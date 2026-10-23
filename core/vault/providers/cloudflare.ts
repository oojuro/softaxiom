// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { credentialSecretRecord, providerIdentity } from "../credentials.ts";

const id = providerIdentity.shape.id;
const group = z.strictObject({
  id,
  name: z.string().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});
const policy = z.strictObject({
  id: id.optional(),
  effect: z.enum(["allow", "deny"]),
  resources: z.record(z.string(), z.json()),
  permission_groups: z.array(group).min(1).max(100),
});
const condition = z.strictObject({
  request_ip: z.strictObject({
    in: z.array(z.string().max(100)).max(100).optional(),
    not_in: z.array(z.string().max(100)).max(100).optional(),
  }),
});
const token = z.strictObject({
  id,
  name: z.string().min(1).max(120),
  creator_email_at_creation: z.string().nullish(),
  issued_on: z.string().nullish(),
  last_used_on: z.string().nullish(),
  modified_on: z.string().nullish(),
  provisioner_id: z.null().optional(),
  provisioner_type: z.null().optional(),
  status: z.enum(["active", "disabled", "expired"]),
  policies: z.array(policy).min(1).max(100),
  condition: condition.nullish(),
  expires_on: z.iso.datetime({ offset: true }).nullish(),
  not_before: z.iso.datetime({ offset: true }).nullish(),
});
export type CloudflareToken = z.infer<typeof token>;

export class CloudflareTokenError extends Error {
  constructor() {
    super("cloudflare_token: unavailable");
    this.name = "CloudflareTokenError";
  }
}

// Strip only documented cosmetic/read-only fields. Unknown policy/restriction fields are refused.
function cloudflareTokenPermissions(raw: unknown) {
  const parsed = token.parse(raw);
  return {
    policies: parsed.policies.map((p) => ({
      effect: p.effect,
      resources: p.resources,
      permission_groups: p.permission_groups.map((g) => ({ id: g.id })),
    })),
    ...(parsed.condition && { condition: parsed.condition }),
    ...(parsed.expires_on && { expires_on: parsed.expires_on }),
    ...(parsed.not_before && { not_before: parsed.not_before }),
  };
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const cloudflareCandidateName = (candidateId: string) =>
  `softaxiom-${z.uuid().parse(candidateId)}`;

/** User-token API only. Credentials and transport are explicit; mutations are never retried. */
export function createCloudflareTokens(transport: typeof fetch) {
  async function request(value: string, path: string, method = "GET", body?: unknown) {
    try {
      credentialSecretRecord.parse({ value });
      const response = await transport(`https://api.cloudflare.com/client/v4/user/tokens${path}`, {
        method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${value}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (method === "GET" && path !== "/verify" && response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new CloudflareTokenError();
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          length += chunk.length;
          if (length > 131_072) throw new CloudflareTokenError();
          chunks.push(chunk);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return z
        .looseObject({ success: z.literal(true), result: z.unknown() })
        .parse(JSON.parse(new TextDecoder().decode(bytes))).result;
    } catch {
      // Provider bodies, transport errors and schema diagnostics may contain secrets.
      throw new CloudflareTokenError();
    }
  }
  async function inspect(value: string) {
    try {
      return z
        .looseObject({ id, status: z.literal("active") })
        .parse(await request(value, "/verify")).id;
    } catch {
      throw new CloudflareTokenError();
    }
  }
  async function describe(manager: string, tokenId: string) {
    try {
      const result = await request(manager, `/${id.parse(tokenId)}`);
      if (result === undefined) return undefined;
      const parsed = token.parse(result);
      if (parsed.id !== tokenId) throw new CloudflareTokenError();
      return parsed;
    } catch {
      throw new CloudflareTokenError();
    }
  }
  async function issue(manager: string, previousId: string, candidateId: string) {
    try {
      const previous = await describe(manager, previousId);
      if (!previous || previous.status !== "active") throw new CloudflareTokenError();
      const name = cloudflareCandidateName(candidateId);
      const permissions = cloudflareTokenPermissions(previous);
      const result = z
        .looseObject({ id, value: credentialSecretRecord.shape.value })
        .parse(await request(manager, "", "POST", { name, ...permissions }));
      if (result.id === previousId) throw new CloudflareTokenError();
      return {
        value: result.value,
        provider: { kind: "cloudflare-user-token" as const, id: result.id },
      };
    } catch {
      throw new CloudflareTokenError();
    }
  }
  async function verify(
    manager: string,
    value: string,
    tokenId: string,
    previousId: string,
    candidateId: string,
  ) {
    try {
      if ((await inspect(value)) !== tokenId || tokenId === previousId) return false;
      const candidate = await describe(manager, tokenId),
        previous = await describe(manager, previousId);
      return (
        !!candidate &&
        !!previous &&
        candidate.status === "active" &&
        previous.status === "active" &&
        candidate.name === cloudflareCandidateName(candidateId) &&
        canonical(cloudflareTokenPermissions(candidate)) ===
          canonical(cloudflareTokenPermissions(previous))
      );
    } catch {
      return false;
    }
  }
  async function remove(manager: string, tokenId: string) {
    try {
      const result = z
        .looseObject({ id })
        .parse(await request(manager, `/${id.parse(tokenId)}`, "DELETE"));
      return result.id === tokenId;
    } catch {
      throw new CloudflareTokenError();
    }
  }
  return { inspect, describe, issue, verify, remove };
}
