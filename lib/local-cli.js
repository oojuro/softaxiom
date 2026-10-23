// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { check, MemoryError } from './common.js';
import { jsonInput, httpUrl } from './local-state.js';
import { LocalBrowser, attachBrowser, startBrowser, stopBrowser } from './browser.js';
import { pollSources, webhookServer } from './watchers.js';
import { enqueueRequest, workOnce } from './local-agent.js';

const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const option = (args, flag) => { const i = args.indexOf(flag); if (i < 0) return undefined; check(args[i + 1], 'OPTION_VALUE_REQUIRED'); return args.splice(i, 2)[1]; };
const publicTask = task => { const { lease_token, ...rest } = task; return rest; };

async function browserCommand(workspace, args) {
  const operation = args.shift();
  if (operation === 'start') return startBrowser(workspace, { executable: option(args, '--executable'), headless: args.includes('--headless') });
  if (operation === 'attach') { check(args[0], 'BROWSER_ENDPOINT_REQUIRED'); return attachBrowser(workspace, args[0]); }
  if (operation === 'stop') return stopBrowser(workspace);
  const browser = await LocalBrowser.connect(workspace);
  try {
    if (operation === 'tabs' || operation === 'status') return { tabs: await browser.tabs(), endpoint: browser.state.endpoint, owned: browser.state.owned };
    if (operation === 'navigate') return await browser.navigate(args[0], args[1]);
    if (operation === 'snapshot') return await browser.snapshot(args[0]);
    if (operation === 'screenshot') return await browser.screenshot(args[0]);
    check(['click', 'type', 'press', 'close'].includes(operation), 'UNKNOWN_BROWSER_COMMAND');
    const input = jsonInput(), origin = httpUrl(await browser.pageUrl(input.id)).origin;
    const prepared = await browser.prepare(operation, input, [origin]);
    // These commands are direct operator input. Model calls use the durable approval ledger.
    return await browser.execute(prepared, [origin]);
  } finally { browser.close(); }
}

async function daemon(inbox, args, listenOnly = false) {
  const portValue = option(args, '--port'), port = portValue === undefined ? null : Number(portValue);
  check(port === null || (Number.isSafeInteger(port) && port >= 0 && port <= 65535), 'INVALID_PORT');
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const server = listenOnly || port !== null ? webhookServer(inbox, { port: port ?? 0 }) : null;
  let configuration;
  try {
    if (server) { await once(server, 'listening'); emit({ webhook: `http://127.0.0.1:${server.address().port}/events/SOURCE_ID` }); }
    do {
      const previous = new Map(inbox.sources().map(s => [s.id, s.last_error]));
      const checks = listenOnly ? [] : await pollSources(inbox);
      for (const result of checks) if (result.inserted > 0 || result.error !== (previous.get(result.source) ?? undefined)) emit({ watcher: result });
      if (!listenOnly && !args.includes('--watch-only')) {
        const result = await workOnce(inbox);
        if (result.status === 'configuration_required') {
          if (configuration !== result.code) emit(result);
          configuration = result.code;
        } else if (result.status !== 'idle') emit(result.notify === false ? { task: result.task, status: result.status } : result);
      }
      if (args.includes('--once')) return { checked: true };
      try { await delay(1000, undefined, { signal: controller.signal }); } catch { break; }
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (server) await new Promise(done => server.close(done));
  }
}

export async function localCommand(command, args, workspace) {
  if (command === 'browser') return browserCommand(workspace, args);
  const { Inbox } = await import('./inbox.js');
  const inbox = new Inbox(workspace);
  try {
    if (command === 'agent') {
      const originsText = option(args, '--origins') ?? '';
      const origins = originsText ? originsText.split(',') : [];
      check(args.length, 'USER_REQUEST_REQUIRED');
      const subscriptionId = enqueueRequest(inbox, args.join(' '), origins);
      return { subscription: subscriptionId, ...await workOnce(inbox, { subscriptionId }) };
    }
    const operation = args.shift();
    switch (operation) {
      case 'source': return inbox.putSource(jsonInput());
      case 'sources': return inbox.sources().map(({ lease_token, ...s }) => s);
      case 'subscribe': return inbox.putSubscription(jsonInput());
      case 'subscriptions': return inbox.subscriptions();
      case 'ingest': return inbox.ingest(args[0], jsonInput().events);
      case 'poll': return await pollSources(inbox);
      case 'inbox': return inbox.events({ unread: args.includes('--unread') });
      case 'read': return inbox.markRead(args[0]);
      case 'tasks': return inbox.tasks();
      case 'task': return publicTask(inbox.task(args[0]));
      case 'results': return inbox.all("SELECT id,subscription_id,result FROM tasks WHERE status='completed' ORDER BY updated_at DESC LIMIT 30").map(t => ({ ...t, result: JSON.parse(t.result) }));
      case 'approvals': return inbox.all("SELECT id FROM actions WHERE status IN ('pending','uncertain') ORDER BY created_at").map(a => inbox.action(a.id));
      case 'approve': return inbox.approve(args[0]);
      case 'reject': return inbox.approve(args[0], false);
      case 'resolve-action': return inbox.resolveAction(args[0], args[1]);
      case 'work': return await workOnce(inbox, { subscriptionId: args[0] });
      case 'run': return await daemon(inbox, args);
      case 'listen': return await daemon(inbox, args, true);
      case 'backup': check(args[0], 'DESTINATION_REQUIRED'); return await inbox.backup(resolve(args[0]));
      case 'prune': return inbox.prune(args[0]);
      case 'source-delete': return inbox.forgetSource(args[0]);
      default: throw new MemoryError('UNKNOWN_RADAR_COMMAND');
    }
  } finally { inbox.close(); }
}
