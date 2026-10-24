// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { check } from "./common.js";
import { CloudClient } from "./cloud-client.js";
import { LocalConversation } from "./local-chat.js";
import { browserOrigins } from "./chat-tasks.js";
import { CloudOperationId, type CloudCursor, type CloudTurn } from "./core/contracts/cloud.js";

export const chatHelp = `sa chat [--local] [REQUEST]
sa chat [--local] --operation UUID REQUEST
sa chat [--local] --resume UUID
sa chat --local --history [--before SEQUENCE]
sa chat --local --resolve UUID
sa chat --local --new [REQUEST]
sa chat --local --origins HTTPS_ORIGIN[,HTTPS_ORIGIN] [REQUEST]
sa chat --local --tasks
sa chat --local --cancel-task SUBSCRIPTION
After cloud login, chat joins your existing cloud/iMessage conversation. Replies stay here.
Without cloud login, or with --local, use the persistent local memory conversation.
Omit REQUEST in a terminal for interactive chat. /exit leaves; /history and /new are local.
Local model and Oojuro setup are required. No local files are uploaded by cloud chat.
An operation UUID identifies one message: reuse it after an uncertain send; never invent a
new UUID to retry that message. --resume only reads progress and never submits anything.
Local interruptions block further messages until operator --resolve; that never repeats work.
After a minute, pending cloud work returns its UUID. See docs/CHAT.md for context and recovery.`;

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

export const terminalText = (value: string) => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
  character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));

export async function chatCommand(args: string[], workspace: string) {
  args = [...args];
  let local = false, resume = false, resolve = false, history = false, fresh = false, tasks = false;
  let origins: string[] | undefined;
  let cancelTask: string | undefined;
  let operationId: string | undefined, before: number | undefined;
  const seen = new Set<string>();
  while (args[0]?.startsWith("--")) {
    const option = args.shift()!;
    if (option === "--") break;
    check(!seen.has(option), "INVALID_CHAT_OPTION"); seen.add(option);
    if (option === "--local") local = true;
    else if (option === "--new") fresh = true;
    else if (option === "--history") history = true;
    else if (option === "--tasks") tasks = true;
    else if (option === "--cancel-task") {
      cancelTask = args.shift(); check(cancelTask, "CHAT_TASK_REQUIRED");
    }
    else if (option === "--origins") {
      const value = args.shift(); check(value, "ORIGINS_REQUIRED");
      origins = browserOrigins(value.split(","));
    }
    else if (option === "--before") {
      before = Number(args.shift());
      check(Number.isSafeInteger(before) && before > 0, "INVALID_CHAT_OPTION");
    } else {
      check(["--resume", "--resolve", "--operation"].includes(option) && !operationId, "INVALID_CHAT_OPTION");
      const parsed = CloudOperationId.safeParse(args.shift());
      check(parsed.success, "INVALID_CLOUD_OPERATION"); operationId = parsed.data;
      resume = option === "--resume"; resolve = option === "--resolve";
    }
  }
  const text = args.join(" ").trim();
  check((before === undefined || history) && !(history && (operationId || fresh || tasks)) &&
    !(tasks && (operationId || fresh)) && !(fresh && operationId) &&
    !(origins && (resume || resolve || history || tasks || cancelTask)) &&
    !(cancelTask && (operationId || fresh || history || tasks)), "INVALID_CHAT_OPTION");
  check(!(resume || resolve || history || tasks || cancelTask) || !text, "INVALID_CHAT_OPTION");
  check(!operationId || text || resume || resolve, "CHAT_REQUEST_REQUIRED");
  if (!text && !(resume || resolve || history || tasks || cancelTask))
    check(process.stdin.isTTY && process.stderr.isTTY, "CHAT_REQUEST_REQUIRED");
  const cloud = new CloudClient();
  const cloudMode = !local && (await cloud.status()).connected;
  check(!cloudMode || !(history || resolve || fresh || tasks || origins || cancelTask), "LOCAL_CHAT_OPTION_REQUIRED");
  const conversation = cloudMode ? undefined : new LocalConversation(workspace);
  if (history) return conversation!.history(before);
  if (tasks) return conversation!.tasks();
  if (cancelTask) return conversation!.cancelTask(cancelTask);
  if (resolve) return conversation!.resolve(operationId!);
  if (resume) return cloudMode ? readCloudTurn(cloud, operationId!) : conversation!.resume(operationId!);
  if (fresh) await conversation!.fresh();
  const send = async (request: string, operation: string) => {
    process.stderr.write(`${cloudMode ? "Cloud" : "Local"} operation: ${operation}\n`);
    if (!cloudMode) {
      const reply = await conversation!.send(request, operation, origins);
      const browserTasks = conversation!.tasks().filter(task => task.subscription === `chat_${operation.toLowerCase()}`);
      return browserTasks.length ? { ...reply, browserTasks } : reply;
    }
    await cloud.message({ operationId: operation, text: request });
    return readCloudTurn(cloud, operation);
  };
  if (text) return send(text, operationId ?? randomUUID());
  if (cloudMode) await cloud.pin();
  const reader = createInterface({ input: process.stdin, output: process.stderr, terminal: true, historySize: 0 });
  let active: string | undefined;
  const interrupt = () => {
    if (active) {
      process.stderr.write(`Interrupted. Inspect ${active} with sa chat ${cloudMode ? "" : "--local "}--resume before retrying.\n`);
      process.exit(130);
    }
    reader.close();
  };
  reader.on("SIGINT", interrupt);
  process.once("SIGINT", interrupt);
  process.stderr.write(`${cloudMode ? "Cloud: existing iMessage conversation" : "Local: saved workspace conversation"}. /exit to leave.\n`);
  try {
    reader.setPrompt("you> "); reader.prompt();
    for await (const input of reader) {
      const line = input.trim();
      if (!line) { reader.prompt(); continue; }
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") { process.stderr.write("/exit /history /new /tasks; type a request to continue. Local-only commands never change cloud conversations.\n"); reader.prompt(); continue; }
      if (line === "/history" || line === "/new" || line === "/tasks") {
        if (!conversation) { process.stderr.write("Use --local for local history or a new local conversation. Cloud keeps the existing iMessage conversation.\n"); reader.prompt(); continue; }
        process.stdout.write(terminalText(JSON.stringify(line === "/history" ? conversation.history() :
          line === "/tasks" ? conversation.tasks() : await conversation.fresh(), null, 2)) + "\n");
        reader.prompt();
        continue;
      }
      active = randomUUID();
      const reply = await send(line, active);
      process.stdout.write(terminalText("messages" in reply ? reply.messages.map(message => message.text).join("\n\n") : reply.text ?? reply.status) + "\n");
      if ("browserTasks" in reply) process.stderr.write(terminalText(JSON.stringify({ browserTasks: reply.browserTasks })) +
        "\nInspect with sa chat --local --tasks and sa radar approvals; approval does not itself execute work.\n");
      if (["accepted", "running", "uncertain"].includes(reply.status)) {
        process.stderr.write(`Work is ${reply.status}; resume ${active} before sending another message.\n`); break;
      }
      active = undefined;
      reader.prompt();
    }
  } finally {
    reader.close(); process.removeListener("SIGINT", interrupt);
  }
}
