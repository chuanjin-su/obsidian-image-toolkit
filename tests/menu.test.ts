import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {embeddedWorkerPlugin} from '../build/embedded-worker.mjs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

// Exercise actual menu integration without an Obsidian runtime or a browser.
const entry=fileURLToPath(new URL('../src/main.ts',import.meta.url));
const bundle=build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian'],logLevel:'silent',plugins:[embeddedWorkerPlugin()]}).then(result=>result.outputFiles[0].text);
class Stub {}
class StubModal {
  opened=false;
  constructor(public app:any) {}
  open(){this.opened=true;}
  close(){this.opened=false;this.onClose();}
  onClose(){}
}
function makeMenu(){
  const items:any[]=[];let separators=0;
  const menu={addSeparator(){separators++;},addItem(callback:(item:any)=>void){const item:any={setTitle(title:string){item.title=title;return item;},setIcon(icon:string){item.icon=icon;return item;},onClick(callback:()=>void){item.click=callback;return item;}};callback(item);items.push(item);}};
  return {menu,items,get separators(){return separators;}};
}
async function plugin(isMobile = false){
  const module={exports:{} as any};
  runInNewContext(await bundle,{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return{Plugin:Stub,PluginSettingTab:Stub,Modal:StubModal,Notice:Stub,Setting:Stub,TFile:Stub,Platform:{isMobile},setIcon(){}};}});
  return new module.exports.default();
}

test('mobile startup registers device import and paste without starting desktop image menus', async () => {
  const p = await plugin(true);
  const events: string[] = [];
  const commands: any[] = [];
  const nativeSave = async () => null;
  p.app = { saveAttachment: nativeSave, workspace: { on(name: string) { events.push(name); } } };
  p.loadData = async () => undefined;
  p.register = p.registerEvent = p.addSettingTab = () => {};
  p.addCommand = (command: unknown) => commands.push(command);
  await p.onload();
  assert.notEqual(p.app.saveAttachment, nativeSave);
  assert.deepEqual(events, ['editor-paste', 'editor-drop', 'editor-change']);
  assert.deepEqual(commands.map(command => command.id), ['insert-images-from-device']);
  const editor = { listSelections: () => [{}] };
  const info = { file: { path: 'Notes/example.md' } };
  assert.equal(commands[0].editorCheckCallback(true, editor, info), true);
  p.settings.manageInsertedImages = false;
  assert.equal(commands[0].editorCheckCallback(true, editor, info), false);
});
test('image menu has exactly one Edit image item, deduplicated per menu',async()=>{
  const p=await plugin(),m=makeMenu(),opens:any[]=[];
  const context={file:{path:'photo.jpg'}};p.open=(...args:any[])=>opens.push(args);
  p.addMenu(m.menu,context);p.addMenu(m.menu,context);
  assert.equal(m.items.length,1);assert.equal(m.items[0].title,'Edit image');assert.equal(m.separators,1);
  m.items[0].click();assert.equal(opens.length,1);assert.equal(opens[0][0],context);assert.equal(opens[0][1],'compress');
});

test('enabled backups add Recover image immediately below Edit image exactly once',async()=>{
  const p=await plugin(),m=makeMenu(),recoveries:any[]=[];
  p.settings.backupEnabled=true;p.recover=(context:any)=>recoveries.push(context);
  const context={file:{path:'folder/photo.png'}};
  p.addMenu(m.menu,context);p.addMenu(m.menu,context);
  assert.deepEqual(m.items.map(item=>item.title),['Edit image','Recover image']);
  assert.equal(m.separators,1);m.items[1].click();assert.equal(recoveries[0],context);
});

test('recovery popup is tracked, snapshots its folder, and closes on plugin unload',async()=>{
  const p=await plugin();p.app={};p.settings.backupEnabled=true;p.settings.backupFolder='My Backups';
  p.recover({file:{path:'photo.png'}});
  assert.equal(p.recoveries.size,1);
  const recovery:any=Array.from(p.recoveries)[0];
  assert.equal(recovery.opened,true);assert.equal(recovery.backupFolder,'My Backups');
  p.onunload();assert.equal(recovery.opened,false);assert.equal(p.recoveries.size,0);
});

test('recovery is not opened if backups were disabled after building the menu',async()=>{
  const p=await plugin();p.recover({file:{path:'photo.png'}});assert.equal(p.recoveries.size,0);
});
