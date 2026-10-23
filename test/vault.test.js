// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createVault,
  openWith,
  sealWith,
  VaultError,
  loginSecretRecord,
  loginOriginsRecord,
  authenticatorCode,
  parseAuthenticator,
  createSecretRedactor,
} from "../lib/core/vault.js";

const password = "synthetic-password";
const origin = "https://vault.example";
const person = "synthetic-person";
const connection = "synthetic-login";

// Synthetic host: encrypted records, separate origins, atomic markers and tenant-scoped access.
// It intentionally has no database/provider dependency; the hosted adapter has its own DB tests.
function fixture() {
  const key = Buffer.alloc(32, 19),
    records = new Map(),
    opened = [],
    typed = [];
  const clock = new Date("2026-10-23T12:00:00Z");
  const identity = (who, id) => JSON.stringify([who, id]);
  const binding = (id, purpose) => ({ table: "vault_logins", rowId: id, purpose });
  const seal = (who, id, purpose, value) =>
    sealWith(key, 1, who, binding(id, purpose), Buffer.from(JSON.stringify(value)));
  const open = (who, row, purpose) =>
    JSON.parse(
      Buffer.from(openWith(key, who, binding(row.connectionId, purpose), row[purpose])).toString(),
    );
  const rows = {
    async get(who, id) {
      const row = records.get(identity(who, id));
      return row && structuredClone(row);
    },
    async list(who) {
      return [...records.values()]
        .filter((row) => row.personId === who)
        .map((row) => structuredClone(row));
    },
    async originsOf(who, row) {
      return open(who, row, "origins").origins;
    },
    async secretOf(who, row) {
      opened.push(row.connectionId);
      return open(who, row, "secret");
    },
    async savedFrom(who, row) {
      const origins = open(who, row, "origins");
      return {
        connectionId: row.connectionId,
        origins: origins.origins,
        authenticator: origins.authenticator ?? false,
        autoSignIn: row.autoSignIn,
        rejectedAt: row.rejectedAt,
        generation: row.generation,
      };
    },
    async put(who, id, login) {
      const prior = records.get(identity(who, id));
      const secret = prior ? open(who, prior, "secret") : {};
      const origins = login.origins ?? [origin];
      const row = {
        personId: who,
        connectionId: id,
        generation: (prior?.generation ?? 0) + 1,
        autoSignIn: login.autoSignIn,
        rejectedAt: null,
        until: null,
        secret: seal(who, id, "secret", { ...secret, password: login.password }),
        origins: seal(who, id, "origins", { origins, authenticator: Boolean(secret.totp) }),
      };
      records.set(identity(who, id), row);
      return rows.savedFrom(who, row);
    },
    async setAuthenticator(who, id, value) {
      const row = records.get(identity(who, id));
      if (!row) return false;
      const { totp: old, ...secret } = open(who, row, "secret");
      row.secret = seal(who, id, "secret", { ...secret, ...(value && { totp: value }) });
      row.origins = seal(who, id, "origins", {
        ...open(who, row, "origins"),
        authenticator: Boolean(value),
      });
      row.generation++;
      return true;
    },
    async setAutoSignIn(who, id, enabled) {
      const row = records.get(identity(who, id));
      if (row) row.autoSignIn = enabled;
      return row;
    },
    async removeOrigins(who, id, removing) {
      const row = records.get(identity(who, id));
      if (!row) return;
      const kept = open(who, row, "origins").origins.filter((value) => !removing.includes(value));
      if (!kept.length) throw new VaultError("no_origin");
      row.origins = seal(who, id, "origins", { origins: kept });
      row.generation++;
      return row;
    },
    async addOriginIn(_tx, who, id, value) {
      const row = records.get(identity(who, id));
      if (!row) return false;
      const current = open(who, row, "origins");
      row.origins = seal(who, id, "origins", {
        ...current,
        origins: [...new Set([...current.origins, value])],
      });
      row.generation++;
      return true;
    },
    async remove(who, id) {
      return records.delete(identity(who, id));
    },
    async claimTyping(who, id, now, until) {
      const row = records.get(identity(who, id));
      if (!row?.autoSignIn || (row.until && row.until > now)) return false;
      row.until = until;
      return true;
    },
    async settle(who, id, outcome, now) {
      const row = records.get(identity(who, id));
      if (!row) return;
      row.until = null;
      if (outcome === "rejected") {
        row.autoSignIn = false;
        row.rejectedAt = now;
      }
    },
  };
  const vault = createVault({ rows, now: () => clock });
  const tab = {
    address: () => `${origin}/login`,
    async typeSecret(ref, value, origins, field) {
      typed.push({ ref, value, origins, field });
      return "typed";
    },
  };
  const request = { personId: person, connectionId: connection, tab, ref: "password" };
  const save = () => vault.save(person, connection, { password, origins: [origin] });
  return { rows, records, opened, typed, vault, tab, request, save };
}

test("pre-extraction saved-login envelopes open with unchanged bindings and record schemas", () => {
  const golden = JSON.parse(readFileSync(new URL("../fixtures/vault-v1.json", import.meta.url)));
  for (const record of golden.records) {
    const bytes = openWith(
      Buffer.from(golden.keyHex, "hex"),
      golden.personId,
      record.binding,
      record.envelope,
    );
    assert.equal(Buffer.from(bytes).toString(), record.plaintext);
    const schema =
      record.binding.purpose === "secret_cipher" ? loginSecretRecord : loginOriginsRecord;
    assert.deepEqual(schema.parse(JSON.parse(record.plaintext)), JSON.parse(record.plaintext));
    for (const changed of [
      { ...record.binding, rowId: "another-row" },
      { ...record.binding, purpose: "another-field" },
    ])
      assert.throws(() =>
        openWith(Buffer.from(golden.keyHex, "hex"), golden.personId, changed, record.envelope),
      );
    assert.throws(() =>
      openWith(
        Buffer.from(golden.keyHex, "hex"),
        "another-person",
        record.binding,
        record.envelope,
      ),
    );
    assert.throws(() =>
      openWith(Buffer.from(golden.keyHex, "hex"), golden.personId, record.binding, {
        ...record.envelope,
        kv: 3,
      }),
    );
  }
});

test("the shared vault lists only metadata, types through a reference and preserves encrypted storage", async () => {
  const f = fixture();
  await f.save();
  assert.equal(JSON.stringify([...f.records.values()]).includes(password), false);
  const metadata = await f.vault.list(person);
  assert.equal(JSON.stringify(metadata).includes(password), false);
  assert.deepEqual(f.opened, []);
  assert.equal(await f.vault.typePassword(f.request), "typed");
  assert.equal(f.typed[0].value, password);
  assert.deepEqual(await f.vault.list("another-person"), []);
  assert.equal(
    await f.vault.typePassword({ ...f.request, personId: "another-person" }),
    "no_saved_login",
  );
});

test("invalid origins, disabled access and invalid passwords fail before secret dispatch", async () => {
  const f = fixture();
  for (const invalid of ["", "abc", "x".repeat(1025)]) {
    await assert.rejects(
      f.vault.save(person, connection, { password: invalid, origins: [origin] }),
      { code: "invalid_password" },
    );
    await assert.rejects(f.vault.saveForConnection(person, connection, invalid, true), {
      code: "invalid_password",
    });
  }
  await f.save();
  for (const address of [
    "http://vault.example",
    "https://vault.example.evil.test",
    "https://vault.example:8443",
    "https://user@vault.example",
  ]) {
    f.tab.address = () => address;
    assert.equal(await f.vault.typePassword(f.request), "origin_not_allowed");
  }
  assert.deepEqual(f.opened, []);
  assert.deepEqual(f.typed, []);
  f.tab.address = () => origin;
  await f.vault.change(person, connection, { autoSignIn: false });
  assert.equal(await f.vault.typePassword(f.request), "off");
});

test("a lost typing response retains the marker across vault instances", async () => {
  const f = fixture();
  await f.save();
  f.tab.typeSecret = async () => {
    throw new Error(`synthetic lost response ${password}`);
  };
  assert.equal(await f.vault.typePassword(f.request), "uncertain");
  const restarted = createVault({ rows: f.rows, now: () => new Date("2026-10-23T12:00:00Z") });
  assert.equal(await restarted.typePassword(f.request), "retry_later");
  await restarted.settle(person, connection, "rejected");
  assert.equal(await restarted.typePassword(f.request), "off");
});

test("only one concurrent password typing acquires the host marker", async () => {
  const f = fixture();
  await f.save();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => f.vault.typePassword(f.request)),
  );
  assert.equal(results.filter((status) => status === "typed").length, 1);
  assert.equal(f.typed.length, 1);
});

test("the browser rechecks form destinations; a refused field releases the marker", async () => {
  const f = fixture();
  await f.save();
  f.tab.typeSecret = async () => "origin_mismatch";
  assert.equal(await f.vault.typePassword(f.request), "origin_not_allowed");
  f.tab.typeSecret = async () => "page_changed";
  assert.equal(await f.vault.typePassword(f.request), "page_changed");
  f.tab.typeSecret = async () => "typed";
  assert.equal(await f.vault.typePassword(f.request), "typed");
});

test("authenticator codes and encoded saved secrets are scrubbed without reaching metadata", async () => {
  const f = fixture();
  await f.save();
  const seed = "JBSWY3DPEHPK3PXP";
  await f.vault.setAuthenticator(person, connection, seed);
  assert.equal(await f.vault.typeAuthenticatorCode(f.request), "typed");
  const code = f.typed[0].value;
  for (const value of [
    password,
    seed,
    code,
    Buffer.from(password).toString("hex"),
    Buffer.from(`user:${password}`).toString("base64"),
  ])
    assert.ok((await f.vault.scrub(person, `error ${value}`)).includes("[redacted]"));
  assert.equal(JSON.stringify(await f.vault.list(person)).includes(seed), false);
});

test("redaction discovers replacement and removal by another vault instance", async () => {
  const f = fixture();
  await f.save();
  const reader = createVault({ rows: f.rows });
  assert.equal(await reader.scrub(person, password), "[redacted]");
  await f.vault.save(person, connection, { password: "replacement-secret", origins: [origin] });
  assert.equal(await reader.scrub(person, "replacement-secret"), "[redacted]");
  await f.vault.remove(person, connection);
  assert.equal(await reader.scrub(person, "replacement-secret"), "replacement-secret");
});

test("an unreadable record never exposes a provider error or types anything", async () => {
  const f = fixture();
  await f.save();
  f.rows.secretOf = async () => {
    throw new Error(`synthetic key service error ${password}`);
  };
  assert.equal(await f.vault.typePassword(f.request), "unreadable");
  assert.deepEqual(f.typed, []);
});

test("TOTP matches the RFC 6238 known answer", () => {
  const parsed = parseAuthenticator(
    "otpauth://totp/synthetic?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8",
  );
  assert.equal(authenticatorCode(parsed, new Date(59000)), "94287082");
  const redactor = createSecretRedactor();
  redactor.set("login", password);
  assert.equal(redactor.redact(password.replace(/(.{2})/g, "$1\n")).trim(), "[redacted]");
});
