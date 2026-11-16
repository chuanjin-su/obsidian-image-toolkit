import assert from 'node:assert/strict';
import test from 'node:test';
import type { App, Editor, MarkdownFileInfo } from 'obsidian';
import { DEFAULT_INSERTION_PREFERENCES, imageDestinationFolder, insertedImageName, isInsertedImage, normalizeImageFolder, normalizeImageNameTemplate } from '../src/insertion-paths';
import { ImageInsertions, InsertionRange, importInsertedFile } from '../src/insertions';

const preferences = { ...DEFAULT_INSERTION_PREFERENCES, manageInsertedImages: true };
const date = new Date(2026, 6, 9, 8, 5, 2);
const image = (name = 'photo.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type });

test('folder paths distinguish current-note and vault-relative destinations', () => {
  assert.equal(normalizeImageFolder(' _Asset\\pictures/ '), '_Asset/pictures/');
  assert.equal(normalizeImageFolder('.'), './');
  assert.equal(imageDestinationFolder('./', 'Notes/note.md'), 'Notes');
  assert.equal(imageDestinationFolder('./_Asset/', 'Notes/note.md'), 'Notes/_Asset');
  assert.equal(imageDestinationFolder('_Asset/', 'Notes/note.md'), '_Asset');
  assert.equal(imageDestinationFolder('/', 'Notes/note.md'), '');
  assert.equal(imageDestinationFolder('./', 'note.md'), '');
  for (const value of ['', ' ', '../outside', './a/../../b', '/tmp/images', 'C:\\images', 'a:b', 'a?b', 'bad\n', 'a/.. /b', 'a./']) {
    assert.throws(() => normalizeImageFolder(value), Error, value);
  }
});

test('filename templates support original name, note name, local date/time and suffix without altering original tokens', () => {
  const rename = { ...preferences, renameInsertedImages: true };
  assert.equal(insertedImageName(image('photo.PNG'), 'Notes/Test.md', rename, date), 'photo-2026-07-09.PNG');
  assert.equal(insertedImageName(image('YYYY-MM-DD.png'), 'Test.md', rename, date), 'YYYY-MM-DD-2026-07-09.png');
  assert.equal(insertedImageName(image(), 'Notes/My note.md', { ...rename, imageNameTemplate: '<note-name>-YYYY-MM-DD-HHmmss.<suffix>' }, date), 'My note-2026-07-09-080502.png');
  assert.equal(insertedImageName(image('screenshot', 'image/png'), 'Test.md', preferences, date), 'screenshot.png');
  assert.equal(insertedImageName(image('a#b[1].png'), 'Test.md', preferences, date), 'a-b-1-.png');
  assert.equal(insertedImageName(image('photo.png'), 'Test.md', preferences, date), 'photo.png');
  for (const value of ['', '<original-name>.jpg', '../<original-name>.<suffix>', '<unknown>.<suffix>', '<suffix>.<suffix>', '.<suffix>', '..<suffix>', 'name\n.<suffix>']) {
    assert.throws(() => normalizeImageNameTemplate(value), Error, value);
  }
});

test('import classification includes images outside the raster editor formats', () => {
  for (const name of ['photo.PNG', 'animation.gif', 'drawing.svg', 'photo.avif', 'photo.heic']) assert.ok(isInsertedImage({ name, type: '' }));
  assert.ok(isInsertedImage({ name: 'clipboard', type: 'image/png' }));
  assert.equal(isInsertedImage({ name: 'note.pdf', type: 'application/pdf' }), false);
});

function runtime() {
  const entries = new Map<string, any>();
  const requested: string[] = [];
  const notices: string[] = [];
  let fail = false;
  const app = {
    vault: {
      getAbstractFileByPath(path: string) { return entries.get(path) ?? null; },
      async createFolder(path: string) {
        if (entries.has(path)) throw new Error('Exists');
        entries.set(path, { path, children: [] });
      },
      async createBinary(path: string, bytes: ArrayBuffer) {
        if (fail) throw new Error('Disk full');
        if (entries.has(path)) throw new Error('Exists');
        const file = { path, bytes };
        entries.set(path, file);
        return file;
      },
    },
    fileManager: {
      async getAvailablePathForAttachment(filename: string, source: string) {
        requested.push(source);
        return `Default/${filename}`;
      },
      generateMarkdownLink(file: { path: string }, source: string) {
        requested.push(source);
        return `[[${file.path}]]`;
      },
    },
  } as unknown as App;
  const settings = { ...preferences };
  const manager = new ImageInsertions(app, () => settings, message => notices.push(message));
  const info = { file: { path: 'Notes/note.md' } } as MarkdownFileInfo;
  let value = 'before SELECT after';
  let from = 7, to = 13;
  const history: string[] = [];
  const editor = {
    getValue: () => value,
    getSelection: () => value.slice(from, to),
    getCursor: (side?: string) => ({ line: 0, ch: side === 'to' ? to : from }),
    listSelections: () => [{ anchor: { line: 0, ch: from }, head: { line: 0, ch: to } }],
    posToOffset: (position: { ch: number }) => position.ch,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    replaceSelection(text: string) { history.push(value); value = value.slice(0, from) + text + value.slice(to); },
    replaceRange(text: string, start: { ch: number }, end = start) { history.push(value); value = value.slice(0, start.ch) + text + value.slice(end.ch); },
    undo() { value = history.pop() ?? value; },
  } as unknown as Editor;
  const event = (files: File[], drop = false) => {
    const transfer = { files, items: [] };
    return {
      ...(drop ? { dataTransfer: transfer, clientX: 10, clientY: 20 } : { clipboardData: transfer }),
      defaultPrevented: false,
      preventDefault(this: { defaultPrevented: boolean }) { this.defaultPrevented = true; },
    } as unknown as ClipboardEvent & DragEvent;
  };
  return { app, entries, requested, notices, settings, manager, info, editor, event, history,
    failWrites() { fail = true; },
    get value() { return value; }, set value(text: string) { value = text; },
  };
}

test('image import writes unmodified bytes to chosen folders, preserving extensions', async () => {
  const r = runtime();
  const result = await importInsertedFile(r.app, image('photo.PNG'), 'Notes/note.md', { ...preferences, imageFolder: './', renameInsertedImages: true }, date);
  assert.equal(result.file.path, 'Notes/photo-2026-07-09.PNG');
  assert.equal(result.embed, '![[Notes/photo-2026-07-09.PNG]]');
  assert.deepEqual(new Uint8Array(r.entries.get(result.file.path).bytes), new Uint8Array([1, 2, 3]));
  assert.equal(r.requested[0], 'Notes/note.md');
});

test('concurrent identical imports allocate unique paths and never overwrite', async () => {
  const r = runtime();
  const imports = await Promise.all(Array.from({ length: 3 }, () => importInsertedFile(r.app, image(), 'note.md', preferences, date)));
  assert.deepEqual(imports.map(result => result.file.path), ['_Asset/photo.png', '_Asset/photo-1.png', '_Asset/photo-2.png']);
  assert.ok(r.entries.get('_Asset').children);
});

test('folder/file collisions and write failures are reported without overwriting files', async () => {
  const r = runtime();
  const existing = { path: '_Asset' };
  r.entries.set('_Asset', existing);
  await assert.rejects(importInsertedFile(r.app, image(), 'note.md', preferences), /is a file/);
  assert.equal(r.entries.get('_Asset'), existing);
  r.entries.clear();
  r.failWrites();
  await assert.rejects(importInsertedFile(r.app, image(), 'note.md', preferences), /Disk full/);
});

test('disabled management, already-handled events, text-only paste and non-image files stay native', () => {
  const r = runtime();
  r.settings.manageInsertedImages = false;
  let event = r.event([image()]);
  assert.equal(r.manager.handle(event, r.editor, r.info), undefined);
  assert.equal(event.defaultPrevented, false);
  r.settings.manageInsertedImages = true;
  event = r.event([image()]); event.preventDefault();
  assert.equal(r.manager.handle(event, r.editor, r.info), undefined);
  for (const files of [[], [new File(['pdf'], 'document.pdf', { type: 'application/pdf' })]]) {
    event = r.event(files);
    assert.equal(r.manager.handle(event, r.editor, r.info), undefined);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(r.value, 'before SELECT after');
  assert.equal(r.entries.size, 0);
});

test('paste inserts image links and preserves concurrent typing around the insertion anchor', async () => {
  const r = runtime();
  const event = r.event([image()]);
  const pending = r.manager.handle(event, r.editor, r.info);
  assert.equal(event.defaultPrevented, true);
  assert.equal(r.value, 'before SELECT after');
  r.value = 'typed ' + r.value;
  await pending;
  assert.equal(r.value, 'typed before ![[_Asset/photo.png]] after');
  assert.equal(r.notices.length, 0);
});

test('editor-change tracking preserves the range across edits on both sides', async () => {
  const r = runtime();
  const pending = r.manager.handle(r.event([image()]), r.editor, r.info);
  r.value = 'typed ' + r.value;
  r.manager.onEditorChange(r.editor, r.info);
  r.value += ' more';
  r.manager.onEditorChange(r.editor, r.info);
  await pending;
  assert.equal(r.value, 'typed before ![[_Asset/photo.png]] after more');
});

test('editor reuse with a new info object cancels the original insertion', async () => {
  const r = runtime();
  const pending = r.manager.handle(r.event([image()]), r.editor, r.info);
  r.manager.onEditorChange(r.editor, { file: { path: 'other.md' } } as MarkdownFileInfo);
  await pending;
  assert.equal(r.value, 'before SELECT after');
  assert.match(r.notices[0], /note changed/);
});

test('mixed file paste keeps ordering and imports non-images using native folder preferences', async () => {
  const r = runtime();
  await r.manager.handle(r.event([image(), new File(['pdf'], 'document.pdf', { type: 'application/pdf' }), image('drawing.svg', 'image/svg+xml')]), r.editor, r.info);
  assert.equal(r.value, 'before ![[_Asset/photo.png]]\n![[Default/document.pdf]]\n![[_Asset/drawing.svg]] after');
  assert.ok(r.entries.has('Default/document.pdf'));
});

test('failed imports restore selected text and show an actionable error', async () => {
  const r = runtime(); r.failWrites();
  await r.manager.handle(r.event([image()]), r.editor, r.info);
  assert.equal(r.value, 'before SELECT after');
  assert.match(r.notices[0], /photo.png.*Disk full.*retry/);
});

test('drop uses pointer coordinates rather than replacing selected text', async () => {
  const r = runtime();
  (r.editor as any).cm = { posAtCoords: ({ x, y }: any) => { assert.equal(x, 10); assert.equal(y, 20); return 0; } };
  await r.manager.handle(r.event([image()], true), r.editor, r.info);
  assert.equal(r.value, '![[_Asset/photo.png]]before SELECT after');
});

test('overlapping edits and switched notes never receive a late insertion', async () => {
  for (const switchNote of [false, true]) {
    const r = runtime();
    const pending = r.manager.handle(r.event([image()]), r.editor, r.info);
    r.value = 'new text';
    if (switchNote) (r.info as any).file = { path: 'other.md' };
    await pending;
    assert.equal(r.value, 'new text');
    assert.match(r.notices[0], /insertion was cancelled or the note changed/);
  }
});

test('unload leaves pending text intact and prevents late editor changes', async () => {
  const r = runtime();
  const pending = r.manager.handle(r.event([image()]), r.editor, r.info);
  r.manager.dispose();
  assert.equal(r.value, 'before SELECT after');
  await pending;
  assert.equal(r.value, 'before SELECT after');
  const next = r.event([image()]);
  assert.equal(r.manager.handle(next, r.editor, r.info), undefined);
  assert.equal(next.defaultPrevented, false);
});

test('imports create only one undoable edit, with no placeholder history', async () => {
  const r = runtime();
  const pending = r.manager.handle(r.event([image()]), r.editor, r.info);
  assert.equal(r.history.length, 0);
  await pending;
  assert.equal(r.history.length, 1);
  r.editor.undo();
  assert.equal(r.value, 'before SELECT after');
});

test('multiple selections fall back to native handling rather than leaving unresolved anchors', () => {
  const r = runtime();
  r.editor.listSelections = () => [1, 2] as any;
  const event = r.event([image()]);
  assert.equal(r.manager.handle(event, r.editor, r.info), undefined);
  assert.equal(event.defaultPrevented, false);
});

test('note renaming during an import leaves no temporary text or lost selection', async () => {
  const r = runtime();
  const pending = r.manager.handle(r.event([image()]), r.editor, r.info);
  r.info.file!.path = 'Notes/renamed.md';
  await pending;
  assert.equal(r.value, 'before SELECT after');
  assert.match(r.notices[0], /note changed/);
});

test('range tracking maps edits before an anchor and cancels edits inside it', () => {
  const range = new InsertionRange(2, 5, 'abXYZcd');
  assert.equal(range.update('prefix abXYZcd'), true);
  assert.equal(range.from, 9);
  assert.equal(range.to, 12);
  assert.equal(range.update('prefix abX!YZcd'), false);
  const caret = new InsertionRange(2, 2, 'abcd');
  assert.equal(caret.update('ab!cd'), true);
  assert.equal(caret.from, 2);
});

test('generated embeds respect Markdown link preferences', async () => {
  const r = runtime();
  r.app.fileManager.generateMarkdownLink = () => '[photo](../_Asset/photo.png)';
  await r.manager.handle(r.event([image()]), r.editor, r.info);
  assert.equal(r.value, 'before ![photo](../_Asset/photo.png) after');
});

test('an in-flight import snapshots folder and renaming preferences', async () => {
  const r = runtime();
  const pending = r.manager.handle(r.event([image(), image('second.png')]), r.editor, r.info);
  r.settings.imageFolder = 'Other/';
  r.settings.renameInsertedImages = true;
  await pending;
  assert.equal(r.value, 'before ![[_Asset/photo.png]]\n![[_Asset/second.png]] after');
});

test('a partially failed batch retains successful embeds and reports the failed file', async () => {
  const r = runtime();
  const broken = image('broken.png');
  broken.arrayBuffer = async () => { throw new Error('Cannot read input'); };
  await r.manager.handle(r.event([image(), broken, image('last.png')]), r.editor, r.info);
  assert.equal(r.value, 'before ![[_Asset/photo.png]]\n![[_Asset/last.png]] after');
  assert.match(r.notices[0], /broken.png.*Cannot read input/);
});

test('clipboard items fallback imports a screenshot without a file extension', async () => {
  const r = runtime();
  const event = r.event([]);
  (event.clipboardData as any).items = [{ kind: 'file', getAsFile: () => image('clipboard', 'image/png') }];
  await r.manager.handle(event, r.editor, r.info);
  assert.equal(r.value, 'before ![[_Asset/clipboard.png]] after');
});
