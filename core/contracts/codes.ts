// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

// A failure is described by one of these codes and nothing else, so diagnostics stay content-free
// and their cardinality stays bounded (REQUIREMENTS S1). Add a code here instead of putting detail
// in a message. The flag says whether repeating the same operation is safe and may succeed; a
// failure that cannot prove nothing happened is never retryable: it is reconciled instead.
export const errorCodes = {
  invalid_input: { retryable: false },
  // Refused locally before a hold or dispatch; a caller may compact once under the same operation.
  context_overflow: { retryable: false },
  // A newer worker can read it, so the work waits for one instead of failing (rolling deploys).
  unsupported_version: { retryable: true },
  not_found: { retryable: false },
  // A compare-and-set lost: the caller re-reads and decides again; the same write never succeeds.
  conflict: { retryable: false },
  unauthorized: { retryable: false },
  rate_limited: { retryable: true },
  // Refused before anything was sent (connection refused, 5xx without side effects).
  unavailable: { retryable: true },
  // A definite refusal from the other side.
  refused: { retryable: false },
  // Sent, but no answer: it may have happened, so it is never repeated blindly.
  outcome_unknown: { retryable: false },
  insufficient_funds: { retryable: false },
  cancelled: { retryable: false },
  internal: { retryable: false },
} as const satisfies Record<string, { retryable: boolean }>;

export type ErrorCode = keyof typeof errorCodes;
export const ErrorCode = z.enum(Object.keys(errorCodes) as [ErrorCode, ...ErrorCode[]]);

// The message is the code alone because errors travel to logs and Sentry. Local detail may ride on
// `cause`; telemetry reports the code, never the cause.
export class CodedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, options?: ErrorOptions) {
    const checked = ErrorCode.safeParse(code);
    const safe = checked.success ? checked.data : "internal";
    super(safe, options);
    this.name = "CodedError";
    this.code = safe;
  }

  get retryable(): boolean {
    return errorCodes[this.code].retryable;
  }
}

/** Parses a value at a boundary; anything the schema rejects becomes `invalid_input`. */
export function parse<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) throw new CodedError("invalid_input", { cause: result.error });
  return result.data;
}
