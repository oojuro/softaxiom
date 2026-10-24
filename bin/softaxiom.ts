#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Memory } from "../lib/store.js";
import { MemoryRuntime } from "../lib/runtime.js";
import { restoreCheckpoint } from "../lib/checkpoint.js";
import { check, MemoryError } from "../lib/common.js";
import { jsonInput } from "../lib/local-state.js";
import { commandHelp, productCommand } from "../lib/product-cli.js";
import { accountHelp, accountCommand } from "../lib/account-cli.js";
import { chatCommand, chatHelp } from "../lib/chat-cli.js";
import { modelCommand, modelHelp } from "../lib/model-cli.js";
import { Specialists } from "../lib/specialists.js";
import { LocalSkills } from "../lib/local-skills.js";
import { LocalExecution } from "../lib/local-execution.js";

const HELP = `sa [--workspace DIR] COMMAND

Soft Axiom's local CLI. softaxiom and sa-memory remain compatible command names.

Workspace defaults to SOFTAXIOM_WORKSPACE or the current directory. All five real directories
live in WORKSPACE/memory. JSON arguments come from stdin; results and errors are JSON.

  memory COMMAND                  explicit memory namespace; flat commands below remain compatible
  timezone IANA_ZONE               update diary timezone without rewriting prior entries
  init [CONFIG.json]               initialize folders; optional nonsecret settings
  usage | list | days              inspect capacity, memory IDs/revisions or diary dates
  read ID [BYTE_OFFSET]            read a memory excerpt (partial/offsets explicit)
  search QUERY                    search warm/cool curated knowledge
  context QUERY                   bounded hot + relevant warm/cool context
  curate                          atomic create/update/move/consolidate/retire JSON batch
  diary DAY [BYTE_OFFSET]          read a daily diary excerpt
  write-diary                     write an AI-authored daily account from JSON input
  record                          journal a reported event from JSON {kind,body}; source=tool
  evidence ID [BYTE_OFFSET]        fetch original journal evidence
  journal-search QUERY            search raw experience through Oojuro
  journal-day DAY                  bounded chronological evidence in the configured timezone
  run -- COMMAND [ARG...]          instrument a terminal command and recount its file changes
  permissions status|grant DIR [--write] [--terminal]|revoke
                                   explicitly grant one local project folder outside workspace config
  files list|read|write|mkdir       bounded granted-folder operation; JSON arguments from stdin
  exec [--operation UUID] -- COMMAND [ARG...]
                                   sandboxed command, no network/host credentials; durable receipts
  exec --receipt UUID | --resolve UUID
                                   inspect or acknowledge uncertain work; never repeats it
  checkpoint DESTINATION          consistent complete immutable memory snapshot outside memory/
  restore SNAPSHOT MANIFEST_SHA256 restore into a fresh workspace's memory/ only
  chat [--local] [REQUEST]         interactive or one-shot; persistent local conversation or cloud after login
  setup | model status|logout      independent model setup; private keys, no cloud account required
  specialist start|state|work|cancel|grant|revoke
                                   scoped internal/independent offline specialist; docs/DELEGATION.md
  skills list [OFFSET] | read PATH [BYTE_OFFSET]
                                   discover workspace/skills and open bounded resources
  login [--server HTTPS_ORIGIN]    sign in to your existing cloud account; deployed CLI API required
  logout | status                 this CLI's cloud session, separate from local model access
  browser start|attach|stop|tabs|navigate|snapshot|click|type|press|close|screenshot
                                   your installed local browser; see docs/LOCAL_BROWSER.md
  radar source|subscribe|poll|inbox|tasks|task|results|approvals|approve|reject|work|run
                                   durable local watchers and background tasks; docs/RADAR.md
  bridge github configure|check     explicit API/MCP/local-browser adapter checks
  compass plan [REQUEST]            on-demand day planning; no automatic timer
  agent [--project] [--origins ORIGIN,...] REQUEST
                                   durable task; project tools need --project and a folder grant

Use sa radar --help, sa bridge --help or sa compass --help for each command family.
Direct Markdown edits and mv between tiers are supported. Recount with usage; oversized direct
edits stay on disk but must be consolidated/demoted. Context is bounded independently. See docs/MEMORY.md.`;

const offset = (value: string | undefined) => (value === undefined ? 0 : Number(value));
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

async function main() {
  const args = process.argv.slice(2);
  let workspace: string | undefined = process.env.SOFTAXIOM_WORKSPACE ?? process.cwd();
  if (args[0] === "--workspace") {
    args.shift();
    workspace = args.shift();
    check(workspace, "WORKSPACE_REQUIRED");
  }
  workspace = resolve(workspace);
  let command = args.shift();
  if (command === "memory") {
    command = args.shift();
    const commands = ["init", "usage", "list", "days", "timezone", "read", "search", "context", "curate", "diary", "write-diary", "record", "evidence", "journal-search", "journal-day", "run", "checkpoint", "restore"];
    if (!command || ["--help", "-h", "help"].includes(command)) {
      process.stdout.write(`sa memory COMMAND\nCommands: ${commands.join(", ")}\nUse sa --help for arguments.\n`); return;
    }
    check(commands.includes(command), "UNKNOWN_MEMORY_COMMAND");
  }
  if (!command || ["--help", "-h", "help"].includes(command)) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command === "specialist") {
    const specialist = new Specialists(workspace), operation = args.shift();
    if (operation === "quote") {
      check(args.length === 2, "INVALID_MODEL_PRICE");
      print(await specialist.quote(Number(args[0]), Number(args[1]))); return;
    }
    if (operation === "grant") {
      check(args.length === 1, "SPECIALIST_FOLDER_REQUIRED");
      print(await specialist.execution.allow(args[0]!, false, true)); return;
    }
    if (operation === "receipt" || operation === "resolve") {
      check(args.length === 1, "INVALID_SPECIALIST_COMMAND");
      print(operation === "receipt" ? await specialist.execution.receipt(args[0]!) : await specialist.execution.resolve(args[0]!)); return;
    }
    if (operation === "revoke") { print(await specialist.execution.revoke()); return; }
    if (operation === "start") { check(args.length === 0, "UNEXPECTED_ARGUMENT"); print(specialist.start(jsonInput())); return; }
    check(args.length === 1 && ["state", "work", "cancel"].includes(operation ?? ""), "INVALID_SPECIALIST_COMMAND");
    print(operation === "state" ? specialist.state(args[0]!) : operation === "cancel" ?
      specialist.cancel(args[0]!) : await specialist.work(args[0]!)); return;
  }
  if (command === "skills") {
    if (!args.length || ["--help", "-h", "help"].includes(args[0]!)) {
      process.stdout.write(
        "sa skills list [OFFSET] | read FOLDER/FILE [BYTE_OFFSET]\nRead-only workspace/skills discovery; no scripts execute, no model or memory setup needed.\n",
      );
      return;
    }
    const operation = args.shift();
    check(operation === "list" || operation === "read", "INVALID_SKILL_OPERATION");
    check(args.length <= (operation === "list" ? 1 : 2), "INVALID_SKILL_ARGUMENTS");
    const skills = new LocalSkills(workspace);
    print(
      operation === "list" ? skills.list(offset(args[0])) : skills.read(args[0], offset(args[1])),
    );
    return;
  }
  if (["permissions", "files", "exec"].includes(command)) {
    const execution = new LocalExecution(workspace);
    if (["--help", "-h", "help"].includes(args[0]!)) {
      process.stdout.write("See docs/LOCAL_EXECUTION.md for explicit grants, sandbox prerequisites, limits and reconciliation.\n");
      return;
    }
    if (command === "permissions") {
      const operation = args.shift();
      if (operation === "grant") {
        const folder = args.shift();
        check(folder && args.length <= 2 && new Set(args).size === args.length &&
          args.every(arg => ["--write", "--terminal"].includes(arg)), "INVALID_PERMISSION_OPTION");
        print(await execution.allow(folder, args.includes("--write"), args.includes("--terminal")));
      } else {
        check(args.length === 0 && ["status", "revoke"].includes(operation ?? ""), "INVALID_PERMISSION_OPTION");
        print(await (operation === "status" ? execution.status() : execution.revoke()));
      }
    } else if (command === "files") {
      const operation = args.shift();
      check(operation && args.length === 0, "INVALID_FILE_OPERATION");
      print(await execution.files(operation, jsonInput<Record<string, unknown>>()));
    } else if (["--receipt", "--resolve"].includes(args[0]!)) {
      const mode = args.shift(), operation = args.shift();
      check(operation && args.length === 0, "INVALID_EXECUTION_ID");
      print(await (mode === "--receipt" ? execution.receipt(operation) : execution.resolve(operation)));
    } else {
      let operation: string = randomUUID();
      if (args[0] === "--operation") {
        args.shift();
        const specified = args.shift();
        check(specified, "INVALID_EXECUTION_ID");
        operation = specified;
      }
      check(args.shift() === "--" && args.length, "COMMAND_REQUIRED");
      process.stderr.write(`Sandbox operation: ${operation}\n`);
      const result = await execution.terminal({ operation, argv: args });
      print(result);
      process.exitCode = "exitCode" in result && result.exitCode === 0 && result.status === "completed" ? 0 : 1;
    }
    return;
  }
  const help = ["setup", "model"].includes(command) ? modelHelp : command === "chat" ? chatHelp : Object.hasOwn(commandHelp, command) ? commandHelp[command] :
    Object.hasOwn(accountHelp, command) ? accountHelp[command] : undefined;
  if (help && ((!args.length && (command === "model" || Object.hasOwn(commandHelp, command))) || ["--help", "-h", "help"].includes(args[0]!))) {
    process.stdout.write(`${help}\n`);
    return;
  }
  if (["login", "logout", "status"].includes(command)) {
    print(await accountCommand(command, args));
    return;
  }
  if (["setup", "model"].includes(command)) {
    print(await modelCommand(command, args));
    return;
  }
  if (["bridge", "compass"].includes(command)) {
    print(await productCommand(command, args, workspace));
    return;
  }
  if (["browser", "radar", "agent"].includes(command)) {
    const result = await (await import("../lib/local-cli.js")).localCommand(
      command,
      args,
      workspace,
    );
    if (result !== undefined) print(result);
    return;
  }
  const memory = new Memory(join(workspace, "memory"));
  switch (command) {
    case "init":
      print(memory.initialize(args[0] ? JSON.parse(fs.readFileSync(args[0], "utf8")) : {}));
      break;
    case "usage":
    case "list":
    case "days":
      print(memory.call(command));
      break;
    case "read":
      print(memory.call("read", { id: args[0], offset: offset(args[1]) }));
      break;
    case "timezone":
      check(args.length === 1, "TIMEZONE_REQUIRED");
      print(memory.call("timezone", { timezone: args[0] }));
      break;
    case "search":
    case "context":
      print(memory.call(command, { query: args.join(" ") }));
      break;
    case "curate":
      print(memory.call("curate", jsonInput()));
      break;
    case "diary":
      print(memory.call("diary", { day: args[0], offset: offset(args[1]) }));
      break;
    case "write-diary":
      print(memory.call("writeDiary", jsonInput()));
      break;
    case "record": {
      const input = jsonInput<{ kind: unknown; body: unknown }>();
      check(
        typeof input.kind === "string" && /^[a-z_]{1,40}$/.test(input.kind),
        "INVALID_EVENT_KIND",
      );
      print(
        memory.call("record", { kind: input.kind, body: input.body, meta: { source: "tool" } }),
      );
      break;
    }
    case "evidence":
      print(memory.call("evidence", { id: args[0], offset: offset(args[1]) }));
      break;
    case "journal-search":
      print(memory.call("journalSearch", { query: args.join(" ") }));
      break;
    case "journal-day":
      print(memory.call("journalDay", { day: args[0] }));
      break;
    case "checkpoint":
      check(args[0], "DESTINATION_REQUIRED");
      print(memory.call("checkpoint", { destination: resolve(args[0]) }));
      break;
    case "restore":
      check(args[0] && args[1], "SNAPSHOT_AND_HASH_REQUIRED");
      print(restoreCheckpoint(args[0], memory.root, args[1]));
      break;
    case "run": {
      if (args[0] === "--") args.shift();
      check(args.length > 0, "COMMAND_REQUIRED");
      const runtime = new MemoryRuntime(workspace);
      const result = await runtime.runTool("terminal", { argv: args }, () => {
        const output = spawnSync(args[0]!, args.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        check(!output.error, "TERMINAL_FAILED");
        return {
          stdout: output.stdout,
          stderr: output.stderr,
          exitCode: output.status,
          signal: output.signal,
        };
      });
      print(result);
      process.exitCode = result.result.exitCode === 0 ? 0 : 1;
      break;
    }
    case "chat": {
      const reply = await chatCommand(args, workspace);
      if (reply !== undefined) print(reply);
      break;
    }
    default:
      throw new MemoryError("UNKNOWN_COMMAND");
  }
}

main().catch((error) => {
  print({
    error: {
      code: error instanceof MemoryError ? error.code : "COMMAND_FAILED",
      ...(error instanceof MemoryError ? { details: error.details } : {}),
    },
  });
  process.exitCode = 1;
});
