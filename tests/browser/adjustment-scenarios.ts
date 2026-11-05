import {applyAdjustments,hasAdjustments} from '../../src/adjustments';
import {assert,until,withFixture} from './fixture';

export async function runAdjustmentChecks(){return withFixture(async(g,doc)=>{
  const e=g.editor,checks:string[]=[],originalSize=[e.working.width,e.working.height];
  ++e.sizeVersion;g.clearTimeout(e.estimateTimer);e.working=doc.createElement('canvas');e.working.width=320;e.working.height=240;
  const context=e.working.getContext('2d');context.fillStyle='rgb(80,110,145)';context.fillRect(0,0,320,240);context.fillStyle='rgb(145,85,45)';context.fillRect(180,20,100,200);
  e.marks=[];e.history=[];e.historyIndex=-1;e.invalidateEncodedPreview();await e.checkpoint();e.tool='adjust';e.renderControls();e.draw();
  const pixels=()=>new Uint8ClampedArray(e.working.getContext('2d').getImageData(0,0,320,240).data);
  const same=(a:ArrayLike<number>,b:ArrayLike<number>)=>a.length===b.length&&Array.from(a).every((value,i)=>value===b[i]);
  const click=(label:string)=>{const b=[...doc.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert(b,`Missing ${label}`);b!.click();};
  const change=(key:string,value:number)=>{const input=doc.querySelector<HTMLInputElement>(`[data-adjustment="${key}"]`)!;assert(input,`Missing ${key}`);input.value=String(value);input.dispatchEvent(new g.Event('input'));};
  const wait=()=>until(()=>!e.busy,'Adjustment operation remained busy');
  const initial=pixels(),initialHistory=e.history.length;
  assert(doc.querySelectorAll('[data-adjustment]').length===6&&!hasAdjustments(e.adjustments),'Six neutral basic sliders');checks.push('six neutral adjustment controls');
  change('brightness',30);await new Promise(r=>setTimeout(r,100));assert(!e.encodedPreview,'Adjustments should debounce');
  await until(()=>!!e.encodedPreview&&e.previewCaption.textContent.includes('adjusted'),'Adjusted encoded preview missing');
  const view=doc.createElement('canvas');view.width=320;view.height=240;view.getContext('2d')!.drawImage(e.encodedPreview,0,0);assert(view.getContext('2d')!.getImageData(50,50,1,1).data[0]>initial[(50*320+50)*4]+30,'Preview must visibly brighten');
  assert(same(pixels(),initial)&&e.history.length===initialHistory,'Live sliders must not modify working raster/history');checks.push('debounced live preview without raster mutation');
  click('Reset sliders');assert(!hasAdjustments(e.adjustments)&&same(pixels(),initial)&&e.history.length===initialHistory,'Reset sliders must be nondestructive');checks.push('reset sliders preserves image');
  for(const [key,value] of Object.entries({exposure:0.4,brightness:10,contrast:20,saturation:-30,warmth:15,sharpen:40}))change(key,value);
  const expected=applyAdjustments(initial,320,240,e.adjustments);click('Apply adjustments');await wait();
  assert(same(pixels(),expected)&&!hasAdjustments(e.adjustments)&&e.history.length===initialHistory+1,'Apply must use full-resolution worker once and clear sliders');
  await e.restore(-1);assert(same(pixels(),initial),'Undo applied adjustments');await e.restore(1);assert(same(pixels(),expected),'Redo applied adjustments');checks.push('full-resolution apply and undo/redo');
  const index=e.historyIndex;change('brightness',15);await e.restore(-1);assert(!hasAdjustments(e.adjustments)&&e.historyIndex===index&&same(pixels(),expected),'Undo must clear unapplied preview first');checks.push('undo clears pending preview before history');
  change('brightness',-15);const switched=applyAdjustments(expected,320,240,e.adjustments);click('Resize');await until(()=>e.tool==='resize'&&!e.busy,'Tab switch did not finish');assert(same(pixels(),switched)&&!hasAdjustments(e.adjustments),'Switching tools must commit pending adjustments');click('Adjust');checks.push('tool switch commits pending settings');
  const beforeFailure=pixels(),beforeFailureHistory=e.history.length,process=e.process;e.process=async()=>{throw new Error('Simulated adjustment worker failure');};change('contrast',5);let error='';try{await e.applyAdjustments();}catch(failure){error=String(failure);}e.process=process;
  assert(error.includes('worker failure')&&same(pixels(),beforeFailure)&&e.history.length===beforeFailureHistory&&!e.busy,'Worker failure must not mutate image/history');click('Reset sliders');checks.push('processing failure preserves image and history');
  change('brightness',20);click('Reset');await wait();assert(!hasAdjustments(e.adjustments)&&e.working.width===originalSize[0]&&e.working.height===originalSize[1],'Global Reset must restore source and clear pending settings');await e.restore(-1);assert(same(pixels(),beforeFailure),'Undo global Reset must restore prior raster');checks.push('global Reset clears pending settings and remains undoable');
  change('brightness',20);let saving=e.save();await until(()=>!!doc.querySelector('.image-toolkit-backup-prompt'),'Backup question missing');
  let prompt=doc.querySelector('.image-toolkit-backup-prompt')!;[...prompt.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Cancel')!.click();await saving;
  assert(same(pixels(),beforeFailure)&&e.adjustments.brightness===20&&g.saved.length===0&&!g.preferences.backupConfigured,'Canceling Save must retain pending preview without file writes');checks.push('cancel Save retains pending adjustments');
  const savedPixels=applyAdjustments(beforeFailure,320,240,e.adjustments);saving=e.save();await until(()=>!!doc.querySelector('.image-toolkit-backup-prompt'),'Backup question missing again');prompt=doc.querySelector('.image-toolkit-backup-prompt')!;[...prompt.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Continue & save')!.click();await saving;
  assert(e.closed&&same(pixels(),savedPixels)&&!hasAdjustments(e.adjustments)&&g.saved.length===1&&g.saved[0].path==='fixture.jpg','Save must include unapplied adjustments exactly once');
  assert(g.preferences.backupConfigured&&!g.preferences.backupEnabled,'Save must retain the explicit no-backup choice');checks.push('Save includes pending settings once');
  assert(g.errors.length===0,`Unhandled errors: ${g.errors.join(', ')}`);return{checks,errors:g.errors};
});}
