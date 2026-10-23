// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { check, MemoryError } from "./common.js";
import { CloudClient, CloudDestination, DEFAULT_CLOUD, cloudOrigin } from "./cloud-client.js";

export const accountHelp: Readonly<Record<string, string>> = {
  login: `sa login [--server HTTPS_ORIGIN]
Sign in to your existing Soft Axiom Cloud account with an email/phone code.
Use the identity linked to your iMessage agent. No new account or local-workspace upload.
Cloud CLI support must be deployed before sign-in. Model-provider login is separate.`,
  logout: `sa logout
Remove this CLI's cloud session. Local files and model credentials remain.
The result says whether remote revocation could be confirmed.`,
  status: `sa status
Show whether this CLI has a saved cloud session and its server. No tokens are printed.
This offline status does not establish that the server or session is currently reachable.`,
};

export async function prompt(label: string, secret = false) {
  check(process.stdin.isTTY, "INTERACTIVE_INPUT_REQUIRED");
  const controller = new AbortController();
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: secret ? muted : process.stderr, terminal: true });
  reader.once("SIGINT", () => controller.abort());
  reader.once("close", () => controller.abort());
  if (secret) process.stderr.write(label);
  try {
    const value = await reader.question(secret ? "" : label, { signal: controller.signal });
    check(value.length <= 4096, "INPUT_TOO_LARGE");
    return value.trim();
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError("INPUT_CANCELLED");
  } finally {
    reader.close();
    if (secret) process.stderr.write("\n");
  }
}

export async function accountCommand(command: string, args: string[]) {
  const cloud = new CloudClient();
  if (command === "status" || command === "logout") {
    check(args.length === 0, "UNEXPECTED_ARGUMENT");
    return command === "status" ? cloud.status() : cloud.logout();
  }
  check(command === "login", "UNKNOWN_ACCOUNT_COMMAND");
  let origin = DEFAULT_CLOUD;
  if (args.length) {
    check(args.length === 2 && args[0] === "--server" && args[1], "INVALID_LOGIN_OPTION");
    origin = cloudOrigin(args[1]);
  }
  process.stderr.write(`Soft Axiom Cloud: ${origin}\nUse the email or phone already linked to your agent.\n`);
  const address = await prompt("Email or phone (with country code): ");
  const destination = CloudDestination.safeParse(address.startsWith("+") ? { phone: address } : { email: address });
  check(destination.success, "INVALID_CLOUD_DESTINATION");
  await cloud.requestCode(destination.data, origin);
  return cloud.verify(destination.data, await prompt("Verification code: ", true), origin);
}
