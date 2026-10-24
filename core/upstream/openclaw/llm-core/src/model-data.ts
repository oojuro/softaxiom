// SPDX-FileCopyrightText: 2026 OpenClaw Foundation
// SPDX-License-Identifier: MIT
// Data-only primitives shared by runtime models, catalogs, and configuration.
export const MODEL_DATA_APIS = [
    "openai-completions",
    "openai-responses",
    "openai-chatgpt-responses",
    "anthropic-messages",
    "google-generative-ai",
    "google-interactions",
    "google-vertex",
    "github-copilot",
    "bedrock-converse-stream",
    "ollama",
    "pi-messages",
    "azure-openai-responses",
] as const;
export const MODEL_DATA_THINKING_FORMATS = [
    "openai",
    "openrouter",
    "deepseek",
    "together",
    "qwen",
    "qwen-chat-template",
    "zai",
] as const;
export type ModelDataThinkingFormat = (typeof MODEL_DATA_THINKING_FORMATS)[number];
export const MODEL_DATA_THINKING_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;
export type ModelDataThinkingLevel = (typeof MODEL_DATA_THINKING_LEVELS)[number];
export type ModelDataThinkingLevelMap = Partial<Record<ModelDataThinkingLevel, string | null>>;
export type ModelDataImageInputConfig = {
    /** Provider-documented maximum encoded image payload size. */
    maxBytes?: number | undefined;
    /** Provider-documented maximum accepted input pixels. */
    maxPixels?: number | undefined;
    /** Provider-documented maximum accepted width/height in pixels. */
    maxSidePx?: number | undefined;
    /** Preferred resize side for the default balanced compression policy. */
    preferredSidePx?: number | undefined;
    /** Token accounting style, used as documentation for provider-owned policy. */
    tokenMode?: ("tile" | "detail" | "provider") | undefined;
};
export type ModelDataMediaInputConfig = {
    /** Image input limits and accounting hints for this model. */
    image?: ModelDataImageInputConfig | undefined;
};
/** Per-million-token rates for separately billed token buckets. */
export type ModelDataCostRates = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
};
export type ModelDataRawPricingTier = ModelDataCostRates & {
    /** Half-open prompt-token interval; `[start]` is an open-ended upper tier. */
    range: [
        number,
        number
    ] | [
        number
    ];
};
export type ModelRoutingSortConfig = {
    /** The sorting metric: "price", "throughput", "latency". */
    by?: string | undefined;
    /** Partitioning strategy: "model" (default) or "none". */
    partition?: (string | null) | undefined;
};
export type ModelRoutingMaxPrice = {
    /** Price per million prompt tokens. */
    prompt?: (number | string) | undefined;
    /** Price per million completion tokens. */
    completion?: (number | string) | undefined;
    /** Price per image. */
    image?: (number | string) | undefined;
    /** Price per audio unit. */
    audio?: (number | string) | undefined;
    /** Price per request. */
    request?: (number | string) | undefined;
};
/** Percentile targets in the owning field's throughput or latency units. */
export type ModelRoutingPercentiles = {
    p50?: number | undefined;
    p75?: number | undefined;
    p90?: number | undefined;
    p99?: number | undefined;
};
