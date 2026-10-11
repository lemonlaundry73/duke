// Meshy API client: concept images, image→3D, auto-rigging, animation. Downloads results to local storage
// because Meshy asset URLs expire.
import fs from 'node:fs/promises';
import path from 'node:path';

const base=()=>(process.env.MESHY_BASE_URL||'https://api.meshy.ai').replace(/\/$/,'');
export const meshyReady=()=>Boolean(process.env.MESHY_API_KEY);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Animation library ids (Meshy animation library). Creator-facing name → action id.
export const ANIMS={idle:0,jump:86,shoot:232,die:183,punch:198};

async function req(p,opts={}){
  const r=await fetch(base()+p,{...opts,signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${process.env.MESHY_API_KEY}`,'Content-Type':'application/json',...(opts.headers||{})}});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={message:text};}
  if(!r.ok)throw new Error(`Meshy ${r.status}: ${data?.message||data?.task_error?.message||'request failed'}`);
  return data;
}
const create=(p,body)=>req(p,{method:'POST',body:JSON.stringify(body)}).then(d=>d.result);
export const ENDPOINT={image:'/openapi/v1/text-to-image',model:'/openapi/v1/image-to-3d',rig:'/openapi/v1/rigging',anim:'/openapi/v1/animations'};

export async function poll(kind,id,{onProgress,timeoutMs=30*60e3,interval=5000}={}){
  const start=Date.now();
  while(Date.now()-start<timeoutMs){
    const t=await req(`${ENDPOINT[kind]}/${id}`);
    const s=String(t.status||'').toUpperCase();
    onProgress?.(t.progress??0,s);
    if(s==='SUCCEEDED')return t;
    if(['FAILED','CANCELED','CANCELLED','EXPIRED'].includes(s))throw new Error(t.task_error?.message||`Meshy task ${s.toLowerCase()}`);
    await sleep(Number(process.env.MESHY_POLL_MS)||interval);
  }
  throw new Error('Meshy task timed out (it may still finish — try again to resume)');
}

export const startConcept=(prompt,{pose='',aspect='1:1'}={})=>create(ENDPOINT.image,{ai_model:process.env.MESHY_IMAGE_MODEL||'nano-banana-pro',prompt:prompt.slice(0,2000),aspect_ratio:aspect,...(pose?{pose_mode:pose}:{})});
export const startModel=(imageDataUri,spec)=>create(ENDPOINT.model,{image_url:imageDataUri,model_type:'standard',ai_model:process.env.MESHY_3D_MODEL||'latest',
  should_texture:true,enable_pbr:true,texture_resolution:'2k',should_remesh:true,topology:spec.topology,target_polycount:spec.polycount,
  ...(spec.pose?{pose_mode:spec.pose}:{}),target_formats:['glb','fbx']});
export const startRig=(modelTaskId,height)=>create(ENDPOINT.rig,{input_task_id:modelTaskId,height_meters:height||1.78});
export const startAnim=(rigTaskId,actionId)=>create(ENDPOINT.anim,{rig_task_id:rigTaskId,action_id:actionId});

// Download a remote file into dir/name; returns the public /uploads path.
export async function download(url,dir,name,publicBase){
  if(!url)return null;
  await fs.mkdir(dir,{recursive:true});
  const r=await fetch(url,{signal:AbortSignal.timeout(300000)});
  if(!r.ok)throw new Error(`Download failed (${r.status}) for ${name}`);
  const buf=Buffer.from(await r.arrayBuffer());
  await fs.writeFile(path.join(dir,name),buf);
  return `${publicBase}/${name}`;
}
