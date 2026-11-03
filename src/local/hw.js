// Measured hardware of this PC (never guessed from a plan name) and the model settings that fit it.
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';

const run=(cmd,args,ms=8000)=>new Promise(res=>execFile(cmd,args,{timeout:ms,windowsHide:true},(e,out)=>res(e?'':String(out))));

export async function gpus(){
  const out=await run('nvidia-smi',['--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu','--format=csv,noheader,nounits']);
  const list=out.trim().split(/\r?\n/).filter(Boolean).map(l=>{const [name,total,used,free,util]=l.split(',').map(s=>s.trim());
    return {name,vramTotalMB:Number(total),vramUsedMB:Number(used),vramFreeMB:Number(free),utilPct:Number(util),source:'nvidia-smi'};});
  if(list.length)return list;
  if(process.platform==='win32'){
    const ps=await run('powershell',['-NoProfile','-Command','Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress']);
    try{const j=JSON.parse(ps);return (Array.isArray(j)?j:[j]).map(g=>({name:g.Name,vramTotalMB:g.AdapterRAM?Math.round(g.AdapterRAM/1048576):null,source:'Windows (may under-report above 4 GB)'}));}catch{}
  }
  return [];
}
export async function disk(dir){
  try{const s=await fs.statfs(dir||os.homedir());return {path:dir||os.homedir(),freeGB:Math.round(s.bavail*s.bsize/1e9*10)/10,totalGB:Math.round(s.blocks*s.bsize/1e9*10)/10};}catch{return null;}
}
export async function snapshot(dir){
  const [g,d]=await Promise.all([gpus(),disk(dir)]);
  return {cpu:os.cpus()[0]?.model||'',cores:os.cpus().length,ramTotalGB:Math.round(os.totalmem()/1e8)/10,ramFreeGB:Math.round(os.freemem()/1e8)/10,gpus:g,disk:d,platform:`${os.type()} ${os.release()}`,at:new Date().toISOString()};
}
// Conservative settings for a ~9B model (about 6–7 GB at 4-bit), leaving room for Windows and Blender.
export function recommend(hw,modelSizeBytes){
  const g=hw.gpus[0];const freeMB=g?.vramFreeMB??null;const totalMB=g?.vramTotalMB??null;
  const modelMB=modelSizeBytes?Math.round(modelSizeBytes/1048576):6600;
  const reserveMB=1536; // Blender viewport/rendering and Windows
  const room=(freeMB??totalMB??0)-modelMB-reserveMB;
  const ctx=room>=6000?16384:room>=3000?8192:room>=1200?4096:0;
  const ramOk=hw.ramFreeGB>=6;
  if(!g||!totalMB)return {ok:false,num_ctx:4096,reason:'No NVIDIA graphics card detected. The model would run on the CPU and be very slow.',suggest:'qwen3.5:4b'};
  if(ctx===0)return {ok:false,num_ctx:2048,reason:`Only ${freeMB??totalMB} MB of graphics memory is free; the model needs about ${modelMB+reserveMB} MB including room for Blender.`,suggest:'qwen3.5:4b'};
  return {ok:ramOk,num_ctx:ctx,num_predict:2048,reason:ramOk?`${g.name}: ${freeMB} MB free graphics memory; context set to ${ctx} tokens with ${reserveMB} MB kept for Blender and Windows.`:`Only ${hw.ramFreeGB} GB of system memory free.`,suggest:ramOk?null:'qwen3.5:4b'};
}
