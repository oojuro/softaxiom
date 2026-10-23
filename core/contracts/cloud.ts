// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

// First-party authenticated chat surfaces join the person's existing conversation.
export const CloudOperationId = z.uuid().toLowerCase();
export const CloudMessage = z.object({
  operationId: CloudOperationId,
  text: z.string().trim().min(1).max(32768),
}).strict();
export type CloudMessage = z.infer<typeof CloudMessage>;

export const CloudCursor = z.object({
  day: z.iso.date(),
  line: z.int().positive(),
}).strict();
export type CloudCursor = z.infer<typeof CloudCursor>;

export const CloudTurn = z.object({
  ingressId: CloudOperationId,
  status: z.enum(["accepted", "running", "finished", "failed", "stopped"]),
  runId: z.uuid().nullable(),
  outcome: z.enum(["done", "waiting", "blocked"]).nullable(),
  messages: z.array(z.object({
    op: z.string().min(1).max(200),
    at: z.iso.datetime(),
    text: z.string().max(262144),
  }).strict()).max(20),
  next: CloudCursor.nullable(),
}).strict();
export type CloudTurn = z.infer<typeof CloudTurn>;
