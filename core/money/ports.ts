// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
export type Usage = Record<string, number>;
export interface Budget {
  key: string;
  since: Date;
  limitMicros: number;
}
export type PaidResult<T> =
  | { status: "settled"; value: T; costMicros: number; absorbedMicros: number }
  | { status: "already_settled"; costMicros: number }
  | { status: "declined"; reason: "insufficient"; availableMicros: number }
  | { status: "declined"; reason: "over_budget"; remainingMicros: number }
  | { status: "declined"; reason: "suspended" };
export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`provider answered ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}
