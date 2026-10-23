// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import type { NewLine, StoredLine } from "../context/ports.ts";

// Only the worker-owned envelope counts: text printed by a command or a page cannot invent
// exitCode/status metadata, a note, or the source operation that a later reviewer checks.
function outcome(line: Pick<StoredLine, "body">) {
  if (!line.body || typeof line.body !== "object") return undefined;
  const body = line.body as { name?: string; result?: unknown };
  const result = body.result as { exitCode?: unknown; status?: unknown; error?: unknown } | null;
  if (!result || typeof result !== "object") return undefined;
  if (body.name === "terminal" && typeof result.exitCode === "number")
    return { route: "terminal", status: result.exitCode === 0 ? "succeeded" : "failed" };
  if (body.name === "connect") {
    if (result.status === "connected") return { route: "signin", status: "succeeded" };
    if (["waiting_on_person", "needs_account", "needs_origin"].includes(String(result.status)))
      return { route: "signin", status: "waiting" };
    if (["password_rejected", "code_rejected", "unsupported"].includes(String(result.status)))
      return { route: "signin", status: "failed" };
  }
  if (
    ["terminal", "connect"].includes(body.name ?? "") &&
    ["unavailable", "refused", "invalid_input", "not_found"].includes(String(result.error))
  )
    return { route: body.name === "terminal" ? "terminal" : "signin", status: "failed" };
  return undefined;
}

export function learningFacts(
  previous: StoredLine[],
  results: Pick<StoredLine, "op" | "body">[],
  runId: string,
  at: string,
): NewLine[] {
  const notes: NewLine[] = [];
  for (const result of results) {
    const state = outcome(result);
    if (!state) continue;
    const body = result.body as { id?: unknown; name?: unknown };
    const call = previous.findLast(
      (line) =>
        line.kind === "tool_call" &&
        line.run === runId &&
        line.role === "assistant" &&
        line.provenance === "agent" &&
        (line.body as { id?: unknown })?.id === body.id,
    );
    const input = call?.body as { name?: unknown; input?: unknown } | undefined;
    const routeKey =
      input?.name === body.name && input?.input !== undefined
        ? createHash("sha256")
            .update(JSON.stringify([input.name, input.input]))
            .digest("hex")
        : undefined;
    const before = [...previous, ...notes].findLast(
      (line) =>
        line.kind === "note" &&
        line.run === runId &&
        (line.body as { route?: unknown } | null)?.route === state.route &&
        (line.body as { routeKey?: unknown })?.routeKey === routeKey,
    );
    const prior = before?.body as
      | { fact?: unknown; evidence?: unknown; routeKey?: unknown }
      | undefined;
    const failedOp =
      Array.isArray(prior?.evidence) && typeof prior.evidence[0] === "string"
        ? prior.evidence[0]
        : undefined;
    const fact =
      state.status === "waiting"
        ? "sign_in_waiting"
        : state.status === "failed"
          ? "route_failed"
          : prior?.fact === "route_failed" && failedOp && routeKey
            ? "route_recovered"
            : undefined;
    if (!fact) continue;
    const evidence = fact === "route_recovered" ? [failedOp ?? "", result.op] : [result.op];
    notes.push({
      op: `${result.op}:learning`,
      at,
      kind: "note",
      role: "system",
      provenance: "agent",
      run: runId,
      body: { fact, route: state.route, evidence, ...(routeKey && { routeKey }) },
    });
  }
  return notes;
}
