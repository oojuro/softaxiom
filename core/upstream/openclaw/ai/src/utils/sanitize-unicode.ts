// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
/// <reference lib="es2024.string" />
/** Remove unpaired surrogates rejected by providers; preserve valid Unicode pairs. */
export function sanitizeSurrogates(text: string): string {
    if (text.isWellFormed()) {
        return text;
    }
    return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
