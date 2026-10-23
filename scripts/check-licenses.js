// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const required = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/LICENSING.md'];
// Canonical Apache-2.0 text already approved in the preparation repository; never replace it
// with a summary, custom restriction or another component's license.
const apacheSha256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';

export function verifyDistribution(root, entries) {
  const read = (path) => fs.readFileSync(resolve(root, path), 'utf8');
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.license, 'Apache-2.0', 'Core license must remain Apache-2.0');
  assert.equal(lock.packages?.['']?.license, 'Apache-2.0', 'Lockfile license disagrees');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.keys(pkg[field] ?? {}).length, 0, 'New dependencies need a redistribution review');
  }
  assert.deepEqual(Object.keys(lock.packages), [''], 'Transitive dependencies need a redistribution review');
  assert.equal((pkg.bundleDependencies ?? pkg.bundledDependencies ?? []).length, 0, 'Bundled dependencies need review');
  const licenseHash = createHash('sha256').update(read('LICENSE').replaceAll('\r\n', '\n')).digest('hex');
  assert.equal(licenseHash, apacheSha256, 'Preserve the complete unmodified Apache-2.0 license');
  assert.ok(read('NOTICE').startsWith('Soft Axiom\nCopyright 2026 Soft Axiom contributors\n'), 'Preserve original attribution');

  const paths = entries.map((entry) => entry.path);
  assert.equal(new Set(paths).size, paths.length, 'Duplicate artifact path');
  for (const path of required) assert.ok(paths.includes(path), `Missing required artifact notice: ${path}`);
  for (const path of paths) {
    assert.ok(!path.startsWith('/') && !path.split('/').some((part) => ['', '.', '..'].includes(part)), 'Unsafe artifact path');
    assert.ok(/^(?:LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md|README\.md|CONTRIBUTING\.md|SECURITY\.md|package\.json|docs\/[A-Z_]+\.md|agent-text\/[a-z-]+\.md|(?:bin|lib|scripts)\/[a-z-]+\.js)$/.test(path),
      'New artifact payload needs provenance and redistribution review');
    if (path.endsWith('.js')) {
      const header = read(path).slice(0, 500);
      assert.ok(header.includes('SPDX-License-Identifier: Apache-2.0'), `Missing source license: ${path}`);
      assert.ok(header.includes('SPDX-FileCopyrightText:'), `Missing source copyright: ${path}`);
    }
  }
  return { license: pkg.license, npmDependencies: 0, thirdPartyBundledPayloads: 0, files: paths.length, notices: required };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    // --ignore-scripts prevents recursion when this audit is invoked by prepack.
    const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(packed.status, 0, 'Could not inspect package contents');
    const summary = verifyDistribution(root, JSON.parse(packed.stdout)[0].files);
    if (!process.argv.includes('--quiet')) process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    process.stderr.write(`License/distribution check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
