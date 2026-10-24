// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
import { floorPositiveFiniteNumber, parseStrictPositiveInteger, } from "../../../normalization-core/src/number-coercion.js";
export function parsePositiveInteger(value: unknown): number | undefined {
    return typeof value === "string"
        ? parseStrictPositiveInteger(value)
        : floorPositiveFiniteNumber(value);
}
