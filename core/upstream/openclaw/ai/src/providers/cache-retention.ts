// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import type { CacheRetention } from "../types.js";
/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses OPENCLAW_CACHE_RETENTION for backward compatibility.
 */
export function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
    if (cacheRetention === "short" || cacheRetention === "long" || cacheRetention === "none") {
        return cacheRetention;
    }
    if (typeof process !== "undefined" && ({} as NodeJS.ProcessEnv).OPENCLAW_CACHE_RETENTION === "long") {
        return "long";
    }
    return "short";
}
