// Duke 3D Generator and the simple cast list.
//  Cast: name, role and four photos (front, back, left, right) per character.
//  Generator: photos -> the best image-to-3D models (Rodin Gen-2 and Meshy 7.1 side by side) ->
//  AAA finishing on the creator's GPU worker (Blender, scripted) -> quality gates -> approve -> Unreal.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { load, mutate } from '../store.js';
import { HttpError, id as nanoid, readMultipart } from '../http.js';
import { requireUser } from '../auth.js';
import { createZip } from '../zip.js';
import { RECIPES, VIEWS, PHOTO_RULES, recipeView } from './presets.js';
import { PROVIDERS, readyProviders, saveFiles, meshyReady, rigModel } from './providers.js';

const now=()=>new Date().toISOString();
const nf=(m='not found')=>{throw new HttpError(404,m);};
const IMG_EXT={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
const MIN_PX=1024;

// Width/height from the file header (PNG, JPEG, WebP), so tiny or broken images are refused on the server too.
export function imageSize(buf){
  if(buf.length>24&&buf.readUInt32BE(0)===0x89504e47)return {w:buf.readUInt32BE(16),h:buf.readUInt32BE(20),mime:'image/png'};
  if(buf[0]===0xff&&buf[1]===0xd8){let i=2;while(i+9<buf.length){if(buf[i]!==0xff){i++;continue;}const m=buf[i+1];const len=buf.readUInt16BE(i+2);
      if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return {h:buf.readUInt16BE(i+5),w:buf.readUInt16BE(i+7),mime:'image/jpeg'};i+=2+len;}return null;}
  if(buf.length>30&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP'){const t=buf.toString('ascii',12,16);
    if(t==='VP8X')return {w:1+buf.readUIntLE(24,3),h:1+buf.readUIntLE(27,3),mime:'image/webp'};
    if(t==='VP8 ')return {w:buf.readUInt16LE(26)&0x3fff,h:buf.readUInt16LE(28)&0x3fff,mime:'image/webp'};
    if(t==='VP8L'){const b=buf.readUInt32LE(21);return {w:(b&0x3fff)+1,h:((b>>14)&0x3fff)+1,mime:'image/webp'};}}
  return null;
}
function checkPhoto(buf,view){
  const s=imageSize(buf);
  if(!s)throw new HttpError(400,`${VIEWS[view]?.label||view}: use a PNG, JPG or WebP image.`);
  if(Math.min(s.w,s.h)<MIN_PX)throw new HttpError(400,`${VIEWS[view]?.label||view} is ${s.w}×${s.h}. AAA results need at least ${MIN_PX}×${MIN_PX} pixels.`);
  if(buf.length>20*1024*1024)throw new HttpError(400,`${VIEWS[view]?.label||view} is over 20 MB.`);
  return s;
}

// The quality gates. A candidate is only called AAA when every gate passes; otherwise the reasons are shown.
export function judge(recipe,report){
  const g=RECIPES[recipe]?.gates||{};const fails=[],passes=[];const r=report||{};
  const t0=Number(r.lods?.[0]?.tris)||0;
  const test=(ok,text)=>(ok?passes:fails).push(text);
  test(t0<=g.maxTrisLOD0,`LOD0 ${t0.toLocaleString()} triangles (limit ${g.maxTrisLOD0.toLocaleString()})`);
  test(t0>=g.minTrisLOD0,`LOD0 detail ${t0.toLocaleString()} triangles (minimum ${g.minTrisLOD0.toLocaleString()})`);
  test((r.lods||[]).length>=(RECIPES[recipe]?.lods.length||1),`${(r.lods||[]).length} of ${RECIPES[recipe]?.lods.length} levels of detail`);
  test(Number(r.texture_max)>=g.minTexture,`Textures ${r.texture_max||0}px (need ${g.minTexture}px)`);
  if(g.needsUV)test(!!r.has_uv&&!(Number(r.uv_out_of_bounds_pct)>2),`UVs present${r.uv_out_of_bounds_pct?` (${r.uv_out_of_bounds_pct}% outside 0–1)`:''}`);
  if(g.needsPBR){const m=r.pbr||{};test(!!(m.base_color&&m.normal&&m.roughness),`PBR set: color ${m.base_color?'✓':'✗'} normal ${m.normal?'✓':'✗'} roughness ${m.roughness?'✓':'✗'} metallic ${m.metallic?'✓':'–'}`);}
  test(Number(r.non_manifold_pct||0)<=g.maxNonManifoldPct,`Clean geometry: ${r.non_manifold_pct||0}% non-manifold edges (limit ${g.maxNonManifoldPct}%)`);
  test(Number(r.loose_parts||0)<=g.maxIslands,`${r.loose_parts||0} separate parts (limit ${g.maxIslands})`);
  if(g.heightTolerance&&r.target_size_m)test(Math.abs(Number(r.size_m)-r.target_size_m)/r.target_size_m<=g.heightTolerance,`Real-world size ${Number(r.size_m||0).toFixed(2)} m (target ${r.target_size_m} m)`);
  if(g.sizeTolerance&&r.target_size_m)test(Math.abs(Number(r.size_m)-r.target_size_m)/r.target_size_m<=g.sizeTolerance,`Real-world size ${Number(r.size_m||0).toFixed(2)} m (target ${r.target_size_m} m)`);
  test(!!r.collision,`Collision: ${r.collision||'none'}`);
  test((r.renders||[]).length>=4,`${(r.renders||[]).length} turntable renders`);
  if(RECIPES[recipe]?.finish?.rig)test(r.rig==='humanoid'||r.rig_ready===true,`Skeleton: ${r.rig||'not rigged yet'}`);
  return {aaa:fails.length===0,fails,passes};
}

export function registerGen3d(r,F){
  const {ensure,newJob,step,touch,wake,workerOf,ownProject,agentTok,emit,FORGE_DIR}=F;
  const G=path.join(FORGE_DIR,'gen3d'),CAST=path.join(FORGE_DIR,'cast');
  fs.mkdirSync(G,{recursive:true});fs.mkdirSync(CAST,{recursive:true});
  const ownCast=async(req,cid)=>{const user=await requireUser(req);const db=await load();const c=ensure(db).cast?.[cid];if(!c||c.ownerId!==user.id)nf('character not found');return {user,db,c};};
  const ownGen=async(req,gid)=>{const user=await requireUser(req);const db=await load();const g=ensure(db).gen3d?.[gid];if(!g||g.ownerId!==user.id)nf('3D job not found');return {user,db,g};};
  const castView=c=>({id:c.id,name:c.name,role:c.role,notes:c.notes||'',createdAt:c.createdAt,
    views:Object.fromEntries(Object.entries(c.views||{}).map(([k,v])=>[k,{...v,url:`/api/forge/cast/${c.id}/view/${k}?v=${encodeURIComponent(v.at)}`}])),
    ready:['front','back','left','right'].every(k=>c.views?.[k]),models:c.models||[]});
  const genView=g=>({...g,inputs:g.inputs.map(i=>({...i,url:`/api/forge/gen3d/${g.id}/input/${i.view}`})),
    candidates:g.candidates.map(c=>({...c,files:(c.files||[]).map(f=>({...f,url:`/api/forge/gen3d/${g.id}/file/${c.provider}/raw/${encodeURIComponent(f.name)}`})),
      finished:(c.finished||[]).map(f=>({...f,url:`/api/forge/gen3d/${g.id}/file/${c.provider}/final/${encodeURIComponent(f.name)}`}))}))});
  const send=(res,file,type)=>{const st=fs.statSync(file);res.writeHead(200,{'content-type':type,'content-length':st.size,'cache-control':'private, max-age=600'});fs.createReadStream(file).pipe(res);};
  const TYPE=n=>({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary','.fbx':'application/octet-stream','.json':'application/json','.zip':'application/zip'})[path.extname(n).toLowerCase()]||'application/octet-stream';

  // ---------------- what the generator needs (shown on the page)
  r.get('/api/forge/gen3d/recipes',async({req})=>{await requireUser(req);
    return {recipes:Object.keys(RECIPES).map(recipeView),views:VIEWS,rules:PHOTO_RULES,minPx:MIN_PX,
      providers:Object.entries(PROVIDERS).map(([id,p])=>({id,label:p.label,ready:p.ready()}))};});

  // ---------------- cast list
  r.get('/api/forge/projects/:fid/cast',async({req,params})=>{const {f,p}=await ownProject(req,params.fid);return {cast:Object.values(f.cast||{}).filter(c=>c.projectId===p.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(castView)};});
  r.post('/api/forge/projects/:fid/cast',async({req,params,body})=>{
    const {p}=await ownProject(req,params.fid);const name=String(body.name||'').trim().slice(0,80);if(!name)throw new HttpError(400,'Give the character a name');
    return mutate(db=>{const f=ensure(db);f.cast ||= {};const c={id:nanoid(10),projectId:p.id,ownerId:p.ownerId,name,role:String(body.role||'').trim().slice(0,80),notes:String(body.notes||'').slice(0,1000),views:{},models:[],createdAt:now()};f.cast[c.id]=c;return {character:castView(c)};});
  });
  r.patch('/api/forge/cast/:cid',async({req,params,body})=>{await ownCast(req,params.cid);
    return mutate(db=>{const c=ensure(db).cast[params.cid];for(const k of ['name','role','notes'])if(k in body)c[k]=String(body[k]||'').slice(0,k==='notes'?1000:80);return {character:castView(c)};});});
  r.del('/api/forge/cast/:cid',async({req,params})=>{await ownCast(req,params.cid);
    await mutate(db=>{delete ensure(db).cast[params.cid];return true;});await fsp.rm(path.join(CAST,params.cid),{recursive:true,force:true});return {ok:true};});
  r.post('/api/forge/cast/:cid/view/:view',async({req,params})=>{
    const {c}=await ownCast(req,params.cid);const view=params.view;if(!VIEWS[view])throw new HttpError(400,'Unknown angle');
    const dir=path.join(CAST,c.id);await fsp.mkdir(dir,{recursive:true});
    const {files,fields}=await readMultipart(req,{dir,limit:25*1024*1024,maxFiles:1});const up=files[0];if(!up)throw new HttpError(400,'Choose an image');
    const buf=await fsp.readFile(up.path);let s;try{s=checkPhoto(buf,view);}catch(e){await fsp.rm(up.path,{force:true});throw e;}
    const file=`${view}${IMG_EXT[s.mime]}`;for(const ext of Object.values(IMG_EXT))await fsp.rm(path.join(dir,view+ext),{force:true});
    await fsp.rename(up.path,path.join(dir,file));
    let checks=null;try{checks=JSON.parse(fields.checks||'null');}catch{}
    return mutate(db=>{const x=ensure(db).cast[c.id];x.views[view]={file,w:s.w,h:s.h,mime:s.mime,checks,at:now()};return {character:castView(x)};});
  });
  r.del('/api/forge/cast/:cid/view/:view',async({req,params})=>{const {c}=await ownCast(req,params.cid);const v=c.views?.[params.view];if(v)await fsp.rm(path.join(CAST,c.id,v.file),{force:true});
    return mutate(db=>{const x=ensure(db).cast[c.id];delete x.views[params.view];return {character:castView(x)};});});
  r.get('/api/forge/cast/:cid/view/:view',async({req,res,params})=>{const {c}=await ownCast(req,params.cid);const v=c.views?.[params.view];if(!v)nf('no image');send(res,path.join(CAST,c.id,v.file),v.mime);});

  // ---------------- generator jobs
  r.get('/api/forge/projects/:fid/gen3d',async({req,params})=>{const {f,p}=await ownProject(req,params.fid);
    return {jobs:Object.values(f.gen3d||{}).filter(g=>g.projectId===p.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(genView)};});
  r.get('/api/forge/gen3d/:gid',async({req,params})=>({job:genView((await ownGen(req,params.gid)).g)}));
  r.post('/api/forge/projects/:fid/gen3d',async({req,params})=>{
    const {p,db}=await ownProject(req,params.fid);
    const gid=nanoid(10);const dir=path.join(G,gid,'in');await fsp.mkdir(dir,{recursive:true});
    const {files,fields}=await readMultipart(req,{dir,limit:25*1024*1024,maxFiles:8});
    const fail=async m=>{await fsp.rm(path.join(G,gid),{recursive:true,force:true});throw new HttpError(400,m);};
    const recipe=RECIPES[fields.recipe]?fields.recipe:null;if(!recipe)await fail('Choose what you are making');
    const R=RECIPES[recipe];const name=String(fields.name||'').trim().slice(0,80)||R.label;
    const inputs=[];
    // photos from a cast member, then any uploaded now (uploads win)
    if(fields.castId){const c=ensure(db).cast?.[fields.castId];if(!c||c.ownerId!==p.ownerId)await fail('Character not found');
      for(const [view,v] of Object.entries(c.views||{})){const to=`${view}${path.extname(v.file)}`;await fsp.copyFile(path.join(CAST,c.id,v.file),path.join(dir,to));inputs.push({view,file:to,w:v.w,h:v.h,mime:v.mime});}}
    for(const up of files){const view=String(up.fieldname||'').replace(/^view_/,'');if(!VIEWS[view]){await fsp.rm(up.path,{force:true});continue;}
      const buf=await fsp.readFile(up.path);let s;try{s=checkPhoto(buf,view);}catch(e){await fail(e.message);}
      const to=`${view}${IMG_EXT[s.mime]}`;await fsp.rename(up.path,path.join(dir,to));const i=inputs.findIndex(x=>x.view===view);const rec={view,file:to,w:s.w,h:s.h,mime:s.mime};if(i>=0)inputs[i]=rec;else inputs.push(rec);}
    const missing=R.views.filter(v=>!inputs.some(i=>i.view===v));
    if(missing.length)await fail(`AAA ${R.label.toLowerCase()} models need these angles: ${missing.map(v=>VIEWS[v].label).join(', ')}.`);
    const want=String(fields.providers||'best');const ready=readyProviders();
    const use=want==='best'?ready:ready.filter(x=>x===want);
    if(!use.length)await fail(ready.length?`${PROVIDERS[want]?.label||want} is not connected.`:'No 3D generator is connected yet. The site owner adds RODIN_API_KEY and/or MESHY_API_KEY in the server settings.');
    const size=Number(fields.size_m)>0?Math.min(500,Number(fields.size_m)):(R.height_m||R.length_m||R.size_m);
    const g={id:gid,projectId:p.id,ownerId:p.ownerId,recipe,name,castId:fields.castId||null,size_m:size,notes:String(fields.notes||'').slice(0,800),
      inputs,state:'GENERATING',createdAt:now(),updatedAt:now(),
      candidates:use.map(provider=>({provider,label:PROVIDERS[provider].label,state:'GENERATING',progress:0,files:[],finished:[],report:null,verdict:null}))};
    await mutate(db2=>{const f=ensure(db2);f.gen3d ||= {};f.gen3d[gid]=g;return true;});
    void runGeneration(gid);
    return {job:genView(g)};
  });
  r.get('/api/forge/gen3d/:gid/input/:view',async({req,res,params})=>{const {g}=await ownGen(req,params.gid);const i=g.inputs.find(x=>x.view===params.view);if(!i)nf('no image');send(res,path.join(G,g.id,'in',i.file),i.mime);});
  r.get('/api/forge/gen3d/:gid/file/:prov/:which/:name',async({req,res,params})=>{
    const {g}=await ownGen(req,params.gid);const c=g.candidates.find(x=>x.provider===params.prov);if(!c)nf('no result');
    const list=params.which==='final'?c.finished:c.files;const name=path.basename(params.name);if(!list.some(f=>f.name===name))nf('file not found');
    send(res,path.join(G,g.id,c.provider,params.which==='final'?'final':'raw',name),TYPE(name));
  });
  r.post('/api/forge/gen3d/:gid/retry',async({req,params})=>{const {g}=await ownGen(req,params.gid);
    await mutate(db=>{const x=ensure(db).gen3d[g.id];x.state='GENERATING';for(const c of x.candidates)if(c.state==='FAILED'||c.state==='BLOCKED')Object.assign(c,{state:'GENERATING',progress:0,error:null});x.updatedAt=now();return true;});
    void runGeneration(g.id);return {ok:true};});
  // Re-run only the finishing on the worker (for example after installing Blender).
  r.post('/api/forge/gen3d/:gid/finish',async({req,params})=>{const {g}=await ownGen(req,params.gid);await queueFinish(g.id,true);return {ok:true};});
  r.post('/api/forge/gen3d/:gid/approve',async({req,params,body})=>{
    const {g,db}=await ownGen(req,params.gid);const c=g.candidates.find(x=>x.provider===body.provider);if(!c)nf('no result');
    if(!c.verdict?.aaa&&!body.override)throw new HttpError(409,'This result did not pass every AAA check. Fix and re-run, or approve it as "below AAA" on purpose.');
    const f=ensure(db);const p=f.projects[g.projectId];
    const out=await mutate(db2=>{const f2=ensure(db2);const x=f2.gen3d[g.id];x.approved=c.provider;x.state='APPROVED';x.updatedAt=now();
      const a={id:nanoid(10),projectId:x.projectId,name:x.name,type:`${RECIPES[x.recipe].kind}/3d`,source:'Duke 3D Generator',provider:c.label,recipe:x.recipe,revision:1,
        status:c.verdict?.aaa?'AAA-checked 3D model':'3D model (below AAA, approved on purpose)',gen3d:x.id,createdAt:now(),provenance:{provider:c.label,inputs:x.inputs.map(i=>i.view),recipe:x.recipe}};
      f2.assets ||= {};f2.assets[a.id]=a;
      if(x.castId&&f2.cast?.[x.castId]){const m=f2.cast[x.castId].models ||= [];m.push({gen3d:x.id,provider:c.provider,at:now()});}
      let j=null;
      if(p?.status==='ready'&&c.finished.some(ff=>/\.fbx$/i.test(ff.name))){
        j=newJob(p,'gen3d_import',`Import ${x.name} into Unreal`,[step('editor.start',{pixel:true}),step('gen3d.import',{gen:x.id,provider:c.provider,name:x.name,kind:RECIPES[x.recipe].kind},{label:'Copy the finished model into the Unreal project and import it',role:'Technical artist'}),
          step('git.commit',{message:`Duke 3D Generator: ${x.name}`})]);f2.jobs[j.id]=j;touch(db2,j);}
      return {asset:a,job:j?{id:j.id}:null};});
    const tok=workerOf(await load(),g.ownerId);if(tok)wake(tok);return out;
  });

  // ---------------- worker side
  r.get('/api/agent/forge/gen3d/:gid/:prov/raw.zip',async({req,res,params})=>{
    const {agent,db}=await agentTok(req);const g=ensure(db).gen3d?.[params.gid];if(!g||g.ownerId!==agent.userId)nf('3D job not found');
    const c=g.candidates.find(x=>x.provider===params.prov);if(!c)nf('no result');
    const entries=[];for(const f of c.files)entries.push({name:'raw/'+f.name,data:await fsp.readFile(path.join(G,g.id,c.provider,'raw',f.name))});
    for(const i of g.inputs)entries.push({name:'inputs/'+i.file,data:await fsp.readFile(path.join(G,g.id,'in',i.file))});
    entries.push({name:'job.json',data:Buffer.from(JSON.stringify({id:g.id,name:g.name,recipe:g.recipe,size_m:g.size_m,spec:RECIPES[g.recipe],provider:c.provider}))});
    const zip=createZip(entries);res.writeHead(200,{'content-type':'application/zip','content-length':zip.length});res.end(zip);
  });
  r.get('/api/agent/forge/gen3d/:gid/:prov/final',async({req,params})=>{
    const {agent,db}=await agentTok(req);const g=ensure(db).gen3d?.[params.gid];if(!g||g.ownerId!==agent.userId)nf('3D job not found');
    const c=g.candidates.find(x=>x.provider===params.prov);return {files:(c?.finished||[]).map(f=>f.name).filter(n=>!/^render_|\.blend$|report\.json$/.test(n))};});
  r.get('/api/agent/forge/gen3d/:gid/:prov/final/:name',async({req,res,params})=>{
    const {agent,db}=await agentTok(req);const g=ensure(db).gen3d?.[params.gid];if(!g||g.ownerId!==agent.userId)nf('3D job not found');
    const name=path.basename(params.name);const c=g.candidates.find(x=>x.provider===params.prov);if(!c?.finished.some(f=>f.name===name))nf('file not found');
    send(res,path.join(G,g.id,params.prov,'final',name),TYPE(name));});
  r.post('/api/agent/forge/gen3d/:gid/:prov/file',async({req,params,query})=>{
    const {agent,db}=await agentTok(req);const g=ensure(db).gen3d?.[params.gid];if(!g||g.ownerId!==agent.userId)nf('3D job not found');
    const name=path.basename(String(query.get('name')||'')).replace(/[^\w.\-]/g,'_').slice(0,100);if(!name)throw new HttpError(400,'name');
    const dir=path.join(G,g.id,params.prov,'final');await fsp.mkdir(dir,{recursive:true});let size=0;
    await new Promise((res,rej)=>{const w=fs.createWriteStream(path.join(dir,name));req.on('data',d=>{size+=d.length;if(size>2*1024**3){req.destroy();rej(new HttpError(413,'Too large'));}});req.pipe(w);w.on('finish',res);w.on('error',rej);});
    await mutate(db2=>{const c=ensure(db2).gen3d[g.id].candidates.find(x=>x.provider===params.prov);if(c){c.finished=c.finished.filter(x=>x.name!==name);c.finished.push({name,size});}return true;});
    return {ok:true,size};
  });
  r.post('/api/agent/forge/gen3d/:gid/:prov/report',async({req,params,body})=>{
    const {agent}=await agentTok(req);
    const out=await mutate(db=>{const x=ensure(db).gen3d?.[params.gid];if(!x||x.ownerId!==agent.userId)nf('3D job not found');
      const c=x.candidates.find(y=>y.provider===params.prov);if(!c)nf('no result');
      c.report={...(body.report||{}),target_size_m:x.size_m};c.verdict=judge(x.recipe,c.report);
      const rig=RECIPES[x.recipe].finish?.rig&&meshyReady();
      c.state=rig?'RIGGING':c.verdict.aaa?'AAA':'BELOW_AAA';c.progress=rig?90:100;
      settle(x);x.updatedAt=now();emit(x.ownerId,{type:'gen3d',job:{id:x.id,state:x.state}});return {verdict:c.verdict,rig};});
    if(out.rig)void rigCharacter(params.gid,params.prov);
    return out;
  });

  // Characters: an automatic humanoid skeleton (Meshy auto-rigging) on the finished model, plus walk and run.
  async function rigCharacter(gid,prov){
    const g=ensure(await load()).gen3d[gid];const c=g?.candidates.find(x=>x.provider===prov);if(!c)return;
    const glb=c.finished.find(f=>/^SM_.*\.glb$/.test(f.name));
    try{
      if(!glb)throw new Error('No finished GLB to rig');
      const dir=path.join(G,gid,prov,'final');const buf=await fsp.readFile(path.join(dir,glb.name));
      if(buf.length>95*1024*1024)throw new Error('The finished model is too large to auto-rig (over 95 MB)');
      const res=await rigModel(`data:model/gltf-binary;base64,${buf.toString('base64')}`,g.size_m);
      const base=glb.name.replace(/^SM_/,'SK_').replace(/\.glb$/,'');
      const files=[{name:`${base}.fbx`,url:res.fbx},{name:`${base}.glb`,url:res.glb},...res.anims.map(a=>({name:`A_${base.slice(3)}_${a.name}.fbx`,url:a.fbx}))].filter(f=>f.url);
      const saved=await saveFiles(files,dir);
      await update(gid,prov,(cc,x)=>{for(const f of saved){cc.finished=cc.finished.filter(y=>y.name!==f.name);cc.finished.push(f);}
        cc.report={...cc.report,rig:'humanoid',animations:res.anims.map(a=>a.name)};cc.verdict=judge(x.recipe,cc.report);cc.state=cc.verdict.aaa?'AAA':'BELOW_AAA';cc.progress=100;});
    }catch(e){await update(gid,prov,(cc,x)=>{cc.report={...cc.report,rig_error:String(e.message||e).slice(0,300)};cc.verdict=judge(x.recipe,cc.report);cc.verdict.fails.push(`Auto-rigging failed: ${String(e.message||e).slice(0,200)}`);cc.verdict.aaa=false;cc.state='BELOW_AAA';cc.progress=100;});}
  }
  // ---------------- the run: generate with every connected provider at once, then queue finishing
  const settle=x=>{const st=x.candidates.map(c=>c.state);
    x.state=x.approved?'APPROVED':st.includes('AAA')&&!st.some(s=>['GENERATING','FINISHING','RIGGING'].includes(s))?'READY':st.every(s=>['FAILED','BELOW_AAA','BLOCKED'].includes(s))?(st.includes('BELOW_AAA')?'BELOW_AAA':'FAILED'):st.includes('RIGGING')?'RIGGING':st.includes('FINISHING')?'FINISHING':st.includes('AAA')?'READY':'GENERATING';};
  async function update(gid,prov,fn){return mutate(db=>{const x=ensure(db).gen3d?.[gid];if(!x)return null;const c=x.candidates.find(y=>y.provider===prov);if(c)fn(c,x);settle(x);x.updatedAt=now();emit(x.ownerId,{type:'gen3d',job:{id:x.id,state:x.state}});return true;});}
  async function runGeneration(gid){
    const g=ensure(await load()).gen3d[gid];if(!g)return;const R=RECIPES[g.recipe];
    const order=['front','back','left','right','three_quarter','detail'];
    const imgs=[];for(const v of order){const i=g.inputs.find(x=>x.view===v);if(i)imgs.push({name:i.file,mime:i.mime,buf:await fsp.readFile(path.join(G,g.id,'in',i.file))});}
    await Promise.all(g.candidates.filter(c=>c.state==='GENERATING').map(async c=>{
      const P=PROVIDERS[c.provider];
      try{
        const params={...R.providers[c.provider]};
        if(c.provider==='meshy'&&g.notes)params.texture_prompt=g.notes.slice(0,800);
        let last=0;
        const res=await P.run(imgs.slice(0,P.maxImages),params,{onProgress:pct=>{if(pct-last>=5){last=pct;void update(gid,c.provider,cc=>{cc.progress=Math.round(pct*0.6);});}}});
        const files=await saveFiles(res.files,path.join(G,gid,c.provider,'raw'));
        await update(gid,c.provider,cc=>{cc.taskId=res.taskId;cc.files=files;cc.state='FINISHING';cc.progress=60;});
      }catch(e){await update(gid,c.provider,cc=>{cc.state='FAILED';cc.error=String(e.message||e).slice(0,500);});}
    }));
    await queueFinish(gid);
  }
  // AAA finishing runs on the creator's GPU worker (Duke app + Blender), one job per 3D request.
  async function queueFinish(gid,again){
    let tok=null;
    await mutate(db=>{const f=ensure(db);const x=f.gen3d?.[gid];if(!x)return null;
      const todo=x.candidates.filter(c=>c.files.length&&(again||c.state==='FINISHING'));if(!todo.length)return null;
      for(const c of todo){c.state='FINISHING';c.progress=Math.max(c.progress,60);}
      const p=f.projects[x.projectId];if(!p)return null;
      const j=newJob(p,'gen3d',`AAA finishing: ${x.name}`,todo.map(c=>step('gen3d.finish',{gen:x.id,provider:c.provider,recipe:x.recipe},{label:`Finish the ${c.label} model to the AAA spec (clean, scale, LODs, collision, renders, checks)`,role:'Technical artist'})));
      f.jobs[j.id]=j;x.finishJob=j.id;touch(db,j);settle(x);tok=workerOf(db,x.ownerId);return true;});
    if(tok)wake(tok);
  }
  // Finishing failed on the worker: show it on the candidate.
  return {onFinishFailed:async(gid,prov,err)=>update(gid,prov,c=>{c.state='BLOCKED';c.error=String(err||'Finishing failed').slice(0,800);})};
}
