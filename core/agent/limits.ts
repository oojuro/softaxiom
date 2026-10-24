// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../contracts/codes.ts";

export const executionLimits = Object.freeze({
  toolCalls: 64,
  argumentBytes: 65536,
  requestBytes: 1048576,
  responseBytes: 1048576,
});

/** Bound provider-made batches before storing or dispatching any of them. */
export function assertCalls(calls: readonly { id: string; name: string; input: unknown }[]): void {
  if (!Array.isArray(calls) || calls.length > executionLimits.toolCalls)
    throw new CodedError("invalid_input");
  let total = 0;
  const ids = new Set<string>();
  for (const call of calls) {
    if (
      !call ||
      typeof call.id !== "string" ||
      !/^(?=.{1,200}$)[\w:.-]+(?:\|[\w:.-]+)?$/.test(call.id) ||
      ids.has(call.id) ||
      typeof call.name !== "string" ||
      !/^[a-z][a-z0-9_]{0,39}$/.test(call.name)
    )
      throw new CodedError("invalid_input");
    ids.add(call.id);
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(call.input);
    } catch {
      throw new CodedError("invalid_input");
    }
    total += Buffer.byteLength(encoded ?? "");
    if (total > executionLimits.responseBytes) throw new CodedError("invalid_input");
    if (encoded === undefined || Buffer.byteLength(encoded) > executionLimits.argumentBytes)
      throw new CodedError("invalid_input");
  }
}

export function assertAnswer(answer: {
  text: string;
  calls: readonly { id: string; name: string; input: unknown }[];
}) {
  assertCalls(answer.calls);
  let encoded: string;
  try {
    encoded = JSON.stringify(answer);
  } catch {
    throw new CodedError("invalid_input");
  }
  if (typeof answer.text !== "string" || Buffer.byteLength(encoded) > executionLimits.responseBytes)
    throw new CodedError("invalid_input");
}
