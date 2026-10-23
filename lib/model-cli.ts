// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { prompt } from "./account-cli.js";
import { check } from "./common.js";
import { saveModelProfile, modelStatus, forgetModel } from "./model-access.js";

export const modelHelp = `sa setup
Configure independent local model access, without a Soft Axiom Cloud account.
Choose OpenAI, Anthropic or an OpenAI-compatible endpoint and enter a model ID.
Keys are masked and saved privately outside workspace memory; never put them in command arguments.
No model call is made. Subscription sign-in is not part of this setup yet.
sa model status | logout
Inspect or remove local model setup. Cloud login and files remain separate.`;

export async function modelCommand(command: string, args: string[], ask = prompt, root?: string) {
  if (command === "model") {
    check(args.length === 1 && ["status", "logout"].includes(args[0]!), "INVALID_MODEL_OPTION");
    return args[0] === "status" ? modelStatus(root) : forgetModel(root);
  }
  check(command === "setup" && args.length === 0, "INVALID_SETUP_OPTION");
  const provider = (await ask("Provider (openai / anthropic / compatible): ")).toLowerCase();
  check(["openai", "anthropic", "compatible"].includes(provider), "INVALID_MODEL_PROVIDER");
  const baseUrl =
    provider === "openai"
      ? "https://api.openai.com/v1"
      : provider === "anthropic"
        ? "https://api.anthropic.com/v1"
        : await ask("API base URL (HTTPS or loopback HTTP): ");
  const name = await ask("Model ID from your provider: ");
  const apiKey = await ask(
    provider === "compatible" ? "API key (blank for a keyless local server): " : "API key: ",
    true,
  );
  return saveModelProfile({ version: 1, provider, baseUrl, name, ...(apiKey && { apiKey }) }, root);
}
