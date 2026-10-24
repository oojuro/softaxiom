// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { normalizeLowercaseStringOrEmpty } from "../../../normalization-core/src/string-coerce.js";
type SubsystemLogger = {
    info(message: string): void;
    debug(message: string): void;
};
type ModelTransportDebugEnv = NodeJS.ProcessEnv;
/** Payload debug detail levels accepted by `OPENCLAW_DEBUG_MODEL_PAYLOAD`. */
type ModelPayloadDebugMode = "off" | "summary" | "tools" | "full-redacted";
/** SSE debug detail levels accepted by `OPENCLAW_DEBUG_SSE`. */
type ModelSseDebugMode = "off" | "events" | "peek";
function isTruthyEnv(value: unknown): boolean {
    const normalized = normalizeLowercaseStringOrEmpty(value);
    return (normalized.length > 0 &&
        normalized !== "0" &&
        normalized !== "false" &&
        normalized !== "off" &&
        normalized !== "no");
}
/** Resolves model payload debug verbosity from `OPENCLAW_DEBUG_MODEL_PAYLOAD`. */
export function resolveModelPayloadDebugMode(env: ModelTransportDebugEnv = {} as NodeJS.ProcessEnv): ModelPayloadDebugMode {
    const normalized = normalizeLowercaseStringOrEmpty(env.OPENCLAW_DEBUG_MODEL_PAYLOAD);
    if (normalized === "tools" || normalized === "full-redacted" || normalized === "summary") {
        return normalized;
    }
    return "off";
}
/** Resolves SSE stream debug verbosity from `OPENCLAW_DEBUG_SSE`. */
export function resolveModelSseDebugMode(env: ModelTransportDebugEnv = {} as NodeJS.ProcessEnv): ModelSseDebugMode {
    const normalized = normalizeLowercaseStringOrEmpty(env.OPENCLAW_DEBUG_SSE);
    if (normalized === "peek") {
        return "peek";
    }
    return isTruthyEnv(normalized) ? "events" : "off";
}
/** Returns whether any model transport debug channel is enabled. */
function isModelTransportDebugEnabled(env: ModelTransportDebugEnv = {} as NodeJS.ProcessEnv): boolean {
    return (isTruthyEnv(env.OPENCLAW_DEBUG_MODEL_TRANSPORT) ||
        resolveModelPayloadDebugMode(env) !== "off" ||
        resolveModelSseDebugMode(env) !== "off" ||
        isTruthyEnv(env.OPENCLAW_DEBUG_CODE_MODE));
}
/** Emits transport diagnostics at debug, promoted to info by explicit debug flags. */
export function emitModelTransportDebug(log: SubsystemLogger, message: string): void {
    if (isModelTransportDebugEnabled()) {
        log.info(message);
        return;
    }
    log.debug(message);
}
/** The requesting layer owns AbortError classification; deadlines remain failures here. */
export function emitModelTransportError(log: SubsystemLogger & {
    warn(message: string): void;
}, label: string, detail: string, signal?: AbortSignal): void {
    const aborted = signal?.aborted === true &&
        signal.reason instanceof Error &&
        signal.reason.name === "AbortError";
    const message = `[${label}] ${aborted ? "aborted" : "error"} ${detail}`;
    if (aborted) {
        emitModelTransportDebug(log, message);
    }
    else {
        log.warn(message);
    }
}
