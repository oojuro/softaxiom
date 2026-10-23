// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { createSecretRedactor } from "./redaction.ts";

export const capturePlanRecord = z.looseObject({
  // API issuance retains the approved browser plan as provenance; it never reads its selector.
  provider: z.literal("cloudflare-user-token").optional(),
  label: z.string().min(1).max(160),
  url: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.hash;
    }),
  selector: z.string().min(1).max(1000),
  revealSelector: z.string().min(1).max(1000).optional(),
});
export const providerIdentity = z.strictObject({
  kind: z.literal("cloudflare-user-token"),
  id: z.string().regex(/^[a-f0-9]{32}$/),
});
export const credentialSecretRecord = z.looseObject({
  provider: providerIdentity.optional(),
  value: z
    .string()
    .min(8)
    .max(8192)
    .regex(/^[\x21-\x7e]+$/),
});
export type CapturePlan = z.infer<typeof capturePlanRecord>;
export type CredentialState = "pending" | "capturing" | "candidate" | "current" | "retired";

export interface CredentialVersion {
  credentialId: string;
  versionId: string;
  connectionId: string;
  state: CredentialState;
  browserClosed: boolean;
}

/** Trusted host ports: enforce ownership, encrypt plans/secrets, serialize promotion and capture. */
export interface CredentialRows {
  prepare(personId: string, input: CredentialVersionInput): Promise<CredentialVersion>;
  get(personId: string, versionId: string): Promise<CredentialVersion | undefined>;
  list(personId: string, credentialId: string): Promise<CredentialVersion[]>;
  plan(personId: string, versionId: string): Promise<CapturePlan>;
  claim(personId: string, versionId: string): Promise<boolean>;
  captured(
    personId: string,
    versionId: string,
    value: string,
    provider?: z.infer<typeof providerIdentity>,
  ): Promise<void>;
  /** Serialize with browser access; close once and commit the unblock together. */
  closed(
    personId: string,
    versionId: string,
    close: () => Promise<void>,
  ): Promise<CredentialVersion>;
  promote(personId: string, versionId: string, expectedCurrent: string | null): Promise<boolean>;
  /** All retained versions, including candidates and retired keys, must remain redacted. */
  secrets(personId: string): Promise<string[]>;
}

export interface CredentialVersionInput {
  credentialId: string;
  versionId: string;
  connectionId: string;
  plan: CapturePlan;
}

/** A quarantined browser. Only this trusted port may reveal/read; close ends every tab/popup. */
export interface KeyCaptureBrowser {
  revealAndRead(plan: CapturePlan): Promise<string>;
  close(): Promise<void>;
}

export class CredentialError extends Error {
  readonly code: "invalid_capture" | "conflict" | "unavailable";
  constructor(code: "invalid_capture" | "conflict" | "unavailable") {
    super(`credential: ${code}`);
    this.name = "CredentialError";
    this.code = code;
  }
}

export type CaptureResult = {
  status: "captured" | "closed" | "uncertain" | "cleanup_required" | "unavailable";
  version?: CredentialVersion;
};

/** Trusted worker API, not a model tool. Authorization must precede prepare and promotion. */
export function createCredentials(rows: CredentialRows) {
  async function prepare(personId: string, input: CredentialVersionInput) {
    const parsed = capturePlanRecord.safeParse(input.plan);
    if (!parsed.success) throw new CredentialError("invalid_capture");
    return rows.prepare(personId, { ...input, plan: parsed.data });
  }

  async function close(
    personId: string,
    versionId: string,
    browser: KeyCaptureBrowser,
  ): Promise<CaptureResult> {
    try {
      if (!(await rows.get(personId, versionId))) return { status: "unavailable" };
      const version = await rows.closed(personId, versionId, () => browser.close());
      const captured = ["candidate", "current", "retired"].includes(version.state);
      return { status: captured ? "captured" : "closed", version };
    } catch {
      return { status: "cleanup_required" };
    }
  }

  async function capture(
    personId: string,
    versionId: string,
    browser: KeyCaptureBrowser,
  ): Promise<CaptureResult> {
    try {
      const version = await rows.get(personId, versionId);
      if (!version) return { status: "unavailable" };
      if (["candidate", "current", "retired"].includes(version.state))
        return close(personId, versionId, browser);
      const plan = capturePlanRecord.parse(await rows.plan(personId, versionId));
      if (plan.provider) return { status: "unavailable" };
      if (version.browserClosed || !(await rows.claim(personId, versionId)))
        return { status: "uncertain" };
      const value = credentialSecretRecord.parse({
        value: await browser.revealAndRead(plan),
      }).value;
      await rows.captured(personId, versionId, value);
    } catch {
      // Keep the browser quarantined for reconciliation; never repeat a reveal after a lost ACK.
      return { status: "uncertain" };
    }
    return close(personId, versionId, browser);
  }

  /** Trusted API issuance uses the same durable claim; a lost response is never reissued. */
  async function captureProvider(
    personId: string,
    versionId: string,
    provider: {
      kind: "cloudflare-user-token";
      issue(): Promise<z.infer<typeof credentialSecretRecord>>;
    },
  ): Promise<CaptureResult> {
    try {
      const version = await rows.get(personId, versionId);
      if (!version) return { status: "unavailable" };
      const plan = capturePlanRecord.parse(await rows.plan(personId, versionId));
      if (plan.provider !== provider.kind) return { status: "unavailable" };
      if (!["candidate", "current", "retired"].includes(version.state)) {
        if (version.browserClosed || !(await rows.claim(personId, versionId)))
          return { status: "uncertain" };
        const secret = credentialSecretRecord.parse(await provider.issue());
        if (secret.provider?.kind !== provider.kind) return { status: "uncertain" };
        await rows.captured(personId, versionId, secret.value, secret.provider);
      }
      // No browser was opened by this path. Only a persisted candidate releases the privacy block.
      const closed = await rows.closed(personId, versionId, async () => {});
      return { status: "captured", version: closed };
    } catch {
      return { status: "uncertain" };
    }
  }

  async function scrub(personId: string, text: string) {
    const redactor = createSecretRedactor();
    (await rows.secrets(personId)).forEach((value, index) => redactor.set(String(index), value));
    return redactor.redact(text);
  }

  return {
    prepare,
    capture,
    captureProvider,
    close,
    list: (personId: string, credentialId: string) => rows.list(personId, credentialId),
    promote: (personId: string, versionId: string, expectedCurrent: string | null) =>
      rows.promote(personId, versionId, expectedCurrent),
    scrub,
  };
}
