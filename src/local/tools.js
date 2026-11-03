// Project tools for the local agents: everything is confined to the folders the creator selected.
// Reads and searches are free; edits are checkpointed first; deleting, overwriting original assets,
// installing software and anything outside the project need the creator's approval.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

export class NeedsApproval extends Error{constructor(action,detail){super(`Needs your approval: ${action}`);this.approval={action,detail};}}
const TEXT=/\.(txt|md|json|ya?ml|ini|cfg|toml|py|js|mjs|ts|tsx|jsx|cs|cpp|c|h|hpp|lua|gd|shader|usf|ush|html|css|csv|xml|bat|ps1|sh|uproject|uplugin)$/i;
const ASSET=/\.(blend|fbx|glb|gltf|obj|png|jpe?g|tga|exr|hdr|wav|mp3|ogg|uasset|umap|abc|usd[cz]?)$/i;
const SKIP=new Set(['.git','.duke','node_modules','Intermediate','DerivedDataCache','Binaries','Saved','__pycache__','.vs']);

export function scope(settings){
  const roots=[settings.projectRoot,...(settings.assetDirs||[])].filter(Boolean).map(p=>path.resolve(p));
  if(!settings.projectRoot)throw new Error('Choose a project folder first.');
  return {project:path.resolve(settings.projectRoot),roots,
    resolve(p,{write=false}={}){
      const abs=path.resolve(this.project,String(p||'.'));
      const inProject=abs===this.project||abs.startsWith(this.project+path.sep);
      const inAssets=this.roots.some(r=>abs===r||abs.startsWith(r+path.sep));
      if(!inProject&&!inAssets)throw new NeedsApproval('access a path outside the selected folders',abs);
      if(write&&!inProject)throw new NeedsApproval('write into an asset folder (only the project folder is writable)',abs);
      if(abs.split(path.sep).includes('.duke')&&write)throw new Error('The .duke folder holds checkpoints and cannot be edited by agents.');
      return abs;}};
}
const rel=(s,abs)=>path.relative(s.project,abs).split(path.sep).join('/')||'.';

export async function listDir(s,p='.',depth=2){
  const base=s.resolve(p);const out=[];
  async function walk(d,lv){if(out.length>400)return;let ents;try{ents=await fsp.readdir(d,{withFileTypes:true});}catch{return;}
    for(const e of ents){if(SKIP.has(e.name))continue;const f=path.join(d,e.name);
      if(e.isDirectory()){out.push(rel(s,f)+'/');if(lv<depth)await walk(f,lv+1);}else{const st=await fsp.stat(f).catch(()=>null);out.push(`${rel(s,f)} (${st?Math.round(st.size/1024):0} KB)`);}}}
  await walk(base,1);return out.join('\n')||'(empty)';
}
export async function readFile(s,p,{max=24000}={}){
  const abs=s.resolve(p);const st=await fsp.stat(abs);
  if(!TEXT.test(abs))return `[${rel(s,abs)} is a ${path.extname(abs)||'binary'} file of ${Math.round(st.size/1024)} KB; it cannot be read as text]`;
  const t=await fsp.readFile(abs,'utf8');return t.length>max?t.slice(0,max)+`\n…[cut: ${t.length-max} more characters]`:t;
}
export async function search(s,query,{glob=''}={}){
  const q=String(query||'').toLowerCase();if(!q)return 'Give a search text.';const hits=[];
  async function walk(d){if(hits.length>=60)return;let ents;try{ents=await fsp.readdir(d,{withFileTypes:true});}catch{return;}
    for(const e of ents){if(SKIP.has(e.name))continue;const f=path.join(d,e.name);
      if(e.isDirectory()){await walk(f);continue;}
      if(glob&&!f.toLowerCase().endsWith(glob.toLowerCase().replace(/^\*/,'')))continue;
      if(e.name.toLowerCase().includes(q))hits.push(`${rel(s,f)} (file name)`);
      if(!TEXT.test(f))continue;const st=await fsp.stat(f).catch(()=>null);if(!st||st.size>2e6)continue;
      const lines=(await fsp.readFile(f,'utf8').catch(()=>'')).split('\n');
      lines.forEach((l,i)=>{if(hits.length<60&&l.toLowerCase().includes(q))hits.push(`${rel(s,f)}:${i+1}: ${l.trim().slice(0,200)}`);});}}
  await walk(s.project);for(const r of s.roots.slice(1))await walk(r);
  return hits.join('\n')||'No matches.';
}
// Writes go through here. Text files are replaced; binary assets that already exist are never overwritten without approval.
export async function writeFile(s,p,content,{approved=false}={}){
  const abs=s.resolve(p,{write:true});const exists=fs.existsSync(abs);
  if(exists&&ASSET.test(abs)&&!approved)throw new NeedsApproval('overwrite an existing asset file',rel(s,abs));
  await fsp.mkdir(path.dirname(abs),{recursive:true});await fsp.writeFile(abs,content);return `${exists?'Updated':'Created'} ${rel(s,abs)} (${Buffer.byteLength(content)} bytes)`;
}
export async function editFile(s,p,find,replace){
  const abs=s.resolve(p,{write:true});const t=await fsp.readFile(abs,'utf8');const n=t.split(find).length-1;
  if(n!==1)throw new Error(n?`The text to replace appears ${n} times in ${rel(s,abs)}; give more context.`:`The text to replace was not found in ${rel(s,abs)}.`);
  await fsp.writeFile(abs,t.replace(find,replace));return `Edited ${rel(s,abs)}`;
}
export async function deleteFile(s,p,{approved=false}={}){
  const abs=s.resolve(p,{write:true});if(!approved)throw new NeedsApproval('delete a file',rel(s,abs));
  const trash=path.join(s.project,'.duke','trash',String(Date.now()));await fsp.mkdir(trash,{recursive:true});
  await fsp.rename(abs,path.join(trash,path.basename(abs)));return `Moved ${rel(s,abs)} to .duke/trash (recoverable)`;
}
const RISKY=/\b(rm|rmdir|del|erase|rd|format|remove-item|move-item|mv|winget|choco|scoop|msiexec|pip3?\s+install|npm\s+(i|install)|curl|wget|invoke-webrequest|iwr|irm|start-bitstransfer|shutdown|reg\s+(add|delete)|set-executionpolicy|git\s+(push|reset|clean))\b/i;
export function runCommand(s,cmd,{approved=false,signal,timeoutMs=120000,onSpawn}={}){
  if(RISKY.test(cmd)&&!approved)throw new NeedsApproval('run a command that deletes, downloads, installs or changes the system',cmd);
  return new Promise(res=>{
    const isWin=process.platform==='win32';
    const p=spawn(isWin?'powershell.exe':'bash',isWin?['-NoProfile','-NonInteractive','-Command',cmd]:['-lc',cmd],{cwd:s.project,windowsHide:true});
    onSpawn?.(p);let out='';const add=d=>{out+=d;if(out.length>40000)out=out.slice(-40000);};
    p.stdout.on('data',add);p.stderr.on('data',add);
    const t=setTimeout(()=>{p.kill();add('\n[stopped: took longer than '+timeoutMs/1000+' s]');},timeoutMs);
    signal?.addEventListener('abort',()=>{p.kill();add('\n[stopped by you]');},{once:true});
    p.on('close',code=>{clearTimeout(t);res({code,output:out.slice(-12000)});});p.on('error',e=>{clearTimeout(t);res({code:-1,output:String(e.message)});});
  });
}

// ---------------------------------------------------------------- checkpoints
// A private Git repository in <project>/.duke/checkpoints.git (never touches the project's own Git history).
// Without Git: a plain copy of the project into .duke/snapshots/<id>.
const MAX_FILE=200*1024*1024;
function hasGit(){try{execFileSync('git',['--version'],{stdio:'ignore',windowsHide:true});return true;}catch{return false;}}
function g(s,...args){
  return execFileSync('git',['--git-dir',path.join(s.project,'.duke','checkpoints.git'),'--work-tree',s.project,'-c','user.name=Duke Local','-c','user.email=local@duke.local','-c','core.autocrlf=false',...args],{cwd:s.project,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
}
async function bigFiles(s){const out=[];async function walk(d){for(const e of await fsp.readdir(d,{withFileTypes:true}).catch(()=>[])){if(SKIP.has(e.name))continue;const f=path.join(d,e.name);
  if(e.isDirectory())await walk(f);else{const st=await fsp.stat(f).catch(()=>null);if(st&&st.size>MAX_FILE)out.push(rel(s,f));}}}await walk(s.project);return out;}
export async function checkpoint(s,label){
  const dir=path.join(s.project,'.duke');await fsp.mkdir(dir,{recursive:true});
  if(hasGit()){
    const gd=path.join(dir,'checkpoints.git');
    if(!fs.existsSync(gd)){execFileSync('git',['init','--bare','-q',gd],{windowsHide:true});}
    const ex=path.join(gd,'info','exclude');await fsp.mkdir(path.dirname(ex),{recursive:true});
    await fsp.writeFile(ex,['.duke/','.git/','node_modules/','Intermediate/','DerivedDataCache/','Saved/','Binaries/','*.blend1',...(await bigFiles(s))].join('\n')+'\n');
    g(s,'add','-A');
    try{g(s,'commit','-q','--allow-empty','-m',label);}catch(e){throw new Error('Checkpoint failed: '+String(e.stderr||e.message).slice(0,300));}
    return {id:g(s,'rev-parse','HEAD').trim(),kind:'git',label,at:new Date().toISOString()};
  }
  const id=`snap-${Date.now()}`;const to=path.join(dir,'snapshots',id);
  await fsp.cp(s.project,to,{recursive:true,filter:src=>{const r=path.relative(s.project,src);return !r.split(path.sep).some(x=>SKIP.has(x));}});
  return {id,kind:'copy',label,at:new Date().toISOString()};
}
// Restore: files go back to the checkpoint; files made after it are moved to .duke/trash (nothing is deleted).
export async function restore(s,cp){
  const trash=path.join(s.project,'.duke','trash',`restore-${Date.now()}`);
  if(cp.kind==='git'){
    const now=g(s,'ls-files','--others','--exclude-standard').split('\n').filter(Boolean);
    const tracked=new Set(g(s,'ls-tree','-r','--name-only',cp.id).split('\n').filter(Boolean));
    const current=g(s,'ls-files').split('\n').filter(Boolean);
    const extra=[...now,...current.filter(f=>!tracked.has(f))];
    for(const f of extra){const a=path.join(s.project,f);if(!fs.existsSync(a))continue;await fsp.mkdir(path.dirname(path.join(trash,f)),{recursive:true});await fsp.rename(a,path.join(trash,f));}
    g(s,'checkout',cp.id,'--','.');
    return {restored:tracked.size,movedToTrash:extra.length,trash:extra.length?rel(s,trash):null};
  }
  const from=path.join(s.project,'.duke','snapshots',cp.id);
  await fsp.cp(from,s.project,{recursive:true,force:true});return {restored:'all files from the snapshot',movedToTrash:0};
}
export { TEXT, ASSET, rel };
