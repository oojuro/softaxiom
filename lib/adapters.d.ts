// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
export type AdapterTransport = 'api' | 'mcp' | 'browser';
export interface BrowserProbe { url: string; selector: string; attribute: string }
export interface ProbeOptions {
  transport: AdapterTransport;
  account?: string;
  token?: string;
  browser?: { read(probe: BrowserProbe): Promise<{ url: string; value: string | null }> };
  mcp?: { call(tool: string, args: Record<string, unknown>): Promise<{ isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }> };
  fetch?: typeof fetch;
  signal?: AbortSignal;
}
export type Health = { status: 'healthy'; account: string } | { status: 'reconnect_required' | 'retry'; code: string };
export interface Adapter {
  id: string; version: number;
  matches(connection?: { origins?: string[] }): boolean;
  configure(transport: AdapterTransport): { version: number; adapter: string; transport: AdapterTransport; readOnly: boolean; health: Partial<BrowserProbe> & { tool?: string; arguments?: Record<string, unknown> }; events: string[] };
  probe(options: ProbeOptions): Promise<Health>;
}
export const githubAdapter: Adapter;
export function adapterFor(connection: { origins?: string[] }): Adapter | undefined;
export function jsonRequest(url: string, options?: RequestInit): Promise<unknown>;
export function checkGithub(source: unknown): Promise<unknown>;
export function createGithubMcp(options: { token: string; fetch?: typeof fetch }): NonNullable<ProbeOptions['mcp']>;
