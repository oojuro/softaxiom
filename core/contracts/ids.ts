// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { parse } from "./codes.ts";

// People have a host-issued UUID. The brand keeps a
// person id from being passed where another kind of id belongs; ids of other rows are declared
// beside the contracts that use them, the same way.
export const PersonId = z.uuid().brand<"PersonId">();
export type PersonId = z.infer<typeof PersonId>;

// An operation id names one effect for its whole life, so retries and replays dedupe on it. It is
// built from ids and fixed words joined by ":", like `event:source:message:<id>`. The narrow
// alphabet keeps content out: ids appear in logs, Temporal histories and unique keys.
export const OperationId = z
  .string()
  .max(200)
  .regex(/^[\w.-]+(:[\w.-]+)*$/)
  .brand<"OperationId">();
export type OperationId = z.infer<typeof OperationId>;

export function operationId(...parts: string[]): OperationId {
  return parse(OperationId, parts.join(":"));
}
