// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { check } from "./common.js";
import { githubAdapter, createGithubMcp, type AdapterTransport } from "./adapters.js";
import { LocalBrowser } from "./browser.js";
import { localCommand } from "./local-cli.js";

export const commandHelp: Readonly<Record<string, string>> = {
  radar: `sa radar COMMAND
  source | sources | source-delete ID   explicitly configure watched sources
  subscribe | subscriptions            configure scoped background work
  poll | inbox [--unread] | read ID     collect events and track human read state
  tasks | task ID | results            inspect background work
  approvals | approve ID | reject ID   decide exact proposed actions
  resolve-action ID OUTCOME            reconcile an uncertain action
  work [SUBSCRIPTION] | run | listen   run locally; no managed service is installed
See docs/RADAR.md for JSON inputs, recovery and limits.`,
  bridge: `sa bridge github COMMAND
  configure api|mcp|browser            describe the available read-only adapter
  check api|mcp --token-env NAME [--account LOGIN]
  check browser [--account LOGIN]      check the configured local browser
Credentials are read from the explicitly named environment variable, never command arguments.
Checks run once. They do not grant permissions, install a daemon or promise permanent login.
See docs/CLI.md and docs/ADAPTER_SDK.md.`,
  compass: `sa compass plan [--origins ORIGIN,...] [REQUEST]
Create an on-demand day-planning task using curated memory and explicitly allowed browser origins.
No daily timer is created. Inspect results and approvals with sa radar tasks/results/approvals.
Uses your configured model and Oojuro; see docs/CLI.md for current limitations.`,
};

export async function productCommand(command: string, args: string[], workspace: string) {
  if (command === "compass") {
    check(args.shift() === "plan", "UNKNOWN_COMPASS_COMMAND");
    const instruction = readFileSync(new URL("../agent-text/compass-local.md", import.meta.url), "utf8");
    return localCommand("agent", [instruction, ...args], workspace);
  }
  check(args.shift() === "github", "BRIDGE_ADAPTER_UNSUPPORTED");
  const operation = args.shift(), transport = args.shift();
  check(["api", "mcp", "browser"].includes(transport ?? ""), "ADAPTER_TRANSPORT_UNSUPPORTED");
  const selected = transport as AdapterTransport;
  if (operation === "configure") {
    check(args.length === 0, "UNEXPECTED_ARGUMENT");
    return githubAdapter.configure(selected);
  }
  check(operation === "check", "UNKNOWN_BRIDGE_COMMAND");
  const options: Record<string, string> = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    check(flag && ["--account", "--token-env"].includes(flag) && value && !value.startsWith("--"), "INVALID_BRIDGE_OPTION");
    check(!Object.hasOwn(options, flag), "INVALID_BRIDGE_OPTION");
    options[flag] = value;
  }
  const account = options["--account"], name = options["--token-env"];
  check(!account || /^[a-zA-Z0-9-]{1,39}$/.test(account), "INVALID_BRIDGE_ACCOUNT");
  if (selected === "browser") {
    check(!name, "INVALID_BRIDGE_OPTION");
    const browser = await LocalBrowser.connect(workspace);
    try {
      return await githubAdapter.probe({ transport: selected, ...(account ? { account } : {}), browser });
    } finally {
      browser.close();
    }
  }
  check(name && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(name), "BRIDGE_TOKEN_ENV_REQUIRED");
  const token = process.env[name];
  check(token, "ADAPTER_CREDENTIAL_MISSING");
  return githubAdapter.probe({
    transport: selected, ...(account ? { account } : {}), token,
    ...(selected === "mcp" ? { mcp: createGithubMcp({ token }) } : {}),
  });
}
