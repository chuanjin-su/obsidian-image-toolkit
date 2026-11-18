import type { App, Editor, MarkdownFileInfo, MarkdownView, TFile } from 'obsidian';
import { imageDestinationFolder, insertedImageName, isInsertedImage, type InsertionPreferences } from './insertion-paths';
import { ensureFolder } from './storage';

// Serialize path allocation and writing across batches. Never overwrite an existing attachment.
const queues = new WeakMap<App['vault'], Promise<void>>();
async function createAttachment(app: App, folder: string, filename: string, bytes: ArrayBuffer): Promise<TFile> {
  const previous = queues.get(app.vault) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  queues.set(app.vault, current);
  await previous;
  try {
    await ensureFolder(app, folder, 'image');
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    for (let index = 0; Number.isSafeInteger(index); index++) {
      const name = `${base}${index ? `-${index}` : ''}${extension}`;
      const path = [folder, name].filter(Boolean).join('/');
      if (app.vault.getAbstractFileByPath(path)) continue;
      try { return await app.vault.createBinary(path, bytes); }
      catch (error) {
        if (app.vault.getAbstractFileByPath(path)) continue;
        throw error;
      }
    }
    throw new Error('Could not find a unique attachment filename.');
  } finally {
    release();
    if (queues.get(app.vault) === current) queues.delete(app.vault);
  }
}

export async function importInsertedFile(
  app: App, file: File, notePath: string, preferences: InsertionPreferences, date = new Date(),
): Promise<{ file: TFile; embed: string }> {
  const image = isInsertedImage(file);
  let folder: string, filename: string;
  if (image) {
    folder = imageDestinationFolder(preferences.imageFolder, notePath);
    filename = insertedImageName(file, notePath, preferences, date);
  } else {
    // Mixed drops/pastes keep non-image attachments in Obsidian's configured folder.
    const path = await app.fileManager.getAvailablePathForAttachment(file.name, notePath);
    const slash = path.lastIndexOf('/');
    folder = slash < 0 ? '' : path.slice(0, slash);
    filename = path.slice(slash + 1);
  }
  const saved = await createAttachment(app, folder, filename, await file.arrayBuffer());
  const link = app.fileManager.generateMarkdownLink(saved, notePath);
  const embeddable = image || /\.(pdf|mp3|wav|m4a|ogg|flac|3gp|mp4|webm|ogv|mov|mkv)$/i.test(saved.path);
  return { file: saved, embed: embeddable ? `!${link.replace(/^!/, '')}` : link };
}

/** A conservative text anchor: edits before it move it; edits overlapping it cancel it.
 * No temporary note text means imports create just one undoable edit and cannot
 * leave placeholders behind after Undo, note switching, failure or unload.
 */
export class InsertionRange {
  valid = true;
  constructor(public from: number, public to: number, private text: string) {}

  update(text: string): boolean {
    if (!this.valid || text === this.text) return this.valid;
    const previous = this.text;
    let start = 0;
    while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
    let end = previous.length, newEnd = text.length;
    while (end > start && newEnd > start && previous[end - 1] === text[newEnd - 1]) { end--; newEnd--; }
    const delta = newEnd - end;
    if (end <= this.from && start < this.from) {
      this.from += delta;
      this.to += delta;
    } else if (start < this.to || (start < this.from && end > this.from)) {
      this.valid = false;
    }
    this.text = text;
    return this.valid;
  }
}

interface PendingInsertion {
  editor: Editor;
  notePath: string;
  range: InsertionRange;
  sync: (file?: TFile | null) => boolean;
}

export class ImageInsertions {
  private disposed = false;
  private pending = new Set<PendingInsertion>();
  private cancelPicker?: () => void;

  constructor(
    private app: App,
    private preferences: () => InsertionPreferences,
    private notify: (message: string) => void,
  ) {}

  dispose() {
    this.disposed = true;
    this.cancelPicker?.();
    this.pending.clear();
  }

  onEditorChange(editor: Editor, info?: MarkdownFileInfo) {
    for (const insertion of this.pending) if (insertion.editor === editor) insertion.sync(info?.file);
  }

  canPickImages(editor: Editor, info: MarkdownFileInfo): boolean {
    return !this.disposed && this.preferences().manageInsertedImages && !!info.file && editor.listSelections().length === 1;
  }

  pickImages(doc: Document, editor: Editor, info: MarkdownFileInfo): Promise<void> | void {
    const note = info.file;
    if (!note || !this.canPickImages(editor, info)) return;
    const preferences = { ...this.preferences() };
    const from = editor.posToOffset(editor.getCursor('from'));
    const to = editor.posToOffset(editor.getCursor('to'));
    const insertion = this.trackInsertion(editor, info, note, from, to);
    return this.insertFiles(insertion, this.chooseImages(doc), preferences);
  }

  private chooseImages(doc: Document): Promise<File[]> {
    this.cancelPicker?.();
    return new Promise(resolve => {
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.heic,.heif';
      input.multiple = true;
      input.hidden = true;
      const finish = (files: File[]) => {
        if (this.cancelPicker !== cancel) return;
        this.cancelPicker = undefined;
        input.remove();
        resolve(files);
      };
      const cancel = () => finish([]);
      this.cancelPicker = cancel;
      input.addEventListener('cancel', cancel);
      input.addEventListener('change', () => finish(Array.from(input.files ?? []).filter(isInsertedImage)));
      doc.body.append(input);
      // Open synchronously while the command still has the user's activation.
      input.click();
    });
  }

  handle(event: ClipboardEvent | DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): Promise<void> | void {
    const preferences = { ...this.preferences() };
    if (this.disposed || event.defaultPrevented || !preferences.manageInsertedImages || !info.file) return;
    // Preserve native multi-cursor behavior rather than replacing just one selection.
    if (editor.listSelections().length > 1) return;
    const transfer = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    if (!transfer) return;
    const files = Array.from(transfer.files);
    if (!files.length) {
      for (const item of Array.from(transfer.items)) {
        if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
      }
    }
    if (!files.some(isInsertedImage)) return; // Plain text, URLs and existing vault embeds remain native.
    const note = info.file;
    let from = editor.posToOffset(editor.getCursor('from'));
    let to = editor.posToOffset(editor.getCursor('to'));
    if (!('clipboardData' in event)) {
      // Obsidian's CM6 editor has no public coordinate API. Guard this optional
      // bridge and fall back to the caret on older hosts instead of failing a drop.
      const cm = (editor as Editor & { cm?: { posAtCoords?: (coords: { x: number; y: number }) => number | null } }).cm;
      const drop = event as DragEvent;
      from = cm?.posAtCoords?.({ x: drop.clientX, y: drop.clientY }) ?? editor.posToOffset(editor.getCursor());
      to = from;
    }
    event.preventDefault();
    const insertion = this.trackInsertion(editor, info, note, from, to);
    return this.insertFiles(insertion, files, preferences);
  }

  private trackInsertion(editor: Editor, info: MarkdownFileInfo, note: TFile, from: number, to: number): PendingInsertion {
    const notePath = note.path;
    const range = new InsertionRange(from, to, editor.getValue());
    const sync = (currentFile: TFile | null | undefined = info.file) => {
      if (currentFile !== note || info.file !== note || info.file.path !== notePath) range.valid = false;
      return range.valid && range.update(editor.getValue());
    };
    const insertion = { editor, notePath, range, sync };
    this.pending.add(insertion);
    return insertion;
  }

  private async insertFiles(insertion: PendingInsertion, selection: File[] | Promise<File[]>, preferences: InsertionPreferences) {
    const { editor, notePath, range, sync } = insertion;
    const links: string[] = [];
    try {
      const files = Array.isArray(selection) ? selection : await selection;
      if (this.disposed || !files.length) return;
      if (!sync()) {
        this.notify('Image Toolkit cancelled the import because the note or insertion range changed.');
        return;
      }
      const date = new Date();
      for (const file of files) {
        if (this.disposed || !sync()) break;
        try {
          const result = await importInsertedFile(this.app, file, notePath, preferences, date);
          links.push(result.embed);
        } catch (error) {
          this.notify(`Image Toolkit could not insert ${file.name}: ${error instanceof Error ? error.message : String(error)}. Please retry this file.`);
        }
      }
      if (links.length) {
        if (!this.disposed && sync()) {
          this.pending.delete(insertion);
          editor.replaceRange(links.join('\n'), editor.offsetToPos(range.from), editor.offsetToPos(range.to));
        } else {
          this.notify('Image Toolkit saved attachments, but insertion was cancelled or the note changed. The files remain in the attachment folder.');
        }
      }
    } finally { this.pending.delete(insertion); }
  }
}
