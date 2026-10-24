// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
export type RecoveredTextToolCall = {
    kind: "toolCall";
    name: string;
    arguments: Record<string, unknown>;
    partialJson: string;
};
export type TextToolCallRecoveryPart = {
    kind: "text";
    text: string;
} | RecoveredTextToolCall;
