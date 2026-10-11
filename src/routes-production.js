// HTTP routes for the production pipeline, Director, asset jobs, builds and the PC build agent.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { load, mutate } from './store.js';
import { HttpError, id as nanoid, readMultipart, send } from './http.js';
import { STAGES, COLLECTIONS, FIELD_HOME, ensureDesign, pipelineStatus, publicSchema } from './pipeline.js';
import * as director from './director.js';
import { runArt, validateStep, entityDir, ART_STEPS } from './art.js';
import { npcReply } from './providers/duke-ai.js';
import { buildUnrealProject } from './unreal/generate.js';
import { createZip } from './zip.js';
import { UPLOAD_DIR, DATA_DIR } from './paths.js';
import { meshyReady } from './meshy.js';
import { brainName } from './brain.js';
import { settle, agentFor, ctxFor, ownerOf } from './ctx.js';
import { requireFeature, spendCredits, CREDIT_COST, can } from './billing.js';
import { requireUser } from './auth.js';
import { evaluate } from './progress.js';
import { gameData } from './unreal/generate.js';

const now=()=>new Date().toISOString();
const nf=(w='not found')=>{throw new HttpError(404,w);};
const BUILD_DIR=path.join(UPLOAD_DIR,'builds');
const MAX_TEXT=6000;

function clean(field,v){
  if(field.type==='number'){if(v===''||v==null)return null;const n=Number(v);if(!Number.isFinite(n))throw new HttpError(400,`${field.label} must be a number`);return n;}
  if(field.type==='bool')return !!v;
  if(field.type==='list')return (Array.isArray(v)?v:String(v||'').split('\n')).map(x=>String(x).trim().slice(0,300)).filter(Boolean).slice(0,40);
  if(field.type==='select'&&field.options?.length&&v&&!field.options.includes(v))throw new HttpError(400,`${field.label}: choose one of ${field.options.join(', ')}`);
  return String(v??'').slice(0,MAX_TEXT);
}
function applyFields(target,fields,values,{onlyEmpty=false}={}){
  for(const f of fields){if(!(f.key in values))continue;
    if(onlyEmpty){const cur=target[f.key];if(Array.isArray(cur)?cur.length:cur!==undefined&&cur!==null&&String(cur).trim()!=='')continue;}
    target[f.key]=clean(f,values[f.key]);}
}
async function withProject(id,fn){
  const out=await mutate(db=>{const p=db.projects[id];if(!p)return null;settle(db,p);const r=fn(p,db);settle(db,p);p.updatedAt=now();return r===undefined?p:r;});
  if(out===null)nf('project not found');return out;
}
async function getProject(id){const db=await load();const p=db.projects[id];if(!p)nf('project not found');settle(db,p);return {p,db};}
const statusOf=p=>({...pipelineStatus(p),coach:director.coach(p)});
const view=p=>({project:p,status:statusOf(p)});

async function streamToFile(req,file,limit){
  await fsp.mkdir(path.dirname(file),{recursive:true});
  return new Promise((resolve,reject)=>{
    let size=0;const out=fs.createWriteStream(file);
    req.on('data',c=>{size+=c.length;if(size>limit){req.destroy();out.destroy();reject(new HttpError(413,'Build too large'));}});
    req.on('error',reject);out.on('error',reject);out.on('finish',()=>resolve(size));req.pipe(out);
  });
}
// Each creator has their own agent token. CLOUD_AGENT_TOKEN identifies the shared cloud build server (Studio plan).
const isCloud=tok=>!!process.env.CLOUD_AGENT_TOKEN&&tok===process.env.CLOUD_AGENT_TOKEN;
async function agentAuth(req){
  const db=await load();const tok=String(req.headers['x-duke-agent']||'');
  if(isCloud(tok))return {db,cloud:true,tok};
  const a=tok&&db.agents?.[tok];
  if(!a)throw new HttpError(401,'Invalid agent token. Download a fresh DukeSetup.cmd from Duke Forger.');
  return {db,agent:a,tok};
}
const mayTouch=(auth,p,b)=>auth.cloud?!!b?.cloud:p.ownerId===auth.agent.userId;
const buildLog=(b,lines)=>{for(const l of [].concat(lines||[]))if(l)b.logs.push(String(l).slice(0,1000));if(b.logs.length>600)b.logs.splice(0,b.logs.length-600);};

export function registerProduction(r){
  r.get('/api/pipeline',()=>({...publicSchema(),meshy:meshyReady(),brain:brainName()}));
  r.get('/api/projects/:id/status',async({params})=>{const {p}=await getProject(params.id);return statusOf(p);});

  r.patch('/api/projects/:id/stage/:stage',async({params,body})=>{
    const stage=STAGES.find(s=>s.id===params.stage);if(!stage?.fields)nf('stage not found');
    const p=await withProject(params.id,p=>{const home=p.design[FIELD_HOME[stage.id]] ||= {};applyFields(home,stage.fields,body.values||{});
      if(stage.id==='vision'&&body.values?.title)p.name=String(body.values.title).slice(0,120);});
    return view(p);
  });

  // ---- entity collections ----
  const coll=c=>{if(!COLLECTIONS[c])nf('unknown collection');return COLLECTIONS[c];};
  r.post('/api/projects/:id/design/:collection',async({params,body})=>{
    const c=coll(params.collection);
    const p=await withProject(params.id,p=>{const list=p.design[params.collection] ||= [];if(list.length>=60)throw new HttpError(400,'Too many items');
      const e={id:nanoid(8),createdAt:now()};applyFields(e,c.fields,body.values||{});list.push(e);});
    return view(p);
  });
  r.patch('/api/projects/:id/design/:collection/:eid',async({params,body})=>{
    const c=coll(params.collection);
    const p=await withProject(params.id,p=>{const e=(p.design[params.collection]||[]).find(x=>x.id===params.eid);if(!e)nf('item not found');
      applyFields(e,c.fields,body.values||{});
      if(body.yaw!=null){e.art ||= {};e.art.yaw=((Math.round(Number(body.yaw)/90)*90)%360+360)%360;}});
    return view(p);
  });
  r.del('/api/projects/:id/design/:collection/:eid',async({params})=>{
    coll(params.collection);
    const p=await withProject(params.id,p=>{const list=p.design[params.collection]||[];const i=list.findIndex(x=>x.id===params.eid);if(i<0)nf('item not found');list.splice(i,1);});
    return view(p);
  });

  // ---- art production ----
  r.post('/api/projects/:id/design/:collection/:eid/art/approve',async({params,body})=>{
    const p=await withProject(params.id,p=>{const e=(p.design[params.collection]||[]).find(x=>x.id===params.eid);if(!e)nf('item not found');
      if(!(e.art?.concepts||[]).some(c=>c.url===body.url))throw new HttpError(400,'Pick one of this item\'s concept images');
      e.art.approved=body.url;});
    return view(p);
  });
  r.post('/api/projects/:id/design/:collection/:eid/art/upload',async({req,params})=>{
    const c=coll(params.collection);if(!c.art)throw new HttpError(400,'This item has no art');
    const {p:p0}=await getProject(params.id);const e0=(p0.design[params.collection]||[]).find(x=>x.id===params.eid);if(!e0)nf('item not found');
    const {dir,pub}=entityDir(params.id,params.eid);await fsp.mkdir(dir,{recursive:true});
    const {files,fields}=await readMultipart(req,{dir,limit:300*1024*1024,maxFiles:8});
    const slot=fields.slot||'auto';
    const placed=[];
    for(const f of files){
      const ext=path.extname(f.originalname).toLowerCase();let name;
      if(['.png','.jpg','.jpeg'].includes(ext)&&(slot==='auto'||slot==='concept'))name=`concept_upload_${Date.now()}${ext}`;
      else if(ext==='.glb'&&slot==='auto')name='model.glb';
      else if(ext==='.fbx'&&(slot==='auto'||slot==='model'))name='model.fbx';
      else if(ext==='.glb'&&slot==='model')name='model.glb';
      else if(ext==='.fbx'&&slot==='rig')name='rig.fbx';
      else if(ext==='.fbx'&&slot.startsWith('anim:'))name=`anim_${slot.slice(5).replace(/[^a-z]/g,'')}.fbx`;
      else{await fsp.rm(f.path,{force:true});throw new HttpError(400,`${f.originalname}: upload PNG/JPG concepts, GLB/FBX models, or FBX rigs/animations`);}
      await fsp.rename(f.path,path.join(dir,name));placed.push({name,url:`${pub}/${name}`});
    }
    const p=await withProject(params.id,p=>{const e=(p.design[params.collection]||[]).find(x=>x.id===params.eid);if(!e)nf('item not found');const a=e.art ||= {};
      for(const {name,url} of placed){
        if(name.startsWith('concept')){a.concepts=[...(a.concepts||[]),{url,at:now(),source:'upload'}];a.approved=url;}
        else if(name.startsWith('model')){a.model={...(a.model&&!a.model.taskId?a.model:{}),[name.endsWith('.glb')?'glb':'fbx']:url,source:'upload'};}
        else if(name==='rig.fbx')a.rig={fbx:url,source:'upload'};
        else if(name.startsWith('anim_')){const k=name.slice(5,-4);a.anims={...(a.anims||{}),[k]:{fbx:url,source:'upload'}};}
      }});
    return view(p);
  });
  r.post('/api/projects/:id/design/:collection/:eid/art/:step',async({req,params})=>{
    const c=coll(params.collection);if(!ART_STEPS.includes(params.step))nf('unknown step');
    const {p:p0}=await getProject(params.id);const e0=(p0.design[params.collection]||[]).find(x=>x.id===params.eid);if(!e0)nf('item not found');
    try{validateStep(e0,params.collection,params.step);}catch(err){throw new HttpError(400,err.message);}
    if(e0.art?.busy)throw new HttpError(409,`Already working on ${e0.art.busy}`);
    const user=await requireUser(req);requireFeature(user,'build','3D generation');
    const jobId=nanoid(10),cost=CREDIT_COST[params.step]||0;
    await mutate(db=>{const p=db.projects[params.id];const e=p.design[params.collection].find(x=>x.id===params.eid);
      spendCredits(db,user.id,cost,`${params.step==='anims'?'Animation':params.step[0].toUpperCase()+params.step.slice(1)} generation`);
      e.art ||= {};e.art.busy=params.step;e.art.job=jobId;
      db.jobs[jobId]={id:jobId,type:'art',step:params.step,projectId:params.id,collection:params.collection,entityId:params.eid,status:'running',progress:2,logs:[`Starting ${params.step} for ${e.name||c.label} (${cost} credits)`],tasks:{},createdAt:now(),
        chargedTo:user.id,credits:cost,creditPeriod:db.users[user.id]?.credits?.period||null};return true;});
    void runArt(jobId);
    return (await load()).jobs[jobId];
  });

  // ---- talk to a cast member (used by the live preview) ----
  r.post('/api/projects/:id/design/characters/:eid/chat',async({params,body})=>{
    const {p}=await getProject(params.id);const ch=(p.design.characters||[]).find(x=>x.id===params.eid);if(!ch)nf('character not found');
    const msg=String(body.message||'').slice(0,1500);
    const npc={name:ch.name,role:ch.role,bio:[ch.personality,ch.backstory,ch.dialogue&&`Signature lines: ${ch.dialogue}`].filter(Boolean).join(' '),autonomy:'guided',memory:ch.memory||[]};
    const out=await npcReply(npc,msg,{game:p.design.vision?.title,setting:p.design.vision?.setting,story:p.design.story?.premise});
    await withProject(params.id,p=>{const c=(p.design.characters||[]).find(x=>x.id===params.eid);if(c){(c.memory ||= []).push({...(out.memory||{summary:msg.slice(0,120)}),at:now()});c.memory=c.memory.slice(-50);}});
    return out;
  });

  // ---- Director ----
  r.post('/api/projects/:id/director/draft',async({params,body})=>{
    const stage=STAGES.find(s=>s.id===body.stage);if(!stage?.fields)nf('stage not found');
    const {p:p0}=await getProject(params.id);
    const {values,source}=await director.draftStage(stage.id,p0);
    const p=await withProject(params.id,p=>{const home=p.design[FIELD_HOME[stage.id]] ||= {};applyFields(home,stage.fields,values,{onlyEmpty:!body.overwrite});
      if(stage.id==='vision'&&home.title&&(!p.name||p.name==='Untitled Dream'||p.name==='My First Dream'))p.name=home.title;});
    return {...view(p),source};
  });
  r.post('/api/projects/:id/director/propose',async({params,body})=>{
    const c=coll(body.collection);const count=Math.max(1,Math.min(5,Number(body.count)||1));
    const {p:p0}=await getProject(params.id);
    const {items,source}=await director.draftEntities(body.collection,p0,count,String(body.hint||'').slice(0,500));
    const p=await withProject(params.id,p=>{const list=p.design[body.collection] ||= [];for(const it of items){const e={id:nanoid(8),createdAt:now()};applyFields(e,c.fields,it);list.push(e);}});
    return {...view(p),source};
  });
  r.post('/api/projects/:id/director/ask',async({params,body})=>{const {p}=await getProject(params.id);return director.ask(p,String(body.question||'').slice(0,1500));});

  // ---- Unreal project + builds ----
  r.get('/api/projects/:id/unreal.zip',async({params,res})=>{
    const {p}=await getProject(params.id);
    const {zip,name}=await buildUnrealProject(p);
    send(res,200,zip,{'content-type':'application/zip','content-length':zip.length,'content-disposition':`attachment; filename="${name}.zip"`});
  });
  r.post('/api/projects/:id/builds',async({req,params,body})=>{
    const user=await requireUser(req);requireFeature(user,'build','Building your game');
    const {p:p0,db}=await getProject(params.id);
    const ev=evaluate(p0,'studio',ctxFor(db,p0));
    if(ev.steps[20].status==='locked')throw new HttpError(400,'Builds open at step 21. Finish the steps before it first.');
    if((p0.builds||[]).some(b=>['queued','running'].includes(b.status)))throw new HttpError(409,'A build is already in progress');
    const cloud=!!body.cloud;if(cloud)requireFeature(user,'cloud','Cloud builds');
    const insp=ctxFor(db,p0).inspect;
    const source=!cloud&&body.source==='mine'?'mine':'duke';
    if(source==='mine'&&!insp?.exists)throw new HttpError(400,'Duke has not found your Unreal project on your PC yet (step 11).');
    if(cloud&&!process.env.CLOUD_AGENT_TOKEN)throw new HttpError(503,'Cloud builds are not set up on this server yet.');
    const config=['Shipping','Development'].includes(body.config)?body.config:p0.design.build?.config||'Shipping';
    const b={id:nanoid(10),status:'queued',phase:cloud?'Waiting for the cloud build server':'Waiting for your PC',progress:0,logs:['Build queued'],config,cloud,source,
      localProject:source==='mine'?insp.path:null,createdAt:now()};
    const p=await withProject(params.id,p=>{(p.builds ||= []).unshift(b);p.builds=p.builds.slice(0,20);});
    return {build:b,...view(p)};
  });
  r.get('/api/projects/:id/builds/:bid',async({params})=>{const {p}=await getProject(params.id);return (p.builds||[]).find(b=>b.id===params.bid)||nf('build not found');});
  r.post('/api/projects/:id/builds/:bid/cancel',async({params})=>view(await withProject(params.id,p=>{const b=(p.builds||[]).find(x=>x.id===params.bid);if(!b)nf('build not found');if(['queued','running'].includes(b.status)){b.status='canceled';b.phase='Canceled';buildLog(b,'Canceled by creator');}})));
  r.get('/api/projects/:id/builds/:bid/download',async({params,res})=>{
    const {p}=await getProject(params.id);const b=(p.builds||[]).find(x=>x.id===params.bid);if(!b?.artifact)nf('no build file');
    const file=path.join(BUILD_DIR,b.artifact.file);const st=await fsp.stat(file).catch(()=>null);if(!st)nf('build file missing');
    res.writeHead(200,{'content-type':'application/zip','content-length':st.size,'content-disposition':`attachment; filename="${b.artifact.name}"`});
    fs.createReadStream(file).pipe(res);
  });

  // ---- PC build agent ----
  const serverUrl=req=>process.env.SITE_URL?.replace(/\/$/,'')||`${req.headers['x-forwarded-proto']||'http'}://${req.headers['x-forwarded-host']||req.headers.host}`;
  const myAgent=async user=>mutate(db=>{db.agents ||= {};let a=agentFor(db,user.id);
    if(!a){const tok=randomBytes(18).toString('base64url');a=db.agents[tok]={token:tok,userId:user.id,createdAt:now(),inspect:{}};}return a;});
  r.get('/api/agent/setup',async({req})=>{
    const user=await requireUser(req);const a=await myAgent(user);const server=serverUrl(req);
    return {server,seenAt:a.seenAt||null,machine:a.machine||null,inspect:a.inspect||{},
      command:`python duke_agent.py --server ${server} --token ${a.token}`,download:'/agent/duke_agent.py'};
  });
  // One-click Windows setup: installs Python, VS C++ build tools, Epic Games Launcher and the agent (auto-start).
  r.get('/api/agent/DukeSetup.cmd',async({req,res})=>{
    const user=await requireUser(req);const a=await myAgent(user);const server=serverUrl(req),token=a.token;
    const cmd=`@echo off\r\ntitle Duke Forger PC setup\r\necho Setting up this PC to build Duke Forger games...\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '${server}/api/agent/setup.ps1?t=${token}' -OutFile \\"$env:TEMP\\DukeSetup.ps1\\"; & \\"$env:TEMP\\DukeSetup.ps1\\""\r\npause\r\n`;
    send(res,200,cmd,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="DukeSetup.cmd"'});
  });
  r.get('/api/agent/setup.ps1',async({req,res,query})=>{
    const db=await load();const token=String(query.get('t')||'');if(!token||!db.agents?.[token])throw new HttpError(401,'Invalid setup link');
    send(res,200,setupPs1(serverUrl(req),token),{'content-type':'text/plain; charset=utf-8'});
  });
  const str=(v,n)=>String(v??'').slice(0,n);
  r.post('/api/agent/hello',async({req,body})=>{
    const auth=await agentAuth(req);
    if(auth.cloud)return {ok:true,cloud:true,watch:[]};
    return mutate(db=>{const a=db.agents[auth.tok];a.seenAt=now();
      const t=body.tools||{};
      a.machine={host:str(body.host,80),os:str(body.os,80),engines:(body.engines||[]).slice(0,8).map(x=>str(x,12)),visualStudio:!!body.visualStudio,python:str(body.python,20),version:str(body.version,20),
        cpu:str(body.cpu,120),cpuCores:Number(body.cpuCores)||null,ramGB:Number(body.ramGB)||null,
        gpus:(Array.isArray(body.gpus)?body.gpus:[]).slice(0,4).map(g=>({name:str(g.name,120),vramGB:Math.round((Number(g.vramGB)||0)*10)/10})),
        tools:{cc5:t.cc5?str(t.cc5,160):null,headshot:t.headshot?str(t.headshot,160):null,blender:t.blender?str(t.blender,160):null,git:t.git?str(t.git,60):null,lfs:t.lfs?str(t.lfs,60):null}};
      const mine=Object.values(db.projects).filter(p=>p.ownerId===a.userId);
      for(const p of mine)settle(db,p);
      return {ok:true,machine:a.machine,watch:mine.filter(p=>p.roadmap?.answers?.project_path).map(p=>({projectId:p.id,path:p.roadmap.answers.project_path}))};});
  });
  // The agent reports what it found in a linked Unreal project: plugins, folders, Git, design sync.
  r.post('/api/agent/inspect',async({req,body})=>{
    const auth=await agentAuth(req);if(auth.cloud)return {ok:true};
    return mutate(db=>{const a=db.agents[auth.tok];a.seenAt=now();const p=db.projects[body.projectId];
      if(!p||p.ownerId!==a.userId)throw new HttpError(404,'project not found');
      a.inspect ||= {};
      a.inspect[p.id]={path:str(body.path,400),exists:!!body.exists,name:str(body.name,120),engine:str(body.engine,20),
        plugins:(Array.isArray(body.plugins)?body.plugins:[]).slice(0,200).map(x=>str(x,80)),folders:(Array.isArray(body.folders)?body.folders:[]).slice(0,200).map(x=>str(x,80)),
        git:!!body.git,lfs:!!body.lfs,syncedAt:body.synced?now():(a.inspect[p.id]?.syncedAt||null),at:now()};
      const done=settle(db,p);return {ok:true,completed:done};});
  });
  r.get('/api/agent/projects/:pid/design.json',async({req,params})=>{
    const auth=await agentAuth(req);const db=auth.db;const p=db.projects[params.pid];
    if(!p||auth.cloud||p.ownerId!==auth.agent.userId)nf('project not found');
    ensureDesign(p);return {duke:'design',version:1,exportedAt:now(),project:{id:p.id,title:p.design.vision?.title||p.name},game:gameData(p),roadmap:{answers:p.roadmap?.answers||{},requirements:p.roadmap?.requirements||[]}};
  });
  r.post('/api/agent/next',async({req})=>{
    const auth=await agentAuth(req);
    const claim=await mutate(db=>{const a=auth.cloud?null:db.agents[auth.tok];if(a)a.seenAt=now();
      for(const p of Object.values(db.projects))for(const b of p.builds||[])if(b.status==='queued'&&mayTouch(auth,p,b)&&(auth.cloud||!b.cloud)){
        b.status='running';b.phase=b.source==='mine'?'Packaging your Unreal project':'Preparing Unreal project';b.progress=3;b.startedAt=now();buildLog(b,`Picked up by ${auth.cloud?'the cloud build server':a.machine?.host||'build agent'}`);
        const pub=p.design?.publish||{};
        return {build:{id:b.id,projectId:p.id,config:b.config,engineVersion:p.design?.build?.engine_version||'',title:p.design?.vision?.title||p.name,localProject:b.localProject||null,
          publish:pub.itch_user&&pub.itch_game?{itch:`${pub.itch_user}/${pub.itch_game}:${pub.itch_channel||'windows'}`}:null}};
      }
      return {build:null};});
    return claim;
  });
  const agentBuild=async(req,params,fn)=>{
    const auth=await agentAuth(req);
    return mutate(db=>{if(!auth.cloud)db.agents[auth.tok].seenAt=now();
      for(const p of Object.values(db.projects)){const b=(p.builds||[]).find(x=>x.id===params.bid);if(b){if(!mayTouch(auth,p,b))break;const r=fn(b,p,db);return r===undefined?{ok:true,status:b.status}:r;}}
      throw new HttpError(404,'build not found');});
  };
  r.get('/api/agent/builds/:bid/project.zip',async({req,res,params})=>{
    const auth=await agentAuth(req);const db=auth.db;
    const p=Object.values(db.projects).find(p=>(p.builds||[]).some(b=>b.id===params.bid&&mayTouch(auth,p,b)));if(!p)nf('build not found');
    ensureDesign(p);const {zip,name}=await buildUnrealProject(p);
    send(res,200,zip,{'content-type':'application/zip','content-length':zip.length,'content-disposition':`attachment; filename="${name}.zip"`});
  });
  r.post('/api/agent/builds/:bid/log',async({req,params,body})=>agentBuild(req,params,b=>{
    if(b.status==='canceled')return {ok:false,canceled:true};
    buildLog(b,body.lines);if(body.phase)b.phase=String(body.phase).slice(0,120);if(Number.isFinite(body.progress))b.progress=Math.max(0,Math.min(99,body.progress));}));
  r.post('/api/agent/builds/:bid/finish',async({req,params,body})=>agentBuild(req,params,(b,p,db)=>{
    if(b.status==='canceled')return;
    b.status=body.status==='succeeded'?'succeeded':'failed';b.finishedAt=now();b.progress=b.status==='succeeded'?100:b.progress;
    b.phase=b.status==='succeeded'?'Playable build ready':`Failed: ${String(body.error||'see log').slice(0,200)}`;
    if(body.error)b.error=String(body.error).slice(0,2000);if(body.itchUrl)b.itchUrl=String(body.itchUrl).slice(0,300);
    buildLog(b,body.lines);buildLog(b,b.phase);settle(db,p);}));
  r.post('/api/agent/builds/:bid/artifact',async({req,params})=>{
    await agentAuth(req);
    const file=`${params.bid.replace(/[^\w-]/g,'')}.zip`;
    const size=await streamToFile(req,path.join(BUILD_DIR,file),12*1024*1024*1024);
    return agentBuild(req,params,(b,p,db)=>{const safe=(p.design?.vision?.title||p.name||'game').replace(/[^\w-]+/g,'-');b.artifact={file,size,name:`${safe}-${b.config||'Shipping'}-Win64.zip`};buildLog(b,`Uploaded playable build (${(size/1048576).toFixed(1)} MB)`);});
  });
}

function setupPs1(server,token){
  return `# Duke Forger PC setup (generated). Safe to run again: it skips anything already installed.
$ErrorActionPreference = 'Continue'
$Server = '${server}'
$Token = '${token}'
$Dir = Join-Path $env:USERPROFILE 'DukeForge'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
function Say($m, $c='Cyan') { Write-Host $m -ForegroundColor $c }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
Say 'Duke Forger PC setup' 'Yellow'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Say 'winget is missing. Install "App Installer" from the Microsoft Store, then run this again.' 'Red'; exit 1 }
$wg = @('--exact','--silent','--accept-source-agreements','--accept-package-agreements')

# 1. Python
Refresh-Path
$py = Get-Command pythonw -ErrorAction SilentlyContinue
if (-not $py) { Say 'Installing Python 3.12...'; winget install --id Python.Python.3.12 @wg; Refresh-Path; $py = Get-Command pythonw -ErrorAction SilentlyContinue }
if (-not $py) { $cand = Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Python\\Python3*\\pythonw.exe" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($cand) { $py = $cand } }
$pyw = if ($py.Source) { $py.Source } else { $py.FullName }
$pyexe = $pyw -replace 'pythonw.exe$','python.exe'
Say "Python: $pyexe" 'Green'
& $pyexe -m pip install --user --quiet pillow | Out-Null
Say 'Duke Link live view: ready' 'Green'

# 2. Visual Studio C++ build tools (Unreal compiles game code with them)
$vswhere = Join-Path \${env:ProgramFiles(x86)} 'Microsoft Visual Studio\\Installer\\vswhere.exe'
$hasVC = $false
if (Test-Path $vswhere) { $hasVC = [bool](& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) }
if (-not $hasVC) {
  Say 'Installing Visual Studio 2022 C++ build tools (large download, about 10 minutes)...'
  winget install --id Microsoft.VisualStudio.2022.BuildTools @wg --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --add Microsoft.Net.Component.4.8.SDK --includeRecommended'
} else { Say 'Visual Studio C++ tools: already installed' 'Green' }

# 3. Epic Games Launcher (Unreal Engine comes from Epic)
$launcher = Join-Path \${env:ProgramFiles(x86)} 'Epic Games\\Launcher'
if (-not (Test-Path $launcher)) { Say 'Installing Epic Games Launcher...'; winget install --id EpicGames.EpicGamesLauncher @wg } else { Say 'Epic Games Launcher: already installed' 'Green' }

# 4. Duke build agent, started now and at every sign-in
Invoke-WebRequest -UseBasicParsing "$Server/agent/duke_agent.py" -OutFile (Join-Path $Dir 'duke_agent.py')
$agent = Join-Path $Dir 'duke_agent.py'
$agentArgs = '"' + $agent + '" --server ' + $Server + ' --token ' + $Token
schtasks /Create /F /SC ONLOGON /TN 'Duke Forger Build Agent' /TR ('"' + $pyw + '" ' + $agentArgs) | Out-Null
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*duke_agent.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath $pyw -ArgumentList $agentArgs -WindowStyle Hidden
Say 'Duke build agent: running (starts automatically when you sign in)' 'Green'

# 5. Unreal Engine 5
& $pyexe $agent --check
if ($LASTEXITCODE -ne 0) {
  Say ''
  Say 'LAST STEP - install Unreal Engine 5 (Epic requires your own Epic account):' 'Yellow'
  Say '  1. The Epic Games Launcher will open. Sign in (or create a free account).'
  Say '  2. Click Unreal Engine > Library > the + next to ENGINE VERSIONS > Install (latest 5.x).'
  Say '  Duke detects it automatically when the install finishes. You can close this window.'
  Start-Process 'com.epicgames.launcher://ue/library' -ErrorAction SilentlyContinue
} else { Say 'All set. Duke can build your game on this PC.' 'Green' }
`;
}
