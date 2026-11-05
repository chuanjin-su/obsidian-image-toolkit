// DOM-only test using an in-memory vault. Never modifies the real fixture.
export async function runSmoke() {
  const g=window as any,e=g.editor;
  if(!e?.preview||e.closed)throw new Error('Reload the harness and wait for the editor first.');
  const checks:string[]=[];
  const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
  const click=(text:string)=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text);assert(button,`Missing button ${text}`);button!.click();};
  const until=async(check:()=>boolean,message:string)=>{for(let n=0;n<300;n++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error(message);};
  const wait=()=>until(()=>!e.busy,'Editor remained busy');
  const field=(label:string)=>[...document.querySelectorAll('label')].find(l=>l.firstChild?.textContent===label||l.querySelector('[aria-label]')?.getAttribute('aria-label')===label)!;
  const input=(label:string,value:number)=>{const el=field(label).querySelector('input')!;el.value=String(value);el.dispatchEvent(new Event('input'));};
  const select=(label:string,value:string)=>{const el=field(label).querySelector('select')!;el.value=value;el.dispatchEvent(new Event('change'));};
  const scroll=e.scroll as HTMLElement;
  const fitted=e.preview.getBoundingClientRect();
  assert(fitted.width<=scroll.clientWidth-20&&fitted.height<=scroll.clientHeight-20,'100% must fit both dimensions');
  assert(scroll.scrollHeight<=scroll.clientHeight+1&&scroll.scrollWidth<=scroll.clientWidth+1,'100% should not need scrolling');
  checks.push('100% fits both dimensions without scrollbars');

  const resizedWidth=Math.min(1600,e.working.width),resizedHeight=Math.max(1,Math.round(resizedWidth*e.working.height/e.working.width));
  click('Resize');input('Width (px)',resizedWidth);click('Apply resize');await wait();
  assert(e.working.width===resizedWidth&&e.working.height===resizedHeight,'Resize aspect lock');checks.push('resize aspect lock');
  click('Compress');await until(()=>!!e.encodedPreview,'Initial encoded preview');
  const quality=[...document.querySelectorAll<HTMLInputElement>('input[type=range]')].find(el=>el.parentElement?.firstChild?.textContent?.startsWith('Quality'))!;
  const adjust=(value:number)=>{quality.value=String(value);quality.dispatchEvent(new Event('input'));};
  const checksum=()=>{const c=e.preview as HTMLCanvasElement,bytes=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let sum=0;for(let i=0;i<bytes.length;i+=17)sum=(sum*31+bytes[i])>>>0;return sum;};
  adjust(10);await new Promise(r=>setTimeout(r,100));assert(!e.encodedPreview,'Quality preview must debounce');
  await until(()=>!!e.encodedPreview&&e.previewCaption.textContent.includes('quality 10'),'Low quality decoded preview');const low=checksum();
  adjust(95);await until(()=>!!e.encodedPreview&&e.previewCaption.textContent.includes('quality 95'),'High quality decoded preview');
  assert(checksum()!==low,'Encoded quality must change rendered pixels');checks.push('debounced real codec quality preview');
  assert(![...document.querySelectorAll('input[type=checkbox]')].some(el=>el.parentElement?.textContent?.includes('Overwrite')),'No overwrite checkbox');

  click('Crop / board');select('Mode','board');
  assert(e.strength===0,'Board enhancement must default to zero');
  assert(field('Mode').querySelectorAll('option').length===2,'Only Rectangle and Board modes');
  select('Board background','black');assert(e.boardBackground==='black','Black background switch');select('Board background','white');
  checks.push('unified Board / background switch / zero strength');
  // Synthetic pointer events lack a browser active-pointer id; stub only capture,
  // while exercising the real registered pointer handlers and coordinate mapping.
  const surface=e.preview as HTMLCanvasElement,rect=surface.getBoundingClientRect();
  const capture=surface.setPointerCapture;surface.setPointerCapture=()=>{};
  const pointer=(type:string,x:number,y:number)=>surface.dispatchEvent(new PointerEvent(type,{button:0,pointerId:1,clientX:rect.left+rect.width*x,clientY:rect.top+rect.height*y,bubbles:true}));
  pointer('pointerdown',0.85,0.8);pointer('pointermove',0.1,0.15);pointer('pointerup',0.1,0.15);surface.setPointerCapture=capture;
  assert(Math.abs(e.corners[0].x-resizedWidth*0.1)<2&&Math.abs(e.corners[0].y-resizedHeight*0.15)<2,'Board reverse-drag rectangle');
  assert(Math.abs(e.corners[2].x-resizedWidth*0.85)<2&&Math.abs(e.corners[2].y-resizedHeight*0.8)<2,'Board rectangle bottom-right');
  checks.push('draw initial Board rectangle in either direction');
  e.corners=[{x:0.0625,y:1/12},{x:0.90625,y:7/120},{x:0.9375,y:0.875},{x:0.05,y:11/12}].map(p=>({x:p.x*resizedWidth,y:p.y*resizedHeight}));e.strength=1;e.scheduleBoardPreview();
  const expected=e.boardSize();
  await until(()=>Math.max(e.boardPreview?.width||0,e.boardPreview?.height||0)===700,'Board worker preview');checks.push('scan enhancement worker preview');
  click('Apply crop / board correction');await wait();
  assert(e.working.width===expected.width&&e.working.height===expected.height,'Projective crop');checks.push('projective crop');
  click('Undo');await wait();assert(e.working.width===resizedWidth&&e.working.height===resizedHeight,'Undo');click('Redo');await wait();assert(e.working.width===expected.width&&e.working.height===expected.height,'Redo');checks.push('undo/redo');
  click('Annotate');e.marks.push({kind:'arrow',points:[{x:50,y:50},{x:300,y:200}],color:'#e53935',width:6});await e.checkpoint();e.selected=0;await e.removeSelected();assert(e.marks.length===0,'Annotation deletion');await e.restore(-1);assert(e.marks.length===1,'Annotation undo');checks.push('annotation deletion / undo');
  const savingFirst=e.save();
  await until(()=>!!document.querySelector('.image-toolkit-backup-prompt'),'First-save backup prompt');
  const prompt=document.querySelector('.image-toolkit-backup-prompt')!;
  const enabled=prompt.querySelector<HTMLInputElement>('input[type=checkbox]')!;assert(!enabled.checked,'Backups default to off');enabled.checked=true;enabled.dispatchEvent(new Event('change'));
  const folder=prompt.querySelector<HTMLInputElement>('input[type=text]')!;folder.value='Backups/Images';
  [...prompt.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Continue & save')!.click();await savingFirst;
  assert(g.preferences.backupConfigured&&g.preferences.backupEnabled,'First-save backup choice persisted');checks.push('first-save backup question and persisted choice');
  const backups=g.saved.filter((s:any)=>s.path.startsWith('Backups/Images/'));
  assert(backups.length===1&&g.data.get(backups[0].path).byteLength===g.sourceBytes.byteLength,'Original bytes backed up in configured folder');
  assert(g.saved.filter((s:any)=>s.path==='fixture.jpg').length===1&&g.data.get('fixture.jpg')!==g.sourceBytes,'Save overwrites original path');
  assert(g.data.get('fixture.md')==='![[fixture.jpg|400]]','Note links remain unchanged');
  assert(!g.saved.some((s:any)=>s.path.includes('-edited')),'No edited copies');checks.push('always overwrite + configured folder backup + unchanged links');
  const next=new e.constructor(g.app,e.file,e.options,()=>{});next.open();
  await until(()=>!!next.preview,'Second editor loaded');
  next.outputBlob=async()=>{await new Promise(r=>setTimeout(r,100));return new Blob([new Uint8Array([1])],{type:'image/jpeg'});};
  const count=g.saved.length,saving=next.save();next.close();await saving;
  assert(g.saved.length===count,'Close during encode must prevent persistence');checks.push('close during encoding prevents save');
  assert(g.workerFileReads.length===0,'BRAT installation must never read a separate processing worker file');checks.push('BRAT-compatible embedded worker without extra files');
  assert(g.errors.length===0,`Unhandled browser errors: ${g.errors.join(', ')}`);
  return {checks,saved:g.saved,errors:g.errors};
}
