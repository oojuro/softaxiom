// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import type { AssistantMessage, ProviderReplayState } from "../../../llm-core/src/index.js";
/** Whether provider replay state is a prefix-bound server compaction checkpoint. */
export function isCompactionReplayCheckpoint(replay: unknown): replay is ProviderReplayState {
    const type = 
    // SAFETY: This predicate inspects only the discriminator; payload validation stays with replay.
    replay && typeof replay === "object" ? (replay as {
        type?: unknown;
    }).type : undefined;
    return (type === "anthropic-compaction" ||
        type === "openai-responses-compaction" ||
        type === "openai-responses-retained-compaction");
}
/** Strip prefix-bound checkpoint state from an in-place message rewrite. */
export function stripCompactionReplayCheckpointInPlace(message: {
    providerReplay?: unknown;
}): void {
    if (isCompactionReplayCheckpoint(message.providerReplay)) {
        delete message.providerReplay;
    }
}
/** Strip prefix-bound checkpoints after local history rewrites. */
export function stripCompactionReplayCheckpoint(message: AssistantMessage): AssistantMessage {
    if (!isCompactionReplayCheckpoint(message.providerReplay)) {
        return message;
    }
    const replaySafeMessage = { ...message };
    delete replaySafeMessage.providerReplay;
    return replaySafeMessage;
}
