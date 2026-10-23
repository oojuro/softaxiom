// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// What context assembly and the model round need from the rest of the system, stated here and
// wired by the worker, the way the channel core states what it needs of the transcript. Each
// interface is satisfied as it is by the package that owns it: the transcript store and the
// retriever (workspace), the person's record (db). Nothing here imports those packages, only the
// list of channels (a type).
import type { ErrorCode } from "../../contracts/codes.ts";

export type Channel = "imessage" | "rcs" | "sms" | "whatsapp" | "voice" | "web";
export type FileSource = "workspace" | "shipped";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** One line of a transcript file as the store hands it back. */
export interface StoredLine {
  seq: number;
  op: string;
  at: string;
  kind: string;
  role: string;
  channel?: string | undefined;
  provenance: string;
  run?: string | undefined;
  body: unknown;
}

/** A line to add: the store skips an op it already has, so a retry writes nothing twice. */
export interface NewLine {
  op: string;
  at: string;
  kind: "message" | "model" | "tool_call" | "tool_result" | "note";
  role: "user" | "assistant" | "system" | "tool";
  channel?: Channel;
  provenance: "person" | "agent" | "automation" | "operator" | "imported";
  run?: string;
  body: Json;
}

export interface Placement {
  op: string;
  path: string;
  fileId: string;
  lineNo: number;
  added: boolean;
}

export interface TranscriptReader {
  list(personId: string): Promise<{ path: string; lineCount: number }[]>;
  read(
    personId: string,
    path: string,
    range?: { from?: number; to?: number },
  ): Promise<StoredLine[]>;
}

/** Whose transcript a line belongs to: the person's conversation, or one work task's own file. */
export type Target = { kind: "main" } | { kind: "task"; taskId: string };

export interface TranscriptWriter<Commit = never> {
  append(personId: string, target: Target, lines: NewLine[], commit?: Commit): Promise<Placement[]>;
}

/** One place the model can open with the read tool: a file and a range of its lines. */
export interface Match {
  kind: string;
  path: string;
  lineFrom: number;
  lineTo: number;
  // `path:from-to`, which is how the read tool is asked for the full source.
  reference: string;
  excerpt: string;
}

export interface Retrieval {
  retrieve(
    personId: string,
    query: { text: string; operation: string; skillsOnly?: true },
  ): Promise<{
    matches: Match[];
    skills: { folder: string; similarity: number }[];
    mode: "hybrid" | "keyword";
    reason?: ErrorCode;
  }>;
}

/** A summary file (`memory/summaries/*.md`) the background summarizer wrote. */
export interface Summary {
  path: string;
  text: string;
}

export interface ContextCompactor {
  compact(
    personId: string,
    range: { path: string; from: number; to: number; funding?: "platform" },
  ): Promise<Summary | undefined>;
}

export interface SummarySource {
  latest(personId: string, count: number): Promise<Summary[]>;
}

/** What the person has saved about themselves: the name is theirs to give, so it may be absent. */
export interface PersonProfile {
  get(
    personId: string,
  ): Promise<{ name?: string | undefined; agentName?: string | undefined; timeZone: string }>;
}

/** The person's files (memory, skills, anything they or the agent saved), by path. */
export interface FileReader {
  read(personId: string, path: string, source?: FileSource): Promise<string | undefined>;
}

/** The paths of the person's files under a folder (`memory/timeline/events/`). */
export interface FileLister {
  list(personId: string, folder: string): Promise<string[]>;
}

/** Worker-owned native and browser route descriptors; credential values never cross this port. */
export interface ConnectedRoutes {
  index(personId: string): Promise<{ name: string; command: string; credentialFiles: string[] }[]>;
}
