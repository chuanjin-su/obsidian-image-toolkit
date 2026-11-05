import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { App, TFile } from 'obsidian';
import { bytesEqual, saveImage } from '../src/storage';
import { findImageBackups, restoreImageBackup } from '../src/recovery';

const jpeg = (value: number) => new Uint8Array([0xff, 0xd8, 0xff, value]).buffer;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const entries = new Map<string, any>();
  let attempts = 0;
  const vault = {
    beforeWrite: undefined as ((file: TFile) => Promise<void>) | undefined,
    get attempts() { return attempts; },
    getAbstractFileByPath: (path: string) => entries.get(path) || null,
    getFiles: () => [...entries.values()].filter(file => file.bytes),
    readBinary: async (file: any): Promise<ArrayBuffer> => file.bytes.slice(0),
    createFolder: async (path: string) => { entries.set(path, { path, children: [] }); },
    createBinary: async (path: string, bytes: ArrayBuffer) => {
      assert.equal(entries.has(path), false);
      const file = { path, bytes: bytes.slice(0), extension: path.split('.').pop() };
      entries.set(path, file);return file as unknown as TFile;
    },
    modifyBinary: async (file: TFile, bytes: ArrayBuffer) => {
      attempts++;
      await vault.beforeWrite?.(file);
      (file as any).bytes = bytes.slice(0);
    },
  };
  return { vault, app: { vault } as unknown as App };
}
const options = { backupEnabled: false, backupFolder: 'Archives' };

test('concurrent saves share a per-vault/source lock and recheck snapshots after waiting', async () => {
  const { vault, app } = fixture(), entered = deferred(), release = deferred();
  const source = await vault.createBinary('photo.jpg', jpeg(1));
  vault.beforeWrite = async () => { entered.resolve();await release.promise; };
  const first = saveImage(app, source, jpeg(1), jpeg(2), options);
  await entered.promise;
  // A separate App wrapper with the same vault must use the same lock.
  const second = saveImage({ vault } as unknown as App, source, jpeg(1), jpeg(3), options)
    .then(() => null, error => error);
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(vault.attempts, 1, 'second write must not pass the first write');
  } finally { release.resolve(); }
  await first;
  assert.match(String(await second), /changed while it was being edited/);
  assert.equal(vault.attempts, 1);
  assert.equal(bytesEqual(await vault.readBinary(source), jpeg(2)), true);
});

test('a failed write releases its lock so queued work can proceed', async () => {
  const { vault, app } = fixture();
  const source = await vault.createBinary('photo.jpg', jpeg(1));
  vault.beforeWrite = async () => { if (vault.attempts === 1) throw new Error('Write failed'); };
  const first = saveImage(app, source, jpeg(1), jpeg(2), options).then(() => null, error => error);
  const second = saveImage(app, source, jpeg(1), jpeg(3), options);
  assert.match(String(await first), /Write failed/);
  await second;
  assert.equal(bytesEqual(await vault.readBinary(source), jpeg(3)), true);
});

test('a blocked image write does not prevent saves to a different image', async () => {
  const { vault, app } = fixture(), entered = deferred(), release = deferred();
  const firstSource = await vault.createBinary('first.jpg', jpeg(1));
  const secondSource = await vault.createBinary('second.jpg', jpeg(1));
  vault.beforeWrite = async file => { if (file === firstSource) { entered.resolve();await release.promise; } };
  const first = saveImage(app, firstSource, jpeg(1), jpeg(2), options);
  await entered.promise;
  try {
    await saveImage(app, secondSource, jpeg(1), jpeg(3), options);
    assert.equal(bytesEqual(await vault.readBinary(secondSource), jpeg(3)), true);
  } finally { release.resolve(); }
  await first;
});

test('recovery cannot overwrite a concurrent editor save that was not in its source snapshot', async () => {
  const { vault, app } = fixture(), entered = deferred(), release = deferred();
  const source = await vault.createBinary('photo.jpg', jpeg(1));
  await vault.createBinary('Archives/photo-backup-10.jpg', jpeg(0));
  const version = findImageBackups(app, source, 'Archives')[0];
  vault.beforeWrite = async () => { entered.resolve();await release.promise; };
  const editing = saveImage(app, source, jpeg(1), jpeg(2), { ...options, backupEnabled: true });
  await entered.promise;
  const recovering = restoreImageBackup(app, source, version, jpeg(1), jpeg(0), 'Archives')
    .then(() => null, error => error);
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(vault.attempts, 1, 'recovery must wait for the editor write');
  } finally { release.resolve(); }
  await editing;
  assert.match(String(await recovering), /changed while it was being edited/);
  assert.equal(bytesEqual(await vault.readBinary(source), jpeg(2)), true);
  assert.equal(findImageBackups(app, source, 'Archives').length, 2, 'only editor safety backup should be added');
  assert.equal(bytesEqual(await vault.readBinary(version.file), jpeg(0)), true);
});
