// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { isRecord } from "../../../normalization-core/src/record-coerce.js";
export function hasResponsesWebSearchTool(tools: unknown): boolean {
    if (!Array.isArray(tools)) {
        return false;
    }
    return tools.some((tool) => {
        if (!isRecord(tool)) {
            return false;
        }
        if (tool.type === "web_search") {
            return true;
        }
        if (tool.type === "function" && tool.name === "web_search") {
            return true;
        }
        const fn = tool.function;
        return isRecord(fn) && fn.name === "web_search";
    });
}
