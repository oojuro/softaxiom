// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
export const OPENCLAW_TRANSCRIPT_ARTIFACT_PROVIDER = "openclaw" as const;
/** Transcript authorship is not an inference model, even when the message is replayable. */
export function isTranscriptArtifactProvider(provider: unknown): boolean {
    return provider === OPENCLAW_TRANSCRIPT_ARTIFACT_PROVIDER;
}
