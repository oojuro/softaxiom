// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// The `connect` tool: the model asks to be signed in to a site and the sign-in relay (the
// workspace package, wired by the worker) does it. The run's person and id come from the call, so
// the model can only sign in as the run it is part of. What the relay found on the page, and what
// it told the person, is its result; the tool's text, for the model, is in agent-text/tools.
import type { Json } from "../context/ports.ts";
import type { Handler } from "./runtime.ts";

interface ConnectRequest {
  site: string;
  connection?: string;
  another?: boolean;
  screen?: boolean;
  account?: string;
}

export interface SigninPort {
  connect(call: { personId: string; runId: string }, input: ConnectRequest): Promise<Json>;
}

export function createConnectTool(deps: { signin: SigninPort }): Handler {
  return async (input, { personId, runId }) => ({
    result: await deps.signin.connect({ personId, runId }, input as ConnectRequest),
  });
}
