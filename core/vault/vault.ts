// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { report } from "../telemetry/report.ts";
import type {
  LoginSecret,
  SavedLogin,
  SecretTab,
  SecretTyping,
  StoredLogin,
  VaultRows,
} from "./ports.ts";
import { VaultError } from "./errors.ts";
import { authenticatorCode, parseAuthenticator, seedBytes } from "./totp.ts";
import { checkedOrigins, httpsOrigin, onSavedOrigin } from "./origins.ts";
import { createSecretRedactor, minimumSecretLength, type SecretRedactor } from "./redaction.ts";

type OpenedLogin = LoginSecret;
const maximumPasswordLength = 1024;
function checkPassword(password: string) {
  if (password.length < minimumSecretLength || password.length > maximumPasswordLength)
    throw new VaultError("invalid_password");
}
// What is done with a login that may be typed now: types its password, or a code made from its seed.
type Typer<Row extends StoredLogin> = (
  request: TypingRequest,
  stored: Row,
  origins: string[],
) => Promise<TypingStatus>;

export interface VaultOptions<Row extends StoredLogin, Transaction> {
  rows: VaultRows<Row, Transaction>;
  // Other retained credential versions participate in every text/value/error scrub.
  additionalSecrets?: (personId: string) => Promise<readonly string[]>;
  now?: () => Date;
  // How long one typing blocks the next if nobody settles it: a worker that dies mid-typing
  // cannot say whether the password went in, so the login waits rather than type twice.
  markerTtlMs?: number;
}

export interface LoginToSave {
  password: string;
  origins: string[];
  // On unless the person says otherwise: the login is theirs to use on their own behalf.
  autoSignIn?: boolean;
}

export interface TypingRequest {
  personId: string;
  connectionId: string;
  tab: SecretTab;
  // The password field the tab's latest snapshot listed.
  ref: string;
}

// What the run is told. Only `typed` means a password went in, and `uncertain` that it may have.
export type TypingStatus =
  | "typed"
  | "uncertain"
  | "no_saved_login"
  | "off"
  | "no_authenticator"
  | "origin_not_allowed"
  | "retry_later"
  | "not_secret_field"
  | "page_changed"
  | "unreadable";

const reported: Record<TypingStatus, Parameters<typeof report>[2]> = {
  typed: "ok",
  uncertain: "uncertain",
  no_saved_login: "blocked",
  off: "blocked",
  no_authenticator: "blocked",
  origin_not_allowed: "blocked",
  retry_later: "blocked",
  not_secret_field: "blocked",
  page_changed: "blocked",
  unreadable: "failed",
};

const keysOf = (connectionId: string) => [
  connectionId,
  `${connectionId}:seed`,
  `${connectionId}:code`,
];

// The password, the seed as it is spelled and as the key it stands for. Codes made from the seed
// are added when they are made.
function takeOut(redactor: SecretRedactor, connectionId: string, opened: OpenedLogin) {
  const { password, totp } = opened;
  redactor.set(connectionId, password);
  if (!totp) return;
  const key = seedBytes(totp.secret);
  redactor.set(
    `${connectionId}:seed`,
    totp.secret,
    totp.secret.toLowerCase(),
    ...(key ? [key] : []),
  );
}

// Saved logins: sealed, bound to the origins they were saved for, typed by code and never
// returned. The model sees a status word and text with every stored password, authenticator seed
// and code made from one taken out.
export function createVault<Row extends StoredLogin, Transaction>(
  options: VaultOptions<Row, Transaction>,
) {
  const { rows, now = () => new Date(), markerTtlMs = 600_000 } = options;
  // Per person, the logins this process has seen and the generation each was read at.
  const watched = new Map<string, { redactor: SecretRedactor; seen: Map<string, number> }>();

  // Brings the person's redactor up to date with what is stored now. Reading the rows each time
  // is what makes a password saved, replaced or deleted by another process count at once.
  async function redactorFor(personId: string): Promise<SecretRedactor> {
    const state = watched.get(personId) ?? { redactor: createSecretRedactor(), seen: new Map() };
    watched.set(personId, state);
    const stored = await rows.list(personId);
    const present = new Set(stored.map((row) => row.connectionId));
    for (const id of state.seen.keys()) {
      if (present.has(id)) continue;
      for (const key of keysOf(id)) state.redactor.remove(key);
      state.seen.delete(id);
    }
    for (const row of stored) {
      if (state.seen.get(row.connectionId) === row.generation) continue;
      // A login that does not open is in no one's memory, so there is nothing to take out.
      const opened = await rows.secretOf(personId, row).catch(() => undefined);
      if (opened) takeOut(state.redactor, row.connectionId, opened);
      state.seen.set(row.connectionId, row.generation);
    }
    if (options.additionalSecrets) {
      state.redactor.set("credential-versions", ...(await options.additionalSecrets(personId)));
    }
    return state.redactor;
  }

  async function typeInto(request: TypingRequest, stored: Row, origins: string[]) {
    const { personId, connectionId, tab, ref } = request;
    const password = (await rows.secretOf(personId, stored).catch(() => undefined))?.password;
    if (password === undefined) return "unreadable";
    const at = now();
    const until = new Date(at.getTime() + markerTtlMs);
    if (!(await rows.claimTyping(personId, connectionId, at, until))) return "retry_later";
    let typing: SecretTyping;
    try {
      typing = await tab.typeSecret(ref, password, origins);
    } catch {
      // It may or may not have gone in, so the marker stays and nothing is typed again.
      return "uncertain";
    }
    if (typing === "typed") return "typed";
    await rows.settle(personId, connectionId, "accepted", at);
    return typing === "origin_mismatch" ? "origin_not_allowed" : typing;
  }

  // The code for this moment, made from the seed and dropped with it, typed into a code field.
  async function typeCode(request: TypingRequest, stored: Row, origins: string[]) {
    const { personId, connectionId, tab, ref } = request;
    const opened = await rows.secretOf(personId, stored).catch(() => undefined);
    if (!opened) return "unreadable";
    if (!opened.totp) return "no_authenticator";
    const code = authenticatorCode(opened.totp, now());
    (await redactorFor(personId)).set(`${connectionId}:code`, code);
    let typing: SecretTyping;
    try {
      typing = await tab.typeSecret(ref, code, origins, "code");
    } catch {
      return "uncertain";
    }
    return typing === "origin_mismatch" ? "origin_not_allowed" : typing;
  }

  // A login that may be typed now: the person's, switched on and on this very origin, checked
  // before anything is opened. What it is not is the status the run is told.
  async function usable(request: TypingRequest) {
    const { personId, connectionId, tab } = request;
    const stored = await rows.get(personId, connectionId);
    if (!stored) return "no_saved_login";
    if (!stored.autoSignIn) return "off";
    const origins = await rows.originsOf(personId, stored).catch(() => undefined);
    if (!origins) return "unreadable";
    return onSavedOrigin(origins, tab.address()) ? { stored, origins } : "origin_not_allowed";
  }

  async function attempt(
    request: TypingRequest,
    type: Typer<Row> = typeInto,
  ): Promise<TypingStatus> {
    const found = await usable(request);
    return typeof found === "string" ? found : type(request, found.stored, found.origins);
  }

  return {
    async save(personId: string, connectionId: string, login: LoginToSave): Promise<SavedLogin> {
      const origins = checkedOrigins(login.origins);
      checkPassword(login.password);
      return rows.put(personId, connectionId, {
        password: login.password,
        origins,
        autoSignIn: login.autoSignIn ?? true,
      });
    },

    // A password from the private form is bound to the connection's origins at commit time.
    saveForConnection: async (
      personId: string,
      connectionId: string,
      password: string,
      autoSignIn: boolean,
    ) => {
      checkPassword(password);
      return rows.put(personId, connectionId, { password, autoSignIn });
    },

    async describe(personId: string, connectionId: string): Promise<SavedLogin | undefined> {
      const stored = await rows.get(personId, connectionId);
      return stored && rows.savedFrom(personId, stored);
    },

    async list(personId: string): Promise<SavedLogin[]> {
      const stored = await rows.list(personId);
      return Promise.all(stored.map((row) => rows.savedFrom(personId, row)));
    },

    // Keeps (a base32 key or an authenticator link), replaces or (null) removes the seed of a saved
    // login. False when the login has no password to keep it with.
    async setAuthenticator(
      personId: string,
      connectionId: string,
      input: string | null,
    ): Promise<boolean> {
      const authenticator = input === null ? null : parseAuthenticator(input);
      if (authenticator === undefined) throw new VaultError("invalid_authenticator");
      return rows.setAuthenticator(personId, connectionId, authenticator);
    },

    // Lists one more origin a saved login may be typed on. It is the person's approval of a place a
    // sign-in moved to, so only the connection service's approval calls it, never a run.
    async addOrigin(
      personId: string,
      connectionId: string,
      origin: string,
      tx: Transaction,
    ): Promise<boolean> {
      const [checked] = checkedOrigins([origin]);
      return rows.addOriginIn(tx, personId, connectionId, checked as string);
    },

    // Only what narrows a login. Widening it takes `save`, the password typed again, or the above.
    async change(
      personId: string,
      connectionId: string,
      change: { autoSignIn?: boolean; removeOrigins?: string[] },
    ): Promise<SavedLogin | undefined> {
      const { autoSignIn, removeOrigins = [] } = change;
      if (autoSignIn !== undefined) await rows.setAutoSignIn(personId, connectionId, autoSignIn);
      const removing = removeOrigins.map((origin) => httpsOrigin(origin) ?? origin);
      const stored = await rows.removeOrigins(personId, connectionId, removing);
      return stored && rows.savedFrom(personId, stored);
    },

    remove: rows.remove,

    async typePassword(request: TypingRequest): Promise<TypingStatus> {
      const status = await attempt(request);
      report(
        "vault",
        "type",
        reported[status],
        status === "uncertain" ? "outcome_unknown" : undefined,
      );
      return status;
    },

    // The same for a code made from the saved seed, typed into the code field the ref names. It is
    // made at the moment of typing and never returned or kept.
    async typeAuthenticatorCode(request: TypingRequest): Promise<TypingStatus> {
      const status = await attempt(request, typeCode);
      report("vault", "type_code", reported[status]);
      return status;
    },

    // Told by whoever watched the page after a typing. A rejection turns automatic sign-in off.
    settle: (personId: string, connectionId: string, outcome: "accepted" | "rejected") =>
      rows.settle(personId, connectionId, outcome, now()),

    async scrub(personId: string, text: string): Promise<string> {
      return (await redactorFor(personId)).redact(text);
    },

    async scrubValue<T>(personId: string, value: T): Promise<T> {
      return (await redactorFor(personId)).redactValue(value);
    },

    async scrubError(personId: string, error: unknown): Promise<string> {
      return (await redactorFor(personId)).redactError(error);
    },
  };
}

export type Vault<Row extends StoredLogin, Transaction> = ReturnType<
  typeof createVault<Row, Transaction>
>;
