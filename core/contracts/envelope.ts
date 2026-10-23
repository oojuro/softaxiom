// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { CodedError, parse } from "./codes.ts";

// Workflow inputs outlive the code that wrote them: a workflow started before a deploy is read by
// the worker after it, and during a rolling deploy an older worker may read a newer input. So every
// input carries `v`, readers ignore fields they do not know (an added field needs no new version),
// and older versions are upgraded on read. A new version is only for a change in meaning.
const envelope = z.looseObject({ v: z.int().positive() });

type Upgrades<Output> = Record<number, (raw: unknown) => Output>;

export function versioned<Schema extends z.ZodObject>(
  v: number,
  schema: Schema,
  upgrades: Upgrades<z.output<Schema>> = {},
) {
  return {
    v,
    encode(input: z.input<Schema>): z.output<Schema> & { v: number } {
      return { ...parse(schema, input), v };
    },
    // `unsupported_version` is retryable: a newer input waits for a worker that knows it.
    decode(raw: unknown): z.output<Schema> {
      const written = parse(envelope, raw).v;
      if (written === v) return parse(schema, raw);
      const upgrade = written < v ? upgrades[written] : undefined;
      if (!upgrade) throw new CodedError("unsupported_version");
      return upgrade(raw);
    },
  };
}
