// Image-to-3D generators used by the Duke 3D Generator. Both take several photos of the same subject
// (front, back, sides) so the unseen sides are not guessed. Results are downloaded at once because the
// providers' download links expire.
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const POLL=()=>Number(process.env.GEN3D_POLL_MS)||6000;

// ---------------------------------------------------------------- Hyper3D Rodin (Gen-2)
const rodinBase=()=>(process.env.RODIN_BASE_URL||'https://api.hyper3d.com/api/v2').replace(/\/$/,'');
export const rodinReady=()=>Boolean(process.env.RODIN_API_KEY);
async function rodinReq(p,init){
  const r=await fetch(rodinBase()+p,{...init,signal:AbortSignal.timeout(180000),headers:{Authorization:`Bearer ${process.env.RODIN_API_KEY}`,...(init.headers||{})}});
  const text=await r.text();let d;try{d=JSON.parse(text);}catch{d={error:text.slice(0,300)};}
  if(!r.ok||d.error)throw new Error(`Rodin ${r.status}: ${d.error||d.message||'request failed'}`);
  return d;
}
async function rodinRun(images,params,{onProgress,timeoutMs=40*60e3}){
  const fd=new FormData();
  for(const im of images)fd.append('images',new Blob([im.buf],{type:im.mime}),im.name);
  for(const [k,v] of Object.entries(params)){
    if(v===undefined||v===null)continue;
    if(Array.isArray(v))for(const x of v)fd.append(k,String(x));else fd.append(k,typeof v==='boolean'?String(v):String(v));
  }
  const sub=await rodinReq('/rodin',{method:'POST',body:fd});
  const key=sub.jobs?.subscription_key;const taskId=sub.uuid;
  if(!key||!taskId)throw new Error('Rodin did not return a job');
  const t0=Date.now();let tick=0;
  while(Date.now()-t0<timeoutMs){
    await sleep(POLL());tick++;
    const st=await rodinReq('/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription_key:key})});
    const jobs=st.jobs||[];
    if(jobs.some(j=>j.status==='Failed'))throw new Error('Rodin generation failed');
    if(jobs.length&&jobs.every(j=>j.status==='Done'))break;
    onProgress?.(Math.min(95,10+tick*3));
  }
  const dl=await rodinReq('/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task_uuid:taskId})});
  const files=(dl.list||[]).map(f=>({name:f.name,url:f.url}));
  if(!files.length)throw new Error('Rodin finished without files');
  return {taskId,files};
}

// ---------------------------------------------------------------- Meshy (multi-image, Meshy 7.1)
const meshyBase=()=>(process.env.MESHY_BASE_URL||'https://api.meshy.ai').replace(/\/$/,'');
export const meshyReady=()=>Boolean(process.env.MESHY_API_KEY);
async function meshyReq(p,init={}){
  const r=await fetch(meshyBase()+p,{...init,signal:AbortSignal.timeout(180000),headers:{Authorization:`Bearer ${process.env.MESHY_API_KEY}`,'Content-Type':'application/json',...(init.headers||{})}});
  const text=await r.text();let d;try{d=JSON.parse(text);}catch{d={message:text.slice(0,300)};}
  if(!r.ok)throw new Error(`Meshy ${r.status}: ${d?.message||d?.task_error?.message||'request failed'}`);
  return d;
}
async function meshyRun(images,params,{onProgress,timeoutMs=40*60e3}){
  const body={image_urls:images.slice(0,4).map(im=>`data:${im.mime};base64,${im.buf.toString('base64')}`),...params,target_formats:['glb','fbx'],multi_view_thumbnails:true};
  const {result:id}=await meshyReq('/openapi/v1/multi-image-to-3d',{method:'POST',body:JSON.stringify(body)});
  const t0=Date.now();
  while(Date.now()-t0<timeoutMs){
    await sleep(POLL());
    const t=await meshyReq(`/openapi/v1/multi-image-to-3d/${id}`);
    const s=String(t.status||'').toUpperCase();onProgress?.(t.progress??0);
    if(s==='SUCCEEDED'){
      const files=[];for(const [k,u] of Object.entries(t.model_urls||{}))if(u&&['glb','fbx'].includes(k))files.push({name:`model.${k}`,url:u});
      for(const [k,u] of Object.entries(t.texture_urls?.[0]||{}))if(u)files.push({name:`texture_${k}.png`,url:u});
      for(const [i,u] of Object.entries(t.thumbnail_urls||{}))if(typeof u==='string'&&u)files.push({name:`preview_${i}.png`,url:u});
      return {taskId:id,files};
    }
    if(['FAILED','CANCELED','CANCELLED','EXPIRED'].includes(s))throw new Error(t.task_error?.message||`Meshy task ${s.toLowerCase()}`);
  }
  throw new Error('Meshy timed out');
}

export const PROVIDERS={
  rodin:{label:'Hyper3D Rodin Gen-2',ready:rodinReady,run:rodinRun,maxImages:5},
  meshy:{label:'Meshy 7.1 (multi-view)',ready:meshyReady,run:meshyRun,maxImages:4}
};
export const readyProviders=()=>Object.entries(PROVIDERS).filter(([,p])=>p.ready()).map(([id])=>id);

// Save every result file locally; returns [{name,file,size}].
export async function saveFiles(files,dir){
  await fs.mkdir(dir,{recursive:true});const out=[];
  for(const f of files){
    const name=path.basename(f.name).replace(/[^\w.\-]/g,'_').slice(0,80)||'file';
    const r=await fetch(f.url,{signal:AbortSignal.timeout(600000)});if(!r.ok)throw new Error(`Download failed (${r.status}) for ${name}`);
    const buf=Buffer.from(await r.arrayBuffer());await fs.writeFile(path.join(dir,name),buf);out.push({name,size:buf.length});
  }
  return out;
}

// Meshy auto-rigging for humanoid characters (the model must face +Z in glTF, which the finishing script ensures).
export async function rigModel(modelDataUri,height){
  const {result:id}=await meshyReq('/openapi/v1/rigging',{method:'POST',body:JSON.stringify({model_url:modelDataUri,height_meters:height||1.78})});
  const t0=Date.now();
  while(Date.now()-t0<30*60e3){
    await sleep(POLL());
    const t=await meshyReq(`/openapi/v1/rigging/${id}`);const s=String(t.status||'').toUpperCase();
    if(s==='SUCCEEDED'){const r=t.result||{};const anims=[];
      for(const [k,v] of Object.entries(r.basic_animations||{})){const fbx=v&&(v.skinned_fbx_url||v.fbx_url||Object.values(v).find(u=>typeof u==='string'&&/\.fbx/i.test(u)));if(fbx)anims.push({name:k.replace(/_?animation/i,'').replace(/^\w/,m=>m.toUpperCase())||'Anim',fbx});}
      return {fbx:r.rigged_character_fbx_url,glb:r.rigged_character_glb_url,anims};}
    if(['FAILED','CANCELED','CANCELLED','EXPIRED'].includes(s))throw new Error(t.task_error?.message||`rigging ${s.toLowerCase()}`);
  }
  throw new Error('Auto-rigging timed out');
}
