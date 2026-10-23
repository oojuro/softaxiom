// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const required = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/LICENSING.md', 'docs/DEPENDENCIES.json', 'npm-shrinkwrap.json'];
// Canonical Apache-2.0 text already approved in the preparation repository; never replace it
// with a summary, custom restriction or another component's license.
const apacheSha256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';

const pathsContainNotice = (entries, path) => entries.some(entry => entry.path === path);

export function verifyDistribution(root, entries) {
  const read = (path) => fs.readFileSync(resolve(root, path), 'utf8');
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('npm-shrinkwrap.json'));
  assert.equal(pkg.license, 'Apache-2.0', 'Core license must remain Apache-2.0');
  assert.equal(lock.packages?.['']?.license, 'Apache-2.0', 'Lockfile license disagrees');
  const review = JSON.parse(read('docs/DEPENDENCIES.json'));
  for (const field of ['dependencies', 'devDependencies']) assert.deepEqual(pkg[field], review.direct[field], 'Dependency changes require a reviewed inventory');
  const inventory = Object.fromEntries(Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => [path,
    Object.fromEntries(['version', 'license', 'integrity', 'resolved', 'hasInstallScript'].filter(key => key in entry).map(key => [key, entry[key]]))]));
  for (const [path, entry] of Object.entries(inventory)) {
    const { notices, supplementSource, ...reviewed } = review.packages[path] ?? {};
    assert.ok(notices?.length, 'Missing reviewed upstream license/NOTICE');
    assert.deepEqual(entry, reviewed, 'Lockfile changed after dependency review');
    for (const notice of notices) {
      assert.ok(pathsContainNotice(entries, notice.file), 'Missing dependency notice in artifact');
      assert.equal(createHash('sha256').update(fs.readFileSync(resolve(root, notice.file))).digest('hex'), notice.sha256, 'Changed dependency notice');
    }
  }
  assert.deepEqual(Object.keys(inventory).sort(), Object.keys(review.packages).sort(), 'Dependency inventory changed');
  for (const entry of Object.values(inventory)) {
    assert.ok(['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause', '0BSD', '(MIT OR Apache-2.0)', 'Python-2.0', '(AFL-2.1 OR BSD-3-Clause)'].includes(entry.license), 'Dependency redistribution terms require review');
    assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), 'Unreviewed dependency origin');
    assert.ok(entry.integrity?.startsWith('sha512-'), 'Missing immutable dependency integrity');
  }
  assert.equal((pkg.bundleDependencies ?? pkg.bundledDependencies ?? []).length, 0, 'Bundled dependencies need review');
  const licenseHash = createHash('sha256').update(read('LICENSE').replaceAll('\r\n', '\n')).digest('hex');
  assert.equal(licenseHash, apacheSha256, 'Preserve the complete unmodified Apache-2.0 license');
  assert.ok(read('NOTICE').startsWith('Soft Axiom\nCopyright 2026 Soft Axiom contributors\n'), 'Preserve original attribution');

  const paths = entries.map((entry) => entry.path);
  assert.equal(new Set(paths).size, paths.length, 'Duplicate artifact path');
  for (const path of required) assert.ok(paths.includes(path), `Missing required artifact notice: ${path}`);
  for (const path of paths) {
    assert.ok(!path.startsWith('/') && !path.split('/').some((part) => ['', '.', '..'].includes(part)), 'Unsafe artifact path');
    assert.ok(/^(?:LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md|README\.md|npm-shrinkwrap\.json|CONTRIBUTING\.md|SECURITY\.md|package\.json|docs\/[A-Z_]+\.(?:md|json)|agent-text\/(?:[A-Za-z_-]+\.md|tools\/[a-z_]+\.md)|(?:bin|lib|scripts)\/[a-z-]+\.(?:js|d\.ts)|lib\/core\/[a-z/-]+\.(?:js|d\.ts)|licenses\/npm\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)$/.test(path),
      'New artifact payload needs provenance and redistribution review');
    if (path.endsWith('.js') || path.endsWith('.d.ts')) {
      const header = read(path).slice(0, 500);
      assert.ok(header.includes('SPDX-License-Identifier: Apache-2.0'), `Missing source license: ${path}`);
      assert.ok(header.includes('SPDX-FileCopyrightText:'), `Missing source copyright: ${path}`);
    }
  }
  return { license: pkg.license, npmDependencies: Object.keys(pkg.dependencies).length, thirdPartyBundledPayloads: 0, files: paths.length, notices: required };
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
