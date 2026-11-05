import { Menu, Notice, Plugin, PluginSettingTab, Setting, TFile, type App } from 'obsidian';
import { ImageEditor, type EditorOptions, type Tool } from './editor';
import { findImageEmbeds, isRemote, supportedExtension } from './embeds';
import { normalizeBackupFolder } from './storage';
import { DEFAULT_SETTINGS, loadSettings, type PluginSettings } from './settings';
interface Context { file: TFile }

export default class ImageToolkit extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private documents = new WeakSet<Document>();
  private clicked?: Context;
  private menuHandled = false;
  private imageClick = false;
  private extendedMenus = new WeakSet<Menu>();
  private menuTimers = new Set<number>();
  private editors = new Set<ImageEditor>();

  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.register(() => { for (const timer of this.menuTimers) window.clearTimeout(timer); this.menuTimers.clear(); });
    this.addSettingTab(new ToolkitSettings(this.app, this));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && supportedExtension(file.path)) {
        const context = this.clicked?.file.path === file.path ? this.clicked : { file };
        this.addMenu(menu, context);
        if (this.clicked?.file.path === file.path) this.menuHandled = true;
      }
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      if (this.clicked) { this.addMenu(menu, this.clicked); this.menuHandled = true; return; }
      if (this.imageClick || !info.file) return;
      const offset = editor.posToOffset(editor.getCursor());
      const embed = findImageEmbeds(editor.getValue()).find(e => e.start <= offset && offset <= e.end);
      if (!embed) return;
      const file = this.resolve(embed.link, info.file.path);
      if (!file) return;
      this.addMenu(menu, { file });
      this.menuHandled = true;
    }));
    this.addCommand({ id: 'edit-image-at-cursor', name: 'Edit image at cursor', editorCallback: (editor, view) => {
      const offset = editor.posToOffset(editor.getCursor());
      const embed = findImageEmbeds(editor.getValue()).find(e => e.start <= offset && offset <= e.end);
      const file = embed && view.file && this.resolve(embed.link, view.file.path);
      if (file && embed && view.file) this.open({ file }, 'compress');
      else new Notice('Place the cursor on a local JPEG, PNG or WebP embed.');
    }});
    const attach = () => {
      this.attachDocument(document);
      this.app.workspace.iterateAllLeaves(leaf => this.attachDocument(leaf.view.containerEl.ownerDocument));
    };
    this.app.workspace.onLayoutReady(attach);
    this.registerEvent(this.app.workspace.on('layout-change', attach));
    this.registerEvent(this.app.workspace.on('active-leaf-change', attach));
  }

  onunload() { for (const editor of this.editors) editor.close(); }

  private resolve(link: string, notePath: string): TFile | null {
    if (isRemote(link)) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(link, notePath);
    return file && supportedExtension(file.path) ? file : null;
  }

  private attachDocument(doc: Document) {
    if (this.documents.has(doc)) return;
    this.documents.add(doc);
    this.registerDomEvent(doc, 'contextmenu', (event: MouseEvent) => {
      this.clicked = undefined;
      this.imageClick = false;
      this.menuHandled = false;
      const el = event.target as HTMLElement | null;
      if (!el || el.closest('.image-toolkit-modal')) return;
      const img = el.closest('img');
      if (!img) return;
      this.imageClick = true;
      // The displayed resource is authoritative, including images inside transcluded
      // notes. Resolving a basename against the outer note can select the wrong file.
      const resource = (img.currentSrc || img.src).split('?')[0];
      const file = this.app.vault.getFiles().find(f => supportedExtension(f.path) && this.app.vault.getResourcePath(f).split('?')[0] === resource);
      if (!file) { queueMicrotask(() => { this.imageClick = false; }); return; }
      // Saves preserve the original path and format; all embeds keep their links.
      const context: Context = { file };
      this.clicked = context;
      const x = event.clientX, y = event.clientY;
      // Give Obsidian its normal file/editor-menu event first. Use a fallback only
      // for rendered images where no native extension hook was emitted.
      const timer = window.setTimeout(() => {
        if (!this.menuHandled) {
          const menu = new Menu();
          this.addMenu(menu, context);
          menu.showAtPosition({ x, y });
        }
        this.clicked = undefined;
        this.imageClick = false;
        this.menuTimers.delete(timer);
      }, 0);
      this.menuTimers.add(timer);
    }, true);
  }

  private addMenu(menu: Menu, context: Context) {
    if (this.extendedMenus.has(menu)) return;
    this.extendedMenus.add(menu);
    menu.addSeparator();
    menu.addItem(item=>item.setTitle('Edit image').setIcon('image').onClick(()=>this.open(context,'compress')));
  }

  private open(context: Context, tool: Tool) {
    const options: EditorOptions = {
      tool,quality:this.settings.quality,backupEnabled:this.settings.backupEnabled,backupFolder:this.settings.backupFolder,
      backupConfigured:this.settings.backupConfigured,pluginDir:this.manifest.dir!,
      getBackupPreferences:()=>({...this.settings}),
      saveBackupPreferences:async preferences=>{
        const next={...this.settings,...preferences,backupConfigured:true};
        await this.saveData(next);this.settings=next;
      }
    };
    const editor = new ImageEditor(this.app, context.file, options, () => this.editors.delete(editor));
    this.editors.add(editor);
    editor.open();
  }
}

class ToolkitSettings extends PluginSettingTab {
  constructor(app: App, private plugin: ImageToolkit) { super(app, plugin); }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl('h2', { text: 'Image Toolkit' });
    new Setting(this.containerEl).setName('Default quality').setDesc('JPEG / WebP only. PNG is lossless.').addSlider(slider => slider.setLimits(10, 100, 1).setValue(this.plugin.settings.quality).setDynamicTooltip().onChange(async value => { this.plugin.settings.quality = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(this.containerEl).setName('Back up before overwriting').setDesc('Every Save replaces the original file. When enabled, preserve its previous bytes in the backup folder first. A failed backup cancels saving.').addToggle(toggle => toggle.setValue(this.plugin.settings.backupEnabled).onChange(async value => { this.plugin.settings.backupEnabled=value;await this.plugin.saveData(this.plugin.settings); }));
    new Setting(this.containerEl).setName('Backup folder').setDesc('Vault-relative folder. Source subfolders are mirrored and each overwrite gets a separate backup.').addText(text => {
      text.setPlaceholder(DEFAULT_SETTINGS.backupFolder).setValue(this.plugin.settings.backupFolder);
      text.inputEl.addEventListener('change', () => { void (async()=>{
        try {const folder=normalizeBackupFolder(text.getValue());text.inputEl.setCustomValidity('');this.plugin.settings.backupFolder=folder;text.setValue(folder);await this.plugin.saveData(this.plugin.settings);}
        catch(error){text.inputEl.setCustomValidity(String(error));text.inputEl.reportValidity();}
      })(); });
      text.inputEl.addEventListener('input',()=>text.inputEl.setCustomValidity(''));
    });
    this.containerEl.createEl('p', { text: 'Images are processed locally. Save always overwrites the same image path and preserves its format; all notes referencing it see the change. Backups start disabled; the first Save asks whether to enable them and where to store them. Desktop-only preview release.' });
  }
}
