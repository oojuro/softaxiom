// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Compile-only consumer contract. Unexpectedly accepted invalid types fail this gate too.
import { Memory } from "../lib/store.js";
import { LocalAgent } from "../lib/runtime.js";
import { githubAdapter } from "../lib/adapters.js";
import type { PreparedAction } from "../lib/browser.js";
import type { Vault, StoredLogin } from "../lib/core/vault.js";

const memory = new Memory("/synthetic/workspace/memory");
const timezone: string = memory.call("settings").timezone;
void timezone;
// @ts-expect-error operation names are checked
memory.call("unrecognized-operation");
// @ts-expect-error settings are a concrete result, not any
const invalid: number = memory.call("settings").timezone;
void invalid;
// @ts-expect-error adapter transport must be explicit and supported
githubAdapter.configure("hosted-browser");
// @ts-expect-error custom models return a structured message
new LocalAgent("/synthetic/workspace", { complete: async () => 42 });
function scoped(action: PreparedAction) {
  if (action.operation === "close") {
    const id: string = action.args.id;
    void id;
    // @ts-expect-error a close action cannot smuggle a navigation URL
    void action.args.url;
  }
}
void scoped;
// @ts-expect-error strict null checking is mandatory
const nullable: string = null;
void nullable;
// @ts-expect-error implicit any is forbidden
function implicit(value) {
  return value;
}
void implicit;
// @ts-expect-error array indexing must acknowledge a missing element
const indexed: string = ["x"][1];
void indexed;

async function vaultContract(vault: Vault<StoredLogin, never>) {
	const [login] = await vault.list("synthetic-person");
	if (login) {
		const generation: number = login.generation;
		void generation;
		// @ts-expect-error metadata never exposes the saved password
		void login.password;
		// @ts-expect-error metadata never exposes an authenticator seed
		void login.totp;
	}
	await vault.typePassword({
		personId: "person",
		connectionId: "login",
		ref: "e1",
		// @ts-expect-error a browser address alone cannot type secrets
		tab: { address: () => "https://example.test" },
	});
}
void vaultContract;

import type { CredentialVersion, CaptureResult } from '../lib/core/vault.js';
declare const credentialVersion: CredentialVersion;
declare const captureResult: CaptureResult;
// @ts-expect-error Credential metadata never exposes the provider key.
credentialVersion.value;
// @ts-expect-error Capture status never exposes browser plaintext.
captureResult.value;
