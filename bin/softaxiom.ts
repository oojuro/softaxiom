#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Memory } from "../lib/store.js";
import { LocalAgent, MemoryRuntime } from "../lib/runtime.js";
import { restoreCheckpoint } from "../lib/checkpoint.js";
import { check, MemoryError } from "../lib/common.js";
import { jsonInput } from "../lib/local-state.js";
import { commandHelp, productCommand } from "../lib/product-cli.js";

const HELP = `sa [--workspace DIR] COMMAND

Soft Axiom's local CLI. softaxiom and sa-memory remain compatible command names.

Workspace defaults to SOFTAXIOM_WORKSPACE or the current directory. All five real directories
live in WORKSPACE/memory. JSON arguments come from stdin; results and errors are JSON.

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
  checkpoint DESTINATION          consistent complete immutable memory snapshot outside memory/
  restore SNAPSHOT MANIFEST_SHA256 restore into a fresh workspace's memory/ only
  chat REQUEST                    local memory assistant; requires your configured model endpoint
  browser start|attach|stop|tabs|navigate|snapshot|click|type|press|close|screenshot
                                   your installed local browser; see docs/LOCAL_BROWSER.md
  radar source|subscribe|poll|inbox|tasks|task|results|approvals|approve|reject|work|run
                                   durable local watchers and background tasks; docs/RADAR.md
  bridge github configure|check     explicit API/MCP/local-browser adapter checks
  compass plan [REQUEST]            on-demand day planning; no automatic timer
  agent [--origins ORIGIN,...] REQUEST
                                   local memory/browser task; mutations wait for approval

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
  const command = args.shift();
  if (!command || ["--help", "-h", "help"].includes(command)) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const help = commandHelp[command];
  if (help && (!args.length || ["--help", "-h", "help"].includes(args[0]!))) {
    process.stdout.write(`${help}\n`);
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
    case "chat":
      print(await new LocalAgent(workspace).run(args.join(" ")));
      break;
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
