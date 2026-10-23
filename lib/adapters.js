// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { check, MemoryError } from './common.js';
import { httpUrl, text } from './local-state.js';

export async function jsonRequest(url, options = {}) {
  httpUrl(url);
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new MemoryError('SOURCE_CONNECTION_FAILED'); }
  check(response.ok, 'SOURCE_HTTP_ERROR', { status: response.status });
  let bytes = 0; const chunks = [];
  for await (const chunk of response.body) { bytes += chunk.length; check(bytes <= 1024 * 1024, 'SOURCE_RESPONSE_TOO_LARGE'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new MemoryError('SOURCE_INVALID_JSON'); }
}


function authorization(config) {
  if (!config.tokenEnv) return {};
  const token = process.env[config.tokenEnv]; check(token, 'SOURCE_CREDENTIAL_NOT_CONFIGURED');
  return { Authorization: `Bearer ${token}` };
}

export async function checkGithub(source) {
  const { repository, api, pulls } = source.config;
  const headers = { ...authorization(source.config), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const read = path => jsonRequest(`${api}${path}`, { headers });
  const events = [], cursor = structuredClone(source.cursor ?? { reviews: {} });
  cursor.reviews ??= {};
  for (const number of pulls) {
    const pr = await read(`/repos/${repository}/pulls/${number}`);
    check(typeof pr.head?.sha === 'string' && typeof pr.html_url === 'string', 'GITHUB_INVALID_PULL');
    if (pr.state === 'closed') continue;
    const prefix = `/repos/${repository}`, latest = new Map();
    let reviewCursor = cursor.reviews[number] ?? 0;
    for (let page = 1; page <= 10; page++) {
      const reviews = await read(`${prefix}/pulls/${number}/reviews?per_page=100&page=${page}`);
      check(Array.isArray(reviews), 'GITHUB_INVALID_REVIEWS');
      for (const review of reviews) {
        check(Number.isSafeInteger(review.id) && review.user?.login, 'GITHUB_INVALID_REVIEW');
        reviewCursor = Math.max(reviewCursor, review.id);
        if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user.login, review);
      }
      if (reviews.length < 100) break;
      check(page < 10, 'GITHUB_REVIEWS_TRUNCATED');
    }
    for (const review of latest.values()) if (review.state === 'CHANGES_REQUESTED' && review.id > (cursor.reviews[number] ?? 0)) events.push({
      id: `review:${review.id}`, kind: 'github.changes_requested', summary: `Changes requested on ${repository}#${number}`,
      url: review.html_url ?? pr.html_url, occurredAt: review.submitted_at, group: `pull:${number}`,
    });
    cursor.reviews[number] = reviewCursor;
    const runs = await read(`${prefix}/commits/${encodeURIComponent(pr.head.sha)}/check-runs?per_page=100`);
    check(Array.isArray(runs.check_runs) && runs.total_count <= 100, 'GITHUB_CHECKS_TRUNCATED');
    for (const run of runs.check_runs) if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)) events.push({
      id: `pull:${number}:check:${run.id}:${run.conclusion}`, kind: 'github.ci_failed', summary: `${text(run.name, 300)} failed on ${repository}#${number}`,
      url: run.html_url ?? pr.html_url, occurredAt: run.completed_at, group: `pull:${number}`,
    });
    const statuses = await read(`${prefix}/commits/${encodeURIComponent(pr.head.sha)}/status?per_page=100`);
    check(Array.isArray(statuses.statuses) && statuses.total_count <= 100, 'GITHUB_STATUSES_TRUNCATED');
    for (const status of statuses.statuses) if (['failure', 'error'].includes(status.state)) events.push({
      id: `pull:${number}:status:${status.id}:${status.state}`, kind: 'github.ci_failed', summary: `${text(status.context, 300)} failed on ${repository}#${number}`,
      url: status.target_url ?? pr.html_url, occurredAt: status.updated_at, group: `pull:${number}`,
    });
  }
  check(events.length <= 500, 'SOURCE_EVENT_BATCH_TOO_LARGE');
  return { events, cursor };
}


// Provider mappings and probes are portable. Credential storage, timers, retries and notices belong to the caller.
export const githubAdapter = Object.freeze({
  id: 'github', version: 1,
  matches: ({ origins = [] } = {}) => origins.includes('https://github.com'),
  configure(transport) {
    check(['api', 'mcp', 'browser'].includes(transport), 'ADAPTER_TRANSPORT_UNSUPPORTED');
    return { version: 1, adapter: 'github', transport, readOnly: true,
      health: transport === 'browser' ? { url: 'https://github.com/settings/profile', selector: 'meta[name="user-login"]', attribute: 'content' } :
        transport === 'api' ? { url: 'https://api.github.com/user' } : { tool: 'get_me', arguments: {} },
      events: ['github.ci_failed', 'github.changes_requested'] };
  },
  async probe({ transport, account, token, browser, mcp, fetch: request = globalThis.fetch, signal }) {
    const config = this.configure(transport);
    let login;
    if (transport === 'browser') {
      check(browser?.read, 'ADAPTER_CAPABILITY_MISSING');
      const page = await browser.read(config.health);
      const url = httpUrl(page.url);
      if (url.origin !== 'https://github.com') return { status: 'reconnect_required', code: 'origin_changed' };
      if (/^\/(login|session|sessions|settings\/sudo)(\/|$)/.test(url.pathname)) return { status: 'reconnect_required', code: 'authentication_required' };
      check(url.pathname === '/settings/profile', 'ADAPTER_PAGE_UNRECOGNIZED');
      login = page.value;
      check(typeof login === 'string' && login.length > 0, 'ADAPTER_PAGE_UNRECOGNIZED');
    } else if (transport === 'mcp') {
      check(mcp?.call, 'ADAPTER_CAPABILITY_MISSING');
      let answer;
      try { answer = await mcp.call('get_me', {}); } catch (error) {
        if (error?.code === 'ADAPTER_AUTHENTICATION_REQUIRED') return { status: 'reconnect_required', code: 'authentication_required' };
        throw error;
      }
      check(!answer.isError, 'ADAPTER_CHECK_FAILED');
      let data = answer.structuredContent;
      if (!data) { try { data = JSON.parse(answer.content?.find(c => c.type === 'text')?.text); } catch { throw new MemoryError('ADAPTER_INVALID_RESPONSE'); } }
      login = data?.login;
    } else {
      check(typeof token === 'string' && token.length > 0, 'ADAPTER_CREDENTIAL_MISSING');
      let response;
      try { response = await request(config.health.url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        redirect: 'error', signal: signal ?? AbortSignal.timeout(20000) }); } catch { throw new MemoryError('ADAPTER_UNAVAILABLE'); }
      if (response.status === 401) return { status: 'reconnect_required', code: 'authentication_required' };
      if (response.status === 403 && response.headers.get('x-github-sso')) return { status: 'reconnect_required', code: 'sso_required' };
      if ([403, 429].includes(response.status)) return { status: 'retry', code: 'rate_limited' };
      check(response.ok, 'ADAPTER_UNAVAILABLE');
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; check(size <= 64000, 'ADAPTER_INVALID_RESPONSE'); chunks.push(chunk); }
      let data; try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new MemoryError('ADAPTER_INVALID_RESPONSE'); }
      login = data?.login;
    }
    check(typeof login === 'string' && /^[a-zA-Z0-9-]{1,39}$/.test(login), 'ADAPTER_INVALID_RESPONSE');
    if (account && login.toLowerCase() !== account.toLowerCase()) return { status: 'reconnect_required', code: 'account_changed' };
    return { status: 'healthy', account: login };
  },
});

export function adapterFor(connection) {
  return githubAdapter.matches(connection) ? githubAdapter : undefined;
}

// A short read-only MCP session: reconnect each probe; never maintain an idle socket indefinitely.
export function createGithubMcp({ token, fetch: request = globalThis.fetch }) {
  check(typeof token === 'string' && token.length > 0, 'ADAPTER_CREDENTIAL_MISSING');
  return { async call(tool, args) {
    check(tool === 'get_me', 'ADAPTER_OPERATION_NOT_ALLOWED');
    let session, version = '2025-06-18', sequence = 0;
    const send = async (method, params, notification = false) => {
      const id = ++sequence;
      let response;
      try { response = await request('https://api.githubcopilot.com/mcp/readonly', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
          ...(session ? { 'Mcp-Session-Id': session } : {}), ...(method !== 'initialize' ? { 'MCP-Protocol-Version': version } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
      }); } catch { throw new MemoryError('ADAPTER_UNAVAILABLE'); }
      check(response.status !== 401, 'ADAPTER_AUTHENTICATION_REQUIRED');
      check(response.ok, 'ADAPTER_UNAVAILABLE');
      if (notification) { await response.body?.cancel(); return; }
      session = response.headers.get('mcp-session-id') ?? session;
      let buffer = '', bytes = 0; const decoder = new TextDecoder();
      const sse = response.headers.get('content-type')?.includes('text/event-stream');
      const parse = value => { try { return JSON.parse(value); } catch { throw new MemoryError('ADAPTER_INVALID_RESPONSE'); } };
      for await (const chunk of response.body) {
        bytes += chunk.length; check(bytes <= 1024 * 1024, 'ADAPTER_INVALID_RESPONSE');
        buffer += decoder.decode(chunk, { stream: true });
        if (sse) {
          buffer = buffer.replaceAll('\r\n', '\n'); let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const message = parse(data);
            if (message.id === id) { check(!message.error, 'ADAPTER_CHECK_FAILED'); return message.result; }
          }
        }
      }
      check(!sse, 'ADAPTER_INVALID_RESPONSE');
      const message = parse(buffer); check(message.id === id && !message.error, 'ADAPTER_CHECK_FAILED'); return message.result;
    };
    const initialized = await send('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'softaxiom', version: '1' } });
    check(initialized?.capabilities?.tools && ['2025-06-18', '2025-03-26'].includes(initialized.protocolVersion), 'ADAPTER_PROTOCOL_UNSUPPORTED');
    version = initialized.protocolVersion;
    await send('notifications/initialized', {}, true);
    try { return await send('tools/call', { name: tool, arguments: args }); }
    finally {
      if (session) await request('https://api.githubcopilot.com/mcp/readonly', { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}`, 'Mcp-Session-Id': session, 'MCP-Protocol-Version': version } }).then(r => r.body?.cancel()).catch(() => {});
    }
  } };
}
