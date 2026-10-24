// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { isRecord } from "../../normalization-core/src/record-coerce.js";
/** Media metadata alone is not an attachment; provider emitters need inline bytes. */
export function hasMediaPayload(block: unknown): block is Record<string, unknown> & {
    data: string;
} {
    return isRecord(block) && typeof block.data === "string" && block.data.trim().length > 0;
}
/** Image metadata alone is not an attachment; provider emitters need inline bytes. */
export function isImageWithMediaPayload<T>(block: T): block is T & {
    type: "image";
    data: string;
} {
    return isRecord(block) && block.type === "image" && hasMediaPayload(block);
}
