// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
export const microsPerDollar = 1_000_000;
export const usd = (dollars: number): number => Math.round(dollars * microsPerDollar);
