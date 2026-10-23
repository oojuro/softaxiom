// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
execFileSync(process.execPath, ['scripts/check-core.js'], { stdio: 'inherit' });
rmSync('lib/core', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.core.json'], { stdio: 'inherit' });
const header = '// SPDX-FileCopyrightText: 2026 Soft Axiom contributors\n// SPDX-License-Identifier: Apache-2.0\n';
function license(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) license(path);
    else if (/\.(?:js|ts)$/.test(path)) {
      const text = readFileSync(path, 'utf8');
      if (!text.startsWith(header)) writeFileSync(path, header + text);
    }
  }
}
license('lib/core');
