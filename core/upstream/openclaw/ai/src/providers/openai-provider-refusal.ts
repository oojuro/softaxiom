// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { readProviderRefusalReview, type ProviderRefusalReview, } from "../../../llm-core/src/utils/diagnostics.js";
import { isRecord } from "../../../normalization-core/src/record-coerce.js";
/** Responses uses snake_case; the ChatGPT app-server error envelope uses camelCase. */
export function readOpenAIMisalignmentReview(value: unknown, continuationSupported: boolean): ProviderRefusalReview | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return readProviderRefusalReview({
        explanation: value.detailed_explanation ?? value.detailedExplanation,
        errorType: value.error_type ?? value.errorType,
        ...(continuationSupported ? { continuation: value.steer } : {}),
    });
}
