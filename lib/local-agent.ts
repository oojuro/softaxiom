// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { check, MemoryError } from "./common.js";
import { text, httpUrl } from "./local-state.js";
import { Memory } from "./store.js";
import type { LocalModel, LocalTool } from "./runtime.js";
import type { Inbox } from "./inbox.js";
import { LocalAgent } from "./runtime.js";
import { LocalBrowser } from "./browser.js";
import { modelAccess } from "./model-access.js";

const extraTools: LocalTool[] = ["browser", "task"].map((name) => ({
  type: "function",
  function: {
    name,
    description:
      name === "browser"
        ? "Use the authorized local browser. Reads return outside page content. Mutations return a durable approval request; never treat a proposal as execution."
        : "Inspect task receipts or save a concise progress note, not a transcript. This tool cannot change subscriptions, approve actions or increase permissions.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string" },
        args: { type: "object", additionalProperties: true },
      },
      required: ["operation", "args"],
      additionalProperties: false,
    },
  },
}));

export async function workOnce(
  inbox: Inbox,
  {
    model,
    subscriptionId,
  }: { model?: LocalModel | undefined; subscriptionId?: string | undefined } = {},
): Promise<WorkResult> {
  let settings;
  try {
    settings = new Memory(join(inbox.workspace, "memory")).call("settings");
  } catch {
    return { status: "configuration_required", code: "MEMORY_SETUP_REQUIRED" };
  }
  if (!model) {
    try {
      await modelAccess(settings);
    } catch (error) {
      return { status: "configuration_required", code: error instanceof MemoryError ? error.code : "MODEL_NOT_CONFIGURED" };
    }
  }
  const task = inbox.claimTask(subscriptionId);
  if (!task) return { status: "idle" };
  const token = task.lease_token,
    id = task.id;
  check(token, "TASK_LEASE_LOST");
  const agent = new LocalAgent(inbox.workspace, model);
  let browser: LocalBrowser | undefined,
    leaseLost = false;
  const authority = () => {
    check(!leaseLost, "TASK_LEASE_LOST");
    return inbox.assertLease(id, token).config;
  };
  const connect = async () => {
    browser ??= await LocalBrowser.connect(inbox.workspace);
    return browser;
  };
  const heartbeat = setInterval(
    () => {
      try {
        inbox.renew(id, token);
      } catch {
        leaseLost = true;
      }
    },
    Math.max(10, Math.floor(inbox.leaseMs / 3)),
  );
  const update = (values: Record<string, unknown>, step = false) => {
    const progress = { ...inbox.task(id).progress, ...values };
    inbox.progress(id, token, progress, step);
  };
  try {
    for (const action of task.actions.filter((a) => a.status === "approved")) {
      inbox.beginAction(action.id, token);
      const executed = await agent.runtime.runTool(
        "browser.approved_action",
        { action: action.id, ...action.operation },
        async () => (await connect()).execute(action.operation, authority().origins, authority),
      );
      inbox.finishAction(action.id, token, {
        evidence: executed.evidence,
        result: executed.result,
      });
      update({ lastTool: { action: action.id, evidence: executed.evidence, status: "succeeded" } });
    }
    const current = inbox.task(id);
    const pending = current.actions.find((a) => ["pending", "uncertain"].includes(a.status));
    if (pending) {
      inbox.waitApproval(id, token);
      return { task: id, status: "waiting_approval", action: pending };
    }
    const subscription = inbox.subscription(task.subscription_id);
    const protocol = fs.readFileSync(new URL("../agent-text/local.md", import.meta.url), "utf8");
    const context = {
      task: id,
      progress: current.progress,
      events: current.events
        .slice(0, 10)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          summary: e.summary.slice(0, 500),
          url: e.url,
          observedAt: e.observed_at,
        })),
      eventCount: current.events.length,
      partialEvents: current.events.length > 10,
      receipts: current.actions.map((a) => ({
        id: a.id,
        operation: a.operation.operation,
        status: a.status,
        result: a.result,
      })),
    };
    const response = await agent.run(subscription.config.instruction, {
      background: true,
      memoryAccess: subscription.config.allowedActions.includes("memory"),
      context,
      tools: extraTools,
      instructions: protocol,
      steps: current.steps,
      beforeModel: () => {
        authority();
        update({}, true);
      },
      authorize: (name, request) => {
        const policy = authority();
        if (name === "memory")
          check(policy.allowedActions.includes("memory"), "ACTION_NOT_ALLOWED");
        if (name === "browser")
          check(
            policy.allowedActions.includes(
              ["snapshot", "tabs", "screenshot", "navigate"].includes(request.operation)
                ? "browser.read"
                : "browser.write",
            ),
            "ACTION_NOT_ALLOWED",
          );
      },
      afterTool: (lastTool) => update({ lastTool }),
      execute: async (name, request) => {
        const policy = authority(),
          { operation, args } = request;
        if (name === "task") {
          if (operation === "progress") {
            update({ note: text(args.text, 4000) });
            return { saved: true };
          }
          check(operation === "state", "INVALID_TASK_OPERATION");
          const t = inbox.task(id);
          return {
            progress: t.progress,
            events: t.events.slice(0, 30),
            actions: t.actions.map((a) => ({ id: a.id, status: a.status, result: a.result })),
          };
        }
        const local = await connect();
        if (operation === "tabs")
          return (await local.tabs()).filter((t) => {
            try {
              return policy.origins.includes(httpUrl(t.url).origin);
            } catch {
              return false;
            }
          });
        if (operation === "navigate") {
          const prepared = await local.prepare(operation, args, policy.origins);
          const result = await local.execute(prepared, policy.origins, authority);
          check("id" in result, "BROWSER_NAVIGATION_FAILED");
          await local.pageUrl(result.id, policy.origins);
          return result;
        }
        if (operation === "snapshot") return local.snapshot(text(args.id, 200), policy.origins);
        if (operation === "screenshot") return local.screenshot(text(args.id, 200), policy.origins);
        const prepared = await local.prepare(operation, args, policy.origins);
        const action = inbox.propose(id, token, prepared);
        if (action.status === "succeeded")
          return { alreadyExecuted: true, action: action.id, receipt: action.result };
        check(["pending", "approved"].includes(action.status), "ACTION_ALREADY_FINISHED");
        return { approval: action.id, operation: action.operation, status: action.status };
      },
    });
    if (response.status === "waiting_approval") {
      inbox.waitApproval(id, token);
      return { task: id, ...response };
    }
    const completed = inbox.complete(id, token, {
      text: response.text,
      evidence: response.evidence,
    });
    return {
      task: id,
      status: completed.status,
      result: completed.result,
      notify: subscription.config.notify,
    };
  } catch (error) {
    const code = error instanceof MemoryError ? error.code : "BACKGROUND_TASK_FAILED";
    try {
      inbox.fail(id, token, code);
    } catch {
      return { task: id, status: "interrupted", error: "TASK_LEASE_LOST" };
    }
    return { task: id, status: inbox.task(id).status, error: code };
  } finally {
    clearInterval(heartbeat);
    browser?.close();
  }
}

export function enqueueRequest(inbox: Inbox, instruction: string, origins: string[] = []) {
  text(instruction, 4000);
  const id = `request_${randomUUID()}`;
  inbox.putSource({ id, account: "local-user", kind: "manual", config: {} });
  inbox.putSubscription({
    id,
    sources: [id],
    instruction,
    origins,
    allowedActions: ["memory", "browser.read", "browser.write"],
  });
  inbox.ingest(id, [{ id, kind: "user.request", summary: "Direct local user request", group: id }]);
  return id;
}

interface WorkResult {
  status: string;
  task?: string;
  code?: string;
  error?: string;
  notify?: boolean;
  action?: unknown;
  result?: unknown;
  evidence?: string;
}
