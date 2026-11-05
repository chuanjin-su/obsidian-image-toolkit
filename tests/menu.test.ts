import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

// Exercise actual menu integration without an Obsidian runtime or a browser.
const entry=fileURLToPath(new URL('../src/main.ts',import.meta.url));
const bundle=buildSync({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent'}).outputFiles[0].text;
class Stub {}
function plugin(){
  const module={exports:{} as any};
  runInNewContext(bundle,{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return{Plugin:Stub,PluginSettingTab:Stub,Modal:Stub,Notice:Stub,Setting:Stub,TFile:Stub,setIcon(){}};}});
  return new module.exports.default();
}
test('image menu has exactly one Edit image item, deduplicated per menu',()=>{
  const p=plugin(),items:any[]=[],opens:any[]=[];let separators=0;
  const menu={addSeparator(){separators++;},addItem(callback:(item:any)=>void){const item:any={setTitle(title:string){item.title=title;return item;},setIcon(icon:string){item.icon=icon;return item;},onClick(callback:()=>void){item.click=callback;return item;}};callback(item);items.push(item);}};
  const context={file:{path:'photo.jpg'}};p.open=(...args:any[])=>opens.push(args);
  p.addMenu(menu,context);p.addMenu(menu,context);
  assert.equal(items.length,1);assert.equal(items[0].title,'Edit image');assert.equal(separators,1);
  items[0].click();assert.equal(opens.length,1);assert.equal(opens[0][0],context);assert.equal(opens[0][1],'compress');
});
