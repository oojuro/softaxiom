// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { ProviderHttpError } from "../../money/ports.ts";

/** A definite provider context refusal; no request is replayed inside the transport. */
export class ContextLimitError extends ProviderHttpError {}
