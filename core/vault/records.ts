// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

// Keep unknown fields when an older host reads and writes a newer record.
export const loginSecretRecord = z.looseObject({
  password: z.string().min(1),
  totp: z
    .object({
      secret: z.string().min(1),
      algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
      digits: z.number().int().min(6).max(8),
      period: z.number().int().min(10).max(300),
    })
    .optional(),
});

export const loginOriginsRecord = z.looseObject({
  origins: z.array(z.string()),
  authenticator: z.boolean().optional(),
});
