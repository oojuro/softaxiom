// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import type { Api, AssistantMessage, Model } from "../../../llm-core/src/index.js";
import { createEmptyTransportUsage } from "./transport-stream-shared.js";
export function createAssistantOutput(model: Pick<Model, "api" | "provider" | "id">, api: Api = model.api): AssistantMessage {
    return {
        role: "assistant",
        content: [],
        api,
        provider: model.provider,
        model: model.id,
        usage: createEmptyTransportUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
    };
}
