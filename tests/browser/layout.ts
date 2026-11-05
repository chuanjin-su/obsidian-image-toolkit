// Exercise real CSS viewport units/media queries in one same-origin iframe.
// No Obsidian host IO and no writes, including when opening advanced controls.
export async function runLayoutChecks() {
  const frame=document.createElement('iframe');frame.src='/';frame.title='Compact layout regression';
  frame.style.cssText='display:block;width:1024px;height:720px;border:0;position:absolute;top:0;left:0;z-index:9999';
  document.body.append(frame);
  const wait=async(check:()=>boolean,message:string)=>{for(let n=0;n<400;n++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error(message);};
  const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
  const results:unknown[]=[];
  try {
    await wait(()=>!!(frame.contentWindow as any)?.editor?.preview,'Layout iframe failed to load');
    const win=frame.contentWindow!,doc=frame.contentDocument!,editor=(win as any).editor;
    const settle=()=>new Promise<void>(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>resolve())));
    editor.outputInfo.setText('4096 × 3072 · 999.99 KB (-32%)');
    editor.titleEl.setText('Image Toolkit — a-very-long-image-filename-that-must-not-wrap-or-push-controls-outside-the-window.jpg');
    const footerQuality=doc.querySelector<HTMLInputElement>('.image-toolkit-export-bar input[type=range]')!;
    const original=editor.working as HTMLCanvasElement;
    const portrait=doc.createElement('canvas');portrait.width=original.height;portrait.height=original.width;
    const context=portrait.getContext('2d')!;context.translate(portrait.width,0);context.rotate(Math.PI/2);context.drawImage(original,0,0);
    for(const orientation of ['landscape','portrait']) {
    ++editor.sizeVersion;win.clearTimeout(editor.estimateTimer);editor.working=orientation==='portrait'?portrait:original;editor.invalidateEncodedPreview();editor.resetCorners();
    for(const [width,height] of [[1024,720],[900,600],[800,600],[640,480],[520,600]]) {
      frame.style.width=`${width}px`;frame.style.height=`${height}px`;await settle();
      for(const tool of ['compress','resize','crop','adjust','annotate']) {
        editor.tool=tool;editor.mode='board';editor.renderControls();editor.draw();await settle();
        const modal=editor.modalEl as HTMLElement,content=editor.contentEl as HTMLElement;
        const bounds=modal.getBoundingClientRect(),footer=doc.querySelector<HTMLElement>('.image-toolkit-footer')!;
        const bottom=footer.getBoundingClientRect();
        const visible=(el:HTMLElement)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=bounds.top&&r.bottom<=bounds.bottom+1&&r.left>=bounds.left&&r.right<=bounds.right+1;};
        const save=[...doc.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Save image')!;
        const quality=doc.querySelector<HTMLInputElement>('.image-toolkit-export-bar input[type=range]')!;
        const prefix=`${width}×${height} ${tool} ${orientation}`;
        assert(bounds.top>=0&&bounds.left>=0&&bounds.bottom<=height+1&&bounds.right<=width+1,`${prefix}: modal outside window`);
        assert(modal.scrollHeight<=modal.clientHeight+1&&content.scrollHeight<=content.clientHeight+1,`${prefix}: modal/content requires page scrolling`);
        assert(doc.documentElement.scrollHeight<=height+1&&doc.documentElement.scrollWidth<=width+1,`${prefix}: document overflow`);
        assert(visible(save)&&visible(quality)&&bottom.bottom<=height,`${prefix}: save/quality not fully visible`);
        assert(footer.contains(quality)&&quality===footerQuality,`${prefix}: quality must stay in the persistent footer`);
        assert(editor.scroll.clientHeight>=75,`${prefix}: preview collapsed`);
        assert(editor.scroll.scrollHeight<=editor.scroll.clientHeight+1&&editor.scroll.scrollWidth<=editor.scroll.clientWidth+1,`${prefix}: fit preview needs scrolling`);
        if(tool!=='compress') {
          const action=editor.toolActions.querySelector('button') as HTMLButtonElement;
          assert(visible(action),`${prefix}: tool action clipped`);
          if(height>=600&&tool!=='crop')assert(editor.controls.scrollHeight<=editor.controls.clientHeight+1,`${prefix}: default tool controls do not fit`);
        }
        const sections=[...editor.controls.querySelectorAll('details')] as HTMLDetailsElement[];
        if(tool==='crop'){
          assert(sections.find(section=>section.querySelector('summary')?.textContent==='Corner precision')?.open,`${prefix}: corner precision must start unfolded`);
          const board=editor.boardPreview.getBoundingClientRect(),corner=editor.magnifier.getBoundingClientRect();
          assert(corner.top>=board.bottom+4,`${prefix}: previews must stack vertically`);
        }
        for(const details of sections){details.open=true;await settle();assert(visible(save)&&content.scrollHeight<=content.clientHeight+1,`${prefix}: advanced controls move footer offscreen`);}
        results.push({width,height,tool,orientation,previewHeight:editor.scroll.clientHeight,footerVisible:true});
      }
    }
    }
    assert((win as any).saved.length===0,'Layout checks must not save images');
    return {layouts:results.length,results,errors:(win as any).errors};
  } finally {(frame.contentWindow as any)?.editor?.close();frame.remove();}
}
