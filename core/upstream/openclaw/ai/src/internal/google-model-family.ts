// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { normalizeLowercaseStringOrEmpty } from "../../../normalization-core/src/string-coerce.js";
export function isGoogleGemini3ProModel(modelId: string): boolean {
    const normalized = normalizeLowercaseStringOrEmpty(modelId);
    return /(?:^|\/)gemini-(?:3(?:\.\d+)?-pro|pro-latest)(?:-|$)/.test(normalized);
}
export function isGoogleGemini3FlashModel(modelId: string): boolean {
    const normalized = normalizeLowercaseStringOrEmpty(modelId);
    return /(?:^|\/)gemini-(?:3(?:\.\d+)?-flash|flash(?:-lite)?-latest)(?:-|$)/.test(normalized);
}
export function isGoogleGemini4Model(modelId: string): boolean {
    return /(?:^|\/)gemini-4(?:[-.]|$)/.test(normalizeLowercaseStringOrEmpty(modelId));
}
/** Identifies thinkingLevel-family Gemini models (3.x and 4). */
export function isGoogleGemini3ThinkingLevelModel(modelId: string): boolean {
    return (isGoogleGemini3ProModel(modelId) ||
        isGoogleGemini3FlashModel(modelId) ||
        isGoogleGemini4Model(modelId));
}
