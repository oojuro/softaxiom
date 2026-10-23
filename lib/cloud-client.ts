// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { check, MemoryError } from "./common.js";
import { authDirectory, authRecordExists, withAuth } from "./local-auth.js";
import { CloudMessage, CloudCursor, CloudTurn } from "./core/contracts/cloud.js";

export const DEFAULT_CLOUD = "https://softaxiom.com";
export const CloudDestination = z.union([
  z.object({ email: z.email().max(254) }).strict(),
  z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/) }).strict(),
]);
export type CloudDestination = z.infer<typeof CloudDestination>;
const token = z.string().min(1).max(32768).regex(/^[A-Za-z0-9._~+/%=-]+$/);
const Session = z.object({
  v: z.literal(1), origin: z.string(), access: token, refresh: token,
}).strict();

export function cloudOrigin(input: string) {
  let url;
  try { url = new URL(input); } catch { throw new MemoryError("INVALID_CLOUD_ORIGIN"); }
  const local = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  check(
    (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === "/",
    "INVALID_CLOUD_ORIGIN",
  );
  return url.origin;
}

async function json(response: Response): Promise<unknown> {
  check(response.body, "CLOUD_INVALID_RESPONSE");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    check(bytes <= 1024 * 1024, "CLOUD_RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new MemoryError("CLOUD_INVALID_RESPONSE"); }
}

async function send(origin: string, path: string, init: RequestInit, request: typeof fetch) {
  check(path.startsWith("/api/") && !path.includes("\\"), "INVALID_CLOUD_PATH");
  const url = new URL(path, cloudOrigin(origin));
  check(url.origin === origin, "INVALID_CLOUD_PATH");
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  try {
    return await request(url, {
      ...init, redirect: "error", signal: AbortSignal.timeout(20000),
      headers,
    });
  } catch { throw new MemoryError("CLOUD_UNAVAILABLE"); }
}

function accepted(response: Response) {
  check(response.ok, response.status === 401 ? "CLOUD_UNAUTHORIZED" :
    response.status === 429 ? "CLOUD_RATE_LIMITED" :
    response.status === 404 ? "CLOUD_UPDATE_REQUIRED" : "CLOUD_REQUEST_REFUSED", { status: response.status });
}

function cookies(response: Response) {
  const values = new Map<string, string>();
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0]!, index = pair.indexOf("=");
    if (index > 0) {
      const name = pair.slice(0, index);
      if (["sa_access", "sa_refresh"].includes(name)) {
        check(!values.has(name), "CLOUD_SESSION_INCOMPLETE");
        values.set(name, pair.slice(index + 1));
      }
    }
  }
  if (!values.size) return undefined;
  const access = token.safeParse(values.get("sa_access"));
  const refresh = token.safeParse(values.get("sa_refresh"));
  check(access.success && refresh.success, "CLOUD_SESSION_INCOMPLETE");
  return { access: access.data, refresh: refresh.data };
}

export class CloudClient {
  readonly state: string;
  readonly request: typeof fetch;
  constructor(state = authDirectory(), request: typeof fetch = globalThis.fetch) {
    this.state = state;
    this.request = request;
  }

  async status() {
    if (!authRecordExists("cloud-session", this.state)) return { connected: false };
    return withAuth(records => {
      const session = records.read("cloud-session", Session);
      return session ? { connected: true, origin: cloudOrigin(session.origin) } : { connected: false };
    }, this.state);
  }

  async requestCode(destination: CloudDestination, server = DEFAULT_CLOUD) {
    const parsed = CloudDestination.safeParse(destination);
    check(parsed.success, "INVALID_CLOUD_DESTINATION");
    const origin = cloudOrigin(server);
    await withAuth(() => {}, this.state);
    const capability = await send(origin, "/api/cli", {}, this.request);
    accepted(capability);
    check(z.object({ version: z.literal(1) }).safeParse(await json(capability)).success, "CLOUD_UPDATE_REQUIRED");
    const response = await send(origin, "/api/auth/code", {
      method: "POST", body: JSON.stringify({ mode: "signin", to: parsed.data }),
    }, this.request);
    accepted(response);
    check(z.object({ sent: z.literal(true) }).safeParse(await json(response)).success, "CLOUD_INVALID_RESPONSE");
    return { sent: true, origin };
  }

  async verify(destination: CloudDestination, code: string, server = DEFAULT_CLOUD) {
    const parsed = CloudDestination.safeParse(destination);
    check(parsed.success && /^\d{4,10}$/.test(code), "INVALID_CLOUD_PROOF");
    const origin = cloudOrigin(server);
    return withAuth(async records => {
      const response = await send(origin, "/api/auth/verify", {
        method: "POST", body: JSON.stringify({ to: parsed.data, code }),
      }, this.request);
      accepted(response);
      const fresh = cookies(response);
      check(fresh && z.object({ ok: z.literal(true) }).safeParse(await json(response)).success, "CLOUD_SESSION_INCOMPLETE");
      records.write("cloud-session", { v: 1, origin, ...fresh });
      return { connected: true, origin };
    }, this.state);
  }

  async call(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}) {
    return withAuth(async records => {
      const session = records.read("cloud-session", Session);
      check(session, "CLOUD_LOGIN_REQUIRED");
      cloudOrigin(session.origin);
      const response = await send(session.origin, path, {
        method,
        headers: {
          authorization: `Bearer ${session.access}`,
          cookie: `sa_access=${session.access}; sa_refresh=${session.refresh}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }, this.request);
      if (response.status === 401) {
        records.remove("cloud-session");
        accepted(response);
      }
      const fresh = cookies(response);
      if (fresh) records.write("cloud-session", { ...session, ...fresh });
      accepted(response);
      return json(response);
    }, this.state);
  }

  async message(input: CloudMessage) {
    const parsed = CloudMessage.safeParse(input);
    check(parsed.success, "INVALID_CLOUD_MESSAGE");
    const response = await this.call("/api/conversation", { method: "POST", body: parsed.data });
    const receipt = z.object({ ingressId: z.uuid() }).strict().safeParse(response);
    check(receipt.success && receipt.data.ingressId === input.operationId, "CLOUD_INVALID_RESPONSE");
    return receipt.data;
  }

  async turn(operationId: string, after?: CloudCursor) {
    check(z.uuid().safeParse(operationId).success, "INVALID_CLOUD_OPERATION");
    const query = new URLSearchParams();
    if (after) {
      const cursor = CloudCursor.safeParse(after);
      check(cursor.success, "INVALID_CLOUD_CURSOR");
      query.set("day", cursor.data.day);
      query.set("line", String(cursor.data.line));
    }
    const response = await this.call(`/api/conversation/turns/${operationId}?${query}`);
    const parsed = CloudTurn.safeParse(response);
    check(parsed.success && parsed.data.ingressId === operationId, "CLOUD_INVALID_RESPONSE");
    return parsed.data;
  }

  async logout() {
    return withAuth(async records => {
      const session = records.read("cloud-session", Session);
      if (!session) return { connected: false, revocation: "no_session" };
      let revoked = false;
      try {
        const response = await send(session.origin, "/api/auth/signout", {
          method: "POST", body: "{}", headers: {
            authorization: `Bearer ${session.access}`,
            cookie: `sa_access=${session.access}; sa_refresh=${session.refresh}`,
          },
        }, this.request);
        if (response.ok)
          revoked = z.object({ revoked: z.literal(true) }).safeParse(await json(response)).success;
      } catch { /* Local logout must succeed even when remote revocation cannot be confirmed. */ }
      records.remove("cloud-session");
      return { connected: false, revocation: revoked ? "confirmed" : "unknown" };
    }, this.state);
  }
}
