// AI Team + Autopilot: creators connect their own AI providers, assign agents to studio roles, and an
// always-on worker advances the project: the director plans a milestone into tasks with dependencies and
// acceptance criteria, agents produce real outputs (design answers, data, source files, docs), a tool
// gateway enforces what each role may touch, an independent agent reviews, passing work is integrated
// with version checks, and a checkpoint is saved. State lives in the database, so work continues when the
// browser closes and resumes after a server restart (expired leases are re-queued; stale results ignored).
import fs from 'node:fs/promises';
import path from 'node:path';
import { load, mutate } from './store.js';
import { HttpError, id as nanoid } from './http.js';
import { requireUser, isAdminEmail } from './auth.js';
import { planOf, PLANS } from './billing.js';
import { seal, open, hint } from './secrets.js';
import { PROVIDERS, listModels, complete, testConnection, parseJson } from './providers.js';
import { STEPS } from './roadmap.js';
import { STAGES, FIELD_HOME, COLLECTIONS, ensureDesign } from './pipeline.js';
import { evaluate } from './progress.js';
import { settle, ctxFor, ownerPlan, agentFor } from './ctx.js';
import { DATA_DIR } from './paths.js';
import { pushLinkCommand } from './link.js';

const now=()=>new Date().toISOString();
const day=()=>new Date().toISOString().slice(0,10);
const nf=(w='not found')=>{throw new HttpError(404,w);};
export const WORKSPACES=path.join(DATA_DIR,'workspaces');
const LEASE_MS=(Number(process.env.TEAM_LEASE_MS)||6*60e3), MAX_ATTEMPTS=3, MAX_FILE=200*1024;

// ---------------------------------------------------------------- roles and what each may touch
export const ROLES={
  director:{label:'Project director',prefer:['anthropic'],does:'Keeps the plan, splits milestones into tasks, tracks dependencies and progress.',
    outputs:['answer','design','file','decision'],files:['Docs/Plan/'],design:['vision'],collections:[],tools:[]},
  gameplay:{label:'Gameplay engineer',prefer:['openai'],does:'Writes movement, combat, abilities, inventory and other game systems.',
    outputs:['file','entity'],files:['Source/','Config/DukeForge/'],design:[],collections:['weapons','vehicles'],tools:[]},
  world:{label:'World builder',prefer:['anthropic','openai'],does:'Designs regions, districts, levels and procedural rules; can run world tools in Unreal.',
    outputs:['file','entity','design','tool'],files:['Content/DukeForge/World/','Docs/World/'],design:['world'],collections:['districts','landmarks','kit'],tools:['ue_blockout_room','ue_save_all']},
  character:{label:'Character and animation specialist',prefer:['anthropic','openai'],does:'Plans characters, species, outfits, rigs and animation lists for the art tools.',
    outputs:['file','entity'],files:['Docs/Characters/','Content/DukeForge/Characters/'],design:[],collections:['characters'],tools:[]},
  ui:{label:'UI designer and engineer',prefer:['anthropic'],does:'Builds menus, HUD, controls and onboarding.',
    outputs:['file','design'],files:['Source/','Content/DukeForge/UI/','Docs/UI/'],design:['audio_ui'],collections:[],tools:[]},
  narrative:{label:'Narrative designer',prefer:['anthropic'],does:'Keeps story, dialogue, quests and progression consistent.',
    outputs:['answer','design','entity','file'],files:['Docs/Story/','Content/DukeForge/Dialogue/'],design:['story'],collections:['missions','characters'],tools:[]},
  research:{label:'Research and asset scout',prefer:['xai'],does:'Finds documentation and compatible assets, with source and license.',
    outputs:['file','asset'],files:['Docs/Research/'],design:[],collections:[],tools:[]},
  content:{label:'Content assistant',prefer:['llama'],does:'Produces structured content: item data, tags and approved variations.',
    outputs:['file','answer'],files:['Content/DukeForge/Data/'],design:[],collections:[],tools:[]},
  tester:{label:'Independent tester',prefer:['openai','anthropic'],does:'Reviews other agents\' work against acceptance criteria and reports defects. Never reviews its own work.',
    outputs:['file'],files:['Docs/QA/'],design:[],collections:[],tools:['ue_play','ue_stop']},
  integration:{label:'Integration and build manager',prefer:['openai','anthropic'],does:'Combines reviewed work, saves snapshots and queues verified builds.',
    outputs:['file','tool'],files:['Docs/Builds/'],design:[],collections:[],tools:['git_commit','build']}
};
const ROLE_KEYS=Object.keys(ROLES);
const AGENT_LIMIT={free:0,creator:3,academy:5,studio:12};
const agentLimit=u=>isAdminEmail(u?.email)?50:AGENT_LIMIT[planOf(u)]||0;
// Starting price estimates (USD per million tokens). Creators confirm or edit them; budgets use these.
const PRICE_DEFAULT={anthropic:[3,15],openai:[2.5,10],xai:[3,15],llama:[0.6,1.8]};

export function ensureTeam(p){
  const t=p.team ||= {};
  t.agents ||= [];t.tasks ||= [];t.log ||= [];t.checkpoints ||= [];t.corrections ||= [];t.decisions ||= [];t.files ||= {};
  t.spend ||= {total:0,days:{}};
  t.autopilot ||= {state:'stopped',mode:'always',windowStart:'22:00',windowEnd:'07:00',tzOffsetMin:240,dailyLimit:5,projectLimit:50,maxParallel:3,milestone:null,reason:'Not started'};
  return t;
}
const tlog=(t,msg,kind='info')=>{t.log.push({at:now(),msg:String(msg).slice(0,400),kind});if(t.log.length>300)t.log.splice(0,t.log.length-300);};
const publicAgent=a=>a;
const agentCost=(a,u)=>((u.input||0)*(a.priceIn??0)+(u.output||0)*(a.priceOut??0))/1e6;

// ---------------------------------------------------------------- tool gateway (enforced in code)
const safePath=p=>{const s=String(p||'').replace(/\\/g,'/').replace(/^\/+/,'');
  if(!s||s.includes('..')||s.includes('\0')||/^[a-z]:/i.test(s)||s.length>200)return null;return s;};
const braces=s=>{let n=0;for(const ch of s){if(ch==='{')n++;else if(ch==='}'){n--;if(n<0)return false;}}return n===0;};
function gate(task,agent,out,p){
  const role=ROLES[task.role];const problems=[];
  if(!role.outputs.includes(out.type))return `The ${role.label} role may not produce "${out.type}" outputs`;
  if(out.type==='file'){
    const fp=safePath(out.path);if(!fp)return `Bad file path "${out.path}"`;
    if(!role.files.some(pre=>fp.startsWith(pre)))return `${role.label} may only write under ${role.files.join(', ')} (tried ${fp})`;
    const c=String(out.content??'');if(!c.trim())return `${fp} is empty`;if(Buffer.byteLength(c)>MAX_FILE)return `${fp} is larger than 200 KB`;
    if(/\.json$/i.test(fp)){try{JSON.parse(c);}catch(e){return `${fp} is not valid JSON: ${e.message}`;}}
    if(/\.(cpp|h|hpp|cs)$/i.test(fp)&&!braces(c))return `${fp} has unbalanced braces`;
    out.path=fp;
  }
  if(out.type==='answer'){
    const step=STEPS[Number(out.step)-1];const f=step?.inputs.find(x=>x.key===out.key);if(!f)return `Unknown answer ${out.step}/${out.key}`;
    if(f.key==='project_path')return 'Agents may not change the project path';
    const ev=evaluate(p,ownerPlan(dbRef,p),ctxFor(dbRef,p)).steps[step.n-1];if(!['open','done'].includes(ev.status))return `Step ${step.n} is not open yet`;
    const v=out.value;
    if(f.type==='list'&&(!Array.isArray(v)||v.length<(f.min||1)))return `${f.label} needs at least ${f.min||1} items`;
    if(f.type==='number'&&!Number.isFinite(Number(v)))return `${f.label} must be a number`;
    if(f.type==='select'&&!f.options.includes(v))return `${f.label} must be one of ${f.options.join(', ')}`;
    if(['text','textarea'].includes(f.type)&&String(v||'').trim().length<(f.min||1))return `${f.label} is too short`;
  }
  if(out.type==='design'){
    if(!role.design.includes(out.stage))return `${role.label} may not edit the ${out.stage} design`;
    const st=STAGES.find(s=>s.id===out.stage);const f=st?.fields.find(x=>x.key===out.key);if(!f)return `Unknown design field ${out.stage}.${out.key}`;
    if(f.type==='select'&&!f.options.includes(out.value))return `${f.label} must be one of ${f.options.join(', ')}`;
  }
  if(out.type==='entity'){
    if(!role.collections.includes(out.collection))return `${role.label} may not add ${out.collection}`;
    if(!out.values||typeof out.values!=='object')return 'Entity has no values';
    const C=COLLECTIONS[out.collection];const miss=C.fields.filter(f=>f.required&&!f.source&&!String(out.values[f.key]??'').trim()).map(f=>f.label);
    if(miss.length)return `${C.label} is missing ${miss.join(', ')}`;
  }
  if(out.type==='asset'&&!(out.name&&out.source&&out.license))return 'Assets need a name, a source and a license';
  if(out.type==='tool'){if(!role.tools.includes(out.action))return `${role.label} may not run ${out.action}`;}
  if(out.type==='decision'&&!out.question)return 'Decision without a question';
  return null;
}
let dbRef=null; // set during integration/gating inside mutate()

// ---------------------------------------------------------------- prompts
function brief(p){
  const d=ensureDesign(p),v=d.vision||{},s=d.story||{},a=p.roadmap?.answers||{};
  return [`GAME: ${v.title||p.name}`,`Pitch: ${v.logline||''}`,`Setting: ${v.setting||''} · Tone: ${v.tone||''} · Art direction: ${v.art_direction||''}`,
    `Scope: ${a.players||''}, ${a.length||''} · Rules: ${(a.rules||[]).slice(0,10).join('; ')}`,`Species: ${(a.species||[]).join('; ')} · Languages: ${(a.languages||[]).join('; ')}`,
    `Story: ${s.premise||''}`,`Characters: ${(d.characters||[]).map(c=>`${c.name} (${c.role})`).join(', ')}`,`Districts: ${(d.districts||[]).map(x=>x.name).join(', ')}`].join('\n');
}
const OUTPUT_SPEC=`Return ONE JSON object: {"summary":"one sentence of what you did","outputs":[...]}
Output types (use only those your role allows):
- {"type":"file","path":"<relative path>","content":"<full file text>"}
- {"type":"answer","step":<step number>,"key":"<field key>","value":<text, number or array of strings>}
- {"type":"design","stage":"<vision|story|world|audio_ui>","key":"<field key>","value":<value>}
- {"type":"entity","collection":"<collection>","values":{...fields...}}
- {"type":"asset","name":"...","kind":"Model|Character|Animation|Surface or texture|Sound effect|Music|Voice|Other","action":"Make|Buy|Generate","source":"...","license":"..."}
- {"type":"tool","action":"<allowed tool>"}
- {"type":"decision","question":"<something only the creator should decide>","options":["..."]}
Write real, complete content. Never invent licenses: if unsure, say "check license" in the license field.`;

function roleContext(p,role){
  const t=p.team;const files=Object.entries(t.files).filter(([fp])=>ROLES[role].files.some(pre=>fp.startsWith(pre))||fp.startsWith('Docs/Plan/')).slice(-30).map(([fp,f])=>`${fp} (v${f.version})`);
  const dec=t.decisions.filter(d=>d.answer).slice(-10).map(d=>`- ${d.question} → ${d.answer}`).join('\n');
  return `${brief(p)}\nCreator decisions:\n${dec||'(none yet)'}\nFiles you may build on: ${files.join(', ')||'(none yet)'}`;
}
function stepContext(p,ev){
  const s=STEPS[ev.current-1];const st=ev.steps[ev.current-1];
  const fields=s.inputs.map(f=>`  - answer key "${f.key}" (${f.type}${f.min?`, min ${f.min}`:''}${f.options?`, one of ${f.options.join('|')}`:''}): ${f.label}`).join('\n');
  return `CURRENT STEP ${s.n}/67: ${s.title} (phase ${s.phase}). ${s.plain}\nStill failing gate checks:\n${st.checks.filter(c=>!c.ok).map(c=>`  - [${c.kind}] ${c.label}${c.detail?` (${c.detail})`:''}`).join('\n')||'  (none)'}\n${fields?`Answer fields on this step:\n${fields}`:''}`;
}

// ---------------------------------------------------------------- credentials + agents API
async function owned(req,id){const user=await requireUser(req);const db=await load();const p=db.projects[id];if(!p||p.ownerId!==user.id)nf('project not found');return {user,db,p};}
function credOf(db,user,credId){const c=db.creds?.[credId];if(!c||c.userId!==user.id)throw new HttpError(400,'Pick one of your saved connections');return c;}
const credView=c=>({id:c.id,provider:c.provider,label:c.label,baseUrl:c.baseUrl||'',hint:c.hint,createdAt:c.createdAt,lastTest:c.lastTest||null});
function teamView(db,p){
  const t=ensureTeam(p);
  return {team:{...t,agents:t.agents.map(publicAgent)},roles:ROLES,providers:PROVIDERS,limits:{agents:agentLimit(db.users?.[p.ownerId])},
    creds:Object.values(db.creds||{}).filter(c=>c.userId===p.ownerId).map(credView),
    pc:{online:!!agentFor(db,p.ownerId)?.seenAt&&Date.now()-Date.parse(agentFor(db,p.ownerId).seenAt)<10*60e3},
    build:(p.builds||[]).find(b=>b.status==='succeeded')||null};
}
async function withTeam(req,id,fn){
  const user=await requireUser(req);
  const out=await mutate(async db=>{const p=db.projects[id];if(!p||p.ownerId!==user.id)return null;ensureTeam(p);dbRef=db;const r=await fn(p,db,user);p.updatedAt=now();return r===undefined?teamView(db,p):r;});
  if(out===null)nf('project not found');return out;
}

export function registerTeam(r){
  r.get('/api/team/providers',()=>({providers:PROVIDERS,roles:ROLES,prices:PRICE_DEFAULT}));
  r.get('/api/projects/:id/team',async({req,params})=>{const {db,p}=await owned(req,params.id);return teamView(db,p);});

  // Connections (API credentials): sealed at rest, never returned.
  r.post('/api/team/connections',async({req,body})=>{
    const user=await requireUser(req);if(!PLANS[planOf(user)].features.build)throw new HttpError(402,'The AI Team is part of the Creator plan or higher.');
    const provider=String(body.provider||'');if(!PROVIDERS[provider])throw new HttpError(400,'Choose a provider');
    const apiKey=String(body.apiKey||'').trim();const baseUrl=String(body.baseUrl||'').trim().replace(/\/$/,'');
    if(!apiKey&&provider!=='llama')throw new HttpError(400,'Paste the API key from your provider account');
    if(provider==='llama'&&!/^https?:\/\//.test(baseUrl))throw new HttpError(400,'Enter the base URL of your Llama endpoint (ending in /v1)');
    let test;try{test=await testConnection({provider,apiKey,baseUrl,model:String(body.model||'')});}catch(e){throw new HttpError(400,`Connection failed: ${e.message}`);}
    const c={id:nanoid(10),userId:user.id,provider,label:String(body.label||PROVIDERS[provider].name).slice(0,60),baseUrl,sealed:apiKey?seal(apiKey):'',hint:hint(apiKey),createdAt:now(),
      lastTest:{ok:true,at:now(),models:test.models,model:test.model,ms:test.ms}};
    await mutate(db=>{db.creds ||= {};db.creds[c.id]=c;return true;});
    return {connection:credView(c)};
  });
  r.post('/api/team/connections/:cid/test',async({req,params})=>{
    const user=await requireUser(req);const db=await load();const c=credOf(db,user,params.cid);
    let lastTest;try{const t=await testConnection({provider:c.provider,apiKey:c.sealed?open(c.sealed):'',baseUrl:c.baseUrl});lastTest={ok:true,at:now(),models:t.models,model:t.model,ms:t.ms};}
    catch(e){lastTest={ok:false,at:now(),error:e.message};}
    await mutate(db=>{if(db.creds[c.id])db.creds[c.id].lastTest=lastTest;return true;});
    return {connection:credView({...c,lastTest})};
  });
  r.del('/api/team/connections/:cid',async({req,params})=>{
    const user=await requireUser(req);
    await mutate(db=>{const c=db.creds?.[params.cid];if(!c||c.userId!==user.id)nf('connection not found');delete db.creds[params.cid];
      for(const p of Object.values(db.projects))if(p.ownerId===user.id)for(const a of p.team?.agents||[])if(a.credId===params.cid){a.status='disconnected';a.credId=null;}return true;});
    return {ok:true};
  });

  const agentFields=(a,b,db,user)=>{
    if('name' in b)a.name=String(b.name||'Agent').slice(0,60);
    if('credId' in b){const c=credOf(db,user,b.credId);a.credId=c.id;a.provider=c.provider;if(a.status==='disconnected')a.status='active';}
    if('model' in b)a.model=String(b.model||'').slice(0,120);
    if('roles' in b){const rs=(Array.isArray(b.roles)?b.roles:[]).filter(x=>ROLES[x]);if(!rs.length)throw new HttpError(400,'Give the agent at least one role');a.roles=[...new Set(rs)];}
    if('tools' in b){const allowed=new Set(a.roles.flatMap(x=>ROLES[x].tools));a.tools=(Array.isArray(b.tools)?b.tools:[]).filter(x=>allowed.has(x));}
    for(const k of ['limitUSD','priceIn','priceOut']){if(k in b){const n=Number(b[k]);if(!Number.isFinite(n)||n<0)throw new HttpError(400,'Use positive numbers');a[k]=n;}}
    if('maxConcurrent' in b)a.maxConcurrent=Math.max(1,Math.min(4,Number(b.maxConcurrent)||1));
    if('status' in b&&['active','paused'].includes(b.status))a.status=b.status;
  };
  r.post('/api/projects/:id/team/agents',async({req,params,body})=>withTeam(req,params.id,(p,db,user)=>{
    const lim=agentLimit(user);if(p.team.agents.length>=lim)throw new HttpError(402,lim?`Your plan includes ${lim} agents. Upgrade for more.`:'The AI Team is part of the Creator plan or higher.');
    const c=credOf(db,user,body.credId);
    const a={id:nanoid(8),name:'Agent',credId:c.id,provider:c.provider,model:c.lastTest?.model||'',roles:['director'],tools:[],limitUSD:20,maxConcurrent:1,
      priceIn:PRICE_DEFAULT[c.provider][0],priceOut:PRICE_DEFAULT[c.provider][1],status:'active',spent:0,stats:{done:0,failed:0,reviews:0,tokensIn:0,tokensOut:0,ms:0},createdAt:now()};
    agentFields(a,body,db,user);if(!body.tools)a.tools=[...new Set(a.roles.flatMap(x=>ROLES[x].tools))];
    p.team.agents.push(a);tlog(p.team,`${a.name} joined as ${a.roles.map(x=>ROLES[x].label).join(', ')}`);
  }));
  r.patch('/api/projects/:id/team/agents/:aid',async({req,params,body})=>withTeam(req,params.id,(p,db,user)=>{
    const a=p.team.agents.find(x=>x.id===params.aid);if(!a)nf('agent not found');agentFields(a,body,db,user);}));
  r.del('/api/projects/:id/team/agents/:aid',async({req,params})=>withTeam(req,params.id,p=>{
    const i=p.team.agents.findIndex(x=>x.id===params.aid);if(i<0)nf('agent not found');const [a]=p.team.agents.splice(i,1);
    for(const t of p.team.tasks)if(t.agentId===a.id&&['queued','running'].includes(t.status)){t.status='queued';t.agentId=null;t.lease=null;}
    tlog(p.team,`${a.name} was disconnected`);}));

  // Set Up My Team: one agent per connected provider, roles spread by preference; tester kept separate.
  r.post('/api/projects/:id/team/setup',async({req,params})=>withTeam(req,params.id,(p,db,user)=>{
    const creds=Object.values(db.creds||{}).filter(c=>c.userId===user.id&&c.lastTest?.ok!==false);
    if(!creds.length)throw new HttpError(400,'Connect at least one AI provider first');
    const lim=agentLimit(user);if(!lim)throw new HttpError(402,'The AI Team is part of the Creator plan or higher.');
    const byProv={};for(const c of creds)(byProv[c.provider] ||= []).push(c);
    const pick=role=>{for(const pr of ROLES[role].prefer)if(byProv[pr])return pr;return Object.keys(byProv)[0];};
    const plan={};for(const role of ROLE_KEYS.filter(r=>r!=='tester'))(plan[pick(role)] ||= []).push(role);
    p.team.agents=p.team.agents.filter(a=>a.status!=='disconnected');
    const made=[];
    for(const [prov,roles] of Object.entries(plan)){if(p.team.agents.length+made.length>=lim)break;const c=byProv[prov][0];
      made.push({id:nanoid(8),name:`${PROVIDERS[prov].name.split(' ')[0]} lead`,credId:c.id,provider:prov,model:c.lastTest?.model||'',roles,tools:[...new Set(roles.flatMap(x=>ROLES[x].tools))],
        limitUSD:20,maxConcurrent:2,priceIn:PRICE_DEFAULT[prov][0],priceOut:PRICE_DEFAULT[prov][1],status:'active',spent:0,stats:{done:0,failed:0,reviews:0,tokensIn:0,tokensOut:0,ms:0},createdAt:now()});}
    // An independent tester: a separate agent (a second connection or the same provider as its own agent).
    if(p.team.agents.length+made.length<lim){const prov=pick('tester');const c=(byProv[prov][1]||byProv[prov][0]);
      made.push({id:nanoid(8),name:'Independent tester',credId:c.id,provider:prov,model:c.lastTest?.model||'',roles:['tester'],tools:ROLES.tester.tools,
        limitUSD:10,maxConcurrent:1,priceIn:PRICE_DEFAULT[prov][0],priceOut:PRICE_DEFAULT[prov][1],status:'active',spent:0,stats:{done:0,failed:0,reviews:0,tokensIn:0,tokensOut:0,ms:0},createdAt:now()});}
    if(!made.length)throw new HttpError(402,'Your plan\'s agent limit is reached');
    p.team.agents.push(...made);tlog(p.team,`Team set up: ${made.map(a=>`${a.name} (${a.roles.length} roles)`).join(', ')}`);
  }));

  // Autopilot controls
  r.post('/api/projects/:id/team/autopilot',async({req,params,body})=>withTeam(req,params.id,(p,db,user)=>{
    const ap=p.team.autopilot;const act=String(body.action||'');
    if(body.settings){const s=body.settings;
      if(['always','window'].includes(s.mode))ap.mode=s.mode;
      for(const k of ['windowStart','windowEnd'])if(/^\d{2}:\d{2}$/.test(s[k]||''))ap[k]=s[k];
      if(Number.isFinite(Number(s.tzOffsetMin)))ap.tzOffsetMin=Number(s.tzOffsetMin);
      for(const k of ['dailyLimit','projectLimit']){const n=Number(s[k]);if(Number.isFinite(n)&&n>=0)ap[k]=n;}
      if(s.maxParallel)ap.maxParallel=Math.max(1,Math.min(8,Number(s.maxParallel)||1));}
    if(act==='start'||act==='resume'){
      if(!p.team.agents.some(a=>a.status==='active'&&a.roles.includes('director')))throw new HttpError(400,'Give one agent the Project director role first');
      ap.state='running';ap.reason='';ap.startedAt ||= now();tlog(p.team,act==='start'?'Autopilot started':'Autopilot resumed');}
    if(act==='pause'){ap.state='paused';ap.reason='Paused by you';tlog(p.team,'Autopilot paused');}
    if(act==='stop'){ap.state='stopped';ap.reason='Stopped by you';
      for(const t of p.team.tasks)if(['queued','running','review'].includes(t.status)){t.status='canceled';t.lease=null;}tlog(p.team,'Autopilot stopped and open tasks canceled');}
  }));
  // Plain-language corrections become revision work for the director.
  r.post('/api/projects/:id/team/correct',async({req,params,body})=>withTeam(req,params.id,p=>{
    const text=String(body.text||'').trim().slice(0,2000);if(!text)throw new HttpError(400,'Write what should change');
    p.team.corrections.push({id:nanoid(6),text,at:now(),status:'open'});tlog(p.team,`Correction received: ${text.slice(0,120)}`);
    if(p.team.autopilot.state==='running')p.team.needsPlan=true;}));
  r.post('/api/projects/:id/team/decisions/:did',async({req,params,body})=>withTeam(req,params.id,p=>{
    const d=p.team.decisions.find(x=>x.id===params.did);if(!d)nf('decision not found');d.answer=String(body.answer||'').slice(0,1000);d.answeredAt=now();
    const t=p.team.tasks.find(x=>x.decisionId===d.id);if(t){t.status='done';t.finishedAt=now();}tlog(p.team,`You decided: ${d.question} → ${d.answer}`);p.team.needsPlan=true;}));
  r.post('/api/projects/:id/team/tasks/:tid/approve',async({req,params,body})=>withTeam(req,params.id,(p,db)=>{
    const t=p.team.tasks.find(x=>x.id===params.tid);if(!t||t.status!=='needs_review')nf('nothing to approve');
    if(body.approve){integrate(db,p,t,'you');}else{retryOrBlock(p.team,t,String(body.note||'Sent back by you'));}}));
  r.get('/api/projects/:id/team/files/*',async()=>nf());
  r.get('/api/projects/:id/team/file',async({req,params,query})=>{
    const {p}=await owned(req,params.id);const fp=safePath(query.get('path'));if(!fp||!p.team?.files?.[fp])nf('file not found');
    return {path:fp,meta:p.team.files[fp],content:await fs.readFile(path.join(WORKSPACES,p.id,fp),'utf8').catch(()=>'')};
  });
}

// ---------------------------------------------------------------- the worker
const running=new Set();
function inWindow(ap){
  if(ap.mode!=='window')return true;
  const d=new Date(Date.now()-ap.tzOffsetMin*60e3);const m=d.getUTCHours()*60+d.getUTCMinutes();
  const [a,b]=[ap.windowStart,ap.windowEnd].map(x=>{const [h,mm]=x.split(':').map(Number);return h*60+mm;});
  return a<=b?m>=a&&m<b:m>=a||m<b;
}
const spentToday=t=>t.spend.days[day()]||0;
function budgetStop(t){
  const ap=t.autopilot;
  if(ap.dailyLimit>0&&spentToday(t)>=ap.dailyLimit)return `Daily limit of $${ap.dailyLimit} reached. It resumes tomorrow, or raise the limit.`;
  if(ap.projectLimit>0&&t.spend.total>=ap.projectLimit)return `Project limit of $${ap.projectLimit} reached. Raise it to continue.`;
  return null;
}
function pickAgent(t,role,exclude){
  return t.agents.filter(a=>a.status==='active'&&a.credId&&a.roles.includes(role)&&a.id!==exclude&&(a.limitUSD<=0||a.spent<a.limitUSD)
    &&t.tasks.filter(x=>x.status==='running'&&x.agentId===a.id).length<(a.maxConcurrent||1))
    .sort((x,y)=>t.tasks.filter(z=>z.status==='running'&&z.agentId===x.id).length-t.tasks.filter(z=>z.status==='running'&&z.agentId===y.id).length)[0];
}
function retryOrBlock(t,task,why){
  task.feedback=[...(task.feedback||[]),why].slice(-5);task.lease=null;task.agentId=null;
  if((task.attempts||0)>=MAX_ATTEMPTS){task.status='blocked';task.blocker=why;tlog(t,`Blocked: ${task.title}: ${why}`,'warn');}
  else{task.status='queued';tlog(t,`Retrying ${task.title}: ${why}`,'warn');}
}
async function callAgent(db,a,system,user){
  const cred=db.creds?.[a.credId];if(!cred)throw new Error('Connection removed');
  const t0=Date.now();const r=await complete({provider:a.provider,model:a.model,baseUrl:cred.baseUrl,apiKey:cred.sealed?open(cred.sealed):''},{system,user,maxTokens:8000});
  return {...r,ms:Date.now()-t0};
}
function charge(t,a,r){
  const cost=agentCost(a,r.usage);a.spent=(a.spent||0)+cost;t.spend.total+=cost;t.spend.days[day()]=(t.spend.days[day()]||0)+cost;
  a.stats.tokensIn+=r.usage.input||0;a.stats.tokensOut+=r.usage.output||0;a.stats.ms+=r.ms||0;return cost;
}

// Integration: apply passing outputs, refusing to overwrite files changed since the task started.
function integrate(db,p,task,by){
  dbRef=db;const t=p.team;const outs=task.outputs||[];
  for(const o of outs)if(o.type==='file'){const cur=t.files[o.path]?.version||0;const base=task.baseVersions?.[o.path]||0;
    if(cur!==base){retryOrBlock(t,task,`${o.path} changed (v${cur}) since this work started (v${base}). Redo it on top of the latest version.`);return false;}}
  const changed=[];
  for(const o of outs){
    if(o.type==='file'){const v=(t.files[o.path]?.version||0)+1;t.files[o.path]={version:v,by:task.agentName,taskId:task.id,at:now(),size:Buffer.byteLength(o.content)};
      pendingWrites.push({pid:p.id,path:o.path,content:o.content});changed.push(`${o.path} v${v}`);}
    if(o.type==='answer'){p.roadmap.answers[o.key]=o.value;changed.push(`step ${o.step}: ${o.key}`);}
    if(o.type==='design'){const home=p.design[FIELD_HOME[o.stage]] ||= {};home[o.key]=o.value;changed.push(`${o.stage}.${o.key}`);}
    if(o.type==='entity'){const list=p.design[o.collection] ||= [];if(list.length<60){const e={id:nanoid(8),createdAt:now()};
      for(const f of COLLECTIONS[o.collection].fields)if(o.values[f.key]!==undefined&&!f.source)e[f.key]=o.values[f.key];list.push(e);changed.push(`${o.collection}: ${e.name||'new'}`);}}
    if(o.type==='asset'){p.roadmap.assets.push({id:nanoid(8),name:String(o.name).slice(0,120),kind:o.kind||'Other',action:o.action||'Buy',source:String(o.source).slice(0,400),license:String(o.license).slice(0,400),status:'Planned',createdAt:now(),by:task.agentName});changed.push(`asset: ${o.name}`);}
    if(o.type==='tool'){
      if(o.action==='build'){if(!(p.builds||[]).some(b=>['queued','running'].includes(b.status))){(p.builds ||= []).unshift({id:nanoid(10),status:'queued',phase:'Queued by the AI Team',progress:0,logs:['Build queued by the integration manager'],config:'Development',source:ctxFor(db,p).inspect?.exists?'mine':'duke',localProject:ctxFor(db,p).inspect?.exists?ctxFor(db,p).inspect.path:null,createdAt:now()});changed.push('build queued');}}
      else{const a=agentFor(db,p.ownerId);if(a){pushLinkCommand(a.token,{type:'action',action:o.action,project:p.roadmap.answers.project_path||''});changed.push(`ran ${o.action} on your PC`);}}
    }
  }
  task.status='done';task.finishedAt=now();task.integratedBy=by;task.changed=changed;
  const cp={id:nanoid(8),at:now(),taskId:task.id,title:task.title,changed,spend:Math.round(t.spend.total*100)/100};
  t.checkpoints.push(cp);if(t.checkpoints.length>200)t.checkpoints.shift();
  const done=settle(db,p);
  tlog(t,`Integrated "${task.title}" (${changed.length} change${changed.length===1?'':'s'})${done.length?`. Step ${done.join(', ')} complete!`:''}`,'ok');
  return true;
}
const pendingWrites=[];
async function flushWrites(){
  while(pendingWrites.length){const w=pendingWrites.shift();const fp=path.join(WORKSPACES,w.pid,w.path);
    await fs.mkdir(path.dirname(fp),{recursive:true});await fs.writeFile(fp,w.content);}
}

async function plan(pid){
  const key=`plan:${pid}`;if(running.has(key))return;running.add(key);
  try{
    const db=await load();const p=db.projects[pid];if(!p)return;ensureTeam(p);settle(db,p);
    const t=p.team;const dir=t.agents.find(a=>a.status==='active'&&a.credId&&a.roles.includes('director'));
    if(!dir){await mutate(db=>{const q=db.projects[pid];q.team.autopilot.state='paused';q.team.autopilot.reason='No active Project director. Assign the director role to an agent.';return true;});return;}
    const ev=evaluate(p,ownerPlan(db,p),ctxFor(db,p));
    const roles=[...new Set(t.agents.filter(a=>a.status==='active').flatMap(a=>a.roles))];
    const corrections=t.corrections.filter(c=>c.status==='open');
    const system=`You are the Project director of a small AI game studio building a high-end Unreal Engine 5 open-world game for a solo creator. Plan the next useful milestone as a few concrete tasks other agents can do right now. Keep creative decisions consistent with the brief and the creator's decisions. Bring only real creative-direction, scope, spending or release choices to the creator.`;
    const user=`${roleContext(p,'director')}\n\n${stepContext(p,ev)}\n\nAvailable roles: ${roles.map(r=>`${r} (${ROLES[r].label}: may output ${ROLES[r].outputs.join('/')}${ROLES[r].files.length?`; files under ${ROLES[r].files.join(', ')}`:''}${ROLES[r].collections.length?`; collections ${ROLES[r].collections.join(', ')}`:''}${ROLES[r].design.length?`; design ${ROLES[r].design.join(', ')}`:''})`).join('\n')}
Recently finished: ${t.checkpoints.slice(-6).map(c=>c.title).join('; ')||'(nothing yet)'}
Creator corrections to address first: ${corrections.map(c=>c.text).join(' | ')||'(none)'}

Return JSON: {"milestone":"short name of the next milestone","tasks":[{"key":"t1","title":"...","role":"<one of the available roles, not tester>","instructions":"what to produce, concretely","acceptance":["checkable criteria"],"dependsOn":["t0"]}],"decisions":[{"question":"...","options":["..."]}],"humanSteps":["things only the creator can do for the current step, in plain words"]}
Rules: at most 5 tasks; prefer filling the current step's answer fields and the work it unblocks; tasks without dependencies run in parallel; never assign the tester role (reviews are automatic); if nothing useful remains for agents, return an empty tasks list and explain in humanSteps.`;
    let r,err;try{r=await callAgent(db,dir,system,user);}catch(e){err=e.message;}
    await mutate(db=>{
      const q=db.projects[pid];if(!q)return true;const t=ensureTeam(q);const a=t.agents.find(x=>x.id===dir.id);t.needsPlan=false;
      if(err){t.autopilot.planErrors=(t.autopilot.planErrors||0)+1;tlog(t,`Director could not plan: ${err}`,'warn');
        if(t.autopilot.planErrors>=3){t.autopilot.state='paused';t.autopilot.reason=`The director's provider keeps failing: ${err}`;}return true;}
      t.autopilot.planErrors=0;if(a)charge(t,a,r);
      const j=parseJson(r.text);
      if(!j||!Array.isArray(j.tasks)){tlog(t,'Director returned an unreadable plan; trying again','warn');return true;}
      t.autopilot.milestone=String(j.milestone||'Next milestone').slice(0,120);
      const keyMap={};const made=[];
      for(const x of j.tasks.slice(0,5)){if(!ROLES[x.role]||x.role==='tester')continue;
        const id=nanoid(8);keyMap[x.key]=id;made.push({id,key:x.key,title:String(x.title||'Task').slice(0,140),role:x.role,instructions:String(x.instructions||'').slice(0,4000),
          acceptance:(Array.isArray(x.acceptance)?x.acceptance:[]).map(s=>String(s).slice(0,300)).slice(0,8),deps:Array.isArray(x.dependsOn)?x.dependsOn:[],
          status:'queued',attempts:0,milestone:t.autopilot.milestone,createdAt:now()});}
      for(const m of made){m.dependsOn=m.deps.map(k=>keyMap[k]).filter(Boolean);delete m.deps;}
      t.tasks.push(...made);
      for(const d of (j.decisions||[]).slice(0,3)){const did=nanoid(6);t.decisions.push({id:did,question:String(d.question).slice(0,300),options:(d.options||[]).map(String).slice(0,6),at:now()});
        t.tasks.push({id:nanoid(8),title:`Your decision: ${String(d.question).slice(0,100)}`,role:'director',status:'needs_you',decisionId:did,milestone:t.autopilot.milestone,createdAt:now()});}
      t.humanSteps=(j.humanSteps||[]).map(String).slice(0,6);
      for(const c of corrections){const x=t.corrections.find(y=>y.id===c.id);if(x)x.status='planned';}
      if(t.tasks.length>400)t.tasks.splice(0,t.tasks.length-400);
      if(!made.length&&!(j.decisions||[]).length){t.autopilot.state='paused';t.autopilot.reason=t.humanSteps.length?`Waiting for you: ${t.humanSteps[0]}`:'Nothing for agents to do on this step right now.';}
      tlog(t,`Director planned "${t.autopilot.milestone}": ${made.length} task${made.length===1?'':'s'}`);
      return true;});
  }finally{running.delete(key);}
}

async function work(pid,tid,leaseId){
  try{
    const db=await load();const p=db.projects[pid];const t=ensureTeam(p);const task=t.tasks.find(x=>x.id===tid);if(!task||task.lease?.id!==leaseId)return;
    const a=t.agents.find(x=>x.id===task.agentId);if(!a)return;
    const ev=evaluate(p,ownerPlan(db,p),ctxFor(db,p));
    if(task.kind==='review'){
      const src=t.tasks.find(x=>x.id===task.reviewOf);
      const system=`You are an independent game QA tester. Judge another agent's work strictly against its acceptance criteria and the game brief. You did not write it.`;
      const user=`${brief(p)}\n\nTASK: ${src.title}\nInstructions: ${src.instructions}\nAcceptance criteria:\n${src.acceptance.map(c=>`- ${c}`).join('\n')||'- Complete, correct and consistent with the brief'}\n\nOUTPUTS:\n${JSON.stringify(src.outputs,null,1).slice(0,40000)}\n\nReturn JSON: {"pass":true|false,"issues":["specific defects to fix"],"notes":"one sentence"}`;
      const r=await callAgent(db,a,system,user);
      await mutate(db=>{const q=db.projects[pid];const t=ensureTeam(q);const rv=t.tasks.find(x=>x.id===tid);if(!rv||rv.lease?.id!==leaseId)return true; // stale delivery
        const ag=t.agents.find(x=>x.id===rv.agentId);if(ag){charge(t,ag,r);ag.stats.reviews++;}
        const j=parseJson(r.text);const s=t.tasks.find(x=>x.id===rv.reviewOf);rv.lease=null;rv.finishedAt=now();
        if(!j||typeof j.pass!=='boolean'){rv.status='queued';rv.attempts++;rv.agentId=null;tlog(t,'Tester reply unreadable; reviewing again','warn');return true;}
        rv.status='done';rv.result={pass:j.pass,issues:(j.issues||[]).map(String).slice(0,10),notes:String(j.notes||'').slice(0,300)};
        if(s){s.review={pass:j.pass,by:ag?.name,issues:rv.result.issues,notes:rv.result.notes,at:now()};
          if(j.pass){dbRef=db;integrate(db,q,s,ag?.name||'tester');}else retryOrBlock(t,s,`Tester: ${rv.result.issues.join('; ')||rv.result.notes}`);}
        return true;});
      await flushWrites();return;
    }
    const role=ROLES[task.role];
    const system=`You are the ${role.label} in a small AI game studio. ${role.does} You produce real, complete project work for a high-end Unreal Engine 5 game. Stay consistent with the brief and the creator's decisions.\n${OUTPUT_SPEC}\nYour role may output: ${role.outputs.join(', ')}.${role.files.length?` Files only under: ${role.files.join(', ')}.`:''}${role.collections.length?` Collections: ${role.collections.join(', ')}.`:''}${role.design.length?` Design stages: ${role.design.join(', ')}.`:''}${role.tools.length?` Tools: ${role.tools.join(', ')}.`:''}`;
    const fileCtx=[];for(const [fp] of Object.entries(t.files).filter(([fp])=>role.files.some(pre=>fp.startsWith(pre))).slice(-4)){const c=await fs.readFile(path.join(WORKSPACES,pid,fp),'utf8').catch(()=>'');fileCtx.push(`--- ${fp}\n${c.slice(0,6000)}`);}
    const user=`${roleContext(p,task.role)}\n\n${stepContext(p,ev)}\n\nYOUR TASK: ${task.title}\n${task.instructions}\nAcceptance criteria:\n${(task.acceptance||[]).map(c=>`- ${c}`).join('\n')}\n${task.feedback?.length?`\nFix these problems from the last attempt:\n${task.feedback.map(f=>`- ${f}`).join('\n')}`:''}\n${fileCtx.length?`\nCurrent versions of related files:\n${fileCtx.join('\n')}`:''}`;
    const r=await callAgent(db,a,system,user);
    await mutate(db=>{const q=db.projects[pid];const t=ensureTeam(q);const task=t.tasks.find(x=>x.id===tid);if(!task||task.lease?.id!==leaseId)return true; // stale or duplicate delivery
      dbRef=db;const ag=t.agents.find(x=>x.id===task.agentId);if(ag)charge(t,ag,r);
      const j=parseJson(r.text);task.lease=null;
      if(!j||!Array.isArray(j.outputs)||!j.outputs.length){if(ag)ag.stats.failed++;retryOrBlock(t,task,'No usable outputs in the reply (it must be one JSON object with an outputs list)');return true;}
      const outs=j.outputs.slice(0,12);const errs=outs.map(o=>gate(task,ag,o,q)).filter(Boolean);
      if(errs.length){if(ag)ag.stats.failed++;retryOrBlock(t,task,`Rejected by the gateway: ${errs.join('; ')}`);return true;}
      const decisions=outs.filter(o=>o.type==='decision');
      for(const d of decisions){const did=nanoid(6);t.decisions.push({id:did,question:String(d.question).slice(0,300),options:(d.options||[]).map(String).slice(0,6),at:now()});
        t.tasks.push({id:nanoid(8),title:`Your decision: ${String(d.question).slice(0,100)}`,role:'director',status:'needs_you',decisionId:did,milestone:task.milestone,createdAt:now()});}
      task.outputs=outs.filter(o=>o.type!=='decision');task.summary=String(j.summary||'').slice(0,400);task.agentName=ag?.name;if(ag)ag.stats.done++;
      if(!task.outputs.length){task.status='done';task.finishedAt=now();return true;}
      // Independent review by a different agent; without one, the creator approves.
      const tester=pickAgentAny(t,'tester',task.agentId);
      if(tester||t.agents.some(x=>x.status==='active'&&x.roles.includes('tester')&&x.id!==task.agentId)){
        task.status='review';t.tasks.push({id:nanoid(8),kind:'review',reviewOf:task.id,title:`Review: ${task.title}`,role:'tester',status:'queued',attempts:0,milestone:task.milestone,excludeAgent:task.agentId,createdAt:now()});
        tlog(t,`${ag?.name} finished "${task.title}". Sent for independent review.`);
      }else{task.status='needs_review';tlog(t,`${ag?.name} finished "${task.title}". No independent tester: waiting for your approval.`,'warn');}
      return true;});
  }catch(e){
    await mutate(db=>{const q=db.projects[pid];if(!q)return true;const t=ensureTeam(q);const task=t.tasks.find(x=>x.id===tid);if(!task||task.lease?.id!==leaseId)return true;
      const ag=t.agents.find(x=>x.id===task.agentId);if(ag)ag.stats.failed++;retryOrBlock(t,task,`Provider error: ${e.message}`);return true;});
  }finally{running.delete(`${pid}:${tid}`);}
}
const pickAgentAny=(t,role,exclude)=>t.agents.find(a=>a.status==='active'&&a.credId&&a.roles.includes(role)&&a.id!==exclude);

export async function tick(){
  let jobs=[];let planNeeded=[];
  await mutate(db=>{
    for(const p of Object.values(db.projects)){
      const t=p.team;if(!t||t.autopilot?.state!=='running')continue;ensureTeam(p);
      const plan=planOf(db.users?.[p.ownerId]);
      if(!AGENT_LIMIT[plan]){t.autopilot.state='paused';t.autopilot.reason='The AI Team needs the Creator plan or higher.';continue;}
      // recover expired leases (server restarts, lost connections)
      for(const x of t.tasks)if(x.status==='running'&&x.lease&&Date.parse(x.lease.until)<Date.now()&&!running.has(`${p.id}:${x.id}`)){retryOrBlock(t,x,'The previous attempt did not finish (restart or timeout)');}
      const stop=budgetStop(t);if(stop){t.autopilot.state='paused';t.autopilot.reason=stop;tlog(t,stop,'warn');continue;}
      if(!inWindow(t.autopilot)){t.autopilot.reason=`Outside your schedule (${t.autopilot.windowStart}–${t.autopilot.windowEnd}). Waiting.`;continue;}
      t.autopilot.reason='';
      const open=t.tasks.filter(x=>['queued','running','review'].includes(x.status));
      if(!open.length||t.needsPlan){if(!t.tasks.some(x=>x.status==='needs_you'&&!t.needsPlan))planNeeded.push(p.id);else t.autopilot.reason='Waiting for your decision.';}
      const runningN=t.tasks.filter(x=>x.status==='running').length;let slots=t.autopilot.maxParallel-runningN;
      for(const x of t.tasks){if(slots<=0)break;if(x.status!=='queued')continue;
        if((x.dependsOn||[]).some(d=>t.tasks.find(y=>y.id===d)?.status!=='done'))continue;
        const a=pickAgent(t,x.role,x.kind==='review'?x.excludeAgent:null);if(!a)continue;
        x.status='running';x.agentId=a.id;x.agentName=a.name;x.attempts=(x.attempts||0)+1;x.startedAt=now();x.lease={id:nanoid(10),until:new Date(Date.now()+LEASE_MS).toISOString()};
        if(x.kind!=='review')x.baseVersions=Object.fromEntries(Object.entries(t.files).map(([k,v])=>[k,v.version]));
        jobs.push([p.id,x.id,x.lease.id]);slots--;tlog(t,`${a.name} started "${x.title}"`);
      }
      if(!t.tasks.some(x=>['queued','running','review','needs_you'].includes(x.status))&&t.tasks.some(x=>x.status==='blocked'))t.autopilot.reason='Some work is blocked. See Blockers.';
    }
    return true;
  });
  for(const pid of planNeeded)void plan(pid);
  for(const [pid,tid,lease] of jobs){running.add(`${pid}:${tid}`);void work(pid,tid,lease);}
}
let timer=null;
export function startTeamWorker(ms=4000){if(timer)return;
  // On boot nothing can still be running in this process: hand every leased task back to the queue.
  void mutate(db=>{for(const p of Object.values(db.projects))for(const x of p.team?.tasks||[])if(x.status==='running'){ensureTeam(p);retryOrBlock(p.team,x,'The server restarted while this was running');}return true;});timer=setInterval(()=>{tick().catch(e=>console.error('[team]',e.message));},ms);timer.unref?.();}
