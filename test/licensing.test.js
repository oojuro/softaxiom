// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDistribution } from '../scripts/check-licenses.js';

test('distribution audit preserves license/notices and blocks unreviewed dependencies or payloads', (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'softaxiom-license-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'docs')); fs.mkdirSync(join(root, 'lib'));
  fs.mkdirSync(join(root, 'assets'));
  fs.copyFileSync(new URL('../assets/softaxiom-logo.svg', import.meta.url), join(root, 'assets/softaxiom-logo.svg'));
  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/LICENSING.md', 'docs/DEPENDENCIES.json', 'package.json', 'npm-shrinkwrap.json']) {
    fs.copyFileSync(new URL(`../${file}`, import.meta.url), join(root, file));
  }
  fs.cpSync(new URL('../licenses', import.meta.url), join(root, 'licenses'), { recursive: true });
  const notices = JSON.parse(fs.readFileSync(join(root, 'docs/DEPENDENCIES.json')));
  const noticeEntries = Object.values(notices.packages).flatMap(p => p.notices.map(n => ({ path: n.file })));
  const source = '// SPDX-FileCopyrightText: 2026 Soft Axiom contributors\n// SPDX-License-Identifier: Apache-2.0\n';
  fs.writeFileSync(join(root, 'lib/example.js'), source);
  const entries = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/LICENSING.md', 'docs/DEPENDENCIES.json', 'package.json', 'npm-shrinkwrap.json', 'assets/softaxiom-logo.svg', 'lib/example.js'].map((path) => ({ path })).concat(noticeEntries);
  assert.equal(verifyDistribution(root, entries).npmDependencies, 6);
  assert.throws(() => verifyDistribution(root, entries.filter((e) => e.path !== 'NOTICE')), /Missing required artifact notice/);
  assert.throws(() => verifyDistribution(root, entries.filter((e) => e.path !== 'assets/softaxiom-logo.svg')), /Missing required artifact notice/);
  assert.throws(() => verifyDistribution(root, [...entries, { path: 'vendor/native.node' }]), /New artifact payload/);
  const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, dependencies: { unreviewed: '1.0.0' } }));
  assert.throws(() => verifyDistribution(root, entries), /Dependency changes/);
  fs.writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(join(root, 'lib/example.js'), 'export const missingNotice = true;');
  assert.throws(() => verifyDistribution(root, entries), /Missing source license/);
  fs.writeFileSync(join(root, 'lib/example.js'), source);
  fs.appendFileSync(join(root, 'LICENSE'), '\nAdditional restriction');
  assert.throws(() => verifyDistribution(root, entries), /complete unmodified Apache/);
});
