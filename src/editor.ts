import { Modal, Notice, type App, type TFile } from 'obsidian';
import { assertStaticImage } from './embeds';
import { estimateRectifiedSize, isValidQuad, MAX_PIXELS, MAX_DIMENSION as MAX_SIDE, type Point } from './processing';
import { saveImage } from './storage';
import { fitPreviewSize, rectangleCorners } from './preview';

export type Tool = 'compress' | 'resize' | 'crop' | 'annotate';
export interface EditorOptions { tool: Tool; quality: number; backupEnabled: boolean; backupFolder: string; pluginDir: string }
type BoardMode = 'rectangle' | 'board';
type MarkKind = 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'ellipse' | 'text';
interface Mark { kind: MarkKind; points: Point[]; color: string; width: number; text?: string }
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
  private dragging?: { corner?: number; mark?: number; point: Point; drawing?: boolean; rectangle?: boolean; originalPoints?: Point[] };
  private history: Snapshot[] = [];
  private historyIndex = -1;
  private busy = false;
  private closed = false;
  private readonly format: 'jpg' | 'png' | 'webp';
  private quality: number;
  private zoom = 100;
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
    for (const [id, title] of [['compress','Compress'],['resize','Resize'],['crop','Crop / board'],['annotate','Annotate']] as [Tool,string][]) {
      const b = this.button(toolbar, title, () => { this.tool = id; this.selected = -1; this.renderControls(); this.draw(); });
      b.dataset.tool = id;
    }
    this.button(toolbar, 'Undo', () => this.restore(-1));
    this.button(toolbar, 'Redo', () => this.restore(1));
    this.button(toolbar, 'Reset', () => this.exclusive(async () => {
      this.working = await decode(new Blob([this.original])); this.marks = []; this.resetCorners(); await this.checkpoint(); this.renderControls(); this.draw(); this.refreshOutputSize();
    }));
    const layout = this.contentEl.createDiv('image-toolkit-layout');
    const viewport = layout.createDiv('image-toolkit-viewport');
    const zoomBar = viewport.createDiv('image-toolkit-zoom');
    this.range(zoomBar, 'Zoom (100% = fit)', 25, 300, this.zoom, 5, value => { this.zoom = value; this.draw(); });
    this.previewCaption=viewport.createDiv('image-toolkit-preview-caption');
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
    this.controls = layout.createDiv('image-toolkit-controls');
    this.status = this.contentEl.createDiv('image-toolkit-status');
    this.status.setAttribute('role', 'status');
    this.status.setText(`Original: ${this.working.width} × ${this.working.height} · ${this.bytes(this.original.byteLength)}. Crop / resize controls require Apply before saving.`);
    const footer = this.contentEl.createDiv('image-toolkit-footer');
    this.outputInfo = footer.createSpan();
    this.button(footer, 'Cancel', () => this.close());
    this.button(footer, 'Save image', () => this.save(), true);
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
    const label = this.label(parent, `${text}: ${value}`); const title = label.firstChild!;
    const input = label.createEl('input', { type:'range', value:String(value), attr:{min:String(min),max:String(max),step:String(step)} });
    input.addEventListener('input', () => { title.textContent = `${text}: ${input.value}`; change(Number(input.value)); }); return input;
  }
  private check(parent: HTMLElement, text: string, value: boolean, change: (v:boolean)=>void) {
    const label = this.label(parent, text); const input = label.createEl('input',{type:'checkbox'}); input.checked=value; input.addEventListener('change',()=>change(input.checked)); return input;
  }
  private select(parent: HTMLElement, label: string, values: Record<string,string>, value:string, change:(v:string)=>void) {
    const field = this.label(parent,label), select = field.createEl('select');
    for (const [key,text] of Object.entries(values)) select.createEl('option',{text,value:key}); select.value=value; select.addEventListener('change',()=>change(select.value)); return select;
  }

  private renderControls() {
    if (!this.controls) return;
    this.controls.empty(); this.boardPreview = undefined; this.magnifier = undefined;
    this.contentEl.querySelectorAll<HTMLElement>('[data-tool]').forEach(el => el.toggleClass('is-active', el.dataset.tool === this.tool));
    if (this.tool === 'compress') {
      this.controls.createEl('h3',{text:'Compression / export'});
      this.controls.createEl('p',{text:'Quality changes update the actual encoded preview after 300 ms. JPEG/WebP quality affects output size; PNG remains lossless. Saving preserves the original format and replaces the same file. Metadata is not retained.'});
      this.button(this.controls,'Before / after',()=>this.compare());
    }
    if (this.tool === 'resize') this.resizeControls();
    if (this.tool === 'crop') this.cropControls();
    if (this.tool === 'annotate') this.annotationControls();
    this.controls.createEl('hr');
    this.controls.createEl('h3',{text:'Save'});
    this.controls.createEl('p',{text:`Format: ${this.format.toUpperCase()} (preserved). Save replaces ${this.file.path} for every note using it.`,cls:'image-toolkit-hint'});
    if (this.format !== 'png') this.range(this.controls,'Quality',10,100,this.quality,1,v=>{this.quality=v;this.refreshOutputSize();});
    this.controls.createEl('p',{text:this.options.backupEnabled?`A backup is saved to ${this.options.backupFolder} before every overwrite.`:'Backups are disabled in Image Toolkit settings. Saving permanently replaces the image.',cls:'image-toolkit-hint'});
  }

  private resizeControls() {
    this.controls.createEl('h3',{text:'Resize'});
    let width=this.working.width,height=this.working.height,lock=true,upscale=false;
    const ratio=width/height;
    let wi:HTMLInputElement,hi:HTMLInputElement;
    wi=this.number(this.controls,'Width (px)',width,v=>{width=v;if(lock){height=Math.max(1,Math.round(width/ratio));hi.value=String(height);}});
    hi=this.number(this.controls,'Height (px)',height,v=>{height=v;if(lock){width=Math.max(1,Math.round(height*ratio));wi.value=String(width);}});
    this.number(this.controls,'Scale (%)',100,v=>{width=Math.max(1,Math.round(this.working.width*v/100));height=Math.max(1,Math.round(this.working.height*v/100));wi.value=String(width);hi.value=String(height);},1,500);
    this.check(this.controls,'Lock aspect ratio',lock,v=>{lock=v;});
    this.check(this.controls,'Allow enlargement',upscale,v=>{upscale=v;});
    this.button(this.controls,'Apply resize',()=>this.exclusive(async()=>{
      width=Number(wi.value);height=Number(hi.value);
      if(!Number.isInteger(width)||!Number.isInteger(height))throw new Error('Use whole-pixel dimensions.');
      if(!upscale&&(width>this.working.width||height>this.working.height))throw new Error('Enable enlargement to upscale.');
      const out=canvas(width,height), c=ctx(out);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(this.composite(),0,0,width,height);
      await this.replaceRaster(out);
    }),true);
  }

  private cropControls() {
    this.controls.createEl('h3',{text:'Crop / straighten'});
    this.select(this.controls,'Mode',{rectangle:'Rectangle crop',board:'Board'},this.mode,v=>{this.mode=v as BoardMode;this.renderControls();this.draw();});
    this.controls.createEl('p',{text:'Drag anywhere away from a corner to draw an initial rectangle. Then drag each corner to match the board perspective. Arrow keys nudge a selected corner (Shift: 10px). Apply before saving.'});
    this.button(this.controls,'Reset corners',()=>{this.resetCorners();this.draw();this.scheduleBoardPreview();});
    if(this.mode==='rectangle') {
      this.select(this.controls,'Aspect preset',{free:'Free',square:'1:1',landscape:'4:3',wide:'16:9',portrait:'3:4'},'free',v=>{
        const ratio=({square:1,landscape:4/3,wide:16/9,portrait:3/4} as Record<string,number>)[v];
        if(!ratio)return;
        let w=this.working.width-1,h=w/ratio;if(h>this.working.height-1){h=this.working.height-1;w=h*ratio;}
        const x=(this.working.width-1-w)/2,y=(this.working.height-1-h)/2;
        this.corners=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];this.draw();
      });
      this.controls.createEl('small',{text:'Aspect presets initialize a centered crop; dragging remains freeform.'});
    } else {
      this.select(this.controls,'Board background',{white:'White — dark writing',black:'Black — light writing'},this.boardBackground,v=>{this.boardBackground=v as 'white'|'black';this.scheduleBoardPreview();});
      this.range(this.controls,'Enhancement strength',0,100,Math.round(this.strength*100),1,v=>{this.strength=v/100;this.scheduleBoardPreview();});
      this.number(this.controls,'Output width (0 = automatic)',this.boardWidth,v=>{this.boardWidth=v;this.scheduleBoardPreview();},0);
      this.number(this.controls,'Output height (0 = automatic)',this.boardHeight,v=>{this.boardHeight=v;this.scheduleBoardPreview();},0);
      this.controls.createEl('small',{text:'Set either dimension to preserve the estimated ratio, or both to choose an exact rectangle. Preview is reduced-resolution. Enhancement cannot recover glare or blur.'});
      this.boardPreview=this.controls.createEl('canvas',{cls:'image-toolkit-board-preview',attr:{'aria-label':'Rectified board preview'}});
      this.scheduleBoardPreview();
    }
    this.magnifier=this.controls.createEl('canvas',{cls:'image-toolkit-magnifier',attr:{'aria-label':'Selected corner magnifier'}});this.magnifier.width=160;this.magnifier.height=120;
    this.button(this.controls,'Apply crop / board correction',()=>this.exclusive(()=>this.applyCrop()),true);
    const transforms=this.controls.createDiv('image-toolkit-transform');
    this.button(transforms,'Rotate ↶',()=>this.transform('left'));
    this.button(transforms,'Rotate ↷',()=>this.transform('right'));
    this.button(transforms,'Flip ↔',()=>this.transform('horizontal'));
    this.button(transforms,'Flip ↕',()=>this.transform('vertical'));
  }

  private annotationControls() {
    this.controls.createEl('h3',{text:'Annotations'});
    this.select(this.controls,'Tool',{pen:'Pen',highlighter:'Highlighter',arrow:'Arrow',rectangle:'Rectangle',ellipse:'Ellipse',text:'Text',select:'Select / move'},this.markTool,v=>{this.markTool=v as typeof this.markTool;this.selected=-1;this.draw();});
    const color=this.label(this.controls,'Color').createEl('input',{type:'color',value:this.color});color.addEventListener('input',()=>{this.color=color.value;});
    this.range(this.controls,'Stroke width',1,40,this.lineWidth,1,v=>{this.lineWidth=v;});
    this.range(this.controls,'Text size',10,120,this.fontSize,1,v=>{this.fontSize=v;});
    this.controls.createEl('p',{text:'Drag to draw. Text prompts on click. Select / move: click an object, drag to move it, Delete to remove it. Raster operations flatten annotations; Undo restores them.'});
    this.button(this.controls,'Delete selected',()=>this.removeSelected());
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
      this.selected=-1;
      for(let i=this.marks.length-1;i>=0;i--){const b=this.bounds(this.marks[i]),pad=10*this.working.width/this.preview.getBoundingClientRect().width;if(p.x>=b.x-pad&&p.x<=b.x+b.w+pad&&p.y>=b.y-pad&&p.y<=b.y+b.h+pad){this.selected=i;break;}}
      if(this.selected>=0)this.dragging={mark:this.selected,point:p,originalPoints:clone(this.marks[this.selected].points)};
      this.draw();return;
    }
    if(this.markTool==='text') {
      this.askText().then(text=>{if(text&&!this.closed){this.marks.push({kind:'text',points:[p],text,color:this.color,width:this.fontSize});this.draw();void this.run(()=>this.exclusive(async()=>{await this.checkpoint();this.refreshOutputSize();}));}});return;
    }
    const mark:Mark={kind:this.markTool,points:[p,{...p}],color:this.color,width:this.lineWidth};
    this.marks.push(mark);this.selected=this.marks.length-1;this.dragging={mark:this.selected,point:p,drawing:true};this.draw();
  }
  private pointerMove(e:PointerEvent) {
    if(!this.dragging||this.busy)return;const p=this.position(e),d=this.dragging;
    if(d.corner!==undefined){if(d.rectangle)this.corners=rectangleCorners(d.point,p);else{this.corners[d.corner]=p;if(this.mode==='rectangle')this.rectangleFromCorner(d.corner);}this.draw();this.scheduleBoardPreview();return;}
    if(d.mark!==undefined){const mark=this.marks[d.mark];if(d.drawing){if(mark.kind==='pen'||mark.kind==='highlighter')mark.points.push(p);else mark.points[1]=p;}else if(d.originalPoints){const dx=p.x-d.point.x,dy=p.y-d.point.y;mark.points=d.originalPoints.map(v=>({x:v.x+dx,y:v.y+dy}));}this.draw();}
  }
  private pointerUp() {
    const annotation=this.dragging?.mark!==undefined;this.dragging=undefined;
    if(annotation)void this.run(()=>this.exclusive(async()=>{await this.checkpoint();this.refreshOutputSize();}));
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
    if(this.tool==='annotate'&&this.selected>=0&&this.marks[this.selected]){const b=this.bounds(this.marks[this.selected]);c.strokeStyle='#00b8ff';c.lineWidth=2*unit;c.setLineDash([6*unit,4*unit]);c.strokeRect(b.x-4*unit,b.y-4*unit,b.w+8*unit,b.h+8*unit);}
  }
  private drawMagnifier() {
    if(!this.magnifier)return;const p=this.corners[this.activeCorner],c=ctx(this.magnifier);
    c.fillStyle='#777';c.fillRect(0,0,160,120);c.imageSmoothingEnabled=false;c.drawImage(this.working,p.x-20,p.y-15,40,30,0,0,160,120);c.strokeStyle='#ffcc00';c.lineWidth=1;c.beginPath();c.moveTo(80,0);c.lineTo(80,120);c.moveTo(0,60);c.lineTo(160,60);c.stroke();
  }
  private paintMarks(c:CanvasRenderingContext2D) {
    for(const mark of this.marks){c.save();c.strokeStyle=mark.color;c.fillStyle=mark.color;c.lineWidth=mark.width;c.lineCap='round';c.lineJoin='round';
      const a=mark.points[0],b=mark.points[mark.points.length-1];
      if(mark.kind==='text'){c.font=`${mark.width}px sans-serif`;c.textBaseline='top';c.fillText(mark.text||'',a.x,a.y);}
      else if(mark.kind==='rectangle'){c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
      else if(mark.kind==='ellipse'){c.beginPath();c.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);c.stroke();}
      else {if(mark.kind==='highlighter'){c.globalAlpha=0.3;c.lineWidth=mark.width*3;}c.beginPath();mark.points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();
        if(mark.kind==='arrow'){const angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.max(12,mark.width*4);c.beginPath();c.moveTo(b.x-len*Math.cos(angle-0.5),b.y-len*Math.sin(angle-0.5));c.lineTo(b.x,b.y);c.lineTo(b.x-len*Math.cos(angle+0.5),b.y-len*Math.sin(angle+0.5));c.stroke();}}
      c.restore();}
  }
  private bounds(mark:Mark) {
    if(mark.kind==='text'){const c=ctx(this.working);c.font=`${mark.width}px sans-serif`;return{x:mark.points[0].x,y:mark.points[0].y,w:c.measureText(mark.text||'').width,h:mark.width*1.2};}
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const p of mark.points){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
    return{x:left,y:top,w:right-left,h:bottom-top};
  }
  private composite(background?: string) {const out=canvas(this.working.width,this.working.height),c=ctx(out);if(background){c.fillStyle=background;c.fillRect(0,0,out.width,out.height);}c.drawImage(this.working,0,0);this.paintMarks(c);return out;}
  private async removeSelected() {if(this.selected<0)return;await this.exclusive(async()=>{this.marks.splice(this.selected,1);this.selected=-1;await this.checkpoint();this.draw();this.refreshOutputSize();});}

  private async checkpoint() {
    const blob=await encode(this.working);if(this.closed)return;
    this.history=this.history.slice(0,this.historyIndex+1);this.history.push({blob,marks:clone(this.marks)});
    while(this.history.length>2&&(this.history.length>12||this.history.reduce((n,s)=>n+s.blob.size,0)>64*1024*1024))this.history.shift();
    this.historyIndex=this.history.length-1;
  }
  private async restore(delta:number) {await this.exclusive(async()=>{
    const index=this.historyIndex+delta;if(index<0||index>=this.history.length)return;
    const state=this.history[index];this.working=await decode(state.blob);this.marks=clone(state.marks);this.historyIndex=index;this.selected=-1;this.resetCorners();this.renderControls();this.draw();this.refreshOutputSize();
  });}
  private async replaceRaster(out:HTMLCanvasElement) {
    this.working=out;this.marks=[];this.selected=-1;this.resetCorners();await this.checkpoint();this.renderControls();this.draw();this.refreshOutputSize();this.status.setText(`Applied: ${out.width} × ${out.height}. Annotations flattened into the raster; Undo restores the previous state.`);
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
  private async process(request:{data:ArrayBufferLike;width:number;height:number;corners:Point[];outWidth:number;outHeight:number;mode:'whiteboard'|'blackboard';strength:number}) {
    if(!this.workerReady)this.workerReady=(async()=>{
      const source=await this.app.vault.adapter.read(`${this.options.pluginDir}/processing-worker.js`);
      if(this.closed)throw new Error('Editor closed.');
      this.workerUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
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

  private async outputBlob() {
    const out=this.composite(this.format==='jpg'?'#fff':undefined);
    const type=`image/${this.format==='jpg'?'jpeg':this.format}`;
    const blob=await encode(out,type,this.quality/100);
    if(blob.type!==type)throw new Error(`This Obsidian version cannot encode ${this.format.toUpperCase()}. The original was not overwritten.`);
    return blob;
  }
  private invalidateEncodedPreview() {
    this.encodedPreview?.close();this.encodedPreview=undefined;
    this.previewCaption?.setText('Updating encoded preview…');this.draw();
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
      this.previewCaption.setText(`Encoded preview: ${this.format.toUpperCase()}${this.format==='png'?' (lossless)':` · quality ${this.quality}`} · 100% zoom fits the image`);
      const diff=Math.round((blob.size/this.original.byteLength-1)*100);
      this.outputInfo.setText(`${this.working.width} × ${this.working.height} · ${this.bytes(blob.size)} (${diff>=0?'+':''}${diff}% vs original)${diff>0?' — larger':''}`);
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
  private askText():Promise<string|null> {
    return new Promise(resolve=>{const modal=new Modal(this.app);modal.titleEl.setText('Annotation text');const input=modal.contentEl.createEl('input',{type:'text',attr:{placeholder:'Enter text','aria-label':'Annotation text'}});let result:string|null=null;
      const add=modal.contentEl.createEl('button',{text:'Add text',cls:'mod-cta'});const submit=()=>{result=input.value.trim();modal.close();};add.onclick=submit;input.onkeydown=e=>{if(e.key==='Enter')submit();};this.childModals.add(modal);modal.onClose=()=>{this.childModals.delete(modal);resolve(result);};modal.open();input.focus();});
  }
  private async save() {
    await this.exclusive(async()=>{
      if(this.closed)return;
      const blob=await this.outputBlob();if(this.closed)return;
      const output=await blob.arrayBuffer();if(this.closed)return;
      const result=await saveImage(this.app,this.file,this.original,output,{backupEnabled:this.options.backupEnabled,backupFolder:this.options.backupFolder});
      new Notice(`Replaced ${result.path}${result.backupPath?`\nBackup: ${result.backupPath}`:''}`,8000);
      this.close();
    });
  }
}
