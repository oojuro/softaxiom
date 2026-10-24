// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
/** Stable storage naming, independent of engine context selection. */
export const taskPath = (taskId: string) => `tasks/${taskId}.jsonl`;
