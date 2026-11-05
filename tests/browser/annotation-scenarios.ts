import {assert,until,withFixture} from './fixture';

export async function runAnnotationChecks(){return withFixture(async(g,doc)=>{
  const e=g.editor,checks:string[]=[];
  ++e.sizeVersion;g.clearTimeout(e.estimateTimer);e.working=doc.createElement('canvas');e.working.width=900;e.working.height=600;e.working.getContext('2d').fillStyle='#fff';e.working.getContext('2d').fillRect(0,0,900,600);e.invalidateEncodedPreview();e.marks=[];e.history=[];e.historyIndex=-1;await e.checkpoint();e.tool='annotate';e.renderControls();e.draw();
  const wait=()=>until(()=>!e.busy,'Annotation edit remained busy');
  const click=(label:string)=>{const b=[...doc.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert(b,`Missing ${label}`);b!.click();};
  const pointer=(type:string,x:number,y:number)=>{const r=e.preview.getBoundingClientRect();e.preview.dispatchEvent(new g.PointerEvent(type,{button:0,pointerId:1,clientX:r.left+x/900*r.width,clientY:r.top+y/600*r.height,bubbles:true}));};
  e.preview.setPointerCapture=()=>{};
  const drag=async(x1:number,y1:number,x2:number,y2:number)=>{pointer('pointerdown',x1,y1);pointer('pointermove',x2,y2);pointer('pointerup',x2,y2);await wait();};
  const near=(a:number,b:number)=>Math.abs(a-b)<1;
  const buttons=[...doc.querySelectorAll<HTMLElement>('[data-annotation-tool]')];
  assert(buttons.length===7&&buttons.every(b=>b.querySelector('svg')&&b.getAttribute('aria-label')),'Seven accessible icon tools required');assert(!e.controls.querySelector('select'),'Annotation tool dropdown must be removed');checks.push('seven accessible icon tools, no dropdown');
  click('Rectangle');await drag(100,100,320,240);click('Select / move');await drag(100,170,100,170);assert(e.selected===0,'Rectangle selection');
  await drag(320,240,470,350);assert(near(e.marks[0].points[1].x,470)&&near(e.marks[0].points[1].y,350),'Rectangle handle resize');
  await e.restore(-1);assert(near(e.marks[0].points[1].x,320),'Resize undo');await e.restore(1);assert(near(e.marks[0].points[1].x,470),'Resize redo');
  await drag(100,175,100,175);await drag(200,200,250,240);assert(near(e.marks[0].points[0].x,150)&&near(e.marks[0].points[0].y,140),'Selected mark move');checks.push('rectangle resize / move / undo / redo');
  click('Pen');pointer('pointerdown',100,420);pointer('pointermove',160,400);pointer('pointermove',240,450);pointer('pointerup',240,450);await wait();click('Select / move');await drag(160,400,160,400);assert(e.selected===1,'Freehand selection');await drag(240,450,320,500);const path=e.bounds(e.marks[1]);assert(near(path.w,220)&&near(path.h,100),'Freehand resize');checks.push('freehand corner reshaping');
  click('Arrow');await drag(550,80,730,180);click('Select / move');await drag(640,130,640,130);assert(e.selected===2,'Arrow selection');await drag(730,180,800,250);assert(near(e.marks[2].points[0].x,550)&&near(e.marks[2].points[1].x,800)&&near(e.marks[2].points[1].y,250),'Arrow endpoint reshape');checks.push('arrow endpoint reshaping');
  click('Text');pointer('pointerdown',100,300);pointer('pointerup',100,300);await until(()=>!!doc.querySelector('[aria-label="Annotation text"]'),'Text dialog missing');
  const text=doc.querySelector<HTMLInputElement>('[aria-label="Annotation text"]')!;text.value='Before';click('Add text');await until(()=>e.marks.length===4,'Text mark missing');await wait();click('Select / move');
  let box=e.bounds(e.marks[3]);await drag(box.x+box.w/2,box.y+box.h/2,box.x+box.w/2,box.y+box.h/2);assert(e.selected===3,'Text selection');box=e.bounds(e.marks[3]);
  await drag(box.x+box.w,box.y+box.h,box.x+box.w*1.5,box.y+box.h*2);let resized=e.bounds(e.marks[3]);assert(near(resized.w,box.w*1.5)&&near(resized.h,box.h*2),'Nonuniform text reshape');assert(near(e.marks[3].width,64),'Text font size follows resize');checks.push('text corner resizing');
  click('Edit text');await until(()=>!!doc.querySelector('[aria-label="Annotation text"]'),'Edit text dialog missing');const edit=doc.querySelector<HTMLInputElement>('[aria-label="Annotation text"]')!;assert(edit.value==='Before','Existing text prefilled');edit.value='After editing';click('Apply text');await until(()=>e.marks[3].text==='After editing','Text edit not applied');await wait();
  const font=[...e.controls.querySelectorAll('input[type=range]')].find((el:any)=>el.parentElement.firstChild.textContent.startsWith('Text size')) as HTMLInputElement;font.value='80';font.dispatchEvent(new g.Event('input'));font.dispatchEvent(new g.Event('change'));await wait();assert(near(e.marks[3].width,80),'Selected text font control');
  const color=e.controls.querySelector('input[type=color]') as HTMLInputElement;color.value='#3366ff';color.dispatchEvent(new g.Event('input'));color.dispatchEvent(new g.Event('change'));await wait();assert(e.marks[3].color==='#3366ff','Selected mark color control');
  await e.removeSelected();assert(e.marks.length===3,'Delete text');await e.restore(-1);assert(e.marks.length===4&&e.marks[3].text==='After editing'&&near(e.marks[3].width,80)&&e.marks[3].color==='#3366ff','Text style/edit undo');checks.push('edit text / selected styles / deletion undo');
  assert(g.saved.length===0,'Annotation checks must not write files');assert(g.errors.length===0,`Browser errors: ${g.errors.join(', ')}`);return{checks,errors:g.errors};
});}
