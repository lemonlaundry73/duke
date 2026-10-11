// Asset production jobs: concept → 3D model → rig → animations, backed by Meshy and resumable across restarts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { load, mutate } from './store.js';
import { UPLOAD_DIR } from './paths.js';
import { COLLECTIONS, ART_SPEC, artPrompt, ensureDesign } from './pipeline.js';
import * as meshy from './meshy.js';

const now=()=>new Date().toISOString();
export const ART_STEPS=['concept','model','rig','anims'];
export const entityDir=(pid,eid)=>({dir:path.join(UPLOAD_DIR,'p',pid,eid),pub:`/uploads/p/${pid}/${eid}`});
export const localPath=pub=>path.join(UPLOAD_DIR,pub.replace(/^\/uploads\//,''));

function findEntity(db,pid,collection,eid){
  const p=db.projects[pid];if(!p)return {};
  const d=ensureDesign(p);const e=(d[collection]||[]).find(x=>x.id===eid);
  return {p,d,e};
}
async function patchEntity(pid,collection,eid,fn){
  return mutate(db=>{const {p,e}=findEntity(db,pid,collection,eid);if(!e)return null;e.art ||= {};fn(e.art,e,p);p.updatedAt=now();return e;});
}
async function jobLog(jobId,msg,progress){
  await mutate(db=>{const j=db.jobs[jobId];if(!j)return null;if(msg)j.logs.push(msg);if(progress!=null)j.progress=Math.max(j.progress||0,Math.round(progress));return j;});
}

export function validateStep(e,collection,step){
  const kind=COLLECTIONS[collection]?.art;
  if(!kind)throw new Error('This item does not need 3D art');
  const art=e.art||{};
  if(step==='concept'){
    const req=COLLECTIONS[collection].fields.filter(f=>f.required&&!f.source&&!['name','role','class','type'].includes(f.key));
    const miss=req.filter(f=>!String(e[f.key]||'').trim()).map(f=>f.label);
    if(miss.length)throw new Error(`Write these first: ${miss.join(', ')}`);
  }
  if(step==='model'&&!art.approved)throw new Error('Approve a concept image first');
  if(step==='rig'){if(kind!=='character')throw new Error('Only characters are rigged');if(!art.model?.glb)throw new Error('Build the 3D model first');}
  if(step==='anims'&&!art.rig?.fbx)throw new Error('Rig the character first');
  if(!meshy.meshyReady())throw new Error('Add MESHY_API_KEY on the server to generate assets — or upload your own files for this step');
  return kind;
}

// Runs (or resumes) one art job. job: {id, projectId, collection, entityId, step, tasks}
export async function runArt(jobId){
  const db0=await load();const job=db0.jobs[jobId];if(!job)return;
  const {projectId:pid,collection,entityId:eid,step}=job;
  const {d,e}=findEntity(db0,pid,collection,eid);
  try{
    if(!e)throw new Error('Item was deleted');
    const kind=COLLECTIONS[collection].art,spec=ART_SPEC[kind];
    const {dir,pub}=entityDir(pid,eid);
    // create-or-resume a Meshy task under a role name
    const task=async(role,kindName,start)=>{
      const fresh=await load();let id=fresh.jobs[jobId]?.tasks?.[role];
      if(!id){id=await start();await mutate(db=>{const j=db.jobs[jobId];j.tasks ||= {};j.tasks[role]=id;j.logs.push(`Meshy ${kindName} task started (${role})`);return j;});}
      else await jobLog(jobId,`Resuming Meshy ${kindName} task (${role})`);
      return meshy.poll(kindName,id,{onProgress:p=>{void jobLog(jobId,null,p*.9);}});
    };
    if(step==='concept'){
      const prompt=artPrompt(kind,e,d);
      const results=await Promise.all([0,1].map(i=>task(`concept${i}`,'image',()=>meshy.startConcept(prompt+(i?' Alternate design variation.':''),{pose:kind==='character'?'a-pose':'',aspect:kind==='vehicle'?'4:3':'1:1'}))));
      const urls=[];
      for(const [i,t] of results.entries())for(const [k,u] of (t.image_urls||[]).entries())urls.push(await meshy.download(u,dir,`concept_${Date.now()}_${i}${k}.png`,pub));
      await patchEntity(pid,collection,eid,a=>{a.concepts=[...(a.concepts||[]),...urls.filter(Boolean).map(url=>({url,at:now(),source:'meshy'}))];});
      await finish(jobId,`${urls.length} concept images ready — pick your favourite`);
    }
    else if(step==='model'){
      const src=localPath(e.art.approved);const bytes=await fs.readFile(src);
      const mime=src.endsWith('.jpg')||src.endsWith('.jpeg')?'image/jpeg':'image/png';
      const t=await task('model','model',()=>meshy.startModel(`data:${mime};base64,${bytes.toString('base64')}`,spec));
      const m={taskId:t.id||job.tasks?.model,glb:await meshy.download(t.model_urls?.glb,dir,'model.glb',pub),fbx:await meshy.download(t.model_urls?.fbx,dir,'model.fbx',pub),
        thumb:await meshy.download(t.thumbnail_url,dir,'thumb.png',pub).catch(()=>null),textures:{}};
      const tex=(t.texture_urls||[])[0]||{};
      for(const k of ['base_color','normal','roughness','metallic'])if(tex[k])m.textures[k]=await meshy.download(tex[k],dir,`tex_${k}.png`,pub).catch(()=>null);
      if(!m.glb&&!m.fbx)throw new Error('Meshy returned no model files');
      await patchEntity(pid,collection,eid,a=>{a.model=m;delete a.rig;delete a.anims;});
      await finish(jobId,'3D model ready');
    }
    else if(step==='rig'){
      const modelTask=e.art.model.taskId;
      const t=await task('rig','rig',async()=>{
        if(modelTask)return meshy.startRig(modelTask,spec.height(e));
        const bytes=await fs.readFile(localPath(e.art.model.glb));
        return (await fetch(`${process.env.MESHY_BASE_URL||'https://api.meshy.ai'}/openapi/v1/rigging`,{method:'POST',headers:{Authorization:`Bearer ${process.env.MESHY_API_KEY}`,'Content-Type':'application/json'},
          body:JSON.stringify({model_url:`data:model/gltf-binary;base64,${bytes.toString('base64')}`,height_meters:spec.height(e)})}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.message||'Rigging failed');return j.result;}));
      });
      const r=t.result||{},ba=r.basic_animations||{};
      const rig={taskId:t.id||job.tasks?.rig,fbx:await meshy.download(r.rigged_character_fbx_url,dir,'rig.fbx',pub),glb:await meshy.download(r.rigged_character_glb_url,dir,'rig.glb',pub)};
      const anims={};
      for(const k of ['walking','running']){const name=k==='walking'?'walk':'run';
        anims[name]={fbx:await meshy.download(ba[`${k}_fbx_url`],dir,`anim_${name}.fbx`,pub).catch(()=>null),glb:await meshy.download(ba[`${k}_glb_url`],dir,`anim_${name}.glb`,pub).catch(()=>null)};}
      if(!rig.fbx)throw new Error('Meshy returned no rigged character');
      await patchEntity(pid,collection,eid,a=>{a.rig=rig;a.anims={...(a.anims||{}),...anims};});
      await finish(jobId,'Rigged — walk and run cycles included');
    }
    else if(step==='anims'){
      const want=['idle','jump','shoot','die'].filter(k=>!e.art.anims?.[k]?.fbx);
      const rigTask=e.art.rig.taskId;if(!rigTask)throw new Error('This rig was uploaded, so Meshy cannot animate it. Upload animation FBX files instead.');
      const out={};
      for(const [i,k] of want.entries()){
        const t=await task(`anim_${k}`,'anim',()=>meshy.startAnim(rigTask,meshy.ANIMS[k]));
        const r=t.result||{};
        out[k]={fbx:await meshy.download(r.animation_fbx_url,dir,`anim_${k}.fbx`,pub),glb:await meshy.download(r.animation_glb_url,dir,`anim_${k}.glb`,pub).catch(()=>null)};
        await jobLog(jobId,`${k} animation ready`,(i+1)/want.length*95);
      }
      await patchEntity(pid,collection,eid,a=>{a.anims={...(a.anims||{}),...out};});
      await finish(jobId,want.length?`Animations ready: ${want.join(', ')}`:'All animations already present');
    }
  }catch(err){
    console.error(`[art ${jobId}]`,err.message);
    await mutate(db=>{const j=db.jobs[jobId];if(j){j.status='failed';j.error=String(err.message||err);j.logs.push(`ERROR: ${j.error}`);
        // Refund the credits this job charged: failed generations are free.
        const u=j.chargedTo&&db.users?.[j.chargedTo];if(u&&j.credits&&!j.refunded){if(u.credits?.period===j.creditPeriod)u.credits.used=Math.max(0,u.credits.used-j.credits);else u.bonusCredits=(u.bonusCredits||0)+j.credits;j.refunded=true;j.logs.push(`Refunded ${j.credits} credits`);}}
      const {e:ent}=findEntity(db,pid,collection,eid);if(ent?.art?.busy===step)delete ent.art.busy;return j;});
  }
}
async function finish(jobId,msg){
  await mutate(db=>{const j=db.jobs[jobId];j.status='complete';j.progress=100;j.logs.push(msg);
    const {e}=findEntity(db,j.projectId,j.collection,j.entityId);if(e?.art?.busy===j.step)delete e.art.busy;return j;});
}
