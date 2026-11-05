import {assert,until,withFixture} from './fixture';

export async function runBackupChecks(){return withFixture(async(g,doc)=>{
  let editor=g.editor;const checks:string[]=[];
  const prompt=()=>doc.querySelector<HTMLElement>('.image-toolkit-backup-prompt');
  const button=(text:string)=>[...prompt()!.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
  const newEditor=async()=>{const e=new editor.constructor(g.app,editor.file,g.editorOptions,()=>{});editor=e;g.editor=e;e.open();await until(()=>!!e.preview,'Next editor did not load');return e;};
  const choose=async(enabled:boolean,folder?:string)=>{const box=prompt()!.querySelector<HTMLInputElement>('input[type=checkbox]')!;box.checked=enabled;box.dispatchEvent(new g.Event('change'));const input=prompt()!.querySelector<HTMLInputElement>('input[type=text]')!;if(folder!==undefined){input.value=folder;input.dispatchEvent(new g.Event('input'));}button('Continue & save').click();};
  assert(!g.preferences.backupEnabled&&!g.preferences.backupConfigured,'Fresh default must disable backup and require first-save choice');
  let pending=editor.save();await until(()=>!!prompt(),'First Save must ask about backup');
  assert(!prompt()!.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,'Backup must initially be unchecked');assert(prompt()!.querySelector<HTMLInputElement>('input[type=text]')!.disabled,'Folder must be disabled while backup is off');button('Cancel').click();await pending;
  assert(g.saved.length===0&&!g.preferences.backupConfigured&&!editor.closed,'Cancel must neither save nor remember a choice');checks.push('first-save default off and cancellation without writes');
  pending=editor.save();await until(()=>!!prompt(),'Canceled choice must be asked again');await choose(true,'../outside');
  assert(!!prompt()&&!prompt()!.querySelector<HTMLElement>('[role=alert]')!.hidden,'Invalid folder must keep prompt open');assert(g.saved.length===0,'Invalid folder must prevent writes');
  await choose(true,'Backups/Images');await pending;
  assert(g.preferences.backupConfigured&&g.preferences.backupEnabled&&g.preferenceWrites.length===1,'Backup choice must be remembered');assert(g.saved.length===2&&g.saved[0].path.startsWith('Backups/Images/'),'Backup must be created before overwrite');checks.push('invalid folder rejected, enabled choice remembered with backup');
  await newEditor();const previous=g.saved.length;await editor.save();assert(!prompt()&&g.saved.length===previous+2&&g.preferenceWrites.length===1,'Later Save must reuse preference without a prompt');checks.push('later saves reuse confirmed backup preferences');
  g.preferences={backupEnabled:false,backupFolder:'Backups/Images',backupConfigured:false};await newEditor();pending=editor.save();await until(()=>!!prompt(),'Reset fresh state must ask');const before=g.saved.length;await choose(false);await pending;
  assert(g.preferences.backupConfigured&&!g.preferences.backupEnabled&&g.saved.length===before+1,'Declining backup must save original without backup');checks.push('explicit no-backup choice is saved and remembered');
  await newEditor();const after=g.saved.length;await editor.save();assert(!prompt()&&g.saved.length===after+1,'Remembered no-backup choice must not prompt or create backup');checks.push('later no-backup save does not ask again');
  g.preferences={backupEnabled:false,backupFolder:'Backups/Images',backupConfigured:false};await newEditor();const count=g.saved.length;pending=editor.save();await until(()=>!!prompt(),'Close test prompt missing');editor.close();await pending;assert(!prompt()&&g.saved.length===count&&!g.preferences.backupConfigured,'Closing parent must cancel first-save prompt and persistence');checks.push('closing editor cancels pending backup question');
  await newEditor();editor.options.saveBackupPreferences=async()=>{throw new Error('Simulated preference persistence failure');};pending=editor.save();await until(()=>!!prompt(),'Persistence failure prompt missing');await choose(true,'Backups/Images');let error='';try{await pending;}catch(e){error=String(e);}assert(error.includes('persistence failure')&&g.saved.length===count&&!g.preferences.backupConfigured,'Preference write failure must prevent image overwrite');checks.push('preference persistence failure prevents overwrite');
  assert(g.errors.length===0,`Unhandled errors: ${g.errors.join(', ')}`);return{checks,errors:g.errors};
});}
