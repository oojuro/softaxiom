// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { parse } from "../contracts/codes.ts";
import { z } from "zod";

// One id follows a text from the webhook that received it to the delivery that answers it, so a
// slow or lost reply can be traced across web, worker and providers (REQUIREMENTS S5). We mint it
// ourselves; an id from outside is never trusted, because it would flow into every log line.
export const CorrelationId = z.uuid().brand<"CorrelationId">();
export type CorrelationId = z.infer<typeof CorrelationId>;

const current = new AsyncLocalStorage<CorrelationId>();

export function newCorrelationId(): CorrelationId {
  return parse(CorrelationId, randomUUID());
}

/** Everything `work` reports, however deep and however many awaits later, carries `id`. */
export function withCorrelation<Result>(id: CorrelationId, work: () => Result): Result {
  return current.run(id, work);
}

export function currentCorrelation(): CorrelationId | undefined {
  return current.getStore();
}
