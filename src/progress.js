// Roadmap engine: evaluates every step's gate for a project and keeps completion stamps.
// A step completes when all its checks pass while it is unlocked; completion is then sticky,
// so a PC going offline later never relocks finished work.
import { STEPS, PHASES, stepPlan } from './roadmap.js';
import { ensureDesign, pipelineStatus, STAGES, stageItems } from './pipeline.js';
import { PLANS } from './billing.js';

const MIN_GPU_GB=8, MIN_RAM_GB=32;
const REQUIRED_PLUGINS=['PCG','MassCrowd','StateTree','PythonScriptPlugin'];
const CONTENT_FOLDERS=['Characters','Environments','Gameplay','Maps','Animation','Audio','UI'];
export const DEFAULT_REQUIREMENTS=[
  {key:'districts',label:'Districts',unit:''},{key:'interiors',label:'Enterable interiors',unit:''},{key:'npc_looks',label:'Distinct NPC looks',unit:''},
  {key:'species',label:'Species',unit:''},{key:'languages',label:'Languages',unit:''},{key:'activities',label:'Side activities',unit:''},
  {key:'fps',label:'Minimum frame rate on target PC',unit:'fps'}
];

export function ensureRoadmap(p){
  const r=p.roadmap ||= {};
  r.answers ||= {};r.ticks ||= {};r.proof ||= {};r.assets ||= [];r.completed ||= {};r.unlockedAt ||= {};
  r.requirements ||= DEFAULT_REQUIREMENTS.map(x=>({...x,id:x.key,target:null,current:0}));
  r.passes ||= [];
  p.course ||= {lessons:{},quizzes:{},certificates:{}};
  p.mode ||= 'build';
  return r;
}

const filled=(f,v)=>{
  if(f.type==='list'){const n=Array.isArray(v)?v.filter(x=>String(x||'').trim()).length:0;return {ok:n>=(f.min||1),detail:`${n} of ${f.min||1}`};}
  if(f.type==='number'){const ok=v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v));return {ok};}
  const s=String(v??'').trim();
  if(f.min&&s.length<f.min)return {ok:false,detail:`${s.length} of ${f.min} characters`};
  return {ok:s.length>0};
};
const gb=n=>Number(n)||0;
const fresh=(iso,min)=>iso&&Date.now()-Date.parse(iso)<min*60e3;

function stageDone(p,id){return pipelineStatus(p).stages.find(s=>s.id===id)?.done;}
function stageFieldsDone(p,id){const st=STAGES.find(s=>s.id===id);return stageItems(st,p).filter(i=>i.ref?.field).every(i=>i.done);}

// ctx: {agent, inspect}
const CHECKS={
  vision_core:p=>{const v=p.design.vision||{};const n=String(v.logline||'').trim().length;
    return {ok:!!String(v.title||'').trim()&&n>=60&&!!v.setting&&!!v.tone,detail:n<60?`Pitch is ${n} of 60 characters`:''};},
  art_direction:p=>({ok:String(p.design.vision?.art_direction||'').trim().length>=20}),
  vision_scope:p=>({ok:!!p.design.vision?.camera&&!!p.design.vision?.platform}),
  combat_rules:p=>({ok:Number(p.design.combat?.player_health)>0&&!!p.design.combat?.aim_style}),
  weapon1:p=>({ok:(p.design.weapons||[]).some(w=>w.name&&w.type&&w.look)}),
  asset_list:p=>{const a=p.roadmap.assets;const good=a.filter(x=>x.name&&x.action&&x.source&&x.license).length;return {ok:a.length>=10&&good===a.length,detail:`${good} complete of ${a.length} (need 10+)`};},
  agent_online:(p,c)=>({ok:fresh(c.agent?.seenAt,10),detail:c.agent?.seenAt?`Last seen ${new Date(c.agent.seenAt).toLocaleString()}`:'Double-click DukeForger.py on your PC'}),
  pc_gpu:(p,c)=>{const g=c.agent?.machine?.gpus||[];const best=g.reduce((m,x)=>Math.max(m,gb(x.vramGB)),0);
    return {ok:best>=MIN_GPU_GB,detail:g.length?`${g.map(x=>`${x.name} (${gb(x.vramGB)} GB)`).join(', ')}`:'Waiting for the agent to report'};},
  pc_ram:(p,c)=>{const r=gb(c.agent?.machine?.ramGB);return {ok:r>=MIN_RAM_GB,detail:r?`${r} GB${r<64?' (64 GB recommended)':''}`:'Waiting for the agent to report'};},
  ue_installed:(p,c)=>{const e=c.agent?.machine?.engines||[];return {ok:e.length>0,detail:e.length?`Unreal ${e.join(', ')}${e.some(v=>v>='5.8')?'':' (5.8 recommended)'}`:'Not found'};},
  vs_cpp:(p,c)=>({ok:!!c.agent?.machine?.visualStudio}),
  cc5_installed:(p,c)=>({ok:!!c.agent?.machine?.tools?.cc5,detail:c.agent?.machine?.tools?.cc5||''}),
  blender_installed:(p,c)=>({ok:!!c.agent?.machine?.tools?.blender,detail:c.agent?.machine?.tools?.blender||''}),
  git_lfs:(p,c)=>({ok:!!c.agent?.machine?.tools?.git&&!!c.agent?.machine?.tools?.lfs}),
  project_found:(p,c)=>({ok:!!c.inspect?.exists,detail:c.inspect?c.inspect.exists?c.inspect.name:`Not found at ${c.inspect.path}`:'Waiting for the agent'}),
  plugins:(p,c)=>{const on=new Set(c.inspect?.plugins||[]);const missing=REQUIRED_PLUGINS.filter(x=>!on.has(x));return {ok:!!c.inspect?.exists&&!missing.length,detail:missing.length?`Still off: ${missing.join(', ')}`:''};},
  folders:(p,c)=>{const have=new Set(c.inspect?.folders||[]);const missing=CONTENT_FOLDERS.filter(x=>!have.has(x));return {ok:!!c.inspect?.exists&&!missing.length,detail:missing.length?`Missing: ${missing.join(', ')}`:''};},
  git_repo:(p,c)=>({ok:!!c.inspect?.git&&!!c.inspect?.lfs,detail:!c.inspect?.git?'Not a Git repository yet':!c.inspect?.lfs?'Git LFS not set up':''}),
  synced:(p,c)=>({ok:!!c.inspect?.syncedAt,detail:c.inspect?.syncedAt?`Synced ${new Date(c.inspect.syncedAt).toLocaleString()}`:''}),
  build_since:(p,c,n)=>{const since=Date.parse(p.roadmap.unlockedAt[n]||0)||0;return {ok:(p.builds||[]).some(b=>b.status==='succeeded'&&Date.parse(b.createdAt)>=since)};},
  shipping_since:(p,c,n)=>{const since=Date.parse(p.roadmap.unlockedAt[n]||0)||0;return {ok:(p.builds||[]).some(b=>b.status==='succeeded'&&b.config==='Shipping'&&Date.parse(b.createdAt)>=since)};},
  protagonist:p=>({ok:(p.design.characters||[]).some(c=>c.role==='Protagonist'&&c.name)}),
  protagonist_rigged:p=>({ok:(p.design.characters||[]).some(c=>c.role==='Protagonist'&&c.art?.rig?.fbx)}),
  species_listed:p=>({ok:(p.roadmap.answers.species||[]).length>0}),
  world_fields:p=>({ok:stageFieldsDone(p,'world')}),
  districts3:p=>{const d=(p.design.districts||[]).filter(x=>x.name&&x.style&&x.mood);return {ok:d.length>=3,detail:`${d.length} of 3`};},
  landmarks2:p=>{const ids=new Set((p.design.districts||[]).map(x=>x.id));const l=(p.design.landmarks||[]).filter(x=>x.name&&x.description&&ids.has(x.district));return {ok:l.length>=2,detail:`${l.length} of 2`};},
  surfaces_licensed:p=>{const s=p.roadmap.assets.filter(a=>a.kind==='Surface or texture');return {ok:s.length>0&&s.every(a=>a.source&&a.license),detail:`${s.length} surface assets`};},
  music_licensed:p=>{const m=p.roadmap.assets.filter(a=>a.kind==='Music');return {ok:m.length>0&&m.every(a=>a.source&&a.license),detail:`${m.length} music tracks`};},
  music_style:p=>({ok:String(p.design.audio_ui?.music_style||'').trim().length>0}),
  menu_title:p=>({ok:String(p.design.audio_ui?.menu_title||'').trim().length>0}),
  requirements_set:p=>{const r=p.roadmap.requirements.filter(x=>Number(x.target)>0);return {ok:r.length>=5&&r.some(x=>x.key==='fps'),detail:`${r.length} with targets`};},
  requirements_met:p=>{const r=p.roadmap.requirements.filter(x=>Number(x.target)>0);const open=r.filter(x=>Number(x.current)<Number(x.target));
    return {ok:r.length>=5&&!open.length,detail:open.length?`Still short: ${open.map(x=>`${x.label} ${x.current||0}/${x.target}`).join(', ')}`:''};},
  story_done:p=>({ok:!!stageDone(p,'story')}),
  missions3:p=>({ok:!!stageDone(p,'missions')}),
  fps_target:p=>{const t=Number(p.roadmap.requirements.find(x=>x.key==='fps')?.target)||60;const m=Number(p.roadmap.answers.fps_measured);return {ok:m>=t,detail:`${m||0} of ${t} fps`};}
};
export const CHECK_IDS=Object.keys(CHECKS);

function evalCheck(p,ctx,step,c,i){
  if(c.t==='input'){const f=step.inputs.find(x=>x.key===c.key);const r=filled(f,p.roadmap.answers[c.key]);return {kind:'input',label:f.label,ok:r.ok,detail:r.detail||'',key:c.key};}
  if(c.t==='auto'){const fn=CHECKS[c.id];const r=fn?fn(p,ctx,step.n):{ok:false,detail:'Unknown check'};return {kind:'auto',label:c.label,ok:!!r.ok,detail:r.detail||'',id:c.id};}
  if(c.t==='proof'){const n=(p.roadmap.proof[c.key]||[]).length;return {kind:'proof',label:c.label,ok:n>=c.min,detail:`${n} of ${c.min} uploaded`,key:c.key,min:c.min};}
  const k=`${step.n}:${i}`;return {kind:'self',label:c.label,ok:!!p.roadmap.ticks[k],key:k};
}

const PLAN_RANK={free:0,creator:1,academy:2,studio:3};
// plan: the owner's effective plan id. ctx: {agent, inspect}
export function evaluate(p,plan='free',ctx={}){
  ensureDesign(p);ensureRoadmap(p);
  const steps=[];let open=true;
  for(const s of STEPS){
    const checks=s.checks.map((c,i)=>evalCheck(p,ctx,s,c,i));
    const lessonDone=p.mode!=='course'||!!(p.course.lessons[s.n]?.learn&&p.course.lessons[s.n]?.watch);
    const passing=checks.every(c=>c.ok)&&lessonDone;
    const done=!!p.roadmap.completed[s.n];
    const need=stepPlan(s);const allowed=PLAN_RANK[plan]>=PLAN_RANK[need];
    const status=done?'done':!open?'locked':!allowed?'upgrade':'open';
    steps.push({n:s.n,phase:s.phase,status,passing,lessonDone,checks,needPlan:need,completedAt:p.roadmap.completed[s.n]||null,
      progress:checks.length?Math.round(checks.filter(c=>c.ok).length/checks.length*100):100});
    if(!done)open=false;
  }
  const current=steps.find(s=>s.status!=='done')||steps.at(-1);
  const phases=PHASES.map(ph=>{const st=steps.filter(s=>s.phase===ph.n);return {n:ph.n,title:ph.title,done:st.filter(s=>s.status==='done').length,total:st.length};});
  const doneCount=steps.filter(s=>s.status==='done').length;
  return {steps,current:current.n,overall:Math.round(doneCount/steps.length*100),doneCount,phases,plan,planName:PLANS[plan]?.name};
}

// Stamps unlock times and completions. Call inside mutate() after any change. Returns newly completed step numbers.
export function advance(p,plan,ctx){
  const out=[];
  for(let guard=0;guard<STEPS.length;guard++){
    const ev=evaluate(p,plan,ctx);
    const cur=ev.steps.find(s=>s.status==='open');
    for(const s of ev.steps)if((s.status==='open'||s.status==='upgrade')&&!p.roadmap.unlockedAt[s.n])p.roadmap.unlockedAt[s.n]=new Date().toISOString();
    if(!cur||!cur.passing)break;
    p.roadmap.completed[cur.n]=new Date().toISOString();out.push(cur.n);
  }
  return out;
}

export function coachLine(p,ev){
  const s=ev.steps.find(x=>x.n===ev.current);const step=STEPS[s.n-1];
  if(ev.doneCount===STEPS.length)return 'All 67 steps are complete. Your game is shipped. Keep patching and keep backing up.';
  if(s.status==='upgrade')return `Step ${s.n}, ${step.title}, is part of the ${PLANS[s.needPlan].name} plan. Upgrade to keep building.`;
  if(p.mode==='course'&&!s.lessonDone)return `Step ${s.n}: start with the Learn and Watch tabs, then do it on your game.`;
  const next=s.checks.find(c=>!c.ok);
  return next?`Step ${s.n}, ${step.title}. Next: ${next.label}${next.detail?` (${next.detail})`:''}.`:`Step ${s.n} passes. It completes automatically.`;
}
