// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import {
  capturePlanRecord,
  CredentialError,
  credentialSecretRecord,
  type CapturePlan,
} from "./credentials.ts";

/** Plaintext stays between this adapter callback and the encrypted store, never a tool result. */
export async function captureBrowserKey(
  plan: CapturePlan,
  evaluate: (script: string) => Promise<unknown>,
  wait: () => Promise<void>,
): Promise<string> {
  try {
    plan = capturePlanRecord.parse(plan);
    if (plan.revealSelector) {
      const reply = (await evaluate(browserKeyScript(plan, "reveal"))) as { status: string };
      if (reply?.status !== "revealed") throw new CredentialError("unavailable");
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      const reply = (await evaluate(browserKeyScript(plan, "read"))) as {
        status: string;
        value?: string;
      };
      if (reply?.status === "captured")
        return credentialSecretRecord.parse({ value: reply.value }).value;
      if (reply?.status !== "not_found") break;
      await wait();
    }
  } catch {
    // Browser/validation errors may contain page text or the newly generated key.
  }
  throw new CredentialError("unavailable");
}

/** Evaluated by a trusted adapter only, while all model-facing browser access is blocked. */
export function browserKeyScript(plan: CapturePlan, mode: "reveal" | "read"): string {
  const { url, selector, revealSelector } = capturePlanRecord.parse(plan);
  const request = JSON.stringify({ url, selector, revealSelector, mode });
  return `(() => {
    const request = ${request};
    if (window.top !== window || location.href !== request.url) return { status: "page_changed" };
    const matches = document.querySelectorAll(request.mode === "reveal" ? request.revealSelector : request.selector);
    if (matches.length !== 1) return { status: "not_found" };
    const element = matches[0];
    if (request.mode === "reveal") {
      if (!request.revealSelector || element.disabled) return { status: "not_found" };
      if (element.form && new URL(element.form.action, location.href).origin !== location.origin) return { status: "page_changed" };
      element.click();
      return { status: "revealed" };
    }
    const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent;
    if (typeof value !== "string" || value.length < 8 || value.length > 8192 || !/^[\\x21-\\x7e]+$/.test(value)) return { status: "not_found" };
    return { status: "captured", value };
  })()`;
}
