import { Modal, Notice, setIcon, type App, type TFile } from 'obsidian';
import { assertStaticImage } from './embeds';
import { estimateRectifiedSize, isValidQuad, MAX_PIXELS, MAX_DIMENSION as MAX_SIDE, type Point } from './processing';
import { saveImage } from './storage';
import { fitPreviewSize, rectangleCorners } from './preview';
import { DEFAULT_ADJUSTMENTS, hasAdjustments, type BasicAdjustments } from './adjustments';
import type { ProcessingRequest } from './processing-worker';
import processingWorkerSource from 'image-toolkit:processing-worker';
import { BackupPrompt } from './backup-dialog';
import type { BackupPreferences } from './settings';
import { markBounds, moveMark, resizeBounds, resizeMark, hitTestMark, selectionHandles, type MarkKind, type Mark, type Bounds, type Corner } from './annotations';

export type Tool = 'compress' | 'resize' | 'crop' | 'adjust' | 'annotate';
export interface EditorOptions {
  tool:Tool;quality:number;backupEnabled:boolean;backupFolder:string;backupConfigured?:boolean;
  getBackupPreferences?:()=>BackupPreferences&{backupConfigured:boolean};
  saveBackupPreferences?:(preferences:BackupPreferences)=>Promise<void>;
}
type BoardMode = 'rectangle' | 'board';
interface Snapshot { blob: Blob; marks: Mark[] }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const canvas = (width: number, height: number): HTMLCanvasElement => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error('Image exceeds limits: 32 megapixels and 8192 pixels per side. Resize the original externally first.');
  const c = document.createElement('canvas'); c.width = Math.round(width); c.height = Math.round(height); return c;
};
const ctx = (c: HTMLCanvasElement) => { const context = c.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Canvas is unavailable.'); return context; };
const encode = (c: HTMLCanvasElement, type = 'image/png', quality?: number) => new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Image encoding failed.')), type, quality));
async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const out = canvas(img.naturalWidth, img.naturalHeight); ctx(out).drawImage(img, 0, 0); return out;
  } finally { URL.revokeObjectURL(url); }
}

export class ImageEditor extends Modal {
  private working!: HTMLCanvasElement;
  private original!: ArrayBuffer;
  private preview!: HTMLCanvasElement;
  private scroll!: HTMLElement;
  private previewCaption!: HTMLElement;
  private encodedPreview?: ImageBitmap;
  private resizeObserver?: ResizeObserver;
  private boardPreview?: HTMLCanvasElement;
  private magnifier?: HTMLCanvasElement;
  private controls!: HTMLElement;
  private toolActions!: HTMLElement;
  private layout!: HTMLElement;
  private status!: HTMLElement;
  private outputInfo!: HTMLElement;
  private tool: Tool;
  private mode: BoardMode = 'rectangle';
  private corners: Point[] = [];
  private activeCorner = 0;
  private strength = 0;
  private boardBackground: 'white' | 'black' = 'white';
  private marks: Mark[] = [];
  private markTool: MarkKind | 'select' = 'pen';
  private selected = -1;
  private color = '#e53935';
  private lineWidth = 5;
  private fontSize = 32;
  private dragging?: { corner?:number;mark?:number;point:Point;drawing?:boolean;rectangle?:boolean;originalMark?:Mark;bounds?:Bounds;handle?:'start'|'end'|Corner };
  private history: Snapshot[] = [];
  private historyIndex = -1;
  private busy = false;
  private closed = false;
  private readonly format: 'jpg' | 'png' | 'webp';
  private quality: number;
  private adjustments:BasicAdjustments={...DEFAULT_ADJUSTMENTS};  private zoom = 100;
  private worker?: Worker;
  private workerReady?: Promise<void>;
  private workerUrl?: string;
  private workerSequence = 0;
  private jobs = new Map<number, { resolve: (v: {data:ArrayBuffer;width:number;height:number}) => void; reject: (e: Error) => void; timer: number }>();
  private previewTimer?: number;
  private previewRunning = false;
  private estimateTimer?: number;
  private estimating = false;
  private estimateAgain = false;
  private previewVersion = 0;
  private sizeVersion = 0;
  private boardWidth = 0;
  private boardHeight = 0;
  private childModals = new Set<Modal>();

  constructor(app: App, private file: TFile, private options: EditorOptions, private didClose: () => void) {
    super(app);
    this.tool = options.tool;
    this.quality = clamp(Number(options.quality) || 85, 10, 100);
    this.format = (file.extension.toLowerCase() === 'jpeg' ? 'jpg' : file.extension.toLowerCase()) as 'jpg'|'png'|'webp';
  }

  async onOpen() {
    this.modalEl.addClass('image-toolkit-modal');
    this.titleEl.setText(`Image Toolkit — ${this.file.name}`);
    this.titleEl.addClass('image-toolkit-title');this.titleEl.title=this.file.path;
    this.contentEl.createEl('p', { text: 'Loading image…' });
    try {
      this.original = await this.app.vault.readBinary(this.file);
      if (this.original.byteLength > 80 * 1024 * 1024) throw new Error('Input exceeds the 80 MB safety limit.');
      assertStaticImage(this.original, this.file.extension.toLowerCase());
      this.working = await decode(new Blob([this.original]));
      if (this.closed) return;
      this.resetCorners();
      await this.checkpoint();
      this.build();
      this.draw();
      this.refreshOutputSize();
    } catch (error) { this.contentEl.empty(); this.contentEl.createEl('p', { text: String(error), cls: 'image-toolkit-error' }); }
  }

  onClose() {
    this.closed = true;
    for (const modal of this.childModals) modal.close();
    this.childModals.clear();
    window.clearTimeout(this.previewTimer);
    window.clearTimeout(this.estimateTimer);
    this.resizeObserver?.disconnect();
    this.encodedPreview?.close();this.encodedPreview=undefined;
    this.stopWorker(new Error('Editor closed.'));
    this.history = []; this.marks = [];
    this.didClose();
  }

  private button(parent: HTMLElement, text: string, action: () => void | Promise<void>, primary = false) {
    const b = parent.createEl('button', { text });
    if (primary) b.addClass('mod-cta');
    b.addEventListener('click', () => { if (!this.busy) void this.run(action); });
    return b;
  }
  private async run(action: () => void | Promise<void>) {
    try { await action(); } catch (e) { if (!this.closed) { new Notice(String(e)); this.status?.setText(String(e)); } }
  }
  private async exclusive(action: () => Promise<void>) {
    if (this.busy || this.closed) return;
    this.busy = true; this.modalEl.addClass('image-toolkit-busy');
    this.setEnabled(false);
    try { await action(); } finally { this.busy = false; this.modalEl.removeClass('image-toolkit-busy'); this.setEnabled(true); }
  }
  private setEnabled(enabled: boolean) {
    this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select,textarea').forEach(el => { el.disabled = !enabled; });
  }

  private build() {
    this.contentEl.empty();
    const toolbar = this.contentEl.createDiv('image-toolkit-toolbar');
    const tabs=toolbar.createDiv('image-toolkit-tool-tabs');
    for (const [id, title] of [['compress','Compress'],['resize','Resize'],['crop','Crop / board'],['adjust','Adjust'],['annotate','Annotate']] as [Tool,string][]) {
      const b = this.button(tabs,title,()=>this.selectTool(id));
      b.dataset.tool = id;
    }
    const history=toolbar.createDiv('image-toolkit-history');
    this.button(history, 'Undo', () => this.restore(-1));
    this.button(history, 'Redo', () => this.restore(1));
    this.button(history, 'Reset', () => this.exclusive(async () => {
      this.adjustments={...DEFAULT_ADJUSTMENTS};++this.sizeVersion;window.clearTimeout(this.estimateTimer);this.invalidateEncodedPreview();
      this.working = await decode(new Blob([this.original])); this.marks = []; this.resetCorners(); await this.checkpoint(); this.renderControls(); this.draw(); this.refreshOutputSize();
    }));
    this.button(history,'Compare',()=>this.compare()).title='Before / after with the current quality';
    this.layout=this.contentEl.createDiv('image-toolkit-layout');
    const viewport = this.layout.createDiv('image-toolkit-viewport');
    const zoomBar = viewport.createDiv('image-toolkit-zoom');
    this.range(zoomBar, 'Zoom', 25, 300, this.zoom, 5, value => { this.zoom = value; this.draw(); }).title='100% fits both dimensions; scroll to pan above 100%';
    this.previewCaption=zoomBar.createDiv('image-toolkit-preview-caption');
    this.scroll = viewport.createDiv('image-toolkit-scroll');
    const stage=this.scroll.createDiv('image-toolkit-stage');
    this.preview = stage.createEl('canvas', { attr: { tabindex: '0', 'aria-label': 'Image editing canvas. Drag crop handles; arrow keys nudge the selected corner.' } });
    this.preview.addEventListener('pointerdown', e => this.pointerDown(e));
    this.preview.addEventListener('pointermove', e => this.pointerMove(e));
    this.preview.addEventListener('pointerup', () => this.pointerUp());
    this.preview.addEventListener('pointercancel', () => this.pointerUp());
    this.preview.addEventListener('keydown', e => {
      if (this.busy) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void this.run(() => this.restore(e.shiftKey ? 1 : -1)); }
      if (this.tool === 'annotate' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); void this.run(() => this.removeSelected()); }
      if (this.tool === 'crop' && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        e.preventDefault(); const p = this.corners[this.activeCorner], d = e.shiftKey ? 10 : 1;
        p.x = clamp(p.x + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0), 0, this.working.width - 1);
        p.y = clamp(p.y + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0), 0, this.working.height - 1);
        if (this.mode === 'rectangle') this.rectangleFromCorner(this.activeCorner);
        this.draw(); this.scheduleBoardPreview();
      }
    });
    const sidebar=this.layout.createDiv('image-toolkit-sidebar');
    this.controls=sidebar.createDiv('image-toolkit-controls');
    this.toolActions=sidebar.createDiv('image-toolkit-tool-actions');
    const footer = this.contentEl.createDiv('image-toolkit-footer');
    const exportInfo=footer.createDiv('image-toolkit-export-info');
    const exportBar=exportInfo.createDiv('image-toolkit-export-bar');
    exportBar.createSpan({text:this.format.toUpperCase(),cls:'image-toolkit-format'}).title=`Original format preserved: ${this.file.path}`;
    if(this.format!=='png')this.range(exportBar,'Quality',10,100,this.quality,1,value=>{this.quality=value;this.refreshOutputSize();}).title='Encoded preview updates after 300 ms';
    this.outputInfo=exportBar.createSpan({cls:'image-toolkit-output-info'});
    this.status=exportInfo.createDiv('image-toolkit-status');this.status.setAttribute('role','status');
    this.status.setText(`Original ${this.bytes(this.original.byteLength)} · replaces original · backup ${this.options.backupEnabled?'on':'off'}`);
    this.status.title=`Apply crop/resize before saving. Pending photo adjustments are included automatically. All notes using this image are affected. ${this.options.backupEnabled?`Backups: ${this.options.backupFolder}`:'Backups disabled in plugin settings.'}`;
    const saveActions=footer.createDiv('image-toolkit-save-actions');
    this.button(saveActions, 'Cancel', () => this.close());
    this.button(saveActions, 'Save image', () => this.save(), true).title=`Replace ${this.file.path}. ${this.options.backupEnabled?`Back up to ${this.options.backupFolder} first.`:'Backups are disabled.'}`;
    this.resizeObserver?.disconnect();
    this.resizeObserver=new ResizeObserver(()=>this.draw());this.resizeObserver.observe(this.scroll);
    this.renderControls();
  }

  private label(parent: HTMLElement, text: string) { return parent.createEl('label', { text, cls: 'image-toolkit-field' }); }
  private number(parent: HTMLElement, label: string, value: number, onChange: (v:number) => void, min = 1, max = MAX_SIDE) {
    const field = this.label(parent, label); const input = field.createEl('input', { type: 'number', value: String(value), attr: { min: String(min), max: String(max), step: '1' } });
    input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n)); }); return input;
  }
  private range(parent: HTMLElement, text: string, min: number, max: number, value: number, step: number, change: (n:number)=>void) {
    const suffix=text==='Zoom'?'%':'';
    const label = this.label(parent, `${text}: ${value}${suffix}`); const title = label.firstChild!;
    const input = label.createEl('input', { type:'range', value:String(value), attr:{min:String(min),max:String(max),step:String(step)} });
    input.addEventListener('input', () => { title.textContent = `${text}: ${input.value}${suffix}`; change(Number(input.value)); }); return input;
  }
  private check(parent: HTMLElement, text: string, value: boolean, change: (v:boolean)=>void) {
    const label = this.label(parent, text); const input = label.createEl('input',{type:'checkbox'}); input.checked=value; input.addEventListener('change',()=>change(input.checked)); return input;
  }
  private select(parent: HTMLElement, label: string, values: Record<string,string>, value:string, change:(v:string)=>void) {
    const field = this.label(parent,label), select = field.createEl('select');
    for (const [key,text] of Object.entries(values)) select.createEl('option',{text,value:key}); select.value=value; select.addEventListener('change',()=>change(select.value)); return select;
  }

  private details(parent:HTMLElement,title:string,open=false) {
    const details=parent.createEl('details',{cls:'image-toolkit-details'});details.open=open;
    details.createEl('summary',{text:title});return details.createDiv();
  }
  private renderControls() {
    if (!this.controls) return;
    this.controls.empty();this.controls.removeAttribute('title');this.toolActions.empty();this.boardPreview=undefined;this.magnifier=undefined;
    this.layout.toggleClass('image-toolkit-image-only',this.tool==='compress');
    this.contentEl.querySelectorAll<HTMLElement>('[data-tool]').forEach(el => {el.toggleClass('is-active',el.dataset.tool===this.tool);el.setAttribute('aria-pressed',String(el.dataset.tool===this.tool));});
    if (this.tool === 'resize') this.resizeControls();
    if (this.tool === 'crop') this.cropControls();
    if (this.tool === 'annotate') this.annotationControls();
    if (this.tool === 'adjust') this.adjustmentControls();
    if(this.busy)this.setEnabled(false);
  }

  private async selectTool(tool:Tool) {
    if(tool!==this.tool&&hasAdjustments(this.adjustments))await this.applyAdjustments();
    if(this.closed||this.busy)return;
    this.tool=tool;this.selected=-1;this.renderControls();this.draw();
  }
  private adjustmentControls() {
    const controls:[keyof BasicAdjustments,string,number,number,number,string][]=[
      ['exposure','Exposure',-3,3,0.1,'Exposure in EV (stops).'],
      ['brightness','Brightness',-100,100,1,'Lift or darken overall brightness.'],
      ['contrast','Contrast',-100,100,1,'Increase or soften midtone contrast.'],
      ['saturation','Saturation',-100,100,1,'-100 removes color; 0 preserves it.'],
      ['warmth','Warmth',-100,100,1,'Cooler blues to warmer reds.'],
      ['sharpen','Sharpen',0,100,1,'Strengthen fine edges. Cannot recover lost focus.']
    ];
    for(const [key,label,min,max,step,help] of controls){
      const input=this.range(this.controls,label,min,max,this.adjustments[key],step,value=>{this.adjustments={...this.adjustments,[key]:value};this.refreshOutputSize();});
      input.dataset.adjustment=key;input.title=help;
    }
    this.controls.createDiv({text:'Live preview · undoable on Apply',cls:'image-toolkit-hint'}).title='Apply commits one history step. Switching tools or saving also applies pending adjustments. Undo first clears an unapplied preview.';
    const actions=this.toolActions.createDiv('image-toolkit-adjustment-actions');
    this.button(actions,'Reset sliders',()=>{this.adjustments={...DEFAULT_ADJUSTMENTS};this.renderControls();this.refreshOutputSize();});
    this.button(actions,'Apply',()=>this.applyAdjustments(),true).setAttribute('aria-label','Apply adjustments');
  }
  private applyAdjustments() {return this.exclusive(()=>this.applyAdjustmentRaster());}
  private async applyAdjustmentRaster() {
    if(!hasAdjustments(this.adjustments))return;
    this.status.setText('Applying adjustments…');
    const out=await this.adjustedRaster();if(this.closed)return;
    await this.replaceRaster(out);
  }

  private resizeControls() {
    let width=this.working.width,height=this.working.height,lock=true,upscale=false;
    const ratio=width/height;
    let wi:HTMLInputElement,hi:HTMLInputElement;
    wi=this.number(this.controls,'Width (px)',width,v=>{width=v;if(lock){height=Math.max(1,Math.round(width/ratio));hi.value=String(height);}});
    hi=this.number(this.controls,'Height (px)',height,v=>{height=v;if(lock){width=Math.max(1,Math.round(height*ratio));wi.value=String(width);}});
    this.number(this.controls,'Scale (%)',100,v=>{width=Math.max(1,Math.round(this.working.width*v/100));height=Math.max(1,Math.round(this.working.height*v/100));wi.value=String(width);hi.value=String(height);},1,500);
    this.check(this.controls,'Lock aspect ratio',lock,v=>{lock=v;});
    this.check(this.controls,'Allow enlargement',upscale,v=>{upscale=v;});
    this.button(this.toolActions,'Apply resize',()=>this.exclusive(async()=>{
      width=Number(wi.value);height=Number(hi.value);
      if(!Number.isInteger(width)||!Number.isInteger(height))throw new Error('Use whole-pixel dimensions.');
      if(!upscale&&(width>this.working.width||height>this.working.height))throw new Error('Enable enlargement to upscale.');
      const out=canvas(width,height), c=ctx(out);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(this.composite(),0,0,width,height);
      await this.replaceRaster(out);
    }),true);
  }

  private cropControls() {
    let inspectors:HTMLElement=this.controls;
    this.select(this.controls,'Mode',{rectangle:'Rectangle crop',board:'Board'},this.mode,v=>{this.mode=v as BoardMode;this.renderControls();this.draw();}).title='Drag to draw a rectangle, then refine corners. Arrow keys nudge; Apply commits the crop.';
    this.controls.createDiv({text:'Drag to select · refine corners',cls:'image-toolkit-hint'}).title='Drag away from a handle to draw a rectangle. Drag handles independently in Board mode. Arrow keys: 1px; Shift+arrow: 10px. Apply before Save.';
    if(this.mode==='rectangle') {
      this.select(this.controls,'Aspect preset',{free:'Free',square:'1:1',landscape:'4:3',wide:'16:9',portrait:'3:4'},'free',v=>{
        const ratio=({square:1,landscape:4/3,wide:16/9,portrait:3/4} as Record<string,number>)[v];
        if(!ratio)return;
        let w=this.working.width-1,h=w/ratio;if(h>this.working.height-1){h=this.working.height-1;w=h*ratio;}
        const x=(this.working.width-1-w)/2,y=(this.working.height-1-h)/2;
        this.corners=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];this.draw();
      });
      this.controls.title='Aspect presets start a centered crop; subsequent dragging remains freeform.';
    } else {
      const background=this.select(this.controls,'Background',{white:'White',black:'Black'},this.boardBackground,v=>{this.boardBackground=v as 'white'|'black';this.scheduleBoardPreview();});
      background.setAttribute('aria-label','Board background');background.title='White: dark writing. Black: light writing.';
      this.range(this.controls,'Enhance',0,100,Math.round(this.strength*100),1,v=>{this.strength=v/100;this.scheduleBoardPreview();}).title='0 leaves the rectified image unchanged; higher values clean the background and strengthen writing.';
      inspectors=this.controls.createDiv('image-toolkit-crop-previews');
      const board=inspectors.createDiv();board.createDiv({text:'Board preview',cls:'image-toolkit-inspector-label'});
      this.boardPreview=board.createEl('canvas',{cls:'image-toolkit-board-preview',attr:{'aria-label':'Rectified board preview'}});
      this.scheduleBoardPreview();
    }
    const precision=this.details(inspectors,'Corner precision',true);
    this.magnifier=precision.createEl('canvas',{cls:'image-toolkit-magnifier',attr:{'aria-label':'Selected corner magnifier'}});this.magnifier.width=160;this.magnifier.height=120;
    if(this.mode==='board'){
      const output=this.details(this.controls,'Output size');
      this.number(output,'Width',this.boardWidth,value=>{this.boardWidth=value;this.scheduleBoardPreview();},0).title='Output pixels; 0 = automatic. Set one dimension to preserve the estimated ratio.';
      this.number(output,'Height',this.boardHeight,value=>{this.boardHeight=value;this.scheduleBoardPreview();},0).title='Output pixels; 0 = automatic.';
    }
    const cropActions=this.toolActions.createDiv('image-toolkit-crop-actions');
    this.button(cropActions,'Reset corners',()=>{this.resetCorners();this.draw();this.scheduleBoardPreview();});
    this.button(cropActions,'Apply crop',()=>this.exclusive(()=>this.applyCrop()),true).setAttribute('aria-label','Apply crop / board correction');
    const transforms=this.toolActions.createDiv('image-toolkit-transform');
    const actions:[string,'left'|'right'|'horizontal'|'vertical',string][]=[['↶','left','Rotate left 90°'],['↷','right','Rotate right 90°'],['↔','horizontal','Flip horizontally'],['↕','vertical','Flip vertically']];
    for(const [icon,kind,label] of actions){const button=this.button(transforms,icon,()=>this.transform(kind));button.title=label;button.setAttribute('aria-label',label);}
  }

  private annotationControls() {
    const tools=this.controls.createDiv('image-toolkit-annotation-tools');tools.setAttribute('role','group');tools.setAttribute('aria-label','Annotation tools');
    const choices:[MarkKind|'select',string,string][]=[['select','mouse-pointer-2','Select / move'],['pen','pencil','Pen'],['highlighter','highlighter','Highlighter'],['arrow','move-up-right','Arrow'],['rectangle','square','Rectangle'],['ellipse','circle','Ellipse'],['text','type','Text']];
    for(const [kind,icon,label] of choices){
      const button=this.button(tools,'',()=>{this.markTool=kind;this.selected=-1;this.renderControls();this.draw();});
      setIcon(button,icon);button.dataset.annotationTool=kind;button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(this.markTool===kind));button.toggleClass('is-active',this.markTool===kind);
    }
    const mark=this.markTool==='select'?this.marks[this.selected]:undefined;
    const changed=()=>{if(mark)this.refreshOutputSize();};
    const commit=()=>{if(mark)void this.run(()=>this.exclusive(async()=>{await this.checkpoint();this.refreshOutputSize();}));};
    const color=this.label(this.controls,'Color').createEl('input',{type:'color',value:mark?.color||this.color});
    color.addEventListener('input',()=>{this.color=color.value;if(mark)mark.color=color.value;changed();});color.addEventListener('change',commit);
    if(mark?.kind==='text'||this.markTool==='text'){
      const size=mark?.kind==='text'?mark.width:this.fontSize;
      const input=this.range(this.controls,'Text size',10,Math.max(256,Math.ceil(size)),size,1,value=>{this.fontSize=value;if(mark?.kind==='text')mark.width=value;changed();});input.addEventListener('change',commit);
    }else{
      const width=mark?.width||this.lineWidth;
      const input=this.range(this.controls,'Stroke width',1,Math.max(40,Math.ceil(width)),width,1,value=>{this.lineWidth=value;if(mark)mark.width=value;changed();});input.addEventListener('change',commit);
    }
    this.controls.createDiv({text:this.markTool==='select'?'Drag to move · handles to reshape':'Drag to draw · click for text',cls:'image-toolkit-hint'}).title='Select a mark to move, resize or change its style. Arrows have endpoint handles. Text can also be edited. Delete removes the selection.';
    if(mark?.kind==='text')this.button(this.toolActions,'Edit text',()=>this.editSelectedText());
    this.button(this.toolActions,'Delete selected',()=>this.removeSelected());
  }

  private async editSelectedText() {
    const index=this.selected,mark=this.marks[index];if(mark?.kind!=='text')return;
    const text=await this.askText(mark.text||'');if(!text||this.closed||this.marks[index]!==mark)return;
    await this.exclusive(async()=>{mark.text=text;await this.checkpoint();this.renderControls();this.refreshOutputSize();});
  }
  private measureText=(text:string,fontSize:number)=>{const context=ctx(this.working);context.font=`${fontSize}px sans-serif`;return context.measureText(text).width;};
  private selectionHandle(point:Point) {
    const mark=this.marks[this.selected];if(!mark)return undefined;
    const radius=12*this.working.width/this.preview.getBoundingClientRect().width;
    const handles=selectionHandles(mark,this.bounds(mark));
    const closest=handles.reduce<(typeof handles)[number]|undefined>((best,handle)=>!best||Math.hypot(handle.point.x-point.x,handle.point.y-point.y)<Math.hypot(best.point.x-point.x,best.point.y-point.y)?handle:best,undefined);
    return closest&&Math.hypot(closest.point.x-point.x,closest.point.y-point.y)<=radius?closest:undefined;
  }

  private resetCorners() {
    const w=this.working.width-1,h=this.working.height-1;
    this.corners=[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];this.activeCorner=0;
  }
  private rectangleFromCorner(i:number) {
    const opposite=this.corners[(i+2)%4],p=this.corners[i];
    this.corners[(i+1)%4]=i%2===0?{x:opposite.x,y:p.y}:{x:p.x,y:opposite.y};
    this.corners[(i+3)%4]=i%2===0?{x:p.x,y:opposite.y}:{x:opposite.x,y:p.y};
  }
  private position(e:PointerEvent):Point {
    const r=this.preview.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width*this.working.width,0,this.working.width-1),y:clamp((e.clientY-r.top)/r.height*this.working.height,0,this.working.height-1)};
  }
  private pointerDown(e:PointerEvent) {
    if(this.busy||e.button!==0)return;
    e.preventDefault();this.preview.focus();this.preview.setPointerCapture(e.pointerId);const p=this.position(e);
    if(this.tool==='crop') {
      const r=this.preview.getBoundingClientRect(),radius=22*this.working.width/r.width;
      let closest=-1,distance=Infinity;this.corners.forEach((c,i)=>{const d=Math.hypot(c.x-p.x,c.y-p.y);if(d<distance){distance=d;closest=i;}});
      if(distance<=radius){this.activeCorner=closest;this.dragging={corner:closest,point:p};}
      else {this.corners=rectangleCorners(p,p);this.activeCorner=2;this.dragging={corner:2,point:p,rectangle:true};}
      this.draw();return;
    }
    if(this.tool!=='annotate')return;
    ++this.sizeVersion;window.clearTimeout(this.estimateTimer);this.invalidateEncodedPreview();
    if(this.markTool==='select') {
      const handle=this.selectionHandle(p);
      if(handle){const mark=this.marks[this.selected];this.dragging={mark:this.selected,point:p,handle:handle.id,originalMark:clone(mark),bounds:this.bounds(mark)};this.draw();return;}
      const previous=this.selected;this.selected=-1;
      const tolerance=8*this.working.width/this.preview.getBoundingClientRect().width;
      for(let i=this.marks.length-1;i>=0;i--){if(hitTestMark(this.marks[i],p,tolerance,this.measureText)){this.selected=i;break;}}
      if(this.selected<0&&this.marks[previous]){const bounds=this.bounds(this.marks[previous]);if(p.x>=bounds.x&&p.x<=bounds.x+bounds.w&&p.y>=bounds.y&&p.y<=bounds.y+bounds.h)this.selected=previous;}
      if(this.selected>=0)this.dragging={mark:this.selected,point:p,originalMark:clone(this.marks[this.selected])};
      this.renderControls();this.draw();return;
    }
    if(this.markTool==='text') {
      this.askText().then(text=>{if(text&&!this.closed){this.marks.push({kind:'text',points:[p],text,color:this.color,width:this.fontSize});this.selected=this.marks.length-1;this.draw();void this.run(()=>this.exclusive(async()=>{await this.checkpoint();this.refreshOutputSize();}));}});return;
    }
    const mark:Mark={kind:this.markTool,points:[p,{...p}],color:this.color,width:this.lineWidth};
    this.marks.push(mark);this.selected=this.marks.length-1;this.dragging={mark:this.selected,point:p,drawing:true};this.draw();
  }
  private pointerMove(e:PointerEvent) {
    if(this.busy)return;const p=this.position(e),d=this.dragging;
    if(!d){
      const handle=this.tool==='annotate'&&this.markTool==='select'?this.selectionHandle(p):undefined;
      this.preview.style.cursor=handle?(handle.id==='nw'||handle.id==='se'?'nwse-resize':handle.id==='ne'||handle.id==='sw'?'nesw-resize':'crosshair'):this.tool==='annotate'&&this.markTool==='select'?'move':'crosshair';return;
    }
    if(d.corner!==undefined){if(d.rectangle)this.corners=rectangleCorners(d.point,p);else{this.corners[d.corner]=p;if(this.mode==='rectangle')this.rectangleFromCorner(d.corner);}this.draw();this.scheduleBoardPreview();return;}
    if(d.mark!==undefined){
      const mark=this.marks[d.mark];
      if(d.drawing){if(mark.kind==='pen'||mark.kind==='highlighter')mark.points.push(p);else mark.points[1]=p;}
      else if(d.originalMark){
        if(d.handle==='start'||d.handle==='end'){
          const reshaped=clone(d.originalMark);reshaped.points[d.handle==='start'?0:reshaped.points.length-1]=p;this.marks[d.mark]=reshaped;
        }else if(d.handle&&d.bounds)this.marks[d.mark]=resizeMark(d.originalMark,d.bounds,resizeBounds(d.bounds,d.handle,p));
        else this.marks[d.mark]=moveMark(d.originalMark,p.x-d.point.x,p.y-d.point.y);
      }
      this.draw();
    }
  }
  private pointerUp() {
    const annotation=this.dragging?.mark!==undefined;this.dragging=undefined;
    if(annotation)void this.run(()=>this.exclusive(async()=>{await this.checkpoint();if(this.markTool==='select')this.renderControls();this.refreshOutputSize();}));
    else if(this.tool==='annotate')this.refreshOutputSize();
  }

  private draw() {
    if(!this.preview||!this.working||this.closed)return;
    const size=fitPreviewSize(this.working.width,this.working.height,this.scroll.clientWidth||600,this.scroll.clientHeight||400,this.zoom);
    const ratio=this.preview.ownerDocument.defaultView?.devicePixelRatio||1;
    const backingScale=Math.min(ratio,4096/Math.max(size.width,size.height));
    this.preview.width=Math.max(1,Math.round(size.width*backingScale));this.preview.height=Math.max(1,Math.round(size.height*backingScale));
    this.preview.style.width=`${size.width}px`;this.preview.style.height=`${size.height}px`;
    const c=ctx(this.preview);c.scale(this.preview.width/this.working.width,this.preview.height/this.working.height);c.drawImage(this.encodedPreview||this.working,0,0);if(!this.encodedPreview)this.paintMarks(c);
    const unit=this.working.width/size.width;
    if(this.tool==='crop') {
      c.beginPath();this.corners.forEach((p,i)=>i===0?c.moveTo(p.x,p.y):c.lineTo(p.x,p.y));c.closePath();c.strokeStyle=isValidQuad(this.corners)?'#00b8ff':'#ff4141';c.lineWidth=2*unit;c.stroke();
      this.corners.forEach((p,i)=>{c.beginPath();c.arc(p.x,p.y,8*unit,0,Math.PI*2);c.fillStyle=i===this.activeCorner?'#ffcc00':'#fff';c.fill();c.strokeStyle='#111';c.lineWidth=unit;c.stroke();c.fillStyle='#111';c.font=`${10*unit}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(i+1),p.x,p.y);});
      this.drawMagnifier();
    }
    if(this.tool==='annotate'&&this.selected>=0&&this.marks[this.selected]){
      const mark=this.marks[this.selected],b=this.bounds(mark);c.strokeStyle='#00b8ff';c.lineWidth=1.5*unit;c.setLineDash([5*unit,4*unit]);c.strokeRect(b.x,b.y,b.w,b.h);c.setLineDash([]);
      if(this.markTool==='select')for(const handle of selectionHandles(mark,b)){c.beginPath();c.arc(handle.point.x,handle.point.y,5*unit,0,Math.PI*2);c.fillStyle='#fff';c.fill();c.strokeStyle='#0077c8';c.stroke();}
    }
  }
  private drawMagnifier() {
    if(!this.magnifier)return;const p=this.corners[this.activeCorner],c=ctx(this.magnifier);
    c.fillStyle='#777';c.fillRect(0,0,160,120);c.imageSmoothingEnabled=false;c.drawImage(this.working,p.x-20,p.y-15,40,30,0,0,160,120);c.strokeStyle='#ffcc00';c.lineWidth=1;c.beginPath();c.moveTo(80,0);c.lineTo(80,120);c.moveTo(0,60);c.lineTo(160,60);c.stroke();
  }
  private paintMarks(c:CanvasRenderingContext2D) {
    for(const mark of this.marks){c.save();c.strokeStyle=mark.color;c.fillStyle=mark.color;c.lineWidth=mark.width;c.lineCap='round';c.lineJoin='round';
      const a=mark.points[0],b=mark.points[mark.points.length-1];
      if(mark.kind==='text'){c.translate(a.x,a.y);c.scale(mark.textScaleX??1,1);c.font=`${mark.width}px sans-serif`;c.textBaseline='top';c.fillText(mark.text||'',0,0);}
      else if(mark.kind==='rectangle'){c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
      else if(mark.kind==='ellipse'){c.beginPath();c.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);c.stroke();}
      else {if(mark.kind==='highlighter'){c.globalAlpha=0.3;c.lineWidth=mark.width*3;}c.beginPath();mark.points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();
        if(mark.kind==='arrow'){const angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.max(12,mark.width*4);c.beginPath();c.moveTo(b.x-len*Math.cos(angle-0.5),b.y-len*Math.sin(angle-0.5));c.lineTo(b.x,b.y);c.lineTo(b.x-len*Math.cos(angle+0.5),b.y-len*Math.sin(angle+0.5));c.stroke();}}
      c.restore();}
  }
  private bounds(mark:Mark) {return markBounds(mark,this.measureText);}
  private composite(background?: string) {const out=canvas(this.working.width,this.working.height),c=ctx(out);if(background){c.fillStyle=background;c.fillRect(0,0,out.width,out.height);}c.drawImage(this.working,0,0);this.paintMarks(c);return out;}
  private async removeSelected() {if(this.selected<0)return;await this.exclusive(async()=>{this.marks.splice(this.selected,1);this.selected=-1;await this.checkpoint();this.renderControls();this.draw();this.refreshOutputSize();});}

  private async checkpoint() {
    const blob=await encode(this.working);if(this.closed)return;
    this.history=this.history.slice(0,this.historyIndex+1);this.history.push({blob,marks:clone(this.marks)});
    while(this.history.length>2&&(this.history.length>12||this.history.reduce((n,s)=>n+s.blob.size,0)>64*1024*1024))this.history.shift();
    this.historyIndex=this.history.length-1;
  }
  private async restore(delta:number) {await this.exclusive(async()=>{
    if(hasAdjustments(this.adjustments)){this.adjustments={...DEFAULT_ADJUSTMENTS};this.renderControls();this.refreshOutputSize();return;}
    const index=this.historyIndex+delta;if(index<0||index>=this.history.length)return;
    const state=this.history[index];this.working=await decode(state.blob);this.marks=clone(state.marks);this.historyIndex=index;this.selected=-1;this.resetCorners();this.renderControls();this.draw();this.refreshOutputSize();
  });}
  private async replaceRaster(out:HTMLCanvasElement) {
    this.working=out;this.adjustments={...DEFAULT_ADJUSTMENTS};this.marks=[];this.selected=-1;this.resetCorners();
    ++this.sizeVersion;window.clearTimeout(this.estimateTimer);this.invalidateEncodedPreview();await this.checkpoint();this.renderControls();this.draw();this.refreshOutputSize();this.status.setText(`Applied ${out.width} × ${out.height} · Undo to restore`);
  }
  private async transform(kind:'left'|'right'|'horizontal'|'vertical') {await this.exclusive(async()=>{
    const src=this.composite(),rotate=kind==='left'||kind==='right',out=canvas(rotate?src.height:src.width,rotate?src.width:src.height),c=ctx(out);
    if(kind==='right'){c.translate(out.width,0);c.rotate(Math.PI/2);}if(kind==='left'){c.translate(0,out.height);c.rotate(-Math.PI/2);}if(kind==='horizontal'){c.translate(out.width,0);c.scale(-1,1);}if(kind==='vertical'){c.translate(0,out.height);c.scale(1,-1);}c.drawImage(src,0,0);await this.replaceRaster(out);
  });}
  private boardSize() {
    const auto=estimateRectifiedSize(this.corners);let w=this.boardWidth||auto.width,h=this.boardHeight||auto.height;
    if(this.boardWidth&&!this.boardHeight)h=Math.round(w*auto.height/auto.width);
    if(this.boardHeight&&!this.boardWidth)w=Math.round(h*auto.width/auto.height);
    return{width:Math.max(2,Math.round(w)),height:Math.max(2,Math.round(h))};
  }
  private async applyCrop() {
    if(!isValidQuad(this.corners))throw new Error('Choose four non-crossing corners enclosing a usable area.');
    const src=this.composite();
    if(this.mode==='rectangle'){
      const xs=this.corners.map(p=>p.x),ys=this.corners.map(p=>p.y),x=Math.round(Math.min(...xs)),y=Math.round(Math.min(...ys)),w=Math.round(Math.max(...xs))-x+1,h=Math.round(Math.max(...ys))-y+1;
      const out=canvas(w,h);ctx(out).drawImage(src,x,y,w,h,0,0,w,h);await this.replaceRaster(out);return;
    }
    const size=this.boardSize();canvas(size.width,size.height); // Validate before worker allocation.
    const data=ctx(src).getImageData(0,0,src.width,src.height);
    this.status.setText('Correcting perspective and enhancing board…');
    const result=await this.process({data:data.data.buffer,width:src.width,height:src.height,corners:this.corners,outWidth:size.width,outHeight:size.height,mode:this.boardBackground==='white'?'whiteboard':'blackboard',strength:this.strength});
    if(this.closed)return;
    const out=canvas(result.width,result.height);ctx(out).putImageData(new ImageData(new Uint8ClampedArray(result.data),result.width,result.height),0,0);await this.replaceRaster(out);
  }

  private scheduleBoardPreview() {
    window.clearTimeout(this.previewTimer);const version=++this.previewVersion;
    if(this.mode==='rectangle'||!this.boardPreview)return;
    this.previewTimer=window.setTimeout(()=>void this.run(async()=>{
      if(this.closed||this.busy||this.previewRunning||!isValidQuad(this.corners))return;
      if(this.mode==='rectangle')return;
      const mode=this.boardBackground==='white'?'whiteboard':'blackboard';
      this.previewRunning=true;
      try {
      const scale=Math.min(1,900/Math.max(this.working.width,this.working.height));
      const src=canvas(Math.max(2,Math.round(this.working.width*scale)),Math.max(2,Math.round(this.working.height*scale)));
      const c=ctx(src);c.scale(src.width/this.working.width,src.height/this.working.height);c.drawImage(this.working,0,0);this.paintMarks(c);
      const points=this.corners.map(p=>({x:p.x*(src.width-1)/Math.max(1,this.working.width-1),y:p.y*(src.height-1)/Math.max(1,this.working.height-1)}));
      const size=this.boardSize(),s=Math.min(1,700/Math.max(size.width,size.height));
      const result=await this.process({data:ctx(src).getImageData(0,0,src.width,src.height).data.buffer,width:src.width,height:src.height,corners:points,outWidth:Math.max(2,Math.round(size.width*s)),outHeight:Math.max(2,Math.round(size.height*s)),mode,strength:this.strength});
      if(version!==this.previewVersion||this.closed||!this.boardPreview)return;
      this.boardPreview.width=result.width;this.boardPreview.height=result.height;ctx(this.boardPreview).putImageData(new ImageData(new Uint8ClampedArray(result.data),result.width,result.height),0,0);
      } finally { this.previewRunning=false; if(!this.closed&&version!==this.previewVersion)this.scheduleBoardPreview(); }
    }),180);
  }
  private stopWorker(error: Error) {
    this.worker?.terminate();this.worker=undefined;this.workerReady=undefined;
    if(this.workerUrl){URL.revokeObjectURL(this.workerUrl);this.workerUrl=undefined;}
    for(const job of this.jobs.values()){window.clearTimeout(job.timer);job.reject(error);}this.jobs.clear();
  }
  private async process(request:Omit<ProcessingRequest,'id'|'data'>&{data:ArrayBufferLike}) {
    if(!this.workerReady)this.workerReady=(async()=>{
      if(this.closed)throw new Error('Editor closed.');
      this.workerUrl=URL.createObjectURL(new Blob([processingWorkerSource],{type:'text/javascript'}));
      const worker=new Worker(this.workerUrl);this.worker=worker;
      worker.onmessage=event=>{if(this.worker!==worker)return;const r=event.data,job=this.jobs.get(r.id);if(!job)return;this.jobs.delete(r.id);window.clearTimeout(job.timer);r.error?job.reject(new Error(r.error)):job.resolve(r);};
      worker.onerror=event=>{if(this.worker===worker)this.stopWorker(new Error(event.message||'Background processing failed.'));};
    })().catch(error=>{this.stopWorker(error);throw error;});
    await this.workerReady;
    if(this.closed||!this.worker)throw new Error('Background processor is unavailable.');
    const worker=this.worker,id=++this.workerSequence;
    return new Promise<{data:ArrayBuffer;width:number;height:number}>((resolve,reject)=>{
      const timer=window.setTimeout(()=>this.stopWorker(new Error('Board processing timed out. Try a smaller image.')),60000);
      this.jobs.set(id,{resolve,reject,timer});
      try {worker.postMessage({...request,id},[request.data as ArrayBuffer]);} catch(error){window.clearTimeout(timer);this.jobs.delete(id);reject(error);}
    });
  }

  private async adjustedRaster(background?:string) {
    const adjustments={...this.adjustments},out=this.composite(background);
    if(hasAdjustments(adjustments)){
      const pixels=ctx(out).getImageData(0,0,out.width,out.height);
      const result=await this.process({data:pixels.data.buffer,width:out.width,height:out.height,adjustments});
      if(this.closed)throw new Error('Editor closed.');
      ctx(out).putImageData(new ImageData(new Uint8ClampedArray(result.data),result.width,result.height),0,0);
    }
    return out;
  }
  private async outputBlob() {
    const out=await this.adjustedRaster(this.format==='jpg'?'#fff':undefined);
    const type=`image/${this.format==='jpg'?'jpeg':this.format}`;
    const blob=await encode(out,type,this.quality/100);
    if(blob.type!==type)throw new Error(`This Obsidian version cannot encode ${this.format.toUpperCase()}. The original was not overwritten.`);
    return blob;
  }
  private invalidateEncodedPreview() {
    this.encodedPreview?.close();this.encodedPreview=undefined;
    this.previewCaption?.setText('Updating…');this.draw();
  }
  private refreshOutputSize() {
    ++this.sizeVersion;window.clearTimeout(this.estimateTimer);this.invalidateEncodedPreview();
    this.estimateTimer=window.setTimeout(()=>void this.run(()=>this.estimateOutput()),300);
  }
  private async estimateOutput() {
    if(this.closed||this.dragging)return;
    if(this.estimating){this.estimateAgain=true;return;}
    this.estimating=true;
    try {do {
      if(this.dragging)return;
      this.estimateAgain=false;const version=this.sizeVersion;
      const blob=await this.outputBlob();if(this.closed)return;
      if(version!==this.sizeVersion){this.estimateAgain=true;continue;}
      const decoded=await createImageBitmap(blob);
      if(this.closed){decoded.close();return;}
      if(version!==this.sizeVersion||this.dragging){decoded.close();this.estimateAgain=true;continue;}
      this.encodedPreview?.close();this.encodedPreview=decoded;this.draw();
      this.previewCaption.setText(`${this.format.toUpperCase()}${this.format==='png'?' · lossless':` · quality ${this.quality}`}${hasAdjustments(this.adjustments)?' · adjusted':''}`);
      this.previewCaption.title='Actual encoded preview. 100% zoom fits both dimensions.';
      const diff=Math.round((blob.size/this.original.byteLength-1)*100);
      this.outputInfo.setText(`${this.working.width} × ${this.working.height} · ${this.bytes(blob.size)} (${diff>=0?'+':''}${diff}%)${diff>0?' ↑':''}`);
    } while(this.estimateAgain&&!this.closed);
    } finally {this.estimating=false;}
  }
  private bytes(n:number) {return n>=1024*1024?`${(n/1024/1024).toFixed(2)} MB`:`${(n/1024).toFixed(1)} KB`;}
  private async compare() {
    const modal=new Modal(this.app);modal.titleEl.setText('Before / after (current export settings)');modal.modalEl.addClass('image-toolkit-compare');
    const output=await this.outputBlob();if(this.closed)return;
    const urls=[URL.createObjectURL(new Blob([this.original])),URL.createObjectURL(output)];
    const row=modal.contentEl.createDiv('image-toolkit-comparison');
    ['Original','Output'].forEach((text,i)=>{const col=row.createDiv();col.createEl('h3',{text});col.createEl('img',{attr:{src:urls[i],alt:text}});});
    this.childModals.add(modal);modal.onClose=()=>{this.childModals.delete(modal);urls.forEach(url=>URL.revokeObjectURL(url));};modal.open();
  }
  private askText(initial=''):Promise<string|null> {
    return new Promise(resolve=>{const modal=new Modal(this.app);modal.titleEl.setText('Annotation text');const input=modal.contentEl.createEl('input',{type:'text',value:initial,attr:{placeholder:'Enter text','aria-label':'Annotation text'}});let result:string|null=null;
      const add=modal.contentEl.createEl('button',{text:initial?'Apply text':'Add text',cls:'mod-cta'});const submit=()=>{result=input.value.trim();modal.close();};add.onclick=submit;input.onkeydown=e=>{if(e.key==='Enter')submit();};this.childModals.add(modal);modal.onClose=()=>{this.childModals.delete(modal);resolve(result);};modal.open();input.focus();});
  }
  private async prepareBackupPreferences():Promise<boolean> {
    const current=this.options.getBackupPreferences?.()||{backupEnabled:this.options.backupEnabled,backupFolder:this.options.backupFolder,backupConfigured:this.options.backupConfigured===true};
    let preferences:BackupPreferences=current;
    if(!current.backupConfigured){
      const choice=await new Promise<BackupPreferences|null>(resolve=>{
        const dialog=new BackupPrompt(this.app,current,result=>{this.childModals.delete(dialog);resolve(result);});
        this.childModals.add(dialog);dialog.open();
      });
      if(!choice||this.closed)return false;
      await this.options.saveBackupPreferences?.(choice);
      if(this.closed)return false;
      preferences=choice;
    }
    Object.assign(this.options,preferences,{backupConfigured:true});return !this.closed;
  }
  private async save() {
    await this.exclusive(async()=>{
      if(this.closed||!await this.prepareBackupPreferences())return;
      await this.applyAdjustmentRaster();if(this.closed)return;
      const blob=await this.outputBlob();if(this.closed)return;
      const output=await blob.arrayBuffer();if(this.closed)return;
      const result=await saveImage(this.app,this.file,this.original,output,{backupEnabled:this.options.backupEnabled,backupFolder:this.options.backupFolder});
      new Notice(`Replaced ${result.path}${result.backupPath?`\nBackup: ${result.backupPath}`:''}`,8000);
      this.close();
    });
  }
}
