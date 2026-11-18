// Minimal DOM-only Obsidian shim for a browser smoke test, not a substitute for host testing.
function create(this: HTMLElement, tag:string, options:any={}) {
  const el=document.createElement(tag); if(typeof options==='string')options={cls:options};
  if(options.text)el.textContent=options.text;if(options.cls)el.className=options.cls;
  for(const [key,value] of Object.entries(options.attr||{}))el.setAttribute(key,String(value));
  if(options.type)(el as HTMLInputElement).type=options.type;
  if(options.value!==undefined)(el as HTMLInputElement).value=options.value;
  this.appendChild(el);return el;
}
Object.assign(HTMLElement.prototype,{
  createEl:create,createDiv(this:HTMLElement,opts:any){return create.call(this,'div',opts);},createSpan(this:HTMLElement,opts:any){return create.call(this,'span',opts);},
  empty(this:HTMLElement){this.replaceChildren();},setText(this:HTMLElement,text:string){this.textContent=text;},
  addClass(this:HTMLElement,...cls:string[]){this.classList.add(...cls);},removeClass(this:HTMLElement,...cls:string[]){this.classList.remove(...cls);},toggleClass(this:HTMLElement,cls:string,value:boolean){this.classList.toggle(cls,value);}
});
export class Scope {
  register() {}
}
export class Modal {
  scope = new Scope();
  containerEl=document.createElement('div');modalEl=document.createElement('section');titleEl=document.createElement('h2');contentEl=document.createElement('div');
  constructor(public app:any){this.containerEl.className='modal-container';this.modalEl.className='modal';this.titleEl.className='modal-title';this.contentEl.className='modal-content';this.modalEl.append(this.titleEl,this.contentEl);this.containerEl.append(this.modalEl);}
  open(){document.body.append(this.containerEl);void this.onOpen();}
  close(){this.onClose();this.containerEl.remove();}
  onOpen():any{} onClose(){}
}
export function setIcon(el:HTMLElement,name:string){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.setAttribute('aria-hidden','true');
  const paths:Record<string,string>={'mouse-pointer-2':'M4 3 20 12 12 14 9 21Z',pencil:'m4 16 12-12 4 4-12 12H4Z',highlighter:'m5 17 9-12 6 4-9 12M3 21h12','move-up-right':'M5 19 19 5M8 5h11v11',square:'M4 4h16v16H4Z',circle:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',type:'M4 5h16M12 5v15M8 20h8'};
  const path=document.createElementNS(ns,'path');path.setAttribute('d',paths[name]||paths.square);svg.append(path);el.replaceChildren(svg);
}
export class Notice { constructor(message:string){ const el=document.createElement('pre');el.className='notice';el.textContent=message;document.body.append(el);console.log('NOTICE',message); } }
