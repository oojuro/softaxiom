// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { z } from "zod";
import { localModelProfile } from "./model-access.js";
import { readFileSync } from "node:fs";
import { Inbox } from "./inbox.js";
import { LocalAgent, type LocalModel } from "./runtime.js";
import { LocalExecution } from "./local-execution.js";
import { withAuth, authDirectory } from "./local-auth.js";
import { check, cleanText, hash, MemoryError } from "./common.js";
import { Delegation, SpecialistOutput } from "./core/contracts/delegation.js";

export class Specialists {
  readonly execution: LocalExecution;
  readonly workspace: string;
  constructor(workspace: string) {
    this.workspace = workspace;
    this.execution = new LocalExecution(workspace, authDirectory(), "specialist");
  }
  async quote(inputMicrosPerMillion: number, outputMicrosPerMillion: number) {
    check([inputMicrosPerMillion, outputMicrosPerMillion].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000), "INVALID_MODEL_PRICE");
    const profile = await localModelProfile(); check(profile, "MODEL_NOT_CONFIGURED");
    await withAuth(records => records.write("specialist-quote-" + hash(this.workspace).slice(0,32), {
      profile: hash(JSON.stringify(profile)), inputMicrosPerMillion, outputMicrosPerMillion,
    }));
    return { quoted: true, inputMicrosPerMillion, outputMicrosPerMillion };
  }
  private async costBound(input: number, output: number) {
    const profile = await localModelProfile(); check(profile, "MODEL_NOT_CONFIGURED");
    const quote = await withAuth(records => records.read("specialist-quote-" + hash(this.workspace).slice(0,32),
      z.object({ profile: z.string(), inputMicrosPerMillion: z.number().int().nonnegative(),
        outputMicrosPerMillion: z.number().int().nonnegative() }).strict()));
    check(quote && quote.profile === hash(JSON.stringify(profile)), "SPECIALIST_PRICE_QUOTE_REQUIRED");
    const bound = Math.ceil((input * quote.inputMicrosPerMillion + output * quote.outputMicrosPerMillion) / 1000000);
    check(Number.isSafeInteger(bound), "INVALID_MODEL_PRICE"); return bound;
  }
  start(input: unknown, conversation?: string) {
    check(conversation === undefined || /^[a-f0-9-]{36}$/.test(conversation), "INVALID_SPECIALIST_SCOPE");
    const parsed = Delegation.safeParse(input); check(parsed.success, "INVALID_DELEGATION");
    cleanText(parsed.data.input);
    const request = parsed.data, subscription = `specialist_${request.operationId}`;
    const inbox = new Inbox(this.workspace);
    try {
      const digest = hash(JSON.stringify(request));
      const previous = inbox.get<{ config: string }>("SELECT config FROM sources WHERE id=?", subscription);
      if (previous) {
        check(JSON.parse(previous.config).specialistDigest === digest, "DELEGATION_ID_CONFLICT");
        return { subscription, repeated: true };
      }
      // Configuration comes only from the operator command, never specialist/model output.
      inbox.putSource({ id: subscription, account: "local-specialist", kind: "manual",
        config: { specialist: request, specialistDigest: digest, ...(conversation && { specialistConversation: conversation }) } });
      inbox.putSubscription({ id: subscription, sources: [subscription], instruction: "Scoped specialist task",
        allowedActions: [], origins: [], maxRetries: 0 });
      inbox.ingest(subscription, [{ id: request.operationId, kind: "specialist.request", summary: "Operator-scoped specialist task" }]);
      return { subscription, repeated: false };
    } finally { inbox.close(); }
  }
  list(conversation: string) {
    const inbox = new Inbox(this.workspace);
    try {
      return inbox.all("SELECT id FROM sources WHERE account='local-specialist' AND json_extract(config,'$.specialistConversation')=? ORDER BY rowid DESC LIMIT 10", conversation)
        .map(row => this.state(row.id));
    } finally { inbox.close(); }
  }
  state(subscription: string) {
    const inbox = new Inbox(this.workspace);
    try {
      check(inbox.source(subscription).account === "local-specialist", "SPECIALIST_NOT_FOUND");
      if (!inbox.subscription(subscription).enabled) return { subscription, status: "cancelled" };
      const row = inbox.get("SELECT id FROM tasks WHERE subscription_id=? ORDER BY created_at DESC LIMIT 1", subscription);
      return row ? inbox.task(row.id) : { subscription, status: "queued" };
    } finally { inbox.close(); }
  }
  cancel(subscription: string) {
    const inbox = new Inbox(this.workspace);
    try {
      check(inbox.source(subscription).account === "local-specialist", "SPECIALIST_NOT_FOUND");
      const sub = inbox.subscription(subscription);
      inbox.putSubscription({ id: sub.id, ...sub.config, enabled: false });
      return { cancelled: true };
    } finally { inbox.close(); }
  }
  async work(subscription: string, model?: LocalModel) {
    return withAuth(() => this.run(subscription, model),
      join(authDirectory(), "specialist-coordinator-" + hash(this.workspace).slice(0, 32)));
  }
  private async run(subscription: string, model?: LocalModel) {
    const inbox = new Inbox(this.workspace);
    try {
      const source = inbox.source(subscription);
      check(source.kind === "manual" && source.account === "local-specialist", "SPECIALIST_NOT_FOUND");
      const request = Delegation.parse(source.config.specialist);
      const task = inbox.claimTask(subscription);
      if (!task) return this.state(subscription);
      const token = task.lease_token!;
      const controller = new AbortController();
      const authority = () => { inbox.assertLease(task.id, token); };
      const deadline = setTimeout(() => controller.abort(), request.limits.milliseconds);
      const revocation = setInterval(() => {
        try { authority(); } catch { controller.abort(); }
      }, 200);
      const timer = setInterval(() => {
        try { inbox.renew(task.id, token); } catch { /* Next authority check fences dispatch. */ }
      }, Math.max(10, inbox.leaseMs / 3));
      try {
        check(!task.progress.started, "SPECIALIST_RECONCILIATION_REQUIRED");
        // No nested delegation, permission negotiation, network or ambient data transfer.
        const envelope = { ...request, permissions: { actions: ["analyze"], network: false,
          memory: [], history: false, workspace: false, externalEffects: false },
          boundary: request.agent === "external-jsonl" ? "local offline independent executable" : "local operator-configured provider" };
        const runtime = new LocalAgent(this.workspace, model);
        inbox.progress(task.id, token, { started: true, operationId: request.operationId }, true);
        let text: string, evidence: string;
        if (request.agent === "internal-auditor") {
          const required = model ? 0 : await this.costBound(runtime.settings.context.request,
            runtime.settings.agent.maxOutputTokens);
          check(request.limits.maxMicros >= required, "SPECIALIST_BUDGET_TOO_SMALL");
          let calls = 0;
          const started = Date.now();
          const result = await runtime.run(request.input, { background: true, signal: controller.signal,
            memoryAccess: false, skillsAccess: false, fileAccess: false, terminalAccess: false,
            instructions: readFileSync(new URL("../agent-text/specialist.md", import.meta.url), "utf8"),
            beforeModel: () => { authority(); check(++calls === 1, "SPECIALIST_STEP_LIMIT"); check(Date.now() - started < request.limits.milliseconds,
              "SPECIALIST_TIME_LIMIT"); check(inbox.task(task.id).steps <= 1, "SPECIALIST_STEP_LIMIT"); },
          });
          authority();
          check(Date.now() - started < request.limits.milliseconds && result.status !== "waiting_approval", "SPECIALIST_TIME_LIMIT");
          text = result.text; evidence = result.evidence;
        } else {
          const result = await this.execution.terminal({ operation: request.operationId,
            argv: ["/usr/bin/python3", "-I", "/work/specialist.py", JSON.stringify(envelope)] }, authority);
          check(result.status === "completed" && result.exitCode === 0, "SPECIALIST_EFFECT_UNCERTAIN");
          const lines = result.stdout.trim().split("\n");
          check(lines.length <= 10, "INVALID_SPECIALIST_RESPONSE");
          const outputs = lines.map(line => SpecialistOutput.parse(JSON.parse(line)));
          check(outputs.every(output => output.operationId === request.operationId) &&
            outputs.filter(output => output.type === "result").length === 1 &&
            outputs.at(-1)?.type === "result", "INVALID_SPECIALIST_RESPONSE");
          const last = outputs.at(-1)!; check(last.type === "result", "INVALID_SPECIALIST_RESPONSE");
          text = last.text;
          evidence = runtime.runtime.record("specialist_result", { operationId: request.operationId,
            untrusted: true, outputs }).id;
        }
        authority();
        return inbox.complete(task.id, token, { text, evidence });
      } catch (error) {
        const code = error instanceof MemoryError ? error.code : "SPECIALIST_FAILED";
        try { inbox.fail(task.id, token, code); } catch { /* Revocation already owns cancellation. */ }
        return this.state(subscription);
      } finally { clearInterval(timer); clearInterval(revocation); clearTimeout(deadline); }
    } finally { inbox.close(); }
  }
}
