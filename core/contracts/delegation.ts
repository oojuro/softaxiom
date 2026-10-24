// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
export const Delegation = z.object({
  version: z.literal(1), operationId: z.uuid(),
  agent: z.enum(["internal-auditor", "external-jsonl"]),
  input: z.string().trim().min(1).max(4000),
  limits: z.object({ milliseconds: z.literal(20000), steps: z.literal(1),
    concurrency: z.literal(1), retries: z.literal(0), maxMicros: z.number().int().min(0).max(1000000) }).strict(),
}).strict().superRefine((task, ctx) => {
  if (task.agent === "external-jsonl" && task.limits.maxMicros !== 0)
    ctx.addIssue({ code: "custom", message: "Offline external adapter requires zero spend" });
});
export type Delegation = z.infer<typeof Delegation>;
export const SpecialistOutput = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), operationId: z.uuid(), type: z.literal("progress"),
    text: z.string().max(1000) }).strict(),
  z.object({ version: z.literal(1), operationId: z.uuid(), type: z.literal("result"),
    text: z.string().min(1).max(8000), artifacts: z.array(z.object({
      name: z.string().max(100), digest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict()).max(10) }).strict(),
]);
