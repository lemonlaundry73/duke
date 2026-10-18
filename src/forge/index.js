// Duke Forger V1 orchestrator.
//
// Durable jobs made of steps live in the database; the creator's Unreal worker (the Duke app on a Windows
// GPU PC, or a cloud Windows runner running the same app) pulls one step at a time, does the real work
// (Unreal Build Tool, the Unreal Editor with the Duke Forger plugin, Git, AutomationTool) and reports back
// with logs and evidence. The orchestrator decides what happens next: continue, repair, or block.
// Jobs survive browser closure, server restarts (running steps are re-queued) and worker restarts.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { machineId, seen, isActive, activeMachine, machinesOf } from '../machines.js';
import { registerGen3d } from '../gen3d/index.js';
import { fileURLToPath } from 'node:url';
import { load, mutate } from '../store.js';
import { HttpError, id as nanoid, readBody, readMultipart } from '../http.js';
import { requireUser } from '../auth.js';
import { agentFor } from '../ctx.js';
import { DATA_DIR, ROOT } from '../paths.js';
import { createZip } from '../zip.js';
import { complete, parseJson } from '../providers.js';
import { open as unseal } from '../secrets.js';
import * as gen from './codegen.js';

const FORGE_DIR=path.join(DATA_DIR,'forge');
const now=()=>new Date().toISOString();
const nf=(m='not found')=>{throw new HttpError(404,m);};

export const DEFAULT_SETTINGS={
  project:{engine:'unreal',quality:'aaa',target_platforms:['windows'],target_fps:60,source_control:'git-lfs'},
  autonomy:{enabled:true,auto_fix:true,max_repair_attempts:12,require_test_before_ready:true,require_commit_before_ready:true},
  worlds:{use_world_partition:true,use_data_layers:true,use_hlod:true,pcg_enabled:true},
  graphics:{nanite:'auto',lumen:'auto',virtual_shadow_maps:true,hero_texture_max:4096},
  characters:{control_rig:true,ik:true,motion_matching:true,facial_rig_for_hero_characters:true},
  gameplay:{gameplay_ability_system:true,enhanced_input:true,common_ui:true,data_driven_weapons:true,data_driven_quests:true},
  qa:{compile_check:true,blueprint_check:true,missing_asset_check:true,automated_pie_test:true,screenshot_validation:true,performance_validation:true},
  site:{live_unreal:true,project_file_vault:true,source_editor:true,concept_editor:true,asset_revision_history:true,build_downloads:true},
  storage:{raw_assets:true,generated_assets:true,unreal_assets:true,concepts:true,builds:true,logs:true,revision_history:true}
};

// Step kinds, what phase they belong to, and how long the worker may hold them.
const STEP={
  'kit.install':{phase:'IMPLEMENTING',min:15,label:'Create the Unreal project from the Duke Forger template'},
  'git.init':{phase:'IMPLEMENTING',min:15,label:'Turn on Git and Git LFS'},
  'ubt.build':{phase:'COMPILING',min:120,label:'Compile with Unreal Build Tool'},
  'editor.start':{phase:'IMPLEMENTING',min:120,label:'Open the project in Unreal Editor'},
  'editor.stop':{phase:'IMPLEMENTING',min:5,label:'Close Unreal Editor'},
  'bridge':{phase:'IMPLEMENTING',min:30,label:'Run in Unreal Editor (Duke Forger plugin)'},
  'test':{phase:'TESTING',min:20,label:'Play-In-Editor test'},
  'file.write':{phase:'IMPLEMENTING',min:5,label:'Write project files'},
  'ini.set':{phase:'IMPLEMENTING',min:5,label:'Update project settings'},
  'git.commit':{phase:'IMPLEMENTING',min:20,label:'Commit to Git'},
  'uat.package':{phase:'COMPILING',min:240,label:'Package a Windows build (AutomationTool)'},
  'live.show':{phase:'IMPLEMENTING',min:10,label:'Show it in Live Unreal'},
  'gen3d.finish':{phase:'OPTIMIZING',min:90,label:'AAA finishing of a generated 3D model'},
  'gen3d.import':{phase:'IMPLEMENTING',min:30,label:'Import a generated 3D model into Unreal'}
};

// ---------------------------------------------------------------- worker channel (in memory)
let gen3dHooks=null;
const chans=new Map(); // agent token -> {rpc:[], waiters:[], replies:Map, seenAt}
function chan(tok){let c=chans.get(tok);if(!c){c={rpc:[],waiters:[],replies:new Map(),seenAt:0,hello:null};chans.set(tok,c);}return c;}
function wake(tok){const c=chan(tok);for(const fn of c.waiters.splice(0))fn();}
const workerOnline=tok=>Date.now()-chan(tok).seenAt<45000;
async function rpc(tok,op,args={},ms=30000){
  if(!workerOnline(tok))throw new HttpError(409,'Your Unreal worker is offline. Start the Duke app (DukeForger.py) on your Windows PC.');
  const c=chan(tok);const id=nanoid(10);
  const p=new Promise((res,rej)=>{const t=setTimeout(()=>{c.replies.delete(id);rej(new HttpError(504,'The worker did not answer in time.'));},ms);
    c.replies.set(id,v=>{clearTimeout(t);v.ok?res(v.result):rej(new HttpError(400,v.error||'The worker reported an error'));});});
  c.rpc.push({id,op,args});wake(tok);return p;
}
// Events for the browser (Server-Sent Events).
const listeners=new Map(); // userId -> Set(res)
function emit(userId,ev){for(const res of listeners.get(userId)||[]){try{res.write(`data: ${JSON.stringify(ev)}\n\n`);}catch{}}}

// ---------------------------------------------------------------- helpers
async function agentTok(req){
  const tok=String(req.headers['x-duke-agent']||'');const db=await load();const a=db.agents?.[tok];
  if(!tok||!a)throw new HttpError(401,'Invalid agent token');return {tok,agent:a,db};
}
function ensure(db){db.forge ||= {projects:{},jobs:{},assets:{},concepts:{},builds:{}};for(const k of ['projects','jobs','assets','concepts','builds','cast','gen3d'])db.forge[k] ||= {};return db.forge;}
async function ownProject(req,fid){
  const user=await requireUser(req);const db=await load();const f=ensure(db);const p=f.projects[fid];
  if(!p||p.ownerId!==user.id)nf('project not found');return {user,db,p,f};
}
function workerOf(db,userId){const a=agentFor(db,userId);return a?a.token:null;}
function llmFor(db,userId){
  const c=Object.values(db.creds||{}).filter(x=>x.userId===userId&&['anthropic','openai','xai','llama'].includes(x.provider)&&x.lastTest?.ok)
    .sort((a,b)=>(a.provider==='anthropic'?-1:0)-(b.provider==='anthropic'?-1:0))[0];
  if(!c)return null;
  return {...c,apiKey:c.sealed?unseal(c.sealed):'',model:c.model||c.lastTest?.model};
}
function step(kind,args={},extra={}){return {id:nanoid(8),kind,args,state:'pending',attempts:0,log:[],label:extra.label||STEP[kind]?.label||kind,role:extra.role||null,...extra};}
function jobView(j){
  return {id:j.id,projectId:j.projectId,kind:j.kind,title:j.title,prompt:j.prompt||null,state:j.state,reason:j.reason||null,createdAt:j.createdAt,updatedAt:j.updatedAt,
    finishedAt:j.finishedAt||null,repairs:j.repairs||0,plan:j.plan||null,evidence:j.evidence||[],tests:j.tests||[],commit:j.commit||null,build:j.build||null,
    steps:j.steps.map(s=>({id:s.id,kind:s.kind,label:s.label,role:s.role,state:s.state,attempts:s.attempts,startedAt:s.startedAt||null,endedAt:s.endedAt||null,
      error:s.error||null,summary:s.summary||null,log:(s.log||[]).slice(-60)}))};
}
function phaseOf(j){
  if(['READY','BLOCKED','STOPPED'].includes(j.state))return j.state;
  const s=j.steps.find(x=>x.state==='running')||j.steps.find(x=>x.state==='pending');
  if(!s)return j.state;
  if(s.repair)return 'FIXING';
  return STEP[s.kind]?.phase||'IMPLEMENTING';
}
function touch(db,j){j.updatedAt=now();j.state=phaseOf(j);const p=ensure(db).projects[j.projectId];if(p){p.updatedAt=j.updatedAt;emit(p.ownerId,{type:'job',job:jobView(j)});}}

// ---------------------------------------------------------------- job pipelines
function newJob(p,kind,title,steps,extra={}){
  return {id:nanoid(10),projectId:p.id,ownerId:p.ownerId,kind,title,steps,state:'PLANNED',createdAt:now(),updatedAt:now(),evidence:[],tests:[],repairs:0,...extra};
}
function pipelineCreate(p){
  const fps=p.starter==='fps';
  return [step('kit.install',{name:p.name,starter:p.starter||'blank'},fps?{label:"Create the Unreal project from Epic's first-person shooter template",role:'Unreal Engine architect'}:{}),
    step('git.init'),step('ubt.build',{target:'Editor'}),step('editor.start',{pixel:true}),
    ...(fps?[]:[step('bridge',{cmd:'python',args:{code:gen.startMapScript()}},{label:'Build the start map (ground, sun, sky, player start)',role:'World builder'})]),
    step('git.commit',{message:fps?'Duke Forger: new first-person shooter project':'Duke Forger: new project'})];
}
function pipelineActorTest(){
  return [step('editor.start',{pixel:true}),
    step('bridge',{cmd:'python',args:{code:gen.acceptanceActorScript()}},{label:'Add an actor through the automation bridge',role:'World builder'}),
    step('ubt.build',{target:'Editor',restart:true}),
    step('test',gen.acceptanceActorTest,{label:'Play-In-Editor: the actor exists at runtime',role:'QA'}),
    step('git.commit',{message:'Duke Forger acceptance: actor placed through the automation bridge'}),
    step('live.show',{map:'/Game/Maps/DukeStart',play:true})];
}
function pipelineRoom(p,spec,prompt){
  const files=spec.door?gen.doorSources(p.name):{};
  const steps=[step('editor.start',{pixel:true})];
  if(Object.keys(files).length)steps.push(step('file.write',{files},{label:'Write the door C++ class (Source/'+p.name+'/DukeDoor.h, .cpp)',role:'Gameplay engineer'}));
  steps.push(step('ubt.build',{target:'Editor',restart:true},{role:'Build engineer'}),
    step('bridge',{cmd:'python',args:{code:gen.roomScript(p.name,spec)}},{label:'Build the room in a new level (/Game/Maps/DukeRoom)',role:'World builder'}),
    step('ini.set',{file:'Config/DefaultEngine.ini',section:'/Script/EngineSettings.GameMapsSettings',values:{GameDefaultMap:'/Game/Maps/DukeRoom.DukeRoom',EditorStartupMap:'/Game/Maps/DukeRoom.DukeRoom'}},{label:'Make the room the default map'}),
    step('ini.set',{file:'Config/DefaultGame.ini',section:'/Script/UnrealEd.ProjectPackagingSettings',add:{MapsToCook:'(FilePath="/Game/Maps/DukeRoom")'}},{label:'Add the room to packaged builds'}),
    step('test',gen.roomTest(spec),{label:'Play-In-Editor: validate the room and the door',role:'QA'}),
    step('git.commit',{message:`Duke Forger: ${String(prompt).slice(0,180)}`},{role:'Build engineer'}),
    step('live.show',{map:'/Game/Maps/DukeRoom',play:true}));
  return {steps,files};
}
async function planCommand(db,p,prompt){
  const spec=gen.interpretRoom(prompt);
  if(spec)return {source:'Duke Forger interpreter',spec,tasks:gen.roomPlan(spec),...pipelineRoom(p,spec,prompt)};
  const llm=llmFor(db,p.ownerId);
  if(!llm)return {blocked:'This request needs an AI model to plan it. Connect an Anthropic, OpenAI, xAI or Llama API key in AI Team, then send it again. Built in without a model: rooms with a floor, walls, lights, a player start, a colored cube and a door that opens when the player approaches.'};
  const r=await complete(llm,{system:gen.PLANNER_SYSTEM,user:`Project module: ${p.name}\nRequest: ${prompt}`,maxTokens:12000});
  const out=parseJson(r.text);
  if(!out||typeof out!=='object'||!out.level_script)return {blocked:'The AI model did not return a usable plan. Try rephrasing the request.'};
  const files={};for(const [k,v] of Object.entries(out.files||{}))if(/^(Source|Config|Content\/Python)\//.test(k)&&!k.includes('..'))files[k]=String(v);
  const steps=[step('editor.start',{pixel:true})];
  if(Object.keys(files).length)steps.push(step('file.write',{files},{label:'Write code',role:'Gameplay engineer'}),step('ubt.build',{target:'Editor',restart:true}));
  steps.push(step('bridge',{cmd:'python',args:{code:String(out.level_script)}},{label:'Build it in the editor',role:'World builder'}));
  if(out.test?.steps?.length)steps.push(step('test',{name:String(out.test.name||'Feature test'),steps:out.test.steps,asserts:out.test.asserts||[]},{role:'QA'}));
  steps.push(step('git.commit',{message:`Duke Forger: ${String(prompt).slice(0,180)}`}),step('live.show',{play:true}));
  return {source:`AI plan (${llm.provider} ${llm.model})`,summary:out.summary,tasks:[{role:'Director',title:String(out.summary||prompt).slice(0,200)}],steps,files};
}

// ---------------------------------------------------------------- results and repair
async function aiRepair(db,j,s,problem){
  const llm=llmFor(db,j.ownerId);if(!llm)return null;
  const files=j.files||{};
  const r=await complete(llm,{system:`You fix a real Unreal Engine 5 C++ project. Return ONLY JSON {"files": {"path": "full new contents"}, "explanation": str}. Change as little as possible.`,
    user:`Problem:\n${problem.slice(0,12000)}\n\nCurrent files:\n${Object.entries(files).map(([k,v])=>`--- ${k}\n${v}`).join('\n').slice(0,40000)}`,maxTokens:12000}).catch(()=>null);
  const out=r&&parseJson(r.text);if(!out?.files)return null;
  const fixed={};for(const [k,v] of Object.entries(out.files))if(/^(Source|Config)\//.test(k)&&!k.includes('..'))fixed[k]=String(v);
  return Object.keys(fixed).length?{files:fixed,why:String(out.explanation||'')}:null;
}
// Deterministic repairs for problems Duke Forger understands without a model.
function knownRepair(j,s,res){
  if(s.kind==='test'&&res?.vars){
    const v=res.vars;
    if(v.door_closed_at_start!=null&&v.player_near===false&&!j.didWiden){j.didWiden=true;return {why:'The player was not counted as near the door: widening the trigger distance to 450 cm.',
      edit:{path:`Source/${j.module}/DukeDoor.h`,from:'float TriggerDistance = 300.f;',to:'float TriggerDistance = 450.f;'}};}
    if(v.player_near===true&&v.door_open_near!=null&&v.door_open_near<0.95&&!j.didSlow){j.didSlow=true;return {why:'The door was still opening when measured: giving it more time.',retestWait:3};}
  }
  return null;
}
async function onStepResult(tok,jid,sid,body){
  if(!body.progress){chan(tok).freedAt=Date.now();setTimeout(()=>wake(tok),50);} // the worker finished a step: hand it the next one now
  let followUp=null;const gen3dFail=[];
  await mutate(async db=>{
    const f=ensure(db);const j=f.jobs[jid];if(!j)return null;const s=j.steps.find(x=>x.id===sid);if(!s||s.state!=='running')return null;
    if(Array.isArray(body.log))s.log.push(...body.log.map(x=>String(x).slice(0,2000)));s.log=s.log.slice(-400);
    if(body.progress){touch(db,j);return true;}
    s.endedAt=now();s.result=body.result??null;s.summary=body.summary?String(body.summary).slice(0,500):null;
    for(const e of body.evidence||[])j.evidence.push({...e,step:s.label,at:now()});
    if(s.kind==='test'&&body.result){j.tests.push({name:s.args.name,passed:!!body.result.passed,checks:body.result.checks||[],vars:body.result.vars||{},at:now()});}
    if(s.kind==='git.commit'&&body.result?.sha)j.commit={sha:body.result.sha,message:s.args.message};
    if(s.kind==='uat.package'&&body.result?.buildId)j.build=body.result.buildId;
    const failed=!body.ok||(s.kind==='test'&&body.result&&body.result.passed===false);
    if(!failed){s.state='done';s.error=null;}
    else{
      s.state='failed';s.error=String(body.error||(s.kind==='test'?'Test assertions failed':'Step failed')).slice(0,4000);
      if(s.kind.startsWith('gen3d.')){ // a 3D model that could not be finished: report it on the model, keep going with the others
        s.state='skipped';gen3dFail.push([s.args.gen,s.args.provider,s.error]);
        finishIfDone(f,j);if(j.steps.every(x=>['done','skipped'].includes(x.state))&&j.steps.some(x=>x.error)){j.state='BLOCKED';j.reason=`${s.label}: ${s.error}`;j.finishedAt=now();}
        touch(db,j);return true;}
      const settings=f.projects[j.projectId]?.settings||DEFAULT_SETTINGS;const max=settings.autonomy?.max_repair_attempts??12;
      if(settings.autonomy?.auto_fix!==false&&(j.repairs||0)<max){followUp={jid,sid,res:body.result,error:s.error,log:s.log.slice(-80).join('\n')};}
      else{j.state='BLOCKED';j.reason=`${s.label} failed: ${s.error}`;j.finishedAt=now();}
    }
    if(!followUp)finishIfDone(f,j);
    touch(db,j);return true;
  });
  if(followUp)await repair(followUp);
  for(const [g,pr,e] of gen3dFail)await gen3dHooks?.onFinishFailed(g,pr,e);
  wake(tok);
}
function finishIfDone(f,j){
  if(j.steps.every(x=>['done','skipped'].includes(x.state))&&!['BLOCKED','STOPPED'].includes(j.state)){
    const p=f.projects[j.projectId];const needTest=p?.settings?.autonomy?.require_test_before_ready!==false,needCommit=p?.settings?.autonomy?.require_commit_before_ready!==false;
    if(needTest&&['command','actor_test'].includes(j.kind)&&!j.tests.some(t=>t.passed)){j.state='BLOCKED';j.reason='No passing test, so it is not marked ready.';}
    else if(needCommit&&['command','actor_test','create_project'].includes(j.kind)&&!j.commit){j.state='BLOCKED';j.reason='The change was not committed.';}
    else j.state='READY';
    j.finishedAt=now();
    if(j.state==='READY'&&j.kind==='create_project'&&p)p.status='ready';
  }
}
async function repair({jid,sid,res,error,log}){
  const db0=await load();const j0=ensure(db0).jobs[jid];if(!j0)return;const s0=j0.steps.find(x=>x.id===sid);
  const known=knownRepair(j0,s0,res);
  const ai=known?null:await aiRepair(db0,j0,s0,`${s0.label} failed.\n${error}\n\nLog:\n${log}`);
  await mutate(db=>{
    const f=ensure(db);const j=f.jobs[jid];if(!j)return null;const i=j.steps.findIndex(x=>x.id===sid);const s=j.steps[i];
    if(known){j.didWiden=j0.didWiden;j.didSlow=j0.didSlow;}
    if(!known&&!ai){j.state='BLOCKED';j.reason=`${s.label} failed: ${error}`+(llmFor(db,j.ownerId)?'':' (Automatic code repair needs an AI model: connect one in AI Team.)');j.finishedAt=now();touch(db,j);return true;}
    j.repairs=(j.repairs||0)+1;
    const add=[];
    if(known?.edit)add.push(step('file.write',{edits:[known.edit]},{label:`Repair: ${known.why}`,repair:true,role:'Gameplay engineer'}),step('ubt.build',{target:'Editor',restart:true},{repair:true}));
    if(ai){j.files={...(j.files||{}),...ai.files};add.push(step('file.write',{files:ai.files},{label:`Repair: ${ai.why.slice(0,160)||'AI fix'}`,repair:true}));
      if(s.kind!=='ubt.build')add.push(step('ubt.build',{target:'Editor',restart:true},{repair:true}));}
    // Retry the failed step (and, for a rebuilt editor, the level work that follows it is still pending).
    const retry={...step(s.kind,s.kind==='test'&&known?.retestWait?{...s.args,steps:s.args.steps.map(x=>x.op==='wait'?{...x,s:Math.max(x.s,known.retestWait)}:x)}:s.args,{label:s.label,role:s.role}),repair:true};
    s.state='skipped';
    j.steps.splice(i+1,0,...add,retry);
    j.state='FIXING';touch(db,j);return true;
  });
}

// Next step for a worker: the oldest job of this owner with a pending step whose predecessors are done.
function nextStep(f,userId){
  const jobs=Object.values(f.jobs).filter(j=>j.ownerId===userId&&!['READY','BLOCKED','STOPPED'].includes(j.state)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  for(const j of jobs){
    if(j.steps.some(s=>s.state==='running'))return null; // one step at a time per worker
    const s=j.steps.find(x=>x.state==='pending');if(s)return {j,s};
  }
  return null;
}

// ---------------------------------------------------------------- routes
export function registerForge(r){
  gen3dHooks=registerGen3d(r,{ensure,newJob,step,touch,wake,workerOf,ownProject,agentTok,emit,FORGE_DIR});
  fs.mkdirSync(path.join(FORGE_DIR,'evidence'),{recursive:true});fs.mkdirSync(path.join(FORGE_DIR,'builds'),{recursive:true});fs.mkdirSync(path.join(FORGE_DIR,'concepts'),{recursive:true});

  // ---- worker side
  r.post('/api/agent/forge/poll',async({req,body})=>{
    const {tok,agent,db:db0}=await agentTok(req);const c=chan(tok);const mid=machineId(req);
    const hello=body.hello?{version:String(body.hello.version||''),engine:String(body.hello.engine||''),editor:body.hello.editor||null,root:String(body.hello.root||'').slice(0,300),at:now()}:undefined;
    seen(tok,mid,{...(body.machine||{}),...(hello?{hello,engine:hello.engine}:{}),...(body.editor!==undefined?{editor:body.editor}:{})});
    // Another of this creator's PCs is doing the Unreal work: stay on standby.
    if(!isActive(db0,tok,mid)){
      await new Promise(done=>{const t=setTimeout(done,20000);req.on('close',()=>{clearTimeout(t);done();});});
      seen(tok,mid);const a=activeMachine(await load(),tok);return {standby:a?a.host:true};
    }
    c.seenAt=Date.now();
    if(hello)c.hello=hello;
    if(body.editor!==undefined)c.editor=body.editor;
    if(body.boot){ // the worker restarted: anything it was running must run again
      await mutate(db=>{const f=ensure(db);for(const j of Object.values(f.jobs))if(j.ownerId===agent.userId)for(const s of j.steps)if(s.state==='running'){s.state='pending';s.log.push('Worker restarted; running this step again.');touch(db,j);}return true;});
    }
    const t0=Date.now();
    for(;;){
      if(c.rpc.length)return {rpc:c.rpc.splice(0,20)};
      const db=await load();if(!isActive(db,tok,mid))return {standby:true};
      const f=ensure(db);const n=body.busy&&!(c.freedAt>t0)?null:nextStep(f,agent.userId);
      if(n){
        const p=f.projects[n.j.projectId];
        const out=await mutate(db2=>{const f2=ensure(db2);const j=f2.jobs[n.j.id];const s=j?.steps.find(x=>x.id===n.s.id);if(!s||s.state!=='pending')return null;
          s.state='running';s.startedAt=now();s.attempts++;s.leaseUntil=Date.now()+(STEP[s.kind]?.min||30)*60e3;touch(db2,j);return {s:{...s},j};});
        if(out)return {step:{jobId:n.j.id,stepId:out.s.id,kind:out.s.kind,args:out.s.args,project:{id:p.id,name:p.name,root:p.root||'',uproject:p.uproject||''}}};
      }
      if(Date.now()-t0>20000)return {};
      await new Promise(done=>{const t=setTimeout(done,20000-(Date.now()-t0));c.waiters.push(()=>{clearTimeout(t);done();});req.on('close',()=>{clearTimeout(t);done();});});
      if(req.destroyed)return {};
      c.seenAt=Date.now();seen(tok,mid);
    }
  });
  r.post('/api/agent/forge/rpc/:id',async({req,params,body})=>{const {tok}=await agentTok(req);const fn=chan(tok).replies.get(params.id);if(fn){chan(tok).replies.delete(params.id);fn(body);}return {ok:true};});
  r.post('/api/agent/forge/step/:jid/:sid',async({req,params,body})=>{
    const {tok}=await agentTok(req);
    if(body.project)await mutate(db=>{const f=ensure(db);const j=f.jobs[params.jid];const p=j&&f.projects[j.projectId];if(!p)return null;
      if(body.project.root)p.root=String(body.project.root).slice(0,400);if(body.project.uproject)p.uproject=String(body.project.uproject).slice(0,400);if(body.project.engine)p.engine=String(body.project.engine).slice(0,20);return true;});
    await onStepResult(tok,params.jid,params.sid,body);return {ok:true};
  });
  // Evidence (screenshots, logs) and builds, streamed straight to disk.
  r.post('/api/agent/forge/upload',async({req,query})=>{
    const {agent}=await agentTok(req);const kind=query.get('kind')==='build'?'build':'evidence';
    const db=await load();const f=ensure(db);const j=f.jobs[String(query.get('job')||'')];if(!j||j.ownerId!==agent.userId)nf('job not found');
    const name=path.basename(String(query.get('name')||'file')).replace(/[^\w.\-]/g,'_').slice(0,120);
    const id=nanoid(16);const dir=path.join(FORGE_DIR,kind==='build'?'builds':'evidence');const file=path.join(dir,`${id}_${name}`);
    const max=kind==='build'?8*1024**3:30*1024**2;let size=0;
    await new Promise((res,rej)=>{const w=fs.createWriteStream(file);req.on('data',d=>{size+=d.length;if(size>max){req.destroy();w.destroy();rej(new HttpError(413,'Too large'));}});req.pipe(w);w.on('finish',res);w.on('error',rej);req.on('error',rej);});
    if(kind==='build'){
      await mutate(db2=>{const f2=ensure(db2);f2.builds[id]={id,projectId:j.projectId,ownerId:j.ownerId,jobId:j.id,file:path.basename(file),name,size,platform:'Win64',config:String(query.get('config')||'Development'),
        number:Object.values(f2.builds).filter(b=>b.projectId===j.projectId).length+1,createdAt:now(),log:null};return true;});
      return {buildId:id,url:`/api/forge/builds/${id}/download`,size};
    }
    return {url:`/api/forge/evidence/${id}_${name}`,size};
  });
  r.get('/api/agent/forge/kit.zip',async({req,res})=>{
    await agentTok(req);
    const entries=[];
    for(const [base,prefix] of [[path.join(ROOT,'templates','unreal-project'),'template/'],[path.join(ROOT,'unreal','DukeForgerPlugin'),'plugin/']]){
      for(const rel of await walk(base))entries.push({name:prefix+rel,data:await fsp.readFile(path.join(base,rel))});
    }
    const zip=createZip(entries);res.writeHead(200,{'content-type':'application/zip','content-length':zip.length});res.end(zip);
  });

  // ---- creator side
  r.get('/api/forge/state',async({req})=>{
    const user=await requireUser(req);const db=await load();const f=ensure(db);const tok=workerOf(db,user.id);const c=tok?chan(tok):null;
    const projects=Object.values(f.projects).filter(p=>p.ownerId===user.id).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const act=tok?activeMachine(db,tok):null;
    const machines=tok?machinesOf(tok).filter(m=>m.online||Date.now()-m.seenAt<6*3600e3).map(m=>({id:m.id,host:m.host,gpu:m.gpu||'',vramGB:m.vramGB||0,engine:m.engine||'',online:m.online,active:act?.id===m.id})):[];
    return {worker:tok?{online:workerOnline(tok),hello:act?.hello||c.hello,editor:(act?act.editor:c.editor)||null,machine:act?{id:act.id,host:act.host,gpu:act.gpu||'',vramGB:act.vramGB||0}:null,machines,picked:db.agents?.[tok]?.forgeMachine||null}:null,hasModel:!!llmFor(db,user.id),
      projects:projects.map(p=>({id:p.id,name:p.name,title:p.title||null,starter:p.starter||'blank',status:p.status,root:p.root||null,updatedAt:p.updatedAt,createdAt:p.createdAt}))};
  });
  r.get('/api/forge/events',async({req,res})=>{
    const user=await requireUser(req);
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});res.write(': ok\n\n');
    let set=listeners.get(user.id);if(!set){set=new Set();listeners.set(user.id,set);}set.add(res);
    const ping=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},20000);
    await new Promise(done=>req.on('close',done));clearInterval(ping);set.delete(res);
  });
  // Pick which PC does the Unreal work (empty = automatic: the strongest one online).
  r.post('/api/forge/worker',async({req,body})=>{
    const user=await requireUser(req);
    const tok=await mutate(db=>{const a=agentFor(db,user.id);if(!a)throw new HttpError(409,'Start the Duke app on a PC first.');a.forgeMachine=body.machine?String(body.machine).slice(0,80):null;return a.token;});
    wake(tok);return {ok:true};
  });
  r.post('/api/forge/projects',async({req,body})=>{
    const user=await requireUser(req);const name=gen.safeName(body.name);
    const out=await mutate(db=>{
      const f=ensure(db);if(Object.values(f.projects).some(p=>p.ownerId===user.id&&p.name.toLowerCase()===name.toLowerCase()))throw new HttpError(409,`You already have a project called ${name}.`);
      const p={id:nanoid(10),ownerId:user.id,name,title:String(body.title||'').trim().slice(0,80)||null,starter:body.starter==='fps'?'fps':'blank',status:'creating',settings:structuredClone(DEFAULT_SETTINGS),createdAt:now(),updatedAt:now()};f.projects[p.id]=p;
      const j=newJob(p,'create_project',`Create ${name}`,pipelineCreate(p));f.jobs[j.id]=j;touch(db,j);return {project:p,job:jobView(j)};
    });
    const db=await load();const tok=workerOf(db,user.id);if(tok)wake(tok);return out;
  });
  r.get('/api/forge/projects/:fid',async({req,params})=>{
    const {p,f}=await ownProject(req,params.fid);
    return {project:p,jobs:Object.values(f.jobs).filter(j=>j.projectId===p.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,60).map(jobView),
      builds:Object.values(f.builds).filter(b=>b.projectId===p.id).sort((a,b)=>b.number-a.number).map(b=>({...b,url:`/api/forge/builds/${b.id}/download`})),
      assets:Object.values(f.assets).filter(a=>a.projectId===p.id),concepts:Object.values(f.concepts).filter(c=>c.projectId===p.id).map(conceptView)};
  });
  r.patch('/api/forge/projects/:fid/settings',async({req,params,body})=>{
    await ownProject(req,params.fid);
    return mutate(db=>{const p=ensure(db).projects[params.fid];const s=p.settings ||= structuredClone(DEFAULT_SETTINGS);
      for(const [sec,vals] of Object.entries(body||{}))if(DEFAULT_SETTINGS[sec]&&vals&&typeof vals==='object')for(const [k,v] of Object.entries(vals))if(k in DEFAULT_SETTINGS[sec]){
        const d=DEFAULT_SETTINGS[sec][k];s[sec][k]=typeof d==='number'?Math.max(0,Math.min(100,Number(v)||0)):typeof d==='boolean'?!!v:Array.isArray(d)?(Array.isArray(v)?v.map(String).slice(0,8):d):String(v).slice(0,40);}
      return {settings:s};});
  });
  r.post('/api/forge/projects/:fid/jobs',async({req,params,body})=>{
    const {p,db}=await ownProject(req,params.fid);const kind=String(body.kind||'');
    if(p.status!=='ready'&&kind!=='create_retry')throw new HttpError(409,'The project is still being created. Wait for it to be ready.');
    let j;
    if(kind==='create_retry'){if(p.status==='ready')throw new HttpError(400,'This project is already set up.');j=newJob(p,'create_project',`Create ${p.name} (again)`,pipelineCreate(p));}
    else if(kind==='actor_test')j=newJob(p,'actor_test','Acceptance test: add an actor through the bridge, compile, Play-In-Editor',pipelineActorTest());
    else if(kind==='command'){
      const prompt=String(body.prompt||'').trim().slice(0,2000);if(!prompt)throw new HttpError(400,'Type what you want Duke Forger to do');
      const plan=await planCommand(db,p,prompt);
      if(plan.blocked)j={...newJob(p,'command',prompt.slice(0,80),[]),prompt,state:'BLOCKED',reason:plan.blocked,finishedAt:now()};
      else j=newJob(p,'command',prompt.slice(0,80),plan.steps,{prompt,files:plan.files,module:p.name,plan:{source:plan.source,spec:plan.spec||null,tasks:plan.tasks,summary:plan.summary||null}});
    }
    else if(kind==='build')j=newJob(p,'build','Package a Windows build',[step('uat.package',{config:body.config==='Shipping'?'Shipping':'Development'})]);
    else if(kind==='compile')j=newJob(p,'compile','Compile',[step('ubt.build',{target:'Editor',restart:true})]);
    else if(kind==='open')j=newJob(p,'open','Open Unreal Editor',[step('editor.start',{pixel:true})]);
    else if(kind==='restart')j=newJob(p,'restart','Restart Unreal Editor',[step('editor.stop'),step('editor.start',{pixel:true})]);
    else throw new HttpError(400,'Unknown job');
    await mutate(db2=>{ensure(db2).jobs[j.id]=j;touch(db2,j);return true;});
    const tok=workerOf(db,p.ownerId);if(tok)wake(tok);
    return {job:jobView(j)};
  });
  r.get('/api/forge/jobs/:jid',async({req,params})=>{const user=await requireUser(req);const db=await load();const j=ensure(db).jobs[params.jid];if(!j||j.ownerId!==user.id)nf('job not found');return {job:jobView(j)};});
  r.post('/api/forge/jobs/:jid/stop',async({req,params})=>{
    const user=await requireUser(req);
    return mutate(db=>{const j=ensure(db).jobs[params.jid];if(!j||j.ownerId!==user.id)nf('job not found');
      if(!['READY','BLOCKED','STOPPED'].includes(j.state)){for(const s of j.steps)if(s.state==='pending')s.state='skipped';j.state='STOPPED';j.reason='Stopped by you.';j.finishedAt=now();touch(db,j);}return {job:jobView(j)};});
  });
  r.get('/api/forge/evidence/:file',async({req,res,params})=>{
    const user=await requireUser(req);const name=path.basename(params.file);const db=await load();
    const owned=Object.values(ensure(db).jobs).some(j=>j.ownerId===user.id&&j.evidence.some(e=>e.url===`/api/forge/evidence/${name}`));if(!owned)nf();
    const file=path.join(FORGE_DIR,'evidence',name);const st=await fsp.stat(file).catch(()=>null);if(!st)nf();
    res.writeHead(200,{'content-type':/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':'text/plain; charset=utf-8','content-length':st.size,'cache-control':'private, max-age=86400'});
    fs.createReadStream(file).pipe(res);await new Promise(d=>res.on('close',d));
  });
  r.get('/api/forge/builds/:bid/download',async({req,res,params})=>{
    const user=await requireUser(req);const db=await load();const b=ensure(db).builds[params.bid];if(!b||b.ownerId!==user.id)nf('build not found');
    const file=path.join(FORGE_DIR,'builds',b.file);const st=await fsp.stat(file).catch(()=>null);if(!st)nf('The build file is missing');
    const p=ensure(db).projects[b.projectId];
    res.writeHead(200,{'content-type':'application/zip','content-length':st.size,'content-disposition':`attachment; filename="${p?.name||'Game'}-Win64-build${b.number}.zip"`});
    fs.createReadStream(file).pipe(res);await new Promise(d=>res.on('close',d));
  });

  // ---- File Vault, Source Editor, History (live from the worker's project folder)
  const W=async(req,fid,op,args,ms)=>{const {p,db}=await ownProject(req,fid);if(!p.root)throw new HttpError(409,'The project folder is not ready yet.');
    const tok=workerOf(db,p.ownerId);if(!tok)throw new HttpError(409,'Connect your Unreal worker first.');return rpc(tok,op,{root:p.root,...args},ms);};
  r.get('/api/forge/projects/:fid/tree',async({req,params})=>{
    const {p,f}=await ownProject(req,params.fid);
    let files=[],live=false,error=null;
    try{const out=await W(req,params.fid,'vault.tree',{},45000);files=out.files;live=true;await mutate(db=>{ensure(db).projects[p.id].tree={files:out.files.slice(0,20000),at:now()};return true;});}
    catch(e){error=e.message;files=p.tree?.files||[];}
    // Files Duke Forger keeps for the project outside the Unreal folder.
    const extra=[];
    for(const c of Object.values(f.concepts).filter(x=>x.projectId===p.id))for(const rv of c.revisions)extra.push({p:`@Duke/Concepts/${c.name}/r${rv.n}${rv.n===c.approved?' (approved)':''}.png`,s:rv.size,m:Date.parse(rv.at),url:`/api/forge/concepts/${c.id}/r/${rv.n}`});
    for(const b of Object.values(f.builds).filter(x=>x.projectId===p.id))extra.push({p:`@Duke/Builds/Build ${b.number} (${b.config}).zip`,s:b.size,m:Date.parse(b.createdAt),url:`/api/forge/builds/${b.id}/download`});
    for(const j of Object.values(f.jobs).filter(x=>x.projectId===p.id))for(const e of j.evidence)extra.push({p:`@Duke/Evidence/${j.title.replace(/[\\/]/g,'-').slice(0,60)}/${path.basename(e.url)}`,m:Date.parse(e.at),url:e.url});
    return {live,error,root:p.root||null,files,extra,at:p.tree?.at||null};
  });
  r.get('/api/forge/projects/:fid/file',async({req,params,query})=>W(req,params.fid,'file.read',{path:String(query.get('path')||'')},30000));
  r.post('/api/forge/projects/:fid/file',async({req,params,body})=>W(req,params.fid,'file.write',{path:String(body.path||''),content:String(body.content??'')},30000));
  r.post('/api/forge/projects/:fid/commit',async({req,params,body})=>W(req,params.fid,'git.commit',{message:String(body.message||'Edited in Duke Forger').slice(0,300),paths:Array.isArray(body.paths)?body.paths.map(String).slice(0,200):null},60000));
  r.get('/api/forge/projects/:fid/history',async({req,params,query})=>W(req,params.fid,'git.log',{path:query.get('path')||null},30000));
  r.get('/api/forge/projects/:fid/diff',async({req,params,query})=>W(req,params.fid,'git.diff',{rev:query.get('rev')||null,path:query.get('path')||null},30000));
  r.get('/api/forge/projects/:fid/status',async({req,params})=>W(req,params.fid,'git.status',{},30000));
  r.post('/api/forge/projects/:fid/rollback',async({req,params,body})=>W(req,params.fid,'git.rollback',{rev:String(body.rev||''),path:body.path?String(body.path):null},90000));
  r.get('/api/forge/projects/:fid/logs',async({req,params})=>W(req,params.fid,'logs.tail',{lines:400},30000));
  // Live Unreal controls around the streamed editor.
  r.post('/api/forge/projects/:fid/live/:action',async({req,params,body})=>{
    const a=params.action;const mapPath=String(body?.map||'');
    if(a==='open_map'&&!/^\/Game\/[\w/]+$/.test(mapPath))throw new HttpError(400,'Pick a map');
    const map={play:['bridge.call',{cmd:'pie_start'}],stop:['bridge.call',{cmd:'pie_stop'}],save:['bridge.call',{cmd:'save_all'}],screenshot:['bridge.call',{cmd:'screenshot',args:{name:'live'}}],
      ping:['bridge.call',{cmd:'ping'}],open_map:['bridge.call',{cmd:'python',args:{code:`bridge.load_level(${JSON.stringify(mapPath)})\nresult = True`}}]}[a];
    if(!map)throw new HttpError(400,'Unknown action');
    return W(req,params.fid,map[0],map[1],90000);
  });

  // ---- Concept Studio
  r.get('/api/forge/projects/:fid/concepts',async({req,params})=>{const {p,f}=await ownProject(req,params.fid);return {concepts:Object.values(f.concepts).filter(c=>c.projectId===p.id).map(conceptView)};});
  r.post('/api/forge/projects/:fid/concepts',async({req,params})=>{
    const {p,user}=await ownProject(req,params.fid);
    const dir=path.join(FORGE_DIR,'concepts',p.id);await fsp.mkdir(dir,{recursive:true});
    const {fields,files}=await readMultipart(req,{dir,limit:25*1024*1024,maxFiles:1});
    const img=files[0];if(!img)throw new HttpError(400,'Add an image');
    if(!/^image\/(png|jpeg|webp)$/.test(img.mimetype)){await fsp.rm(img.path,{force:true});throw new HttpError(400,'Use a PNG, JPEG or WebP image');}
    const cat=String(fields.category||'prop');if(!CATEGORIES.includes(cat))throw new HttpError(400,'Pick a category');
    return mutate(db=>{const f=ensure(db);const id=nanoid(10);
      const c={id,projectId:p.id,ownerId:user.id,name:String(fields.name||'Concept').replace(/[\\/]/g,'-').slice(0,80),category:cat,createdAt:now(),
        revisions:[{n:1,file:path.basename(img.path),mime:img.mimetype,size:img.size,at:now(),note:String(fields.note||'Original').slice(0,500),prompt:fields.prompt?String(fields.prompt).slice(0,2000):null,source:String(fields.source||'upload').slice(0,60),parent:null,status:'review'}],
        approved:null};
      f.concepts[id]=c;return {concept:conceptView(c)};});
  });
  r.post('/api/forge/concepts/:cid/revisions',async({req,params})=>{
    const user=await requireUser(req);const db0=await load();const c0=ensure(db0).concepts[params.cid];if(!c0||c0.ownerId!==user.id)nf('concept not found');
    const dir=path.join(FORGE_DIR,'concepts',c0.projectId);await fsp.mkdir(dir,{recursive:true});
    const {fields,files}=await readMultipart(req,{dir,limit:25*1024*1024,maxFiles:1});const img=files[0];if(!img)throw new HttpError(400,'Add the new version');
    if(!/^image\/(png|jpeg|webp)$/.test(img.mimetype)){await fsp.rm(img.path,{force:true});throw new HttpError(400,'Use a PNG, JPEG or WebP image');}
    return mutate(db=>{const c=ensure(db).concepts[params.cid];const n=Math.max(...c.revisions.map(x=>x.n))+1;
      c.revisions.push({n,file:path.basename(img.path),mime:img.mimetype,size:img.size,at:now(),note:String(fields.note||'Variation').slice(0,500),prompt:fields.prompt?String(fields.prompt).slice(0,2000):null,
        source:String(fields.source||'edit').slice(0,60),parent:Number(fields.parent)||c.approved||c.revisions.at(-1).n,status:'review'});
      return {concept:conceptView(c)};});
  });
  r.post('/api/forge/concepts/:cid/review',async({req,params,body})=>{
    const user=await requireUser(req);const n=Number(body.n);const decision=body.decision==='reject'?'rejected':'approved';
    return mutate(db=>{const f=ensure(db);const c=f.concepts[params.cid];if(!c||c.ownerId!==user.id)nf('concept not found');const rv=c.revisions.find(x=>x.n===n);if(!rv)nf('revision not found');
      rv.status=decision;rv.reviewedAt=now();
      if(decision==='approved'){
        for(const x of c.revisions)if(x.n!==n&&x.status==='approved')x.status='superseded';
        c.approved=n;
        // Register the approved concept in the project's asset database (earlier revisions stay available).
        const aid=c.assetId||nanoid(10);c.assetId=aid;const prev=f.assets[aid];
        f.assets[aid]={id:aid,projectId:c.projectId,name:c.name,type:`concept/${c.category}`,status:'approved concept (2D)',projectPath:`Concepts/${c.category}/${c.name}.png`,
          sourceFile:`/api/forge/concepts/${c.id}/r/${n}`,unrealPath:null,creator:'Duke Forger user',prompt:rv.prompt||null,createdAt:prev?.createdAt||now(),updatedAt:now(),
          revision:n,revisions:c.revisions.map(x=>({n:x.n,status:x.status,at:x.at,note:x.note})),dependencies:[],provenance:{source:rv.source,note:rv.note,parent:rv.parent},
          thumbnail:`/api/forge/concepts/${c.id}/r/${n}`};
      }
      return {concept:conceptView(c),asset:c.assetId?f.assets[c.assetId]:null};});
  });
  r.get('/api/forge/concepts/:cid/r/:n',async({req,res,params})=>{
    const user=await requireUser(req);const db=await load();const c=ensure(db).concepts[params.cid];if(!c||c.ownerId!==user.id)nf();
    const rv=c.revisions.find(x=>x.n===Number(params.n));if(!rv)nf();const file=path.join(FORGE_DIR,'concepts',c.projectId,rv.file);const st=await fsp.stat(file).catch(()=>null);if(!st)nf();
    res.writeHead(200,{'content-type':rv.mime,'content-length':st.size,'cache-control':'private, max-age=31536000, immutable'});fs.createReadStream(file).pipe(res);await new Promise(d=>res.on('close',d));
  });
  r.get('/api/forge/projects/:fid/assets',async({req,params})=>{const {p,f}=await ownProject(req,params.fid);return {assets:Object.values(f.assets).filter(a=>a.projectId===p.id)};});
}
const CATEGORIES=['character','weapon','vehicle','ship','building','planet','creature','environment','ui','prop'];
function conceptView(c){return {...c,revisions:c.revisions.map(r=>({...r,url:`/api/forge/concepts/${c.id}/r/${r.n}`}))};}
async function walk(dir,base=dir){const out=[];for(const e of await fsp.readdir(dir,{withFileTypes:true})){if(e.name==='__pycache__')continue;const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p,base));else out.push(path.relative(base,p).split(path.sep).join('/'));}return out;}

// Leases: a step held too long by a worker that went away is offered again.
export function startForgeSweeper(){
  setInterval(()=>{mutate(db=>{const f=ensure(db);let changed=false;for(const j of Object.values(f.jobs))for(const s of j.steps)if(s.state==='running'&&s.leaseUntil&&Date.now()>s.leaseUntil){
    s.state='pending';s.log.push('The worker took too long or went away; offering this step again.');changed=true;touch(db,j);}return changed||null;}).catch(()=>{});},60000).unref?.();
}
export const _test={interpretRoom:gen.interpretRoom};
