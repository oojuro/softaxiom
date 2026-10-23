// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  createCredentials,
  captureBrowserKey,
  browserKeyScript,
  sealWith,
  openWith,
} from "../lib/core/vault.js";

const plan = {
  label: "Synthetic API key",
  url: "https://keys.test/settings",
  selector: "#key",
  revealSelector: "#reveal",
};
const input = {
  credentialId: "credential",
  versionId: "one",
  connectionId: "connection",
  plan,
};
const secret = "synthetic-new-key-123";
function fixture() {
  const records = new Map(),
    key = Buffer.alloc(32, 31);
  const identity = (person, id) => JSON.stringify([person, id]);
  const metadata = (row) => {
    const { cipher, ...value } = row;
    return structuredClone(value);
  };
  const binding = (id) => ({
    table: "credential_versions",
    rowId: id,
    purpose: "secret",
  });
  const rows = {
    async prepare(person, request) {
      const id = identity(person, request.versionId);
      if (!records.has(id))
        records.set(id, {
          credentialId: request.credentialId,
          versionId: request.versionId,
          connectionId: request.connectionId,
          state: "pending",
          browserClosed: false,
        });
      return metadata(records.get(id));
    },
    async get(person, id) {
      const row = records.get(identity(person, id));
      return row && metadata(row);
    },
    async list(person, credential) {
      return [...records.entries()]
        .filter(([id, row]) => JSON.parse(id)[0] === person && row.credentialId === credential)
        .map(([, row]) => metadata(row));
    },
    async plan() {
      return plan;
    },
    async claim(person, id) {
      const row = records.get(identity(person, id));
      if (!row || row.state !== "pending" || row.browserClosed) return false;
      row.state = "capturing";
      return true;
    },
    async captured(person, id, value) {
      const row = records.get(identity(person, id));
      if (row.state !== "capturing") throw new Error("conflict");
      row.cipher = sealWith(key, 7, person, binding(id), Buffer.from(value));
      row.state = "candidate";
    },
    async closed(person, id, close) {
      const row = records.get(identity(person, id));
      if (!row.browserClosed) {
        await close();
        row.browserClosed = true;
      }
      return metadata(row);
    },
    async promote(person, id, expected) {
      const row = records.get(identity(person, id));
      const versions = [...records.entries()]
        .filter(
          ([id, candidate]) =>
            JSON.parse(id)[0] === person && candidate.credentialId === row?.credentialId,
        )
        .map(([, v]) => v);
      const current = versions.find((v) => v.state === "current");
      if (
        !row ||
        row.state !== "candidate" ||
        !row.browserClosed ||
        (current?.versionId ?? null) !== expected
      )
        return false;
      if (current) current.state = "retired";
      row.state = "current";
      return true;
    },
    async secrets(person) {
      return [...records.entries()]
        .filter(([id, row]) => JSON.parse(id)[0] === person && row.cipher)
        .map(([, row]) =>
          Buffer.from(openWith(key, person, binding(row.versionId), row.cipher)).toString(),
        );
    },
  };
  let reveals = 0,
    closes = 0;
  const browser = {
    async revealAndRead() {
      reveals++;
      return secret;
    },
    async close() {
      closes++;
    },
  };
  return {
    rows,
    records,
    browser,
    vault: createCredentials(rows),
    reveals: () => reveals,
    closes: () => closes,
  };
}

test("capture returns metadata, encrypts a candidate, and never promotes it implicitly", async () => {
  const f = fixture();
  await f.vault.prepare("person", input);
  const result = await f.vault.capture("person", "one", f.browser);
  assert.equal(result.status, "captured");
  assert.equal(result.version.state, "candidate");
  assert.equal(result.version.browserClosed, true);
  assert.equal(f.reveals(), 1);
  assert.equal(JSON.stringify([...f.records.values()]).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(await f.vault.list("other-person", "credential"), []);
  assert.equal((await f.vault.capture("other-person", "one", f.browser)).status, "unavailable");
  assert.equal(await f.vault.promote("person", "one", null), true);
  assert.equal((await f.vault.capture("person", "one", f.browser)).status, "captured");
  assert.equal(f.reveals(), 1);
  assert.equal(f.closes(), 1);
});

test("concurrent/restarted capture never repeats a reveal after a lost result", async () => {
  const f = fixture();
  await f.vault.prepare("person", input);
  f.browser.revealAndRead = async () => {
    throw new Error(secret);
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => f.vault.capture("person", "one", f.browser)),
  );
  assert.ok(results.every((result) => result.status === "uncertain"));
  assert.equal(f.closes(), 0);
  assert.equal(
    (await createCredentials(f.rows).capture("person", "one", f.browser)).status,
    "uncertain",
  );
  assert.equal((await f.rows.get("person", "one")).browserClosed, false);
  assert.equal(await f.vault.promote("person", "one", null), false);
});

test("failed persistence retains quarantine; replay cannot redispatch", async () => {
  const f = fixture();
  await f.vault.prepare("person", input);
  f.rows.captured = async () => {
    throw new Error(secret);
  };
  assert.deepEqual(await f.vault.capture("person", "one", f.browser), {
    status: "uncertain",
  });
  assert.deepEqual(await f.vault.capture("person", "one", f.browser), {
    status: "uncertain",
  });
  assert.equal(f.reveals(), 1);
  assert.equal(f.closes(), 0);
});

test("cleanup retries only close, and promotion requires a closed browser and matching current version", async () => {
  const f = fixture();
  await f.vault.prepare("person", input);
  f.browser.close = async () => {
    throw new Error(secret);
  };
  assert.equal((await f.vault.capture("person", "one", f.browser)).status, "cleanup_required");
  assert.equal(await f.vault.promote("person", "one", null), false);
  f.browser.close = async () => {};
  assert.equal((await f.vault.capture("person", "one", f.browser)).status, "captured");
  assert.equal(f.reveals(), 1);
  assert.equal(await f.vault.promote("person", "one", null), true);
  await f.vault.prepare("person", { ...input, versionId: "two" });
  await f.vault.capture("person", "two", f.browser);
  assert.equal(await f.vault.promote("person", "two", null), false);
  assert.equal(await f.vault.promote("person", "two", "one"), true);
  assert.equal(
    (await f.vault.list("person", "credential")).find((v) => v.versionId === "one").state,
    "retired",
  );
  assert.equal(await f.vault.scrub("person", secret), "[redacted]");
});

test("invalid plans and keys have content-free failures", async () => {
  const f = fixture();
  for (const url of [
    "http://keys.test",
    "https://user:pass@keys.test",
    "https://keys.test/#secret",
  ]) {
    await assert.rejects(f.vault.prepare("person", { ...input, plan: { ...plan, url } }), {
      code: "invalid_capture",
    });
  }
  await f.vault.prepare("person", input);
  f.browser.revealAndRead = async () => "invalid key with spaces";
  assert.deepEqual(await f.vault.capture("person", "one", f.browser), {
    status: "uncertain",
  });
  await assert.rejects(
    captureBrowserKey(
      plan,
      async () => {
        throw new Error(secret);
      },
      async () => {},
    ),
    (error) => error.code === "unavailable" && !`${error.stack}${error.cause}`.includes(secret),
  );
});

test("browser reads one exact HTTPS page/element, bounds values, and reveals only once while waiting", async () => {
  let revealed = 0;
  class Input {
    value = secret;
  }
  class TextArea {}
  const element = new Input();
  element.click = () => revealed++;
  const window = {};
  window.top = window;
  const context = {
    window,
    location: { href: plan.url, origin: "https://keys.test" },
    document: { querySelectorAll: () => [element] },
    HTMLInputElement: Input,
    HTMLTextAreaElement: TextArea,
    URL,
  };
  assert.equal(runInNewContext(browserKeyScript(plan, "read"), context).value, secret);
  context.location.href = "https://keys.test.evil/settings";
  assert.equal(runInNewContext(browserKeyScript(plan, "read"), context).status, "page_changed");
  context.location.href = plan.url;
  context.document.querySelectorAll = () => [element, element];
  assert.equal(runInNewContext(browserKeyScript(plan, "read"), context).status, "not_found");
  context.document.querySelectorAll = () => [element];
  let reads = 0;
  const value = await captureBrowserKey(
    plan,
    async (script) => {
      if (script.includes('"mode":"read"') && ++reads < 3) return { status: "not_found" };
      return runInNewContext(script, context);
    },
    async () => {},
  );
  assert.equal(value, secret);
  assert.equal(revealed, 1);
  assert.equal(reads, 3);
});

test("provider issuance shares the durable capture claim and never opens a browser", async () => {
  const f = fixture();
  f.rows.plan = async () => ({ ...plan, provider: "cloudflare-user-token" });
  const providerId = { kind: "cloudflare-user-token", id: "a".repeat(32) };
  let issued = 0,
    metadata;
  const persist = f.rows.captured;
  f.rows.captured = async (person, id, value, provider) => {
    metadata = provider;
    return persist(person, id, value);
  };
  await f.vault.prepare("person", { ...input, plan: await f.rows.plan() });
  assert.equal((await f.vault.capture("person", "one", f.browser)).status, "unavailable");
  const provider = {
    kind: "cloudflare-user-token",
    issue: async () => {
      issued++;
      return { value: secret, provider: providerId };
    },
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => f.vault.captureProvider("person", "one", provider)),
  );
  assert.ok(results.some((r) => r.status === "captured"));
  assert.equal(issued, 1);
  assert.equal(f.reveals(), 0);
  assert.equal(f.closes(), 0);
  assert.deepEqual(metadata, providerId);
  assert.equal(
    (await createCredentials(f.rows).captureProvider("person", "one", provider)).status,
    "captured",
  );
  assert.equal(issued, 1);
  assert.equal(await f.vault.promote("person", "one", null), true);
  assert.equal(JSON.stringify(results).includes(secret), false);
});

test("a lost provider issue/persist response is not retried after restart", async () => {
  for (const failPersist of [false, true]) {
    const f = fixture();
    f.rows.plan = async () => ({ ...plan, provider: "cloudflare-user-token" });
    await f.vault.prepare("person", { ...input, plan: await f.rows.plan() });
    if (failPersist)
      f.rows.captured = async () => {
        throw new Error(secret);
      };
    let issued = 0;
    const provider = {
      kind: "cloudflare-user-token",
      issue: async () => {
        issued++;
        if (!failPersist) throw new Error(secret);
        return {
          value: secret,
          provider: { kind: "cloudflare-user-token", id: "a".repeat(32) },
        };
      },
    };
    assert.deepEqual(await f.vault.captureProvider("person", "one", provider), {
      status: "uncertain",
    });
    assert.deepEqual(await createCredentials(f.rows).captureProvider("person", "one", provider), {
      status: "uncertain",
    });
    assert.equal(issued, 1);
    assert.equal((await f.rows.get("person", "one")).browserClosed, false);
    assert.equal(await f.vault.promote("person", "one", null), false);
  }
});
