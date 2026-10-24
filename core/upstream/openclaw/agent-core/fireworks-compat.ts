// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import type { AssistantMessage } from "../llm-core/src/types.js";
// The fork does not support Responses API truncation recovery or provider compaction replay.
export const isResponsesOutputLimitToolCallError = (_message: AssistantMessage) => false;
export const replaceCompactionReplayOwnerContent = (message: AssistantMessage, content: AssistantMessage["content"]) => ({ ...message, content });
export const createEmptyTransportUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
