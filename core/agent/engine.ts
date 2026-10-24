// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Hosts extend the upstream lifecycle; they do not implement another loop.
export { Agent } from "../upstream/openclaw/agent-core/src/agent.js";
export type { AgentOptions } from "../upstream/openclaw/agent-core/src/agent.js";
export type { AgentMessage, AgentTool, AgentEvent, StreamFn } from "../upstream/openclaw/agent-core/src/types.js";
export { buildSessionContext } from "../upstream/openclaw/agent-core/src/harness/session/session.js";
export { prepareCompaction, compact, estimateContextTokens, shouldCompact } from "../upstream/openclaw/agent-core/src/harness/compaction/compaction.js";
export type { SessionTreeEntry } from "../upstream/openclaw/agent-core/src/harness/types.js";
export { convertToLlm } from "../upstream/openclaw/agent-core/src/harness/messages.js";
export { createFailureMessage } from "../upstream/openclaw/agent-core/src/turn-interruption.js";
