// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { config, check, type Settings } from "./common.js";
import { authRecordExists, withAuth } from "./local-auth.js";

export const ModelProfile = z
  .object({
    version: z.literal(1),
    provider: z.enum(["openai", "anthropic", "compatible"]),
    baseUrl: z.string().max(2048),
    name: z.string().trim().min(1).max(199),
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
  })
  .strict();
export type ModelProfile = z.infer<typeof ModelProfile>;
const record = "local-model";

function validate(value: unknown) {
  const parsed = ModelProfile.safeParse(value);
  check(parsed.success, "INVALID_MODEL_PROFILE");
  const profile = parsed.data;
  config({ model: { baseUrl: profile.baseUrl, name: profile.name } });
  profile.baseUrl = new URL(profile.baseUrl).href.replace(/\/$/, "");
  check(profile.provider === "compatible" || profile.apiKey, "MODEL_KEY_REQUIRED");
  return profile;
}

export async function saveModelProfile(value: unknown, root?: string) {
  const profile = validate(value);
  await withAuth((records) => records.write(record, profile), root);
  return {
    configured: true,
    provider: profile.provider,
    model: profile.name,
    baseUrl: profile.baseUrl,
  };
}

export async function localModelProfile(root?: string) {
  if (!authRecordExists(record, root)) return;
  return withAuth((records) => {
    const profile = records.read(record, ModelProfile);
    return profile && validate(profile);
  }, root);
}

export async function modelStatus(root?: string) {
  const profile = await localModelProfile(root);
  return profile
    ? {
        configured: true,
        provider: profile.provider,
        model: profile.name,
        baseUrl: profile.baseUrl,
      }
    : { configured: false };
}

export async function forgetModel(root?: string) {
  if (authRecordExists(record, root)) await withAuth((records) => records.remove(record), root);
  return { configured: false };
}

export async function modelAccess(settings: Settings, root?: string): Promise<ModelProfile> {
  // Workspace files are data, not authority to select an endpoint or an ambient secret.
  const profile = await localModelProfile(root);
  check(profile, "MODEL_NOT_CONFIGURED");
  if (settings.model.name.trim())
    check(settings.model.name.trim() === profile.name &&
      new URL(settings.model.baseUrl).href.replace(/\/$/, "") === profile.baseUrl,
    "MODEL_PROFILE_MISMATCH");
  return profile;
}
