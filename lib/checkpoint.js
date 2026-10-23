import * as fs from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, hash, config } from './common.js';

function fileHash(path) {
  const digest = createHash('sha256'), block = Buffer.alloc(65536), fd = fs.openSync(path, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, block)) > 0) digest.update(block.subarray(0, count));
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}

export function inventory(root) {
  const rootStat = fs.lstatSync(root);
  check(rootStat.isDirectory() && !rootStat.isSymbolicLink() && rootStat.uid === process.getuid(), 'UNSAFE_CHECKPOINT_ROOT');
  const files = [], directories = [], visit = (dir) => {
    for (const name of fs.readdirSync(join(root, dir)).sort()) {
      check(!/[\x00-\x1f\x7f]/.test(name), 'UNSAFE_CHECKPOINT_PATH');
      const path = dir ? `${dir}/${name}` : name;
      if (path === '.lock' || path === 'cold/LOCK' ||
        (['', 'hot', 'warm', 'cool', 'diary'].includes(dir) && /^\.[a-f0-9-]+\.tmp$/.test(name))) continue;
      const st = fs.lstatSync(join(root, path));
      check(!st.isSymbolicLink() && st.uid === process.getuid(), 'UNSAFE_CHECKPOINT_FILE');
      if (st.isDirectory()) { directories.push(path); visit(path); }
      else {
        check(st.isFile() && st.nlink === 1, 'UNSAFE_CHECKPOINT_FILE');
        files.push({ path, bytes: st.size, sha256: fileHash(join(root, path)) });
      }
      check(files.length + directories.length <= 10000, 'CHECKPOINT_TOO_MANY_FILES');
    }
  };
  visit('');
  check(files.reduce((n, f) => n + f.bytes, 0) <= 1024 ** 3, 'CHECKPOINT_TOO_LARGE');
  for (const dir of ['hot', 'warm', 'cool', 'diary', 'cold']) check(directories.includes(dir), 'INCOMPLETE_CHECKPOINT');
  check(!files.some((f) => f.path === '.transaction.json'), 'CHECKPOINT_TRANSACTION_PENDING');
  return { directories, files };
}

function copyTree(source, destination, manifest) {
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const dir of manifest.directories) fs.mkdirSync(join(destination, dir), { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    fs.copyFileSync(join(source, file.path), join(destination, file.path), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(join(destination, file.path), 0o600);
    const fd = fs.openSync(join(destination, file.path), 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  for (const dir of [...manifest.directories].reverse().concat('')) {
    const fd = fs.openSync(join(destination, dir), 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}

function outside(source, destination) {
  const path = relative(resolve(source), resolve(destination));
  check(path === '..' || path.startsWith('../'), 'CHECKPOINT_MUST_BE_OUTSIDE_MEMORY');
}

// Called only while both the memory lock and Oojuro's native exclusive LOCK are held.
export function snapshotLocked(root, destination) {
  root = resolve(root); destination = resolve(destination); outside(root, destination);
  check(!fs.existsSync(destination), 'CHECKPOINT_ALREADY_EXISTS');
  fs.mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(temporary, { mode: 0o700 });
    outside(fs.realpathSync(root), join(fs.realpathSync(dirname(destination)), 'checkpoint'));
    const tree = inventory(root);
    copyTree(root, join(temporary, 'memory'), tree);
    check(JSON.stringify(inventory(root)) === JSON.stringify(tree), 'CHECKPOINT_EXTERNAL_EDIT');
    check(JSON.stringify(inventory(join(temporary, 'memory'))) === JSON.stringify(tree), 'CHECKPOINT_COPY_MISMATCH');
    const text = JSON.stringify({ schema: 'softaxiom.checkpoint.v1', ...tree });
    fs.writeFileSync(join(temporary, 'manifest.json'), text, { mode: 0o600, flag: 'wx' });
    const fd = fs.openSync(join(temporary, 'manifest.json'), 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const container = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(container); } finally { fs.closeSync(container); }
    fs.renameSync(temporary, destination);
    const parent = fs.openSync(dirname(destination), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    return { destination, manifestSha256: hash(text), files: tree.files.length };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export function checkpoint(root, destination) {
  const result = spawnSync('flock', ['--exclusive', '--timeout', '2', join(root, 'cold', 'LOCK'),
    process.execPath, fileURLToPath(new URL('./checkpoint-worker.js', import.meta.url)), root, destination], {
    encoding: 'utf8', timeout: 90000, maxBuffer: 100000,
  });
  check(!result.error && result.status === 0, 'JOURNAL_BUSY_OR_CHECKPOINT_FAILED');
  const reply = JSON.parse(result.stdout);
  check(!reply.error, reply.error?.code ?? 'CHECKPOINT_FAILED');
  return reply.value;
}

// Restore only into a fresh memory path. There is no merge of database internals or ID remap.
export function restoreCheckpoint(source, root, expectedManifestSha256) {
  source = resolve(source); root = resolve(root); outside(root, source);
  check(!fs.existsSync(root), 'RESTORE_REQUIRES_FRESH_MEMORY');
  const manifestStat = fs.lstatSync(join(source, 'manifest.json'));
  check(manifestStat.isFile() && manifestStat.nlink === 1 && manifestStat.size <= 4 * 1024 * 1024, 'INVALID_CHECKPOINT_MANIFEST');
  const text = fs.readFileSync(join(source, 'manifest.json'), 'utf8');
  check(hash(text) === expectedManifestSha256, 'CHECKPOINT_MANIFEST_MISMATCH');
  const manifest = JSON.parse(text);
  check(manifest.schema === 'softaxiom.checkpoint.v1', 'INVALID_CHECKPOINT');
  const actual = inventory(join(source, 'memory'));
  check(JSON.stringify({ directories: manifest.directories, files: manifest.files }) === JSON.stringify(actual), 'CHECKPOINT_CONTENT_MISMATCH');
  config(JSON.parse(fs.readFileSync(join(source, 'memory', 'config.json'), 'utf8')));
  fs.mkdirSync(dirname(root), { recursive: true, mode: 0o700 });
  const temporary = `${root}.${randomUUID()}.tmp`;
  try {
    copyTree(join(source, 'memory'), temporary, actual);
    check(JSON.stringify(inventory(temporary)) === JSON.stringify(actual), 'CHECKPOINT_COPY_MISMATCH');
    fs.renameSync(temporary, root);
    const parent = fs.openSync(dirname(root), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    return { restored: true, files: actual.files.length };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
