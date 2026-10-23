// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { runRotation, reconcileRotation, rotationSteps, nextDailyRotation, dailyRotationInput } from "../lib/core/vault/rotation.js";
const id = "00000000-0000-4000-8000-000000000001";
function fixture() {
  let record = { operationId: "rotation:1", credentialId: id, connectionId: id, candidateId: id, previousId: id, policyRevision: 1, recipe: "test:v1", consumer: "test", step: 0, revision: 0, status: "ready" };
  const calls = [];
  const store = { get: async () => ({...record}), compareAndSet: async (before, after) => {
    if (before.revision !== record.revision) return false;
    record = {...after}; return true;
  }};
  const driver = { supported: async () => true, authorized: async () => true,
    execute: async (_r, step) => { calls.push(step); return "done"; }, observe: async () => "unknown" };
  return { store, driver, calls };
}
test("rotation orders verification, consumer installation, promotion and revocation; replay is inert", async () => {
  const f = fixture();
  assert.equal((await runRotation(f.store, f.driver)).status, "complete");
  await runRotation(f.store, f.driver);
  assert.deepEqual(f.calls, rotationSteps);
});
test("unknown outcomes and lost acknowledgements never repeat the effect", async () => {
  for (const failed of rotationSteps) {
    const f = fixture();
    const execute = f.driver.execute;
    f.driver.execute = async (r,s) => { if (s === failed) { f.calls.push(s); throw new Error("secret provider body"); } return execute(r,s); };
    assert.equal((await runRotation(f.store, f.driver)).status, "needs_attention");
    await runRotation(f.store, f.driver);
    assert.equal(f.calls.filter(s => s === failed).length, 1);
    const before = await f.store.get();
    await reconcileRotation(f.store, f.driver);
    assert.deepEqual(await f.store.get(), before);
    f.driver.observe = async () => "done";
    await reconcileRotation(f.store, f.driver);
    f.driver.execute = execute;
    assert.equal((await runRotation(f.store, f.driver)).status, "complete");
  }
});
test("competing workers claim once and interruption after claim requires proof", async () => {
  const f = fixture();
  await Promise.all([runRotation(f.store, f.driver), runRotation(f.store, f.driver)]);
  assert.deepEqual(f.calls, rotationSteps);
  const g = fixture(); const before = await g.store.get();
  await g.store.compareAndSet(before, {...before, revision: 1, status: "running"});
  assert.equal((await runRotation(g.store,g.driver)).status, "running");
  assert.deepEqual(g.calls, []);
});
test("missing support and withdrawn authority stop before another effect", async () => {
  const f = fixture(); f.driver.supported = async () => false;
  assert.equal((await runRotation(f.store,f.driver)).status, "unsupported"); assert.deepEqual(f.calls, []);
  const g = fixture(); g.driver.authorized = async (_r,s) => s !== "revoke_previous";
  assert.equal((await runRotation(g.store,g.driver)).status, "paused");
  assert.ok(!g.calls.includes("revoke_previous"));
});
test("daily scheduling follows local DST, takes one catch-up and validates time zones", () => {
  const policy = {time: "02:30", timeZone: "America/New_York"};
  assert.equal(nextDailyRotation(policy,new Date("2026-03-07T08:00:00Z")), "2026-03-08T07:30:00.000Z");
  assert.equal(nextDailyRotation(policy,new Date("2026-03-12T12:00:00Z"),new Date("2026-03-08T07:30:00Z")), "2026-03-13T06:30:00.000Z");
  assert.equal(nextDailyRotation({time:"01:30",timeZone:policy.timeZone},new Date("2026-11-01T05:30:00Z")), "2026-11-02T06:30:00.000Z");
  assert.equal(dailyRotationInput.safeParse({enabled:true,...policy,recipe:"x",consumer:"x",time:"25:00"}).success,false);
  assert.equal(dailyRotationInput.safeParse({enabled:true,...policy,recipe:"x",consumer:"x",timeZone:"bad"}).success,false);
});
