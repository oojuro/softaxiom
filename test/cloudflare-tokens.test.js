// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareTokens, cloudflareCandidateName } from "../lib/core/vault.js";

const oldId = "a".repeat(32),
  newId = "b".repeat(32),
  manager = "synthetic-management-token";
const candidateId = "30b04d32-6df2-4fda-b55f-fb3d87fc6fd3";
const old = {
  id: oldId,
  name: "existing",
  status: "active",
  policies: [
    {
      id: "c".repeat(32),
      effect: "allow",
      resources: { "com.cloudflare.api.account.zone.test": "*" },
      permission_groups: [
        {
          id: "d".repeat(32),
          name: "Zone Read",
          meta: { scopes: "com.cloudflare.api.account" },
        },
      ],
    },
  ],
  condition: { request_ip: { in: ["192.0.2.0/24"], not_in: ["192.0.2.7/32"] } },
  expires_on: "2027-01-01T00:00:00Z",
  not_before: "2026-01-01T00:00:00Z",
};
function fixture() {
  const requests = [];
  let candidate = {
    ...structuredClone(old),
    id: newId,
    name: cloudflareCandidateName(candidateId),
  };
  const api = createCloudflareTokens(async (url, options) => {
    requests.push({ url, ...options });
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(new URL(url).origin, "https://api.cloudflare.com");
    const path = new URL(url).pathname;
    const result = path.endsWith("/verify")
      ? { id: newId, status: "active" }
      : options.method === "POST"
        ? { id: newId, value: "synthetic-new-token" }
        : options.method === "DELETE"
          ? { id: oldId }
          : path.endsWith(oldId)
            ? old
            : candidate;
    return Response.json({ success: true, result });
  });
  return { api, requests, candidate };
}

test("Cloudflare creates an overlapping token with identical permissions, IP and lifetime restrictions", async () => {
  const f = fixture();
  const issued = await f.api.issue(manager, oldId, candidateId);
  assert.deepEqual(issued, {
    value: "synthetic-new-token",
    provider: { kind: "cloudflare-user-token", id: newId },
  });
  const body = JSON.parse(f.requests.find((r) => r.method === "POST").body);
  assert.deepEqual(body, {
    name: cloudflareCandidateName(candidateId),
    policies: [
      {
        effect: "allow",
        resources: old.policies[0].resources,
        permission_groups: [{ id: "d".repeat(32) }],
      },
    ],
    condition: old.condition,
    expires_on: old.expires_on,
    not_before: old.not_before,
  });
  assert.ok(await f.api.verify(manager, issued.value, newId, oldId, candidateId));
  assert.ok(!f.requests.some((r) => r.method === "DELETE"));
  assert.ok(await f.api.remove(manager, oldId));
  assert.equal(f.requests.at(-1).method, "DELETE");
});

test("Cloudflare refuses permission widening, wrong identity/name and unfamiliar restrictions", async () => {
  for (const change of [
    (c) => {
      c.future_restriction = "unknown semantics";
    },
    (c) => {
      c.policies[0].resources = { "*": "*" };
    },
    (c) => {
      c.name = "other operation";
    },
    (c) => {
      c.id = oldId;
    },
    (c) => {
      delete c.condition;
    },
    (c) => {
      c.expires_on = "2028-01-01T00:00:00Z";
    },
    (c) => {
      c.policies[0].future_policy = "unknown semantics";
    },
  ]) {
    const f = fixture();
    change(f.candidate);
    assert.equal(
      await f.api.verify(manager, "synthetic-new-token", newId, oldId, candidateId),
      false,
    );
  }
  const mutated = structuredClone(old);
  mutated.condition.future_restriction = "unknown";
  let posts = 0;
  const api = createCloudflareTokens(async (_url, options) => {
    if (options.method === "POST") posts++;
    return Response.json({ success: true, result: mutated });
  });
  await assert.rejects(api.issue(manager, oldId, candidateId), {
    message: "cloudflare_token: unavailable",
  });
  assert.equal(posts, 0);
});

test("Cloudflare never retries mutations and suppresses transport/provider/schema content", async () => {
  for (const response of [
    () => {
      throw new Error(manager);
    },
    () => new Response(manager, { status: 429 }),
    () => new Response("x".repeat(131_073)),
    () => Response.json({ success: false, errors: [manager] }),
    () => Response.json({ success: true, result: { id: manager } }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test" },
      }),
  ]) {
    let calls = 0;
    const api = createCloudflareTokens(async () => {
      calls++;
      return response();
    });
    await assert.rejects(
      api.remove(manager, oldId),
      (error) =>
        error.message === "cloudflare_token: unavailable" &&
        !`${error.stack}${error.cause}`.includes(manager),
    );
    assert.equal(calls, 1);
  }
  const absent = createCloudflareTokens(async () => new Response(null, { status: 404 }));
  assert.equal(await absent.describe(manager, oldId), undefined);
  await assert.rejects(absent.remove(manager, oldId));
});
