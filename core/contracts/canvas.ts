// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// What the canvas page asks of the server and what it gets back (ARCHITECTURE 2.1, 3.2). The page
// holds no rules of its own: the server decides what needs the person, what is on the screen and
// what it is worth, and sends rows. A program names a record by id only, so every card the page
// draws is one of these rows. Kept apart from `ui.ts`, whose parser the page loads on demand.
import { z } from "zod";
import { Instant } from "./time.ts";

const id = z.uuid();
const shortText = z.string().max(500);

// What an effect can be, in the words of the card and of the tools that declare one.
export const effectKinds = ["send", "payment", "delete", "native"] as const;
export type EffectKind = (typeof effectKinds)[number];

export const ApprovalCardData = z.object({
  id,
  // The page sends back the revision and digest it showed, so a changed approval is a 409.
  revision: z.int().nonnegative(),
  summary: shortText,
  actionDigest: z.string().max(200),
  expiresAt: Instant,
  // The button's label comes from the kind and amount, never from model-written text.
  facts: z.object({
    kind: z.enum(effectKinds),
    target: shortText,
    amountMicros: z.int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
  }),
});
export type ApprovalCardData = z.infer<typeof ApprovalCardData>;

// Facts only. The private sign-in page and its live view stay behind their own route.
export const SignInCardData = z.object({
  id,
  label: shortText,
  site: shortText,
  // Written by code from the challenge (approve on the phone, enter the code), not by a model.
  challenge: z.object({ instruction: shortText, number: z.string().max(12).optional() }).optional(),
});
export type SignInCardData = z.infer<typeof SignInCardData>;

export const TaskView = z.object({
  id,
  title: shortText,
  status: z.enum([
    "queued",
    "running",
    "awaiting_human",
    "stopping",
    "stopped",
    "succeeded",
    "failed",
  ]),
  statusText: shortText.optional(),
  activeAt: Instant,
  // Stop and Resume carry it, so a control aimed at an earlier run of the task is refused.
  generation: z.int().nonnegative(),
});
export type TaskView = z.infer<typeof TaskView>;

export const FileCardData = z.object({
  id,
  title: shortText,
  mediaType: z.string().max(100).optional(),
});
export type FileCardData = z.infer<typeof FileCardData>;

export const CanvasRecords = z.object({
  files: z.record(id, FileCardData),
  tasks: z.record(id, TaskView),
  approvals: z.record(id, ApprovalCardData),
  connections: z.record(id, SignInCardData),
});
export type CanvasRecords = z.infer<typeof CanvasRecords>;

// The page draws these rows as they are. Only what a program names by id is looked up in `records`.
const Need = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approval"), approval: ApprovalCardData }),
  z.object({ kind: z.literal("sign_in"), connection: SignInCardData }),
]);
const Content = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), file: FileCardData }),
  z.object({ kind: z.literal("task"), task: TaskView }),
]);

export const CanvasView = z.object({
  fingerprint: z.string().max(200),
  // Close compares against it, so a late tap cannot clear a newer request.
  revision: z.int().nonnegative(),
  // Approvals and sign-ins, derived live and never part of a program, soonest first; the strip
  // shows three and counts the rest in `more`.
  needs: z.array(Need).max(3),
  more: z.int().nonnegative(),
  // The one thing the person asked to see, if it is still current.
  content: Content.nullable(),
  // The model's Home program, or null (it ships off). Opaque until the page validates it.
  program: z.string().nullable(),
  // The rows that program names by id. A program naming a row not here is not drawn.
  records: CanvasRecords,
  orb: z.object({
    name: z.string().max(100).nullable(),
    line: z.string().max(140).nullable(),
    working: z.boolean(),
  }),
});
export type CanvasView = z.infer<typeof CanvasView>;

// An unchanged screen costs one fingerprint comparison on the server and this on the wire.
export const CanvasPoll = z.union([
  CanvasView,
  z.object({ fingerprint: z.string(), same: z.literal(true) }),
]);
export type CanvasPoll = z.infer<typeof CanvasPoll>;

// The model's Home program on its own, by version: what `GET /api/home` answers and what the work
// agent's `home` tool reads. A version is the row's counter and whether it is still on its way to
// expiring, so a screen that went quiet by the clock changes its fingerprint too.
export const HomeView = z.object({
  fingerprint: z.string().max(200),
  revision: z.int().nonnegative(),
  program: z.string().max(20_000).nullable(),
});
export type HomeView = z.infer<typeof HomeView>;
export const HomePoll = z.union([
  HomeView,
  z.object({ fingerprint: z.string().max(200), same: z.literal(true) }),
]);
export type HomePoll = z.infer<typeof HomePoll>;

// What a write to the Home program answers. Codes name parts of the catalog, never the program.
export type HomeWrite =
  | { saved: true; revision: number }
  | { error: "conflict"; revision: number }
  | { error: "ui_invalid"; codes: string[] }
  | { error: "reference_unavailable" };

export const ApprovalDecision = z.object({
  decision: z.enum(["approved", "denied"]),
  actionDigest: z.string().max(200),
  expectedRevision: z.int().nonnegative(),
});
export const ApprovalOutcome = z.object({ status: z.enum(["approved", "denied", "expired"]) });

export const CanvasClose = z.object({ expectedRevision: z.int().nonnegative() });

export const TaskControl = z.object({
  operationId: z.uuid(),
  action: z.enum(["stop", "resume"]),
  generation: z.int().nonnegative(),
});
