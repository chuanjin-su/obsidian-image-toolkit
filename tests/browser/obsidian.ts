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
export class Modal {
  modalEl=document.createElement('section');titleEl=document.createElement('h2');contentEl=document.createElement('div');
  constructor(public app:any){this.modalEl.className='modal';this.modalEl.append(this.titleEl,this.contentEl);}
  open(){document.body.append(this.modalEl);void this.onOpen();}
  close(){this.onClose();this.modalEl.remove();}
  onOpen():any{} onClose(){}
}
export class Notice { constructor(message:string){ const el=document.createElement('pre');el.className='notice';el.textContent=message;document.body.append(el);console.log('NOTICE',message); } }
