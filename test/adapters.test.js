// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor, githubAdapter } from '../lib/adapters.js';

test('GitHub discovery is exact-origin and all transports use the same identity contract', async () => {
  assert.equal(adapterFor({ origins: ['https://github.com.evil.test'] }), undefined);
  assert.equal(adapterFor({ origins: ['https://github.com'] }), githubAdapter);
  const browser = { async read(mapping) { assert.equal(mapping.url, 'https://github.com/settings/profile');
    assert.equal(mapping.selector, 'meta[name="user-login"]'); return { url: mapping.url, value: 'synthetic-user' }; } };
  assert.deepEqual(await githubAdapter.probe({ transport: 'browser', browser, account: 'Synthetic-User' }), { status: 'healthy', account: 'synthetic-user' });
  assert.equal((await githubAdapter.probe({ transport: 'browser', browser, account: 'another-user' })).code, 'account_changed');
  const mcp = { async call(tool, args) { assert.equal(tool, 'get_me'); assert.deepEqual(args, {}); return { structuredContent: { login: 'synthetic-user' } }; } };
  assert.equal((await githubAdapter.probe({ transport: 'mcp', mcp })).status, 'healthy');
  assert.equal((await githubAdapter.probe({ transport: 'api', token: 'synthetic-test-value', fetch: async (url, options) => {
    assert.equal(url, 'https://api.github.com/user'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value'); return Response.json({ login: 'synthetic-user' });
  } })).status, 'healthy');
});

test('GitHub health separates revoked auth, SSO, throttling and changed page markup', async () => {
  for (const [status, headers, expected] of [[401, {}, 'authentication_required'], [403, { 'x-github-sso': 'required' }, 'sso_required'], [429, {}, 'rate_limited'], [403, {}, 'rate_limited']]) {
    const result = await githubAdapter.probe({ transport: 'api', token: 'synthetic', fetch: async () => new Response(null, { status, headers }) });
    assert.equal(result.code, expected);
  }
  const browser = { read: async () => ({ url: 'https://github.com/login', value: null }) };
  assert.equal((await githubAdapter.probe({ transport: 'browser', browser })).status, 'reconnect_required');
  await assert.rejects(() => githubAdapter.probe({ transport: 'browser', browser: { read: async () => ({ url: 'https://github.com/settings/profile', value: null }) } }), { code: 'ADAPTER_PAGE_UNRECOGNIZED' });
  await assert.rejects(() => githubAdapter.probe({ transport: 'api', token: 'synthetic', fetch: async () => Response.json({ login: 'x'.repeat(64001) }) }), { code: 'ADAPTER_INVALID_RESPONSE' });
  await assert.rejects(() => githubAdapter.probe({ transport: 'mcp' }), { code: 'ADAPTER_CAPABILITY_MISSING' });
});

test('GitHub MCP health initializes read-only HTTP sessions, handles SSE and closes the session', async () => {
  const { createGithubMcp } = await import('../lib/adapters.js');
  const calls = [];
  const mcp = createGithubMcp({ token: 'synthetic', fetch: async (url, init) => {
    assert.equal(url, 'https://api.githubcopilot.com/mcp/readonly');
    if (init.method === 'DELETE') { calls.push('close'); return new Response(null, { status: 204 }); }
    const body = JSON.parse(init.body); calls.push(body.method);
    if (body.method === 'initialize') return Response.json({ id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }, { headers: { 'mcp-session-id': 'synthetic-session' } });
    assert.equal(init.headers['Mcp-Session-Id'], 'synthetic-session');
    if (!body.id) return new Response(null, { status: 202 });
    return new Response(`event: message\ndata: ${JSON.stringify({ id: body.id, result: { structuredContent: { login: 'synthetic-user' } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal((await githubAdapter.probe({ transport: 'mcp', mcp })).status, 'healthy');
  assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call', 'close']);
});
