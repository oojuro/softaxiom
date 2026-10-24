// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
export function encodeTextSignatureV1(id: string, phase?: "commentary" | "final_answer"): string {
    return JSON.stringify({ v: 1, id, ...(phase ? { phase } : {}) });
}
