// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
execFileSync(process.execPath, ["scripts/check-upstream.ts"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check-core.ts"], { stdio: "inherit" });
rmSync("lib/core", { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-b", "tsconfig.core.json", "--force"], {
  stdio: "inherit",
});
const header =
  "// SPDX-FileCopyrightText: 2026 Soft Axiom contributors\n// SPDX-License-Identifier: Apache-2.0\n";
function license(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) license(path);
    else if (/\.(?:js|d\.ts)$/.test(path)) {
      const text = readFileSync(path, "utf8");
      if (!text.slice(0, 500).includes("SPDX-License-Identifier:"))
        writeFileSync(path, ((path.startsWith("lib/core/upstream/openclaw/") && !path.includes("/agent-core/fireworks-compat."))
          ? "// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors\n// SPDX-License-Identifier: MIT\n"
          : header) + text);
    }
  }
}
license("lib/core");

rmSync(".build", { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.local.json"], {
  stdio: "inherit",
});
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.types.json"], {
  stdio: "inherit",
});
for (const folder of ["lib", "bin", "scripts"]) {
  for (const entry of readdirSync(folder))
    if (/\.(?:js|d\.ts)$/.test(entry)) rmSync(join(folder, entry));
  cpSync(join(".build", folder), folder, { recursive: true });
  license(folder);
}
rmSync(".build", { recursive: true, force: true });
