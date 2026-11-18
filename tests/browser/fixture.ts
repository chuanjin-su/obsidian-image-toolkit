export async function createFixtureJpeg(): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 1200;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#143b71');
  gradient.addColorStop(1, '#ebe1c9');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < canvas.width; offset += 13) {
    context.strokeStyle = offset % 2 ? '#ffc857' : '#3c1642';
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(canvas.width - offset, canvas.height);
    context.stroke();
  }
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the test JPEG.')), 'image/jpeg', 0.92);
  });
  return jpeg.arrayBuffer();
}

export const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
export async function until(check:()=>boolean,message:string){for(let n=0;n<400;n++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw new Error(message);}
export async function withFixture<T>(run:(g:any,doc:Document)=>Promise<T>):Promise<T>{
  const frame=document.createElement('iframe');frame.src='/';frame.title='Isolated image editor test';frame.style.cssText='position:absolute;top:0;left:0;width:900px;height:650px;border:0;z-index:9999';document.body.append(frame);
  try{await until(()=>!!(frame.contentWindow as any)?.editor?.preview,'Fixture editor failed to load');return await run(frame.contentWindow,frame.contentDocument!);}
  finally{(frame.contentWindow as any)?.editor?.close();frame.remove();}
}
