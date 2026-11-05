import { Modal, Notice, type App, type TFile } from 'obsidian';
import { assertStaticImage } from './embeds';
import { findImageBackups, restoreImageBackup, type ImageBackup } from './recovery';
import { refreshImageViews } from './refresh';

export function formatImageBytes(bytes: number): string {
  const exact = `${bytes.toLocaleString()} bytes`;
  if (bytes < 1024) return exact;
  const unit = bytes < 1024 * 1024 ? 'KB' : 'MB';
  const divisor = unit === 'KB' ? 1024 : 1024 * 1024;
  return `${(bytes / divisor).toFixed(2)} ${unit} (${exact})`;
}

/** Pick a verified backup; restoring always preserves the current bytes first. */
export class ImageRecovery extends Modal {
  private closed = false;
  private restoring = false;
  private selectionVersion = 0;
  private sourcePath: string;
  private original?: ArrayBuffer;
  private selected?: { version: ImageBackup; bytes: ArrayBuffer };
  private rows: HTMLButtonElement[] = [];
  private urls = new Set<string>();
  private selectedUrl?: string;
  private restoreButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private status!: HTMLElement;
  private preview!: HTMLImageElement;
  private details!: HTMLElement;

  constructor(app: App, private file: TFile, private backupFolder: string, private didClose: () => void = () => {}) {
    super(app);
    this.sourcePath = file.path;
  }

  async onOpen() {
    this.modalEl.addClass('image-toolkit-recovery');
    this.titleEl.setText('Recover image');
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: this.sourcePath, cls: 'image-toolkit-recovery-path' });
    this.contentEl.createEl('p', { text: 'Select a backup to restore. This replaces the shared image in every note. The current image will be backed up first.' });
    const layout = this.contentEl.createDiv('image-toolkit-recovery-layout');
    const list = layout.createDiv('image-toolkit-recovery-versions');
    list.setAttribute('role', 'group');list.setAttribute('aria-label', 'Backup versions');
    list.createEl('p', { text: 'Loading backup versions…' });
    const panel = layout.createDiv('image-toolkit-recovery-preview');
    this.preview = panel.createEl('img', { attr: { alt: 'Selected backup preview' } });
    this.preview.hidden = true;
    this.details = panel.createEl('p', { text: 'Select a version to preview it.' });
    this.status = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = this.contentEl.createDiv('image-toolkit-recovery-actions');
    this.cancelButton = actions.createEl('button', { text: 'Cancel' });
    this.cancelButton.onclick = () => this.close();
    this.restoreButton = actions.createEl('button', { text: 'Restore selected version', cls: 'mod-cta' });
    this.restoreButton.disabled = true;
    this.restoreButton.onclick = () => { void this.restore(); };

    try {
      const versions = findImageBackups(this.app, this.file, this.backupFolder);
      list.empty();
      if (versions.length === 0) {
        list.createEl('p', { text: `No backups found for this image in ${this.backupFolder}.` });
        return;
      }
      this.original = await this.app.vault.readBinary(this.file);
      if (this.closed) return;
      this.assertSourcePresent();
      for (const version of versions) this.addVersion(list, version);
      this.status.setText(`${versions.length} backup version${versions.length === 1 ? '' : 's'} · Newest first`);
    } catch (error) {
      if (!this.closed) { list.empty();this.showError(error); }
    }
  }

  onClose() {
    this.closed = true;
    ++this.selectionVersion;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.preview?.removeAttribute('src');
    this.selected = undefined;this.original = undefined;
    this.didClose();
  }

  private addVersion(list: HTMLElement, version: ImageBackup) {
    const row = list.createEl('button', { cls: 'image-toolkit-recovery-version', attr: { type: 'button', 'aria-pressed': 'false' } });
    row.title = version.path;
    const thumbnail = row.createEl('img', { attr: { alt: '', loading: 'lazy' } });
    const metadata = row.createSpan();
    metadata.createEl('strong', { text: new Date(version.timestamp).toLocaleString() });
    metadata.createSpan({ text: `${formatImageBytes(version.file.stat.size)} · ${version.file.extension.toUpperCase()}` });
    const dimensions = metadata.createSpan({ text: 'Loading dimensions…' });
    metadata.createSpan({ text: version.file.name, cls: 'image-toolkit-recovery-path' });
    thumbnail.onload = () => { if (!this.closed) dimensions.setText(`${thumbnail.naturalWidth} × ${thumbnail.naturalHeight} px`); };
    thumbnail.onerror = () => { if (!this.closed) dimensions.setText('Preview unavailable'); };
    thumbnail.src = this.app.vault.getResourcePath(version.file);
    row.onclick = () => { void this.selectVersion(version, row); };
    this.rows.push(row);
  }

  private async selectVersion(version: ImageBackup, row: HTMLButtonElement) {
    if (this.closed || this.restoring) return;
    const request = ++this.selectionVersion;
    this.selected = undefined;
    this.restoreButton.disabled = true;
    this.preview.hidden = true;
    this.preview.removeAttribute('src');
    if (this.selectedUrl) { this.releaseUrl(this.selectedUrl);this.selectedUrl = undefined; }
    for (const candidate of this.rows) candidate.setAttribute('aria-pressed', String(candidate === row));
    this.details.setText('Loading selected backup…');
    this.status.removeClass('image-toolkit-error');this.status.setText('');
    let url: string | undefined;
    try {
      if (version.file.path !== version.path || this.app.vault.getAbstractFileByPath(version.path) !== version.file) {
        throw new Error('This backup was moved or removed. Reopen Recover image to refresh the list.');
      }
      const bytes = await this.app.vault.readBinary(version.file);
      if (this.closed || request !== this.selectionVersion) return;
      assertStaticImage(bytes, this.file.extension.toLowerCase());
      url = URL.createObjectURL(new Blob([bytes]));this.urls.add(url);
      const probe = this.containerEl.ownerDocument.createElement('img');
      probe.src = url;await probe.decode();
      if (this.closed || request !== this.selectionVersion) return;
      this.selected = { version, bytes };
      this.selectedUrl = url;
      this.preview.src = url;this.preview.hidden = false;
      this.details.setText(`${new Date(version.timestamp).toLocaleString()}\n${probe.naturalWidth} × ${probe.naturalHeight} px · ${this.file.extension.toUpperCase()}\n${formatImageBytes(bytes.byteLength)}\n${version.path}`);
      this.restoreButton.disabled = false;
      this.status.setText('The current version will be backed up before restoring.');
    } catch (error) {
      if (!this.closed && request === this.selectionVersion) { this.details.setText('Cannot use this backup. Select another version.');this.showError(error); }
    } finally {
      if (url && url !== this.selectedUrl) this.releaseUrl(url);
    }
  }

  private async restore() {
    if (this.closed || this.restoring || !this.selected || !this.original) return;
    const { version, bytes } = this.selected;
    this.restoring = true;
    this.restoreButton.disabled = true;this.cancelButton.disabled = true;
    for (const row of this.rows) row.disabled = true;
    this.status.removeClass('image-toolkit-error');this.status.setText('Backing up the current image and restoring…');
    try {
      this.assertSourcePresent();
      const result = await restoreImageBackup(this.app, this.file, version, this.original, bytes, this.backupFolder);
      try { refreshImageViews(this.app, this.file, this.containerEl.ownerDocument); }
      catch (error) { console.error('Image Toolkit: recovered image refresh failed.', error);new Notice('Image recovered. Reopen the note if its preview has not refreshed.'); }
      new Notice(`Recovered ${result.path}\nPrevious version backed up: ${result.backupPath}`, 8000);
      if (!this.closed) this.close();
    } catch (error) {
      if (!this.closed) this.showError(error);
    } finally {
      this.restoring = false;
      if (!this.closed) {
        this.restoreButton.disabled = !this.selected;this.cancelButton.disabled = false;
        for (const row of this.rows) row.disabled = false;
      }
    }
  }

  private assertSourcePresent() {
    if (this.file.path !== this.sourcePath || this.app.vault.getAbstractFileByPath(this.sourcePath) !== this.file) {
      throw new Error('The source image was moved or removed. Reopen Recover image.');
    }
  }

  private showError(error: unknown) {
    this.status.addClass('image-toolkit-error');
    this.status.setText(error instanceof Error ? error.message : String(error));
  }

  private releaseUrl(url: string) {
    if (this.urls.delete(url)) URL.revokeObjectURL(url);
  }
}
