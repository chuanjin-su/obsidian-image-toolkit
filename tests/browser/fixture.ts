export const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
export async function until(check:()=>boolean,message:string){for(let n=0;n<400;n++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error(message);}
export async function withFixture<T>(run:(g:any,doc:Document)=>Promise<T>):Promise<T>{
  const frame=document.createElement('iframe');frame.src='/';frame.title='Isolated image editor test';frame.style.cssText='position:absolute;top:0;left:0;width:900px;height:650px;border:0;z-index:9999';document.body.append(frame);
  try{await until(()=>!!(frame.contentWindow as any)?.editor?.preview,'Fixture editor failed to load');return await run(frame.contentWindow,frame.contentDocument!);}
  finally{(frame.contentWindow as any)?.editor?.close();frame.remove();}
}
