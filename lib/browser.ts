// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { join, isAbsolute } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { check, hash, MemoryError } from "./common.js";
import { localDirectory, saveJson, httpUrl, pause, text } from "./local-state.js";

class Devtools {
  readonly socket: WebSocket;
  sequence: number;
  readonly pending: Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >;
  constructor(socket: WebSocket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      if (typeof data !== "string" || Buffer.byteLength(data) > 6 * 1024 * 1024) {
        socket.close();
        return;
      }
      let reply: { id: number; error?: unknown; result: unknown };
      try {
        reply = JSON.parse(data);
      } catch {
        socket.close();
        return;
      }
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      clearTimeout(waiting.timer);
      if (reply.error) waiting.reject(new MemoryError("BROWSER_PROTOCOL_ERROR"));
      else waiting.resolve(reply.result);
    });
    socket.addEventListener("close", () => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new MemoryError("BROWSER_DISCONNECTED"));
      }
      this.pending.clear();
    });
  }
  call<M extends keyof Protocol>(
    method: M,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Protocol[M]> {
    const id = ++this.sequence;
    return new Promise<Protocol[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MemoryError("BROWSER_TIMEOUT", { method }));
      }, 15000);
      this.pending.set(id, { resolve: (value) => resolve(value as Protocol[M]), reject, timer });
      try {
        this.socket.send(
          JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
        );
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new MemoryError("BROWSER_DISCONNECTED"));
      }
    });
  }
  close() {
    this.socket.close();
  }
}

async function discovery(endpoint: string) {
  const url = httpUrl(endpoint, { local: true });
  check(
    url.protocol === "http:" && url.pathname === "/" && !url.search,
    "INVALID_BROWSER_ENDPOINT",
  );
  let response;
  try {
    response = await fetch(new URL("/json/version", url), {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw new MemoryError("BROWSER_NOT_RUNNING");
  }
  check(response.ok, "BROWSER_NOT_RUNNING");
  const chunks = [];
  let size = 0;
  check(response.body, "BROWSER_NOT_RUNNING");
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= 64000, "INVALID_BROWSER_ENDPOINT");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new MemoryError("INVALID_BROWSER_ENDPOINT");
  }
  const socket = httpUrl(data.webSocketDebuggerUrl, { local: true });
  check(
    socket.protocol === "ws:" &&
      socket.host === url.host &&
      /^\/devtools\/browser\//.test(socket.pathname),
    "INVALID_BROWSER_ENDPOINT",
  );
  return { endpoint: url.origin, websocket: socket.href };
}

export class LocalBrowser {
  static async connect(workspace: string) {
    const path = join(localDirectory(workspace, "browser"), "connection.json");
    check(fs.existsSync(path) && !fs.lstatSync(path).isSymbolicLink(), "BROWSER_NOT_CONFIGURED");
    const state = JSON.parse(fs.readFileSync(path, "utf8"));
    const current = await discovery(state.endpoint);
    check(current.websocket === state.websocket, "BROWSER_SESSION_CHANGED");
    const socket = new WebSocket(current.websocket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new MemoryError("BROWSER_TIMEOUT"));
      }, 5000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new MemoryError("BROWSER_CONNECTION_FAILED"));
        },
        { once: true },
      );
    });
    return new LocalBrowser(workspace, state, new Devtools(socket));
  }
  readonly workspace: string;
  readonly state: BrowserState;
  readonly protocol: Devtools;
  readonly sessions: Map<string, string>;
  constructor(workspace: string, state: BrowserState, protocol: Devtools) {
    this.workspace = workspace;
    this.state = state;
    this.protocol = protocol;
    this.sessions = new Map();
  }
  close() {
    this.protocol.close();
  }
  async tabs() {
    return (await this.protocol.call("Target.getTargets")).targetInfos
      .filter((t) => t.type === "page")
      .map((t) => ({ id: t.targetId, url: t.url, title: t.title }));
  }
  async session(id: string) {
    text(id, 200);
    if (!this.sessions.has(id)) {
      const { sessionId } = await this.protocol.call("Target.attachToTarget", {
        targetId: id,
        flatten: true,
      });
      this.sessions.set(id, sessionId);
    }
    return this.sessions.get(id)!;
  }
  async evaluate<T>(id: string, expression: string): Promise<T> {
    const answer = await this.protocol.call(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      await this.session(id),
    );
    check(!answer.exceptionDetails && answer.result?.type !== "undefined", "BROWSER_PAGE_ERROR");
    return answer.result.value as T;
  }
  async pageUrl(id: string, origins?: string[]) {
    const value = await this.evaluate<string>(id, "location.href");
    const url = httpUrl(value);
    check(!origins || origins.includes(url.origin), "BROWSER_ORIGIN_NOT_ALLOWED");
    return url.href;
  }
  async navigate(url: string, id?: string) {
    url = httpUrl(url).href;
    const created = !id;
    if (!id)
      id = (
        await this.protocol.call("Target.createTarget", { url: "about:blank", background: true })
      ).targetId;
    try {
      const result = await this.protocol.call("Page.navigate", { url }, await this.session(id));
      check(!result.errorText, "BROWSER_NAVIGATION_FAILED");
      for (let i = 0; i < 100; i++) {
        const frame = await this.protocol.call("Page.getFrameTree", {}, await this.session(id));
        const ready = await this.evaluate<{ url: string; ready: string }>(
          id,
          "({url:location.href,ready:document.readyState})",
        );
        if (
          (!result.loaderId || frame.frameTree.frame.loaderId === result.loaderId) &&
          ready.url !== "about:blank" &&
          ["interactive", "complete"].includes(ready.ready)
        )
          return { id, url: ready.url };
        await pause(50);
      }
      throw new MemoryError("BROWSER_NAVIGATION_TIMEOUT");
    } catch (error) {
      if (created) await this.protocol.call("Target.closeTarget", { targetId: id }).catch(() => {});
      throw error;
    }
  }
  async read({ url, selector, attribute }: { url: string; selector: string; attribute: string }) {
    const origin = httpUrl(url).origin;
    const tab = await this.navigate(url);
    try {
      const address = await this.pageUrl(tab.id, [origin]);
      const value = await this.evaluate<string | null>(
        tab.id,
        `document.querySelector(${JSON.stringify(text(selector, 1000))})?.getAttribute(${JSON.stringify(text(attribute, 100))})?.slice(0,320) ?? null`,
      );
      check((await this.pageUrl(tab.id, [origin])) === address, "BROWSER_PAGE_CHANGED");
      return { url: address, value };
    } finally {
      await this.protocol.call("Target.closeTarget", { targetId: tab.id }).catch(() => {});
    }
  }
  async snapshot(id: string, origins?: string[]) {
    const url = await this.pageUrl(id, origins);
    const page = await this.evaluate<{
      title: string;
      text: string;
      textTruncated: boolean;
      elements: PageElement[];
    }>(
      id,
      `({title:document.title,text:(document.body?.innerText||'').slice(0,6000),textTruncated:(document.body?.innerText||'').length>6000,
      elements:Array.from(document.querySelectorAll('a,button,input,textarea,select')).slice(0,30).map(e=>({
        tag:e.tagName.toLowerCase(),id:e.id,name:e.getAttribute('name'),type:e.getAttribute('type'),
        text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,100),href:e.tagName==='A'?e.href.slice(0,500):null}))})`,
    );
    check((await this.pageUrl(id, origins)) === url, "BROWSER_PAGE_CHANGED");
    return { id, url, ...page, outsideContent: true, elementLimit: 30 };
  }
  async items(
    id: string,
    {
      selector,
      readySelector,
      idAttribute = "href",
      revisionAttribute,
      maxItems = 100,
    }: BrowserItems,
    origins?: string[],
  ) {
    text(selector, 1000);
    text(idAttribute, 100);
    check(Number.isSafeInteger(maxItems) && maxItems > 0 && maxItems <= 500, "INVALID_ITEM_LIMIT");
    const url = await this.pageUrl(id, origins);
    if (readySelector) {
      text(readySelector, 1000);
      let ready = false;
      for (let i = 0; i < 30; i++) {
        if (
          await this.evaluate(
            id,
            `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`,
          )
        ) {
          ready = true;
          break;
        }
        await pause(100);
      }
      check(ready, "BROWSER_WATCHER_NOT_READY");
    }
    const items = await this.evaluate<
      { id: string; text: string; url: string; revision: string | null }[]
    >(
      id,
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0,${maxItems + 1}).map(e=>({
      id:e.getAttribute(${JSON.stringify(idAttribute)}), text:(e.innerText||'').slice(0,1000),
      url:e.closest('a')?.href||e.querySelector('a')?.href||location.href,
      revision:${revisionAttribute ? `e.getAttribute(${JSON.stringify(text(revisionAttribute, 100))})` : "null"}}))`,
    );
    check(items.length <= maxItems, "BROWSER_WATCHER_TRUNCATED");
    check((await this.pageUrl(id, origins)) === url, "BROWSER_PAGE_CHANGED");
    return items.map((item) => {
      text(item.id, 1000);
      return { ...item, revision: item.revision ?? hash(item.text + item.url) };
    });
  }
  async prepare(operation: string, input: unknown, origins: string[]): Promise<PreparedAction> {
    check(
      ["navigate", "click", "type", "press", "close"].includes(operation),
      "INVALID_BROWSER_OPERATION",
    );
    const args = structuredClone(input) as BrowserInput;
    if (operation === "navigate") {
      const url = httpUrl(args.url);
      check(origins.includes(url.origin), "BROWSER_ORIGIN_NOT_ALLOWED");
      check(!args.id || typeof args.id === "string", "INVALID_BROWSER_TARGET");
      if (args.id) await this.pageUrl(args.id, origins);
      return {
        operation,
        args: { url: url.href, ...(args.id ? { id: args.id } : {}) },
        binding: args.id ? await this.pageUrl(args.id, origins) : null,
      };
    }
    const url = await this.pageUrl(args.id, origins);
    if (operation === "close") {
      const frame = await this.protocol.call("Page.getFrameTree", {}, await this.session(args.id));
      return {
        operation,
        args: { id: args.id },
        binding: hash(JSON.stringify([url, frame.frameTree.frame.loaderId])),
      };
    }
    text(args.selector, 1000);
    if (operation === "type") text(args.text, 8192);
    if (operation === "press")
      check(
        ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].includes(args.key),
        "INVALID_BROWSER_KEY",
      );
    const node = await this.evaluate<{
      type: string;
      autocomplete: string;
      disabled: boolean;
      readOnly: boolean;
      tag: string;
      editable: boolean;
    } | null>(
      args.id,
      `(()=>{const e=document.querySelector(${JSON.stringify(args.selector)});if(!e)return null;
      return {tag:e.tagName,id:e.id,name:e.getAttribute('name'),type:(e.getAttribute('type')||'text').toLowerCase(),editable:e.isContentEditable,disabled:e.disabled||false,readOnly:e.readOnly||false,autocomplete:e.autocomplete||'',text:(e.innerText||'').slice(0,300),href:e.getAttribute('href')};})()`,
    );
    check(node, "BROWSER_ELEMENT_NOT_FOUND");
    check(
      !["password", "hidden", "file"].includes(node.type) &&
        !/password|one-time-code/.test(node.autocomplete),
      "BROWSER_HUMAN_INPUT_REQUIRED",
    );
    check(!node.disabled, "BROWSER_ELEMENT_DISABLED");
    if (operation === "type")
      check(
        !node.readOnly &&
          (node.tag === "TEXTAREA" ||
            node.editable ||
            (node.tag === "INPUT" &&
              ["text", "search", "email", "url", "tel", "number"].includes(node.type))),
        "BROWSER_ELEMENT_NOT_EDITABLE",
      );
    const frame = await this.protocol.call("Page.getFrameTree", {}, await this.session(args.id));
    return {
      operation: operation as "click" | "type" | "press",
      args,
      binding: hash(JSON.stringify({ url, loader: frame.frameTree.frame.loaderId, node })),
    };
  }
  async execute(prepared: PreparedAction, origins: string[], authorize: () => unknown = () => {}) {
    const current = await this.prepare(prepared.operation, prepared.args, origins);
    check(current.binding === prepared.binding, "BROWSER_ACTION_STALE");
    const { operation, args } = current;
    authorize();
    if (operation === "navigate") return this.navigate(args.url, args.id);
    if (operation === "close")
      return this.protocol.call("Target.closeTarget", { targetId: args.id });
    const session = await this.session(args.id);
    const position = await this.evaluate<{
      x: number;
      y: number;
      width: number;
      height: number;
      hit: boolean;
    }>(
      args.id,
      `(()=>{const e=document.querySelector(${JSON.stringify(args.selector)});e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
      return {x,y,width:r.width,height:r.height,hit:!!hit&&(hit===e||e.contains(hit))};})()`,
    );
    check(position.width > 0 && position.height > 0 && position.hit, "BROWSER_ELEMENT_NOT_VISIBLE");
    authorize();
    if (operation === "click") {
      await this.protocol.call(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", x: position.x, y: position.y, button: "left", clickCount: 1 },
        session,
      );
      await this.protocol.call(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", x: position.x, y: position.y, button: "left", clickCount: 1 },
        session,
      );
    } else
      await this.evaluate(
        args.id,
        `(()=>{document.querySelector(${JSON.stringify(args.selector)}).focus();return true;})()`,
      );
    if (operation === "type") {
      authorize();
      await this.protocol.call("Input.insertText", { text: args.text }, session);
    }
    if (operation === "press") {
      authorize();
      const codes = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
      await this.protocol.call(
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          key: args.key,
          code: args.key,
          windowsVirtualKeyCode: codes[args.key],
          nativeVirtualKeyCode: codes[args.key],
        },
        session,
      );
      await this.protocol.call(
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: args.key, code: args.key },
        session,
      );
    }
    return { id: args.id, operation, dispatched: true };
  }
  async screenshot(id: string, origins?: string[]) {
    const url = await this.pageUrl(id, origins);
    const { data } = await this.protocol.call(
      "Page.captureScreenshot",
      { format: "png" },
      await this.session(id),
    );
    check((await this.pageUrl(id, origins)) === url, "BROWSER_PAGE_CHANGED");
    const file = join(localDirectory(this.workspace, "browser"), `${randomUUID()}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"), { mode: 0o600 });
    return { path: file };
  }
}

export async function attachBrowser(workspace: string, endpoint: string) {
  const state = { ...(await discovery(endpoint)), owned: false };
  saveJson(join(localDirectory(workspace, "browser"), "connection.json"), state);
  return state;
}

export async function startBrowser(
  workspace: string,
  { executable, headless = false }: { executable?: string | undefined; headless?: boolean } = {},
): Promise<BrowserState> {
  const directory = localDirectory(workspace, "browser");
  const statePath = join(directory, "connection.json");
  if (fs.existsSync(statePath)) {
    const previous = JSON.parse(fs.readFileSync(statePath, "utf8"));
    try {
      const current = await discovery(previous.endpoint);
      if (current.websocket === previous.websocket) return previous;
    } catch {}
  }
  if (!executable) {
    for (const candidate of [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "microsoft-edge",
    ]) {
      const found = spawnSync("which", [candidate], { encoding: "utf8" });
      if (found.status === 0) {
        executable = found.stdout.trim();
        break;
      }
    }
  }
  check(
    executable && isAbsolute(executable) && fs.statSync(executable).isFile(),
    "INSTALLED_BROWSER_REQUIRED",
  );
  const profile = join(directory, "profile");
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  check(!fs.lstatSync(profile).isSymbolicLink(), "INVALID_BROWSER_PROFILE");
  const marker = join(profile, "DevToolsActivePort");
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      ...(headless ? ["--headless=new"] : []),
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  let failure;
  child.on("error", () => {
    failure = true;
  });
  child.unref();
  for (let i = 0; i < 200; i++) {
    check(!failure && child.exitCode === null, "BROWSER_START_FAILED");
    if (fs.existsSync(marker)) {
      const [port] = fs.readFileSync(marker, "utf8").split("\n");
      if (/^\d+$/.test(port ?? "")) {
        try {
          const state = {
            ...(await discovery(`http://127.0.0.1:${port}`)),
            owned: true,
            profile,
            pid: child.pid,
          };
          saveJson(statePath, state);
          return state;
        } catch {}
      }
    }
    await pause(50);
  }
  child.kill();
  throw new MemoryError("BROWSER_START_TIMEOUT");
}

export async function stopBrowser(workspace: string) {
  const browser = await LocalBrowser.connect(workspace);
  try {
    check(browser.state.owned, "ATTACHED_BROWSER_NOT_OWNED");
    await browser.protocol.call("Browser.close");
  } finally {
    browser.close();
  }
  if (
    typeof browser.state.pid === "number" &&
    Number.isSafeInteger(browser.state.pid) &&
    browser.state.pid > 0
  ) {
    let stopped = false;
    for (let i = 0; i < 200; i++) {
      try {
        process.kill(browser.state.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          stopped = true;
          break;
        }
        throw error;
      }
      await pause(50);
    }
    check(stopped, "BROWSER_STOP_TIMEOUT");
  }
  fs.unlinkSync(join(localDirectory(workspace, "browser"), "connection.json"));
  return { stopped: true };
}

interface Protocol {
  "Target.getTargets": {
    targetInfos: { targetId: string; type: string; url: string; title: string }[];
  };
  "Target.attachToTarget": { sessionId: string };
  "Runtime.evaluate": { exceptionDetails?: unknown; result: { type: string; value: unknown } };
  "Target.createTarget": { targetId: string };
  "Page.navigate": { errorText?: string; loaderId?: string };
  "Page.getFrameTree": { frameTree: { frame: { loaderId: string } } };
  "Target.closeTarget": { success: boolean };
  "Input.dispatchMouseEvent": unknown;
  "Input.insertText": unknown;
  "Input.dispatchKeyEvent": unknown;
  "Page.captureScreenshot": { data: string };
  "Browser.close": unknown;
}
interface BrowserState {
  endpoint: string;
  websocket: string;
  owned: boolean;
  pid?: number | undefined;
  profile?: string;
}
interface PageElement {
  tag: string;
  id: string;
  name: string | null;
  type: string | null;
  text: string;
  href: string | null;
}
export interface BrowserItems {
  selector: string;
  readySelector?: string;
  idAttribute?: string;
  revisionAttribute?: string;
  maxItems?: number;
}
interface BrowserInput {
  url: string;
  id: string;
  selector: string;
  text: string;
  key: "Enter" | "Tab" | "Escape" | "ArrowDown" | "ArrowUp";
}
export type PreparedAction =
  | { operation: "navigate"; args: { url: string; id?: string }; binding: string | null }
  | { operation: "close"; args: { id: string }; binding: string | null }
  | { operation: "click" | "type" | "press"; args: BrowserInput; binding: string | null };
