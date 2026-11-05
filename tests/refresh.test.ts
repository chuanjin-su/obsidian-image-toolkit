import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import type { App, TFile } from 'obsidian';
import { embeddedWorkerPlugin } from '../build/embedded-worker.mjs';
import { refreshImageViews } from '../src/refresh';

const resource = 'app://vault/attachments/space%20name.png';
const file = { path: 'attachments/space name.png', extension: 'png' } as TFile;
function image(src: string, currentSrc = '') {
  let value = src;
  return {
    currentSrc, writes: [] as string[],
    get src() { return value; },
    set src(next: string) { value = next; this.writes.push(next); },
  };
}
function documentWith(...images: ReturnType<typeof image>[]) {
  let queries = 0;
  return {
    get queries() { return queries; },
    querySelectorAll(selector: string) { assert.equal(selector, 'img'); queries++; return images; },
  } as unknown as Document & { queries: number };
}
function appWith(documents: Document[], path = `${resource}?mtime=10`) {
  return {
    vault: { getResourcePath: (target: TFile) => { assert.equal(target, file); return path; } },
    workspace: {
      iterateAllLeaves: (visit: (leaf: any) => void) => documents.forEach(doc => visit({ view: { containerEl: { ownerDocument: doc } } })),
    },
  } as unknown as App;
}

test('refreshes all matching resources across documents, including transclusions and pop-outs', () => {
  const first = image(`${resource}?mtime=1`);
  const duplicate = image(`${resource}?old=1#fragment`);
  const popout = image(`${resource}?mtime=2`);
  const unrelated = image('app://vault/other/space%20name.png?mtime=1');
  const remote = image('https://example.com/space%20name.png');
  const root = documentWith(first, duplicate, unrelated, remote);
  const other = documentWith(popout);
  refreshImageViews(appWith([root, root, other]), file, root);

  for (const img of [first, duplicate, popout]) {
    const url = new URL(img.src);
    assert.equal(url.pathname, '/attachments/space%20name.png');
    assert.equal(url.searchParams.get('mtime'), '10');
    assert.ok(url.searchParams.get('image-toolkit'));
    assert.equal(img.writes.length, 1);
    assert.equal(img.src, first.src);
  }
  assert.equal(root.queries, 1, 'scan a document only once even with multiple leaves');
  assert.equal(other.queries, 1);
  assert.deepEqual(unrelated.writes, []);
  assert.deepEqual(remote.writes, []);
});

test('the displayed resource is authoritative, rather than a stale src attribute', () => {
  const displayed = image('app://vault/placeholder.png', `${resource}?mtime=1`);
  const different = image(resource, 'app://vault/other.png');
  const root = documentWith(displayed, different);
  refreshImageViews(appWith([]), file, root);
  assert.equal(displayed.writes.length, 1);
  assert.equal(different.writes.length, 0);
});

test('rapid saves with identical mtime get distinct URLs without accumulating query parameters', () => {
  const img = image(resource);
  const root = documentWith(img);
  const app = appWith([], `${resource}?image-toolkit=old&mtime=10#fragment`);
  const now = Date.now;
  Date.now = () => 123;
  try {
    refreshImageViews(app, file, root);
    const first = img.src;
    refreshImageViews(app, file, root);
    assert.notEqual(img.src, first);
    const url = new URL(img.src);
    assert.equal(url.searchParams.getAll('image-toolkit').length, 1);
    assert.equal(url.searchParams.get('mtime'), '10');
    assert.equal(url.hash, '#fragment');
  } finally { Date.now = now; }
});

const bundle = build({
  entryPoints: [fileURLToPath(new URL('../src/editor.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'],
  logLevel: 'silent', plugins: [embeddedWorkerPlugin()],
}).then(result => result.outputFiles[0].text);

async function savingEditor(options: { backup?: boolean; failWrite?: boolean; failRefresh?: boolean } = {}) {
  const img = image(`${resource}?mtime=1`);
  const root = documentWith(img);
  const app = appWith([root]) as any;
  const original = new Uint8Array([1, 2]).buffer;
  let bytes = original;
  let writes = 0;
  let closed = false;
  const entries = new Map<string, any>([[file.path, file]]);
  Object.assign(app.vault, {
    getAbstractFileByPath: (path: string) => entries.get(path) || null,
    readBinary: async (target: TFile) => target === file ? bytes : entries.get(target.path).bytes,
    createFolder: async (path: string) => { entries.set(path, { path, children: [] }); },
    createBinary: async (path: string, backup: ArrayBuffer) => {
      const entry = { path, bytes: backup }; entries.set(path, entry); return entry;
    },
    modifyBinary: async (target: TFile, output: ArrayBuffer) => {
      assert.equal(target, file);
      assert.equal(img.writes.length, 0, 'do not refresh before the write completes');
      await Promise.resolve();
      if (options.failWrite) throw new Error('write failed');
      bytes = output; writes++;
    },
  });
  if (options.failRefresh) app.vault.getResourcePath = () => { throw new Error('refresh failed'); };
  const notices: string[] = [];
  const errors: unknown[] = [];
  class Modal {
    containerEl = { ownerDocument: root };
    constructor(public app: App) {}
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  const module = { exports: {} as any };
  runInNewContext(await bundle, {
    module, exports: module.exports, URL, Date,
    console: { error: (...args: unknown[]) => errors.push(args) },
    require: () => ({ Modal, Notice, setIcon() {} }),
  });
  const editor = new module.exports.ImageEditor(app, file, {
    tool: 'compress', quality: 85, backupEnabled: !!options.backup, backupFolder: 'Backups', backupConfigured: true,
  }, () => {});
  Object.assign(editor, {
    original,
    exclusive: async (action: () => Promise<void>) => action(),
    prepareBackupPreferences: async () => true,
    applyAdjustmentRaster: async () => {},
    outputBlob: async () => new Blob([new Uint8Array([3, 4])]),
    close: () => { closed = true; },
  });
  return { editor, img, notices, errors, get writes() { return writes; }, get closed() { return closed; } };
}

for (const backup of [false, true]) {
  test(`editor refreshes only after successful save (backup ${backup ? 'enabled' : 'disabled'})`, async () => {
    const state = await savingEditor({ backup });
    await state.editor.save();
    assert.equal(state.writes, 1);
    assert.equal(state.img.writes.length, 1);
    assert.equal(state.closed, true);
    assert.ok(state.notices.some(message => message.startsWith('Replaced ')));
    assert.deepEqual(state.errors, []);
  });
}

test('failed saves leave the displayed image and editor untouched', async () => {
  const state = await savingEditor({ failWrite: true });
  await assert.rejects(state.editor.save(), /write failed/);
  assert.equal(state.img.writes.length, 0);
  assert.equal(state.closed, false);
  assert.deepEqual(state.notices, []);
});

test('refresh failure does not turn a successful overwrite into a failed save', async () => {
  const state = await savingEditor({ failRefresh: true });
  await state.editor.save();
  assert.equal(state.writes, 1);
  assert.equal(state.closed, true);
  assert.ok(state.notices.some(message => message.includes('preview could not refresh')));
  assert.ok(state.notices.some(message => message.startsWith('Replaced ')));
  assert.equal(state.errors.length, 1);
});
