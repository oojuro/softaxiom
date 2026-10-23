// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import type { Authenticator } from "./totp.ts";

/** Metadata returned to the agent; passwords and authenticator seeds stay in the store port. */
export interface SavedLogin {
  connectionId: string;
  origins: string[];
  autoSignIn: boolean;
  authenticator: boolean;
  rejectedAt: Date | null;
  generation: number;
}

export interface StoredLogin {
  connectionId: string;
  autoSignIn: boolean;
  generation: number;
}

export interface LoginSecret {
  password: string;
  totp?: Authenticator | undefined;
}

/** Trusted persistence. Every operation must enforce person ownership in the host transaction. */
export interface VaultRows<Row extends StoredLogin, Transaction> {
  get(personId: string, connectionId: string): Promise<Row | undefined>;
  list(personId: string): Promise<Row[]>;
  savedFrom(personId: string, row: Row): Promise<SavedLogin>;
  originsOf(personId: string, row: Row): Promise<string[]>;
  secretOf(personId: string, row: Row): Promise<LoginSecret>;
  put(
    personId: string,
    connectionId: string,
    login: {
      password: string;
      origins?: string[];
      autoSignIn: boolean;
    },
  ): Promise<SavedLogin>;
  setAuthenticator(
    personId: string,
    connectionId: string,
    value: Authenticator | null,
  ): Promise<boolean>;
  setAutoSignIn(personId: string, connectionId: string, enabled: boolean): Promise<Row | undefined>;
  addOriginIn(
    tx: Transaction,
    personId: string,
    connectionId: string,
    origin: string,
  ): Promise<boolean>;
  removeOrigins(
    personId: string,
    connectionId: string,
    removing: readonly string[],
  ): Promise<Row | undefined>;
  remove(personId: string, connectionId: string): Promise<boolean>;
  /** Atomically acquires a typing marker, including the current auto-sign-in setting. */
  claimTyping(personId: string, connectionId: string, now: Date, until: Date): Promise<boolean>;
  settle(
    personId: string,
    connectionId: string,
    outcome: "accepted" | "rejected",
    now: Date,
  ): Promise<void>;
}

export type SecretTyping = "typed" | "origin_mismatch" | "not_secret_field" | "page_changed";
export type SecretField = "password" | "code";

/** The adapter checks both the live field and form destination atomically before typing. */
export interface SecretTab {
  address(): string;
  typeSecret(
    ref: string,
    value: string,
    origins: readonly string[],
    field?: SecretField,
  ): Promise<SecretTyping>;
}
