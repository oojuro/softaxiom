// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { check, MemoryError, hash } from './common.js';
import { httpUrl, text } from './local-state.js';
import { LocalBrowser } from './browser.js';

const errorCode = error => error instanceof MemoryError ? error.code : 'SOURCE_CHECK_FAILED';

async function jsonRequest(url, options = {}) {
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

export async function checkHttp(source) {
  const url = httpUrl(source.config.url);
  if (source.cursor !== null) url.searchParams.set('cursor', typeof source.cursor === 'string' ? source.cursor : JSON.stringify(source.cursor));
  const data = await jsonRequest(url.href, { headers: authorization(source.config) });
  check(data && Array.isArray(data.events), 'SOURCE_EVENT_ENVELOPE_REQUIRED');
  return { events: data.events, cursor: data.cursor ?? source.cursor };
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

export async function checkMcp(source, workspace) {
  const { command, tool, arguments: arguments_ = {}, cursorArgument = 'cursor' } = source.config;
  const child = spawn(command[0], command.slice(1), { cwd: workspace, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map(); let buffer = '', total = 0, next = 0;
  let fatal;
  const fail = code => {
    fatal = new MemoryError(code);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(fatal); }
    pending.clear();
  };
  child.on('error', () => fail('MCP_START_FAILED'));
  child.on('exit', () => fail('MCP_SERVER_EXITED'));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    total += Buffer.byteLength(chunk); buffer += chunk;
    if (total > 1024 * 1024) { fail('MCP_RESPONSE_TOO_LARGE'); child.kill(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail('MCP_INVALID_JSON'); child.kill(); return; }
      const p = pending.get(message.id);
      if (p) { clearTimeout(p.timer); pending.delete(message.id); message.error ? p.reject(new MemoryError('MCP_TOOL_FAILED')) : p.resolve(message.result); }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (fatal) { reject(fatal); return; }
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new MemoryError('MCP_TIMEOUT')); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => { if (error) fail('MCP_WRITE_FAILED'); });
  });
  child.stdin.on('error', () => fail('MCP_WRITE_FAILED'));
  try {
    const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'softaxiom', version: '0.1.0' } });
    check(init?.capabilities?.tools && ['2025-06-18', '2025-03-26', '2024-11-05'].includes(init.protocolVersion), 'MCP_PROTOCOL_UNSUPPORTED');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const args = { ...arguments_, ...(source.cursor !== null ? { [cursorArgument]: source.cursor } : {}) };
    const result = await request('tools/call', { name: tool, arguments: args });
    check(!result.isError, 'MCP_TOOL_FAILED');
    let data = result.structuredContent;
    if (!data) {
      const content = result.content?.find(c => c.type === 'text')?.text;
      try { data = JSON.parse(content); } catch { throw new MemoryError('MCP_EVENT_ENVELOPE_REQUIRED'); }
    }
    check(data && Array.isArray(data.events), 'MCP_EVENT_ENVELOPE_REQUIRED');
    return { events: data.events, cursor: data.cursor ?? source.cursor };
  } finally { child.stdin.end(); child.kill(); for (const p of pending.values()) clearTimeout(p.timer); }
}

export async function checkBrowser(source, workspace) {
  const browser = await LocalBrowser.connect(workspace);
  let tab;
  try {
    tab = await browser.navigate(source.config.url);
    const origin = httpUrl(source.config.url).origin;
    const rows = await browser.items(tab.id, source.config, [origin]);
    const previous = source.cursor?.items ?? {}, current = {};
    const events = [];
    for (const row of rows) {
      const key = hash(row.id); check(!Object.hasOwn(current, key), 'BROWSER_DUPLICATE_ITEM_ID'); current[key] = row.revision;
      if (previous[key] !== row.revision && (source.cursor || source.config.emitInitial === true)) events.push({
        id: `${key}:${hash(row.revision)}`, kind: source.config.eventKind ?? 'browser.changed',
        summary: row.text || 'A watched item changed', url: row.url, group: key,
      });
    }
    return { events, cursor: { items: current } };
  } finally {
    if (tab) await browser.protocol.call('Target.closeTarget', { targetId: tab.id }).catch(() => {});
    browser.close();
  }
}

export async function pollSources(inbox) {
  const result = [];
  for (const candidate of inbox.sources()) {
    if (candidate.kind === 'manual') continue;
    const source = inbox.claimSource(candidate.id);
    if (!source) continue;
    const heartbeat = setInterval(() => { try { inbox.renewSource(source); } catch {} }, Math.max(10, Math.floor(inbox.leaseMs / 3)));
    try {
      const checked = await ({ http: checkHttp, github: checkGithub, mcp: checkMcp, browser: checkBrowser }[source.kind])(source, inbox.workspace);
      const receipt = inbox.ingest(source.id, checked.events, { cursor: checked.cursor, leaseToken: source.lease_token });
      result.push({ source: source.id, ...receipt });
    } catch (error) { const code = errorCode(error); inbox.failSource(source, code); result.push({ source: source.id, error: code }); }
    finally { clearInterval(heartbeat); }
  }
  return result;
}

function githubWebhook(source, event, body) {
  check(body.repository?.full_name?.toLowerCase() === source.config.repository.toLowerCase(), 'WEBHOOK_REPOSITORY_MISMATCH');
  if (event === 'pull_request_review' && body.action === 'submitted' && body.review?.state?.toUpperCase() === 'CHANGES_REQUESTED') {
    check(source.config.pulls.includes(body.pull_request?.number), 'WEBHOOK_PULL_NOT_SUBSCRIBED');
    return [{ id: `review:${body.review.id}`, kind: 'github.changes_requested', summary: `Changes requested on ${source.config.repository}#${body.pull_request.number}`,
      url: body.review.html_url, occurredAt: body.review.submitted_at, group: `pull:${body.pull_request.number}` }];
  }
  if (event === 'check_run' && body.action === 'completed' && ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(body.check_run?.conclusion)) {
    return (body.check_run.pull_requests ?? []).filter(pr => source.config.pulls.includes(pr.number)).map(pr => ({
      id: `pull:${pr.number}:check:${body.check_run.id}:${body.check_run.conclusion}`, kind: 'github.ci_failed',
      summary: `${text(body.check_run.name, 300)} failed on ${source.config.repository}#${pr.number}`, url: body.check_run.html_url,
      occurredAt: body.check_run.completed_at, group: `pull:${pr.number}`,
    }));
  }
  return [];
}

export function webhookServer(inbox, { port = 0 } = {}) {
  const server = createServer(async (request, response) => {
    try {
      check(request.method === 'POST' && !request.headers.origin, 'WEBHOOK_REQUEST_NOT_ALLOWED');
      const match = /^\/events\/([a-zA-Z0-9_-]+)$/.exec(request.url); check(match, 'WEBHOOK_ROUTE_NOT_FOUND');
      const source = inbox.source(match[1]); check(source.enabled && source.config.hmacEnv, 'WEBHOOK_NOT_CONFIGURED');
      const secret = process.env[source.config.hmacEnv]; check(secret && secret.length >= 16, 'WEBHOOK_SECRET_NOT_CONFIGURED');
      let bytes = 0; const chunks = [];
      for await (const chunk of request) { bytes += chunk.length; check(bytes <= 1024 * 1024, 'WEBHOOK_TOO_LARGE'); chunks.push(chunk); }
      const raw = Buffer.concat(chunks), signature = request.headers['x-hub-signature-256'];
      const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
      check(typeof signature === 'string' && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)), 'WEBHOOK_SIGNATURE_INVALID');
      let data;
      try { data = JSON.parse(raw.toString()); } catch { throw new MemoryError('WEBHOOK_INVALID_JSON'); }
      const events = source.kind === 'github' ? githubWebhook(source, request.headers['x-github-event'], data) : data.events;
      const result = inbox.ingest(source.id, events);
      response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: errorCode(error) })); }
  });
  server.requestTimeout = 30000;
  server.listen(port, '127.0.0.1');
  return server;
}
