// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createInterface } from 'node:readline';
let initialized = false;
for await (const line of createInterface({ input: process.stdin })) {
  const input = JSON.parse(line);
  if (input.method === 'notifications/initialized') { initialized = true; continue; }
  const result = input.method === 'initialize' ? { protocolVersion: input.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic-test', version: '1' } } :
    initialized ? { structuredContent: { events: [{ id: 'mcp-event', kind: 'mcp.changed', summary: 'Synthetic MCP item changed' }], cursor: 'mcp-next' } } : { isError: true };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }) + '\n');
}
