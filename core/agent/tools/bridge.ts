// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import type { Json } from "../context/ports.ts";
import type { Handler } from "./executor.ts";
export interface BridgePort {
  callback(call: { personId: string; runId: string; operationId: string }): Promise<Json>;
}
export function createBridgeCallbackTool({ bridge }: { bridge: BridgePort }): Handler {
  return async (_input, { personId, runId, call }) => ({
    result: await bridge.callback({ personId, runId, operationId: call.op }),
  });
}
