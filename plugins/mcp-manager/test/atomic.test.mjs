import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readProfilePatch, withProfileLock, writeProfilePatch } from '../src/atomic.js';
import { PatchError } from '../src/errors.js';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-manager-atomic-'));
  const patch = join(dir, 'cordis.patch.yml');
  writeFileSync(patch, '- id: base\n  name: "@example/base"\n', { mode: 0o600 });
  return { dir, patch, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function expectCode(error, code) {
  return error instanceof PatchError && error.code === code;
}

test('reads a regular patch with its mode', () => {
  const space = workspace();
  try {
    const { text, mode } = readProfilePatch(space.patch);
    assert.match(text, /@example\/base/);
    assert.equal(mode & 0o777, 0o600);
  } finally {
    space.cleanup();
  }
});

test('replaces the patch atomically and preserves the mode', () => {
  const space = workspace();
  try {
    const { text, mode } = readProfilePatch(space.patch);
    writeProfilePatch(space.patch, `${text}- id: extra\n`, { expected: text, mode });
    assert.match(readFileSync(space.patch, 'utf8'), /id: extra/);
    assert.equal(lstatSync(space.patch).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(space.dir).filter(name => name.startsWith('.')), []);
  } finally {
    space.cleanup();
  }
});

test('refuses to overwrite bytes that changed after the read', () => {
  const space = workspace();
  try {
    const { text, mode } = readProfilePatch(space.patch);
    writeFileSync(space.patch, '- id: changed\n', { mode: 0o600 });
    assert.throws(
      () => writeProfilePatch(space.patch, `${text}- id: extra\n`, { expected: text, mode }),
      error => expectCode(error, 'conflict'),
    );
    assert.equal(readFileSync(space.patch, 'utf8'), '- id: changed\n');
    assert.deepEqual(readdirSync(space.dir).filter(name => name.startsWith('.')), []);
  } finally {
    space.cleanup();
  }
});

test('rejects a directory, a symlink and oversized content', () => {
  const space = workspace();
  try {
    assert.throws(() => readProfilePatch(space.dir), error => expectCode(error, 'profile-unavailable'));
    const link = join(space.dir, 'link.yml');
    symlinkSync(space.patch, link);
    assert.throws(() => readProfilePatch(link), error => expectCode(error, 'profile-unavailable'));
    const large = join(space.dir, 'large.yml');
    writeFileSync(large, `# ${'x'.repeat(1024 * 1024 + 1)}\n`);
    assert.throws(() => readProfilePatch(large), error => expectCode(error, 'profile-unavailable'));
  } finally {
    space.cleanup();
  }
});

test('serializes writers through package.json.lock', async () => {
  const space = workspace();
  try {
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const first = withProfileLock(space.dir, async () => {
      await gate;
      return 'first';
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(
      withProfileLock(space.dir, () => 'second', { timeoutMs: 30 }),
      error => expectCode(error, 'locked'),
    );
    release();
    assert.equal(await first, 'first');
    assert.throws(() => lstatSync(join(space.dir, 'package.json.lock')));
  } finally {
    space.cleanup();
  }
});

test('takes over a lock whose recorded process has exited', async () => {
  const space = workspace();
  try {
    writeFileSync(join(space.dir, 'package.json.lock'), '999999\n', { mode: 0o600 });
    const value = await withProfileLock(space.dir, () => 'ran', { timeoutMs: 500 });
    assert.equal(value, 'ran');
    assert.throws(() => lstatSync(join(space.dir, 'package.json.lock')));
  } finally {
    space.cleanup();
  }
});

test('a stale lock with a live process is not taken over', async () => {
  const space = workspace();
  try {
    writeFileSync(join(space.dir, 'package.json.lock'), `${process.pid}\n`, { mode: 0o600 });
    await assert.rejects(
      withProfileLock(space.dir, () => 'never', { timeoutMs: 40 }),
      error => expectCode(error, 'locked'),
    );
    assert.match(readFileSync(join(space.dir, 'package.json.lock'), 'utf8'), new RegExp(String(process.pid)));
  } finally {
    space.cleanup();
  }
});

test('keeps permission bits when the patch was narrower', () => {
  const space = workspace();
  try {
    chmodSync(space.patch, 0o600);
    const { text, mode } = readProfilePatch(space.patch);
    writeProfilePatch(space.patch, `${text}# tail\n`, { expected: text, mode: 0o600 });
    assert.equal(lstatSync(space.patch).mode & 0o777, 0o600);
  } finally {
    space.cleanup();
  }
});
