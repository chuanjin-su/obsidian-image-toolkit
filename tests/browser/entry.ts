import { ImageEditor } from '../../src/editor';
import { runSmoke } from './scenarios';
import { runLayoutChecks } from './layout';
import { runAnnotationChecks } from './annotation-scenarios';
import { runBackupChecks } from './backup-scenarios';
import { runAdjustmentChecks } from './adjustment-scenarios';
const g=window as any;
g.errors=[];window.addEventListener('error',e=>g.errors.push(e.message));window.addEventListener('unhandledrejection',e=>g.errors.push(String(e.reason)));
const files=new Map<string,any>();
const source={path:'fixture.jpg',name:'fixture.jpg',basename:'fixture',extension:'jpg'};
const note={path:'fixture.md',name:'fixture.md',extension:'md'};
files.set(source.path,source);files.set(note.path,note);
const data=new Map<string,ArrayBuffer|string>();
const bytes=await fetch('/fixture.jpg').then(r=>r.arrayBuffer());data.set(source.path,bytes);data.set(note.path,'![[fixture.jpg|400]]');
g.saved=[];g.workerFileReads=[];
const app:any={
  vault:{
    getAbstractFileByPath:(p:string)=>files.get(p)||null,
    readBinary:async(f:any)=>data.get(f.path),
    createFolder:async(path:string)=>{if(files.has(path))throw new Error('File exists');const folder={path,children:[]};files.set(path,folder);return folder;},
    createBinary:async(path:string,output:ArrayBuffer)=>{if(files.has(path))throw new Error('File exists');const file={path,name:path,basename:path.replace(/\.[^.]+$/,''),extension:path.split('.').pop()};files.set(path,file);data.set(path,output);g.saved.push({path,size:output.byteLength});return file;},
    modifyBinary:async(f:any,output:ArrayBuffer)=>{data.set(f.path,output);g.saved.push({path:f.path,size:output.byteLength});},
    process:async(f:any,fn:any)=>{data.set(f.path,fn(data.get(f.path)));},
    adapter:{read:async(path:string)=>{g.workerFileReads.push(path);throw new Error(`ENOENT: BRAT does not install ${path}`);}}
  },fileManager:{generateMarkdownLink:(f:any)=>`![[${f.path}]]`}
};
g.sourceBytes=bytes;g.data=data;g.app=app;g.files=files;
g.preferences={backupEnabled:false,backupFolder:'Backups/Images',backupConfigured:false};g.preferenceWrites=[];
g.editorOptions={
  tool:'crop',quality:85,backupEnabled:false,backupFolder:'Backups/Images',backupConfigured:false,
  getBackupPreferences:()=>({...g.preferences}),
  saveBackupPreferences:async(preferences:any)=>{g.preferences={...preferences,backupConfigured:true};g.preferenceWrites.push({...g.preferences});}
};
g.editor=new ImageEditor(app,source as any,g.editorOptions,()=>{});
g.editor.open();g.runImageToolkitSmoke=runSmoke;g.runImageToolkitLayoutChecks=runLayoutChecks;g.runImageToolkitAnnotationChecks=runAnnotationChecks;g.runImageToolkitBackupChecks=runBackupChecks;g.runImageToolkitAdjustmentChecks=runAdjustmentChecks;
