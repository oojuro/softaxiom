// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { snapshotLocked } from "./checkpoint.js";
import { MemoryError } from "./common.js";

process.umask(0o077);
try {
  process.stdout.write(
    JSON.stringify({ value: snapshotLocked(process.argv[2]!, process.argv[3]!) }),
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: { code: error instanceof MemoryError ? error.code : "CHECKPOINT_IO_ERROR" },
    }),
  );
}
