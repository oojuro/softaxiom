// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { check } from "./common.js";
import { CloudClient } from "./cloud-client.js";
import { LocalAgent } from "./runtime.js";
import type { CloudCursor, CloudTurn } from "./core/contracts/cloud.js";

export const chatHelp = `sa chat [--local] REQUEST
sa chat --operation UUID REQUEST
sa chat --resume UUID
After cloud login, chat joins your existing cloud/iMessage conversation. Replies stay here.
Without cloud login, or with --local, use the independent local memory assistant.
Local model and Oojuro setup are required. No local files are uploaded by cloud chat.
An operation UUID identifies one message: reuse it after an uncertain send; never invent a
new UUID to retry that message. --resume only reads progress and never submits anything.
After a minute, pending work returns its UUID so you can resume without resending.`;

export async function readCloudTurn(
  cloud: Pick<CloudClient, "turn">,
  operationId: string,
  wait: () => Promise<void> = () => new Promise(done => setTimeout(done, 1000)),
  now = Date.now,
) {
  const deadline = now() + 60000, messages: CloudTurn["messages"] = [];
  let after: CloudCursor | undefined, bytes = 0, pages = 0;
  for (;;) {
    check(++pages <= 128, "CLOUD_REPLY_TOO_LARGE", { operationId });
    const turn = await cloud.turn(operationId, after);
    for (const message of turn.messages) {
      bytes += Buffer.byteLength(message.text);
      check(bytes <= 2 * 1024 * 1024, "CLOUD_REPLY_TOO_LARGE", { operationId });
      messages.push(message);
    }
    if (turn.next) {
      check(turn.messages.length > 0 && !["accepted", "running"].includes(turn.status), "CLOUD_INVALID_RESPONSE");
      check(!after || turn.next.day > after.day ||
        (turn.next.day === after.day && turn.next.line > after.line), "CLOUD_INVALID_CURSOR");
      after = turn.next;
      continue;
    }
    if (!["accepted", "running"].includes(turn.status) || now() >= deadline)
      return { ...turn, messages, operationId };
    // Pending turns carry no reply page: only a terminal run gives a complete result.
    check(messages.length === 0, "CLOUD_INVALID_RESPONSE");
    await wait();
  }
}

export async function chatCommand(args: string[], workspace: string) {
  let local = false, resume = false, operationId: string | undefined;
  if (args[0] === "--local") { local = true; args = args.slice(1); }
  else if (["--resume", "--operation"].includes(args[0]!)) {
    resume = args[0] === "--resume";
    operationId = args[1];
    check(z.uuid().safeParse(operationId).success, "INVALID_CLOUD_OPERATION");
    args = args.slice(2);
  }
  check(!args.some(arg => arg.startsWith("--")), "INVALID_CHAT_OPTION");
  const text = args.join(" ").trim();
  check(resume ? !text : text.length > 0, "CHAT_REQUEST_REQUIRED");
  const cloud = new CloudClient();
  if (local || !(await cloud.status()).connected) {
    check(!operationId, "CLOUD_LOGIN_REQUIRED");
    return new LocalAgent(workspace).run(text);
  }
  operationId ??= randomUUID();
  process.stderr.write(`Cloud operation: ${operationId}\n`);
  if (!resume) await cloud.message({ operationId, text });
  return readCloudTurn(cloud, operationId);
}
