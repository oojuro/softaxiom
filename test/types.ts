// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Compile-only consumer contract. Unexpectedly accepted invalid types fail this gate too.
import { Memory } from "../lib/store.js";
import { LocalAgent } from "../lib/runtime.js";
import { githubAdapter } from "../lib/adapters.js";
import type { PreparedAction } from "../lib/browser.js";
import type { Handler } from "../lib/core/agent/tools/runtime.js";

const transactionalReply: Handler<{ token: string }> = async (_input, context) => {
  await context.say("web", "synthetic", undefined, { token: "opaque-host-commit" });
  // @ts-expect-error host commit types remain concrete
  await context.say("web", "synthetic", undefined, { token: 1 });
  return { result: null };
};
void transactionalReply;

const memory = new Memory("/synthetic/workspace/memory");
const timezone: string = memory.call("settings").timezone;
void timezone;
const diaryPage: { text: string; partial: boolean; start: number; end: number; bytes: number } =
  memory.call("diary", { day: "2026-10-23" });
void diaryPage;
// @ts-expect-error operation names are checked
memory.call("unrecognized-operation");
// @ts-expect-error settings are a concrete result, not any
const invalid: number = memory.call("settings").timezone;
void invalid;
// @ts-expect-error adapter transport must be explicit and supported
githubAdapter.configure("hosted-browser");
// @ts-expect-error custom models return a structured message
new LocalAgent("/synthetic/workspace", { complete: async () => 42 });
function scoped(action: PreparedAction) {
  if (action.operation === "close") {
    const id: string = action.args.id;
    void id;
    // @ts-expect-error a close action cannot smuggle a navigation URL
    void action.args.url;
  }
}
void scoped;
// @ts-expect-error strict null checking is mandatory
const nullable: string = null;
void nullable;
// @ts-expect-error implicit any is forbidden
function implicit(value) {
  return value;
}
void implicit;
// @ts-expect-error array indexing must acknowledge a missing element
const indexed: string = ["x"][1];
void indexed;
