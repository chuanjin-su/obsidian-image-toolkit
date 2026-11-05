import { Modal, type App } from 'obsidian';
import { DEFAULT_SETTINGS, type BackupPreferences } from './settings';
import { normalizeBackupFolder } from './storage';

export class BackupPrompt extends Modal {
  private onResult: (result: BackupPreferences | null) => void;
  private result: BackupPreferences | null = null;
  private completed = false;
  private submitting = false;

  constructor(app: App, private current: BackupPreferences, onResult: (result: BackupPreferences | null) => void) {
    super(app);
    this.onResult = onResult;
  }

  onOpen() {
    this.modalEl.addClass('image-toolkit-backup-prompt');
    this.titleEl.setText('Back up images before saving?');
    this.contentEl.empty();

    const form = this.contentEl.createEl('form', { cls: 'image-toolkit-backup-prompt-form' });
    const backupLabel = form.createEl('label', { cls: 'image-toolkit-backup-prompt-option' });
    const backupCheckbox = backupLabel.createEl('input', { type: 'checkbox' });
    backupCheckbox.checked = this.current.backupEnabled === true;
    backupLabel.createSpan({ text: 'Back up before overwriting' });

    const folderLabel = form.createEl('label', { cls: 'image-toolkit-backup-prompt-folder' });
    folderLabel.createSpan({ text: 'Backup folder' });
    const folderInput = folderLabel.createEl('input', {
      type: 'text',
      value: this.current.backupFolder,
      attr: { 'aria-label': 'Backup folder' },
    });
    folderInput.disabled = !backupCheckbox.checked;

    const warning = form.createEl('p', { cls: 'image-toolkit-backup-prompt-warning' });
    warning.setText('Saving will replace the source image. Your decision will be remembered.');

    const validationError = form.createEl('p', {
      cls: 'image-toolkit-backup-prompt-error',
      attr: { role: 'alert' },
    });
    validationError.hidden = true;

    const actions = form.createDiv('image-toolkit-backup-prompt-actions');
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    const submit = actions.createEl('button', { text: 'Continue & save', attr: { type: 'submit' } });
    submit.addClass('mod-cta');

    backupCheckbox.addEventListener('change', () => {
      folderInput.disabled = !backupCheckbox.checked;
      validationError.hidden = true;
      validationError.setText('');
    });
    folderInput.addEventListener('input', () => {
      validationError.hidden = true;
      validationError.setText('');
    });
    cancel.addEventListener('click', () => this.close());
    form.addEventListener('submit', event => {
      event.preventDefault();
      this.submitChoice(backupCheckbox, folderInput, validationError);
    });
  }

  onClose() {
    this.finish(this.result);
  }

  private submitChoice(
    backupCheckbox: HTMLInputElement,
    folderInput: HTMLInputElement,
    validationError: HTMLElement,
  ) {
    if (this.completed || this.submitting) return;
    this.submitting = true;
    validationError.hidden = true;

    let choice: BackupPreferences;
    try {
      const backupEnabled = backupCheckbox.checked;
      const enteredFolder = folderInput.value;
      const backupFolder = backupEnabled
        ? normalizeBackupFolder(enteredFolder)
        : enteredFolder.trim().length > 0 ? enteredFolder : DEFAULT_SETTINGS.backupFolder;
      choice = { backupEnabled, backupFolder };
    } catch (error) {
      this.submitting = false;
      validationError.setText(error instanceof Error ? error.message : String(error));
      validationError.hidden = false;
      return;
    }

    this.result = choice;
    this.close();
  }

  private finish(result: BackupPreferences | null) {
    if (this.completed) return;
    this.completed = true;
    this.onResult(result);
  }
}
