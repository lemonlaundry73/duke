// Blender through its Python API: a headless Blender process per operation (blender -b -P runner).
// Supported: inspect a scene, import assets, run generated bpy scripts (modeling with primitives,
// modifiers, booleans, arrays, materials, lights, cameras), save a new version, render a preview.
// Not supported (shown as such in the app): sculpting, texture painting, retopology or "AAA" judgments.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../paths.js';

export const SUPPORTED=['Inspect a scene (objects, sizes, materials)','Import FBX, OBJ, glTF/GLB assets','Model with primitives, modifiers, booleans and arrays','Create and assign materials','Place lights and cameras','Save a new numbered version of the scene','Render a preview image'];
export const UNSUPPORTED=['Sculpting and fine organic detail','Texture painting','Production retopology','Rigging and animation authoring'];
const RUNNER=path.join(ROOT,'local','blender_runner.py');

export function findBlender(configured){
  if(configured&&fs.existsSync(configured))return configured;
  const pf=[process.env.ProgramFiles,'C:\\Program Files','D:\\Program Files'].filter(Boolean);
  const hits=[];
  for(const r of pf){const base=path.join(r,'Blender Foundation');try{for(const d of fs.readdirSync(base)){const exe=path.join(base,d,'blender.exe');if(fs.existsSync(exe))hits.push(exe);}}catch{}}
  if(hits.length)return hits.sort().at(-1);
  for(const p of String(process.env.PATH||'').split(path.delimiter)){for(const n of ['blender','blender.exe']){const f=path.join(p,n);if(fs.existsSync(f))return f;}}
  return null;
}

// Next free versioned file name: scene.blend -> scene_v002.blend ...
export function nextVersion(scene){
  const dir=path.dirname(scene);const stem=path.basename(scene,'.blend').replace(/_v\d{3}$/,'');
  let n=1;for(const f of fs.existsSync(dir)?fs.readdirSync(dir):[]){const m=new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}_v(\\d{3})\\.blend$`).exec(f);if(m)n=Math.max(n,Number(m[1])+1);}
  return path.join(dir,`${stem}_v${String(n).padStart(3,'0')}.blend`);
}

export async function runBlender({exe,scene,script,save,render,workDir,signal,onLine,timeoutMs=15*60e3}){
  if(!exe)throw new Error('Blender was not found. Install it (the setup script can) or choose blender.exe in Settings.');
  await fsp.mkdir(workDir,{recursive:true});const id=Date.now().toString(36);
  const job={scene:scene||null,save:save||null,render:render||null,out:path.join(workDir,`result-${id}.json`)};
  if(script){job.script=path.join(workDir,`script-${id}.py`);await fsp.writeFile(job.script,script);}
  const jf=path.join(workDir,`job-${id}.json`);await fsp.writeFile(jf,JSON.stringify(job));
  const log=[];
  const code=await new Promise(res=>{
    const p=spawn(exe,['-b','--factory-startup','-noaudio','-P',RUNNER,'--',jf],{windowsHide:true});
    const line=d=>{for(const l of String(d).split(/\r?\n/)){if(!l.trim())continue;log.push(l);if(log.length>400)log.shift();onLine?.(l);}};
    p.stdout.on('data',line);p.stderr.on('data',line);
    const t=setTimeout(()=>{p.kill();log.push('[stopped: Blender took longer than '+timeoutMs/60000+' minutes]');},timeoutMs);
    signal?.addEventListener('abort',()=>{p.kill();log.push('[stopped by you]');},{once:true});
    p.on('close',c=>{clearTimeout(t);res(c);});p.on('error',e=>{clearTimeout(t);log.push(String(e.message));res(-1);});
  });
  let out=null;try{out=JSON.parse(await fsp.readFile(job.out,'utf8'));}catch{}
  if(!out)return {ok:false,error:`Blender exited (code ${code}) without a result.\n${log.slice(-30).join('\n')}`,log};
  return {...out,exitCode:code,log:log.slice(-120),script:job.script||null};
}
