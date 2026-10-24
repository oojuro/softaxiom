// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { getEnvApiKey } from "../env-api-keys.js";
export function requireApiKey(provider: string, apiKey?: string): string {
    const resolved = apiKey || getEnvApiKey(provider);
    if (!resolved) {
        throw new Error(`No API key for provider: ${provider}`);
    }
    return resolved;
}
