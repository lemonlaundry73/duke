// Routes for the 67-step roadmap: answers, self-checks, proof uploads, asset list, requirements,
// the expansion loop, Course mode (lessons, quizzes, certificates) and the showcase.
import { BRIEFS } from './briefs/valor.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { load, mutate } from './store.js';
import { HttpError, id as nanoid, readMultipart } from './http.js';
import { STEPS, PHASES, ROLES, stepByN, stepPlan } from './roadmap.js';
import { GLOSSARY } from './glossary.js';
import { publicQuiz, gradeQuiz, lessonVideo } from './course.js';
import { evaluate, coachLine, ensureRoadmap } from './progress.js';
import { settle, ctxFor, ownerPlan } from './ctx.js';
import { requireUser, publicUser } from './auth.js';
import { PLANS, PLAN_ORDER, yearPrice, billingStatus, requireFeature, planOf, CREDIT_COST } from './billing.js';
import { ensureDesign, STAGES, FIELD_HOME } from './pipeline.js';
import * as director from './director.js';
import { UPLOAD_DIR } from './paths.js';
import { brainName } from './brain.js';
import { meshyReady } from './meshy.js';
import { TOOLS, publicActions } from './link.js';

const now=()=>new Date().toISOString();
const nf=(w='not found')=>{throw new HttpError(404,w);};
const PROOF_DIR=path.join(UPLOAD_DIR,'private');
const PROOF_EXT=['.png','.jpg','.jpeg','.webp','.gif','.mp4','.webm','.mov'];
const ASSET_KINDS=['Model','Character','Animation','Surface or texture','Sound effect','Music','Voice','Other'];
const ASSET_ACTIONS=['Make','Buy','Generate'];
const ASSET_STATUS=['Planned','In progress','Done'];
const PLAN_RANK={free:0,creator:1,academy:2,studio:3};

const stepOr404=n=>{const s=stepByN(Number(n));if(!s)nf('step not found');return s;};
export function roadmapView(db,p){
  const plan=ownerPlan(db,p);const ctx=ctxFor(db,p);const ev=evaluate(p,plan,ctx);
  return {project:p,roadmap:{...ev,coach:coachLine(p,ev),inspect:ctx.inspect,agent:ctx.agent?{seenAt:ctx.agent.seenAt||null,machine:ctx.agent.machine||null}:null}};
}
async function own(req,id,fn,{allowLocked=false,step}={}){
  const user=await requireUser(req);
  const out=await mutate(async db=>{
    const p=db.projects[id];if(!p||p.ownerId!==user.id)return null;
    settle(db,p);
    if(step){const ev=evaluate(p,ownerPlan(db,p),ctxFor(db,p)).steps[step.n-1];
      if(!allowLocked&&ev.status==='locked')throw new HttpError(403,`Step ${step.n} is locked. Finish step ${evaluate(p,ownerPlan(db,p),ctxFor(db,p)).current} first.`);
      if(ev.status==='upgrade')throw new HttpError(402,`Step ${step.n} is part of the ${PLANS[ev.needPlan].name} plan.`);}
    const r=await fn(p,db,user);
    const completed=settle(db,p);p.updatedAt=now();
    return r===undefined?{...roadmapView(db,p),completed}:r;
  });
  if(out===null)nf('project not found');
  return out;
}
function cleanField(f,v){
  if(f.type==='list')return (Array.isArray(v)?v:String(v||'').split('\n')).map(x=>String(x).trim().slice(0,400)).filter(Boolean).slice(0,60);
  if(f.type==='number'){if(v===''||v==null)return null;const n=Number(v);if(!Number.isFinite(n))throw new HttpError(400,`${f.label} must be a number`);return n;}
  if(f.type==='select'){if(v&&!f.options.includes(v))throw new HttpError(400,`${f.label}: choose one of ${f.options.join(', ')}`);return v||'';}
  return String(v??'').slice(0,6000);
}

export function registerRoadmap(r){
  // ---- public content ----
  r.get('/api/roadmap',()=>({phases:PHASES,roles:ROLES,steps:STEPS.map(s=>({...s,plan:stepPlan(s)})),glossary:GLOSSARY,
    plans:PLAN_ORDER.map(id=>({...PLANS[id],year:yearPrice(id)})),creditCost:CREDIT_COST,
    assetKinds:ASSET_KINDS,assetActions:ASSET_ACTIONS,assetStatus:ASSET_STATUS,brain:brainName(),meshy:meshyReady(),tools:TOOLS,actions:publicActions()}));
  r.get('/api/course/quiz/:phase',({params})=>({phase:Number(params.phase),questions:publicQuiz(Number(params.phase))}));

  r.get('/api/me',async({req})=>{const u=await requireUser(req);return {user:publicUser(u),billing:billingStatus(u)};});

  r.get('/api/projects/:id/roadmap',async({req,params})=>{
    const user=await requireUser(req);const db=await load();const p=db.projects[params.id];if(!p||p.ownerId!==user.id)nf('project not found');
    settle(db,p);return roadmapView(db,p);
  });

  // ---- prefill a project from a built-in design brief (fills only empty fields) ----
  r.post('/api/projects/:id/brief',async({req,params,body})=>{
    const b=BRIEFS[String(body.brief||'')];if(!b)nf('brief not found');
    return own(req,params.id,p=>{ensureDesign(p);b.apply(p);});
  });
  // ---- step answers, self-checks ----
  r.patch('/api/projects/:id/steps/:n/answers',async({req,params,body})=>{
    const step=stepOr404(params.n);
    return own(req,params.id,p=>{const a=p.roadmap.answers;
      for(const [k,v] of Object.entries(body.values||{})){const f=step.inputs.find(x=>x.key===k);if(!f)throw new HttpError(400,`Unknown field ${k}`);a[k]=cleanField(f,v);}
    },{step});
  });
  r.post('/api/projects/:id/steps/:n/tick',async({req,params,body})=>{
    const step=stepOr404(params.n);const i=Number(body.i);
    if(step.checks[i]?.t!=='self')throw new HttpError(400,'Not a self-check');
    return own(req,params.id,p=>{const k=`${step.n}:${i}`;if(body.on)p.roadmap.ticks[k]=now();else delete p.roadmap.ticks[k];},{step});
  });
  r.post('/api/projects/:id/steps/:n/draft',async({req,params})=>{
    const step=stepOr404(params.n);const user=await requireUser(req);
    if(PLAN_RANK[planOf(user)]<PLAN_RANK[stepPlan(step)])throw new HttpError(402,`Step ${step.n} is part of the ${PLANS[stepPlan(step)].name} plan.`);
    const db=await load();const p0=db.projects[params.id];if(!p0||p0.ownerId!==user.id)nf('project not found');ensureDesign(p0);ensureRoadmap(p0);
    const {values,source}=await director.draftStep(step,p0);
    // Stage-backed fields on this step are drafted with the stage drafter (only empty ones are filled).
    const stagePanels=step.panels.filter(x=>x.p==='stage');
    const drafted=[];for(const sp of stagePanels)drafted.push([sp,await director.draftStage(sp.stage,p0)]);
    const out=await own(req,params.id,p=>{
      for(const [k,v] of Object.entries(values)){const cur=p.roadmap.answers[k];if(cur===undefined||cur===null||cur===''||(Array.isArray(cur)&&!cur.length))p.roadmap.answers[k]=v;}
      for(const [sp,res] of drafted){const st=STAGES.find(s=>s.id===sp.stage);const home=p.design[FIELD_HOME[sp.stage]] ||= {};
        for(const f of st.fields)if(sp.keys.includes(f.key)&&res.values[f.key]!==undefined){const cur=home[f.key];if(cur===undefined||cur===null||cur===''||(Array.isArray(cur)&&!cur.length))home[f.key]=res.values[f.key];}
        if(sp.stage==='vision'&&home.title)p.name=home.title;}
    },{step});
    return {...out,source:drafted[0]?.[1]?.source&&source==='none'?drafted[0][1].source:source};
  });
  r.post('/api/projects/:id/steps/:n/ask',async({req,params,body})=>{
    const step=stepOr404(params.n);const user=await requireUser(req);const db=await load();const p=db.projects[params.id];if(!p||p.ownerId!==user.id)nf('project not found');
    ensureRoadmap(p);return director.askStep(p,step,String(body.question||'').slice(0,1500));
  });

  // ---- proof uploads (private; served only to the owner) ----
  r.post('/api/projects/:id/proof/:key',async({req,params})=>{
    const user=await requireUser(req);const key=String(params.key).replace(/[^\w-]/g,'').slice(0,40);
    const db0=await load();const p0=db0.projects[params.id];if(!p0||p0.ownerId!==user.id)nf('project not found');
    const dir=path.join(PROOF_DIR,params.id);await fsp.mkdir(dir,{recursive:true});
    const {files}=await readMultipart(req,{dir,limit:250*1024*1024,maxFiles:40});
    for(const f of files)if(!PROOF_EXT.includes(path.extname(f.filename).toLowerCase())){await Promise.all(files.map(x=>fsp.rm(x.path,{force:true})));throw new HttpError(400,'Upload images (PNG, JPG, WebP, GIF) or videos (MP4, WebM, MOV)');}
    return own(req,params.id,p=>{(p.roadmap.proof[key] ||= []).push(...files.map(f=>({id:nanoid(8),file:f.filename,name:f.originalname.slice(0,120),mime:f.mimetype,size:f.size,at:now()})));
      p.roadmap.proof[key]=p.roadmap.proof[key].slice(-80);});
  });
  r.del('/api/projects/:id/proof/:key/:pid',async({req,params})=>own(req,params.id,p=>{
    const list=p.roadmap.proof[params.key]||[];const i=list.findIndex(x=>x.id===params.pid);if(i<0)nf('file not found');
    const [gone]=list.splice(i,1);fsp.rm(path.join(PROOF_DIR,params.id,gone.file),{force:true}).catch(()=>{});}));
  r.get('/api/projects/:id/files/:file',async({req,res,params})=>{
    const user=await requireUser(req);const db=await load();const p=db.projects[params.id];if(!p||p.ownerId!==user.id)nf('file not found');
    const name=path.basename(params.file);const all=Object.values(p.roadmap?.proof||{}).flat();const meta=all.find(x=>x.file===name);if(!meta)nf('file not found');
    const file=path.join(PROOF_DIR,params.id,name);const st=await fsp.stat(file).catch(()=>null);if(!st)nf('file missing');
    res.writeHead(200,{'content-type':meta.mime||'application/octet-stream','content-length':st.size,'cache-control':'private, max-age=3600'});
    fs.createReadStream(file).pipe(res);
  });

  // ---- asset list (step 8 and onward) ----
  const assetFields=v=>{const o={};
    if('name' in v)o.name=String(v.name||'').slice(0,120);
    if('kind' in v){if(v.kind&&!ASSET_KINDS.includes(v.kind))throw new HttpError(400,'Unknown asset kind');o.kind=v.kind||'';}
    if('action' in v){if(v.action&&!ASSET_ACTIONS.includes(v.action))throw new HttpError(400,'Choose make, buy or generate');o.action=v.action||'';}
    if('status' in v){if(v.status&&!ASSET_STATUS.includes(v.status))throw new HttpError(400,'Unknown status');o.status=v.status||'Planned';}
    for(const k of ['source','license','notes'])if(k in v)o[k]=String(v[k]||'').slice(0,400);
    return o;};
  r.post('/api/projects/:id/asset-list',async({req,params,body})=>own(req,params.id,p=>{
    if(p.roadmap.assets.length>=500)throw new HttpError(400,'Asset list is full (500)');
    const rows=Array.isArray(body.rows)?body.rows:[body.values||{}];
    for(const row of rows.slice(0,100))p.roadmap.assets.push({id:nanoid(8),status:'Planned',name:'',kind:'',action:'',source:'',license:'',...assetFields(row),createdAt:now()});}));
  r.patch('/api/projects/:id/asset-list/:aid',async({req,params,body})=>own(req,params.id,p=>{
    const a=p.roadmap.assets.find(x=>x.id===params.aid);if(!a)nf('asset not found');Object.assign(a,assetFields(body.values||{}));}));
  r.del('/api/projects/:id/asset-list/:aid',async({req,params})=>own(req,params.id,p=>{
    const i=p.roadmap.assets.findIndex(x=>x.id===params.aid);if(i<0)nf('asset not found');p.roadmap.assets.splice(i,1);}));
  r.post('/api/projects/:id/asset-list/suggest',async({req,params})=>own(req,params.id,p=>{
    const d=ensureDesign(p),a=p.roadmap.answers;const hero=(d.characters||[]).find(c=>c.role==='Protagonist')?.name||'Hero';
    const have=new Set(p.roadmap.assets.map(x=>x.name.toLowerCase()));
    const rows=[[`${hero} (player character)`,'Character','Make','Character Creator 5 + Headshot 3','Owned (made by you with licensed tools)'],
      [`${a.m_enemy||'Enemy'} (enemy)`,'Character','Make','Character Creator 5 morphs','Owned (made by you with licensed tools)'],
      [(d.weapons||[])[0]?.name||'Main weapon','Model','Buy','Fab marketplace',''],
      ['Locomotion animation set','Animation','Buy','ActorCore or Fab motion pack',''],
      ['Attack, dodge, hit and death animations','Animation','Make','Phone capture with MetaHuman Animator, polish in Cascadeur','Owned'],
      [`${a.m_area||'Mission area'} modular kit`,'Model','Buy','Fab modular kit',''],
      ['Ground surfaces (rock, dirt, grass)','Surface or texture','Buy','Megascans on Fab',''],
      ['Props and clutter','Model','Generate','Duke + Meshy (background only)','Meshy paid-plan output'],
      ['Exploration music','Music','Generate','Suno Pro',''],['Combat music','Music','Generate','Suno Pro',''],
      ['Footsteps, weapon and impact sounds','Sound effect','Buy','Sound effects library',''],
      ['Enemy barks','Voice','Generate','AI voice tool','']];
    for(const [name,kind,action,source,license] of rows)if(!have.has(name.toLowerCase()))p.roadmap.assets.push({id:nanoid(8),name,kind,action,source,license,status:'Planned',createdAt:now()});}));

  // ---- requirements and the expansion loop ----
  r.patch('/api/projects/:id/requirements',async({req,params,body})=>own(req,params.id,p=>{
    for(const it of Array.isArray(body.items)?body.items:[]){
      let q=p.roadmap.requirements.find(x=>x.id===it.id);
      if(!q){if(!it.label)continue;if(p.roadmap.requirements.length>=30)throw new HttpError(400,'Too many requirements');q={id:nanoid(6),key:'custom',label:'',unit:'',target:null,current:0};p.roadmap.requirements.push(q);}
      if(it.remove&&q.key==='custom'){p.roadmap.requirements=p.roadmap.requirements.filter(x=>x!==q);continue;}
      if('label' in it&&q.key==='custom')q.label=String(it.label).slice(0,80);
      if('unit' in it&&q.key==='custom')q.unit=String(it.unit||'').slice(0,12);
      for(const k of ['target','current'])if(k in it){const n=it[k]===''||it[k]==null?null:Number(it[k]);if(n!==null&&(!Number.isFinite(n)||n<0))throw new HttpError(400,'Use positive numbers');q[k]=n;}
    }}));
  r.post('/api/projects/:id/passes',async({req,params,body})=>{
    const user=await requireUser(req);requireFeature(user,'expansion','The AI expansion loop');
    const db=await load();const p0=db.projects[params.id];if(!p0||p0.ownerId!==user.id)nf('project not found');ensureRoadmap(p0);
    if(evaluate(p0,planOf(user),ctxFor(db,p0)).steps[60].status==='locked')throw new HttpError(403,'The expansion loop opens at step 61.');
    if(p0.roadmap.passes.some(x=>['planned','review'].includes(x.status)))throw new HttpError(409,'Finish the open pass first');
    const open=p0.roadmap.requirements.filter(x=>x.key!=='fps'&&Number(x.target)>0&&Number(x.current||0)<Number(x.target));
    const q=body.requirement?open.find(x=>x.id===body.requirement):open.sort((a,b)=>(1-a.current/a.target)>(1-b.current/b.target)?-1:1)[0];
    if(!q)throw new HttpError(400,'Every requirement is already met');
    const plan=await director.planPass(p0,q);
    return own(req,params.id,p=>{p.roadmap.passes.unshift({id:nanoid(8),reqId:q.id,label:q.label,before:q.current||0,title:plan.title,size:plan.size,plan:plan.plan,source:plan.source,status:'planned',createdAt:now()});});
  });
  r.post('/api/projects/:id/passes/:pid/submit',async({req,params,body})=>own(req,params.id,p=>{
    const x=p.roadmap.passes.find(z=>z.id===params.pid);if(!x)nf('pass not found');if(x.status!=='planned'&&x.status!=='failed')throw new HttpError(400,'This pass is not waiting for results');
    const added=Number(body.added),fps=Number(body.fps);
    const fpsReq=p.roadmap.requirements.find(z=>z.key==='fps');const target=Number(fpsReq?.target)||60;
    const shots=(p.roadmap.proof[`pass-${x.id}`]||[]).length;
    x.added=Number.isFinite(added)?added:0;x.fps=Number.isFinite(fps)?fps:0;x.note=String(body.note||'').slice(0,2000);
    x.checks=[{label:'New content added',ok:x.added>0,detail:`${x.added} added`},{label:`Frame rate at or above ${target} fps`,ok:x.fps>=target,detail:`${x.fps} fps measured`},
      {label:'After screenshots attached for review',ok:shots>=1,detail:`${shots} attached`}];
    x.status=x.checks.every(c=>c.ok)?'review':'failed';x.submittedAt=now();}));
  r.post('/api/projects/:id/passes/:pid/review',async({req,params,body})=>own(req,params.id,p=>{
    const x=p.roadmap.passes.find(z=>z.id===params.pid);if(!x)nf('pass not found');if(x.status!=='review')throw new HttpError(400,'Only passes waiting for review can be approved');
    x.reviewNote=String(body.note||'').slice(0,2000);x.reviewedAt=now();
    if(body.approve){const q=p.roadmap.requirements.find(z=>z.id===x.reqId);if(q)q.current=Number(q.current||0)+x.added;
      const fq=p.roadmap.requirements.find(z=>z.key==='fps');if(fq)fq.current=x.fps;x.status='merged';}
    else x.status='rejected';}));

  // ---- mode, Course mode ----
  r.post('/api/projects/:id/mode',async({req,params,body})=>{
    const user=await requireUser(req);const mode=body.mode==='course'?'course':'build';
    if(mode==='course')requireFeature(user,'course','Course mode');
    return own(req,params.id,p=>{p.mode=mode;});
  });
  r.post('/api/projects/:id/lessons/:n',async({req,params,body})=>{
    const user=await requireUser(req);requireFeature(user,'course','Course mode');const step=stepOr404(params.n);
    const part=['learn','watch'].includes(body.part)?body.part:nf('unknown part');
    return own(req,params.id,p=>{const l=p.course.lessons[step.n] ||= {};l[part]=l[part]||now();},{step,allowLocked:false});
  });
  r.get('/api/lessons/:n/video',({params})=>({video:lessonVideo(stepOr404(params.n).slug)}));
  r.post('/api/projects/:id/quiz/:phase',async({req,params,body})=>{
    const user=await requireUser(req);requireFeature(user,'course','Course quizzes');
    const phase=Number(params.phase);const g=gradeQuiz(phase,body.answers);if(!g)nf('quiz not found');
    const out=await own(req,params.id,p=>{const prev=p.course.quizzes[phase];if(!prev?.passed||g.score>prev.score)p.course.quizzes[phase]={score:g.score,total:g.total,passed:g.passed||!!prev?.passed,at:now()};});
    return {...out,grade:g};
  });
  r.post('/api/projects/:id/certificates/:phase',async({req,params})=>{
    const user=await requireUser(req);requireFeature(user,'course','Certificates');const phase=Number(params.phase);
    const ph=PHASES.find(x=>x.n===phase);if(!ph)nf('phase not found');
    return own(req,params.id,(p,db)=>{
      const ev=evaluate(p,planOf(user),ctxFor(db,p));
      if(!ev.steps.filter(s=>s.phase===phase).every(s=>s.status==='done'))throw new HttpError(400,`Finish every step in Phase ${phase} first`);
      if(!p.course.quizzes[phase]?.passed)throw new HttpError(400,`Pass the Phase ${phase} quiz first`);
      if(p.course.certificates[phase])return {certificate:db.certificates[p.course.certificates[phase]]};
      const id=nanoid(12);db.certificates ||= {};
      db.certificates[id]={id,name:user.name||user.email.split('@')[0],phase,phaseTitle:ph.title,game:p.design.vision?.title||p.name,steps:STEPS.filter(s=>s.phase===phase).map(s=>s.n),issuedAt:now()};
      p.course.certificates[phase]=id;return {certificate:db.certificates[id]};
    });
  });

  // ---- showcase ----
  // Publishing to the showcase copies the chosen screenshot to a public location; everything else stays private.
  r.post('/api/projects/:id/showcase',async({req,params,body})=>own(req,params.id,async p=>{
    let cover=p.showcase?.cover||'';
    if(body.coverFile){
      const name=path.basename(String(body.coverFile));const meta=Object.values(p.roadmap.proof).flat().find(x=>x.file===name);
      if(!meta||!/^image\//.test(meta.mime))throw new HttpError(400,'Pick one of your uploaded screenshots');
      const dir=path.join(UPLOAD_DIR,'showcase');await fsp.mkdir(dir,{recursive:true});
      await fsp.copyFile(path.join(PROOF_DIR,p.id,name),path.join(dir,`${p.id}-${name}`));cover=`/uploads/showcase/${p.id}-${name}`;
    }
    p.showcase={on:!!body.on,blurb:String(body.blurb??p.showcase?.blurb??'').slice(0,600),cover,at:now()};}));
}
