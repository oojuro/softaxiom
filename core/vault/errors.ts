// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Why a saved login could not be kept or read. Never carries a value.
export type VaultErrorCode =
  | "no_connection" // the connection is not this person's, or does not exist
  | "no_origin" // a login needs at least one origin it may be typed on
  | "invalid_origin" // not an exact `https` origin
  | "invalid_password" // empty, too short to tell from ordinary text, or too long
  | "invalid_authenticator" // not a base32 key or an authenticator link with usual settings
  | "unreadable" // the sealed record does not open: wrong row, changed, or from a newer release
  | "conflict"; // other writers kept winning

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode) {
    super(`vault: ${code}`);
    this.code = code;
    this.name = "VaultError";
  }
}
