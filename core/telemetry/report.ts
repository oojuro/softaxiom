// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError, ErrorCode } from "../contracts/codes.ts";
export type Status = "ok" | "failed" | "blocked" | "uncertain";
type Reporter = (area: string, operation: string, status: Status, code?: ErrorCode) => void;
let reporter: Reporter | undefined;
export function useDiagnostics(sink?: Reporter) {
  reporter = sink;
}
export function report(area: string, operation: string, status: Status, code?: ErrorCode) {
  if (!/^[a-z][a-z_.-]{0,39}$/.test(area) || !/^[a-z][a-z_.-]{0,79}$/.test(operation)) return;
  if (
    !["ok", "failed", "blocked", "uncertain"].includes(status) ||
    (code !== undefined && !ErrorCode.safeParse(code).success)
  )
    return;
  try {
    reporter?.(area, operation, status, code);
  } catch {
    /* Diagnostics cannot change execution. */
  }
}
export function codeOf(error: unknown): ErrorCode {
  return error instanceof CodedError ? error.code : "internal";
}
