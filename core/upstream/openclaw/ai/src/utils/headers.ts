// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
/** Converts a Headers object to a plain record for provider request handling. */
export function headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of headers.entries()) {
        result[key] = value;
    }
    return result;
}
