// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { ErrorCode } from "./codes.ts";
import { versioned } from "./envelope.ts";
import { PersonId } from "./ids.ts";

// A run in progress, as the next execution of its workflow picks it up.
const runState = z.object({
  runId: z.uuid(),
  round: z.int().nonnegative(),
  replyChannel: z.string().min(1),
  messageLines: z.int().nonnegative(),
  // Who started the run decides whether an empty ending may stay silent.
  startedBy: z.enum(["person", "automation"]).default("person"),
  replied: z.boolean().default(false),
  silentEnds: z.int().nonnegative().default(0),
  emptyRounds: z.int().nonnegative().optional(),
  // Set for the run of a work task: its transcript and its prompt are the task's own.
  taskId: z.uuid().optional(),
});

// What `personWorkflow` is started with, and what it carries into its own next execution: a run
// ends with `continueAsNew`, so these two counters and an unfinished run's place are all it keeps.
// The wake from the channels package starts it with `{ personId }` alone, so a start with no `v`
// is read as version 1 (see person.ts).
const personWorkflowInput = z.object({
  personId: PersonId,
  // Message lines written since the last summary, and when the quiet timer ends (epoch ms).
  unsummarized: z.int().nonnegative().default(0),
  summarizeAt: z.int().nonnegative().optional(),
  // Set when a long run rolled into a new execution: the same run goes on, its rounds numbered on.
  resume: runState.optional(),
});
export const PersonWorkflowInput = versioned(1, personWorkflowInput);
export type PersonWorkflowInput = z.output<typeof personWorkflowInput>;

// What a work task is started with: its id, and the generation of the task this execution plays.
// A stop or resume raises the generation, so a workflow that outlived its generation finds out on
// its first step and does nothing. A task rolled into a new execution carries its run's state.
const taskWorkflowInput = z.object({
  personId: PersonId,
  taskId: z.uuid(),
  generation: z.int().nonnegative(),
  resume: runState.optional(),
});
export const TaskWorkflowInput = versioned(1, taskWorkflowInput);
export type TaskWorkflowInput = z.output<typeof taskWorkflowInput>;

// What the person workflow passes around is ids and line placements, never conversation content:
// Temporal's history is not where a person's words may live (ARCHITECTURE sections 3.6 and 4).
// Activities write the transcript themselves and the workflow only learns where things went.
export interface Placed {
  op: string;
  // The transcript file and line, which is how a later activity reads the line back.
  path: string;
  lineNo: number;
}

// A tool call the model asked for, already written to the transcript as a `tool_call` line. The
// input is on that line; the workflow only needs to know what kind of call it is.
export interface PlannedCall {
  id: string;
  name: string;
  // Decided by the tool registry: read-only calls that sit together may run together.
  readOnly: boolean;
  // A keyed digest of name and input, so the workflow can notice a repeat without seeing the input.
  fingerprint: string;
  line: Placed;
}

export type RoundOutcome =
  | { status: "answered"; calls: PlannedCall[] }
  | { status: "declined"; reason: "insufficient" | "over_budget" | "suspended" }
  // Answered and charged on an earlier attempt, but the answer did not survive: nothing to use.
  | { status: "lost" };

export type RunOutcome = "done" | "waiting" | "blocked";

// A fact the run writes into the transcript for the model to see, such as "stopped". Only code
// words and counts fit here, so a note can never carry anything the person said.
export interface Note {
  op: string;
  at: string;
  run: string;
  fact: string;
  detail?: { [key: string]: string | number | string[] };
}

export interface RoundInput {
  personId: string;
  runId: string;
  // Set for the round of a work task, which reads and writes the task's own transcript.
  taskId?: string;
  round: number;
  // The paid operation of this round: stable across retries and replays.
  operationId: string;
  replyChannel: string;
  // Set on the one retry after an answer was charged and then lost: the platform pays for it and
  // the person is never charged twice.
  platformFunded?: true;
}

export interface ToolsInput {
  personId: string;
  runId: string;
  // Set for a work task's batch: the calls are in the task's transcript, not the conversation.
  taskId?: string;
  round: number;
  // One batch: read-only calls that sit together, or one call that is not read-only.
  calls: PlannedCall[];
  replyChannel: string;
}

export interface ToolsOutcome {
  // Conversation lines the batch added (the `message` tool's replies), for the summarizer's count.
  messageLines: number;
  // The run's explicit finish.
  finish?: { outcome: RunOutcome };
}

export type RunEnd =
  | {
      status: "finished";
      outcome?: RunOutcome;
      // The model ended without calling any tool.
      emptyRound?: true;
      // A person started this run and got nothing back: `endRun` sends the short notice.
      notify?: true;
    }
  | { status: "stopped" }
  | { status: "failed"; code: ErrorCode };

export interface ChatActivities {
  // Writes every text still waiting in ingress to the transcript, oldest first (channels).
  appendWaiting(
    personId: string,
    activeRunId?: string,
  ): Promise<{ channel: string; arrivalBatch?: string }[]>;
  // Facts the run adds to the transcript, each under its op: one already written is skipped. A
  // work task's facts go in its own file.
  appendNotes(personId: string, notes: Note[], taskId?: string): Promise<void>;
  openRun(input: {
    personId: string;
    runId: string;
    replyChannel: string;
    arrivalBatches?: string[];
  }): Promise<void>;
  // Records how the run ended, and sends the person's one honest text when it failed or the
  // person was left with nothing.
  endRun(input: { personId: string; runId: string; replyChannel: string } & RunEnd): Promise<void>;
  // Builds the context, asks the model, writes the model line and one `tool_call` line per call.
  modelRound(input: RoundInput): Promise<RoundOutcome>;
  // Runs one batch of calls and writes each result (and any reply) to the transcript.
  runTools(input: ToolsInput): Promise<ToolsOutcome>;
}

// What `summarizeWorkflow` is started with: ids only, never conversation content.
const summarizeWorkflowInput = z.object({ personId: PersonId });
export const SummarizeWorkflowInput = versioned(1, summarizeWorkflowInput);
export type SummarizeWorkflowInput = z.output<typeof summarizeWorkflowInput>;

// How one summary step ended. `more` says lines are still waiting, so the workflow asks again.
export interface SummaryStep {
  status: "summarized" | "up_to_date" | "low_balance" | "daily_cap" | "uncertain";
  more: boolean;
}

export interface SummarizeActivities {
  // Summarizes the next stretch of the person's conversation that has no summary yet.
  summarizeNext(personId: string): Promise<SummaryStep>;
}

// What a task workflow asks of the records around its run. All of them are idempotent: the
// workflow retries them without limit.
export interface TaskActivities {
  // Opens the work run of this generation. `proceed` is false when the task has moved on (stopped,
  // resumed, ended): the workflow then does nothing.
  openTaskRun(input: {
    personId: string;
    taskId: string;
    runId: string;
    generation: number;
  }): Promise<{ proceed: boolean }>;
  // Brings what waits for the task into its transcript: steers aimed at this generation, and the
  // reports of the tasks it delegated. `added` is how many lines that was.
  readControls(input: {
    personId: string;
    taskId: string;
    generation: number;
  }): Promise<{ added: number }>;
  // Ends the computer, records how the run and the task ended, and tells whoever asked for it.
  closeTask(
    input: { personId: string; taskId: string; runId: string; generation: number } & RunEnd,
  ): Promise<void>;
}
