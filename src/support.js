// Customer support: FAQ knowledge, an AI support chat that can safely fix common account problems itself
// (stuck jobs, failed builds, plan sync, paused Autopilot, blocked AI Team tasks, re-checking steps), and
// support tickets for everything else, delivered to the owner's inbox page (and email/webhook if configured).
import { load, mutate } from './store.js';
import { HttpError, id as nanoid } from './http.js';
import { userFromRequest, requireUser, isAdminEmail } from './auth.js';
import { planOf, PLANS, billingStatus, refreshSubscription } from './billing.js';
import { llmJson, brainName } from './brain.js';
import { settle, agentFor } from './ctx.js';
import { evaluate } from './progress.js';
import { STEPS } from './roadmap.js';

const now=()=>new Date().toISOString();
export const ERRORS=[]; // recent server errors, for diagnostics in tickets and the owner's inbox
export function recordError(where,err){ERRORS.push({at:now(),where:String(where).slice(0,200),message:String(err?.message||err).slice(0,500)});if(ERRORS.length>200)ERRORS.shift();}

export const FAQ=[
 ['Getting started','Do I need to know how to code?','No. Duke Forger explains every step in plain words, and Duke writes and explains any code a step needs. Unreal\'s Blueprints let you build logic visually.'],
 ['Getting started','Do I need a degree or experience?','No. The 67 steps start from one paragraph about your idea and teach you as you build. Course mode turns each step into a lesson on your own game.'],
 ['Getting started','What computer do I need?','A Windows PC with a dedicated graphics card with 8 GB or more of video memory and 32 GB of memory (64 GB recommended). Step 9 checks your PC for you.'],
 ['Getting started','What does it cost besides Duke Forger?','Unreal Engine and Blender are free. Character Creator 5 Deluxe and Headshot 3 cost about $700 once at the time of writing. AI Team agents use your own AI accounts, billed by those providers.'],
 ['Plans and billing','How does the free trial work?','Your first paid plan starts with 7 days free. Cancel before it ends and you pay nothing.'],
 ['Plans and billing','How do I cancel or change my plan?','In the studio, click your plan badge at the bottom left, then Manage billing. Changes and cancellations take effect right away in Stripe\'s secure page.'],
 ['Plans and billing','What are 3D credits?','Credits pay for 3D generation (concept art, models, rigging, animation), which has a real cost per use. They reset monthly, and failed generations are refunded automatically.'],
 ['Plans and billing','I paid but my plan did not change','Open Help and say so: the support assistant re-checks your subscription with Stripe and fixes it on the spot.'],
 ['AI Team','What is the AI Team?','Optional agents from AI accounts you connect (Claude, OpenAI, Grok or a Llama endpoint). You give each a studio role and turn on Autopilot; they keep advancing your game and bring you only real decisions.'],
 ['AI Team','Does my ChatGPT or Claude subscription work?','No. Chat subscriptions do not include API access. You need an API key from the provider\'s developer console, billed per use by that provider.'],
 ['AI Team','Can agents spend too much?','You set a daily limit, a project limit and a limit per agent. Autopilot pauses and tells you when a limit is reached.'],
 ['AI Team','Does Autopilot keep running when I close the page?','Yes. It runs on our servers. Work inside Unreal also needs your PC on with the Duke agent running.'],
 ['Your PC and Duke Link','What is Duke Link?','Duke Link shows your Unreal, Character Creator and Blender windows live inside Duke Forger and lets you use them from the page. Install the tools once and you never have to leave the site.'],
 ['Your PC and Duke Link','My PC shows as not connected','Make sure the PC is on and the Duke agent is running (DukeSetup.cmd installs it and starts it at sign-in). Run DukeSetup.cmd again to repair it.'],
 ['Your PC and Duke Link','My build failed','Open the Build panel and read the last lines of the log. The support assistant can also queue a fresh build for you.'],
 ['Course mode','How do certificates work?','In Course mode, finish every step in a phase and pass its quiz. Your certificate gets a public page you can share.'],
 ['Account and privacy','Who can see my uploads?','Only you. Proof screenshots and photos are private to your account. Only a screenshot you choose for the public showcase is ever shown to others.'],
 ['Account and privacy','Do I own my game?','Yes. Your game, characters and code are yours. Unreal Engine charges a 5% royalty only after a game earns $1 million.']
];

const SAFE_ACTIONS={
  unstick_jobs:'Clear 3D jobs stuck for more than 45 minutes (credits refunded)',
  retry_build:'Queue a fresh build after a failed one',
  cancel_stuck_build:'Cancel builds stuck for more than 3 hours',
  resync_plan:'Re-check the subscription with Stripe and fix the plan',
  resume_autopilot:'Resume an AI Team Autopilot paused by a provider error',
  requeue_blocked:'Give blocked AI Team tasks a fresh set of attempts',
  recheck_steps:'Re-check every step gate on every game'
};

function accountContext(db,u){
  if(!u)return {loggedIn:false};
  const projects=Object.values(db.projects).filter(p=>p.ownerId===u.id).map(p=>{settle(db,p);const ev=evaluate(p,planOf(u),{});const s=STEPS[ev.current-1];
    const builds=(p.builds||[]).slice(0,2).map(b=>({status:b.status,phase:b.phase,age:Math.round((Date.now()-Date.parse(b.createdAt))/60e3)+'m'}));
    const stuck=Object.values(db.jobs||{}).filter(j=>j.projectId===p.id&&j.status==='running'&&Date.now()-Date.parse(j.createdAt)>45*60e3).length;
    const ap=p.team?.autopilot;
    return {title:p.design?.vision?.title||p.name,step:`${ev.current}: ${s.title}`,failing:ev.steps[ev.current-1].checks.filter(c=>!c.ok).map(c=>c.label).slice(0,4),builds,stuckJobs:stuck,
      autopilot:ap?{state:ap.state,reason:ap.reason}:null,blockedTasks:(p.team?.tasks||[]).filter(t=>t.status==='blocked').length};});
  const a=agentFor(db,u.id);
  return {loggedIn:true,email:u.email,billing:billingStatus(u),pc:a?{lastSeen:a.seenAt,host:a.machine?.host}:null,projects};
}

async function runAction(name,u){
  if(name==='resync_plan'){const r=await refreshSubscription(u.id);return r;}
  return mutate(db=>{
    const mine=Object.values(db.projects).filter(p=>p.ownerId===u.id);let n=0;
    if(name==='unstick_jobs')for(const j of Object.values(db.jobs||{}))if(mine.some(p=>p.id===j.projectId)&&j.status==='running'&&Date.now()-Date.parse(j.createdAt)>45*60e3){
      j.status='failed';j.error='Stopped by support: it was stuck';const usr=db.users[j.chargedTo];if(usr&&j.credits&&!j.refunded){if(usr.credits?.period===j.creditPeriod)usr.credits.used=Math.max(0,usr.credits.used-j.credits);j.refunded=true;}
      const p=db.projects[j.projectId];const e=p?.design?.[j.collection]?.find(x=>x.id===j.entityId);if(e?.art?.busy)delete e.art.busy;n++;}
    if(name==='retry_build')for(const p of mine){const last=(p.builds||[])[0];if(last&&last.status==='failed'){p.builds.unshift({id:nanoid(10),status:'queued',phase:'Queued again by support',progress:0,logs:['Build re-queued by the support assistant'],config:last.config,source:last.source,cloud:last.cloud,localProject:last.localProject,createdAt:now()});n++;}}
    if(name==='cancel_stuck_build')for(const p of mine)for(const b of p.builds||[])if(['queued','running'].includes(b.status)&&Date.now()-Date.parse(b.createdAt)>3*3600e3){b.status='canceled';b.phase='Canceled by support (stuck)';n++;}
    if(name==='resume_autopilot')for(const p of mine){const ap=p.team?.autopilot;if(ap?.state==='paused'&&/provider|failing|unreadable/i.test(ap.reason||'')){ap.state='running';ap.reason='';ap.planErrors=0;n++;}}
    if(name==='requeue_blocked')for(const p of mine)for(const t of p.team?.tasks||[])if(t.status==='blocked'){t.status='queued';t.attempts=0;t.blocker=null;n++;}
    if(name==='recheck_steps')for(const p of mine){n+=settle(db,p).length;}
    return {ok:true,changed:n};
  });
}

async function notifyOwner(t){
  const to=process.env.SUPPORT_EMAIL||(process.env.ADMIN_EMAILS||'').split(',')[0]?.trim();
  const text=`New Duke Forger support ticket #${t.id} (${t.severity})\nFrom: ${t.email||'visitor'}\nSubject: ${t.subject}\n\n${t.summary}\n\nAuto-fixes tried: ${t.actions.map(a=>a.name).join(', ')||'none'}\n\nOpen your inbox: ${process.env.SITE_URL||''}/admin`;
  try{
    if(process.env.RESEND_API_KEY&&to)await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({from:process.env.SUPPORT_FROM||'Duke Forger Support <support@dukeforger.com>',to:[to],reply_to:t.email||undefined,subject:`[Ticket ${t.id}] ${t.subject}`,text})});
    if(process.env.SUPPORT_WEBHOOK_URL)await fetch(process.env.SUPPORT_WEBHOOK_URL,{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({text,content:text})});
  }catch(e){recordError('support notify',e);}
}

const hits=new Map();
function rate(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();const t=Date.now();const a=(hits.get(ip)||[]).filter(x=>t-x<3600e3);if(a.length>=40)throw new HttpError(429,'Too many messages. Try again in a little while.');a.push(t);hits.set(ip,a);}

function localReply(text,ctx){
  const q=text.toLowerCase();
  const hit=FAQ.map(([cat,question,answer])=>({question,answer,score:question.toLowerCase().split(/\W+/).filter(w=>w.length>3&&q.includes(w)).length})).sort((a,b)=>b.score-a.score)[0];
  const actions=[];
  if(/stuck|frozen|spinning|never finish/.test(q))actions.push('unstick_jobs','cancel_stuck_build');
  if(/build/.test(q)&&/fail|error|broke/.test(q))actions.push('retry_build');
  if(/paid|charged|plan|subscription|upgrade/.test(q)&&/not|didn|wrong|still/.test(q))actions.push('resync_plan');
  if(/autopilot|agent|team/.test(q)&&/stop|pause|block|stuck/.test(q))actions.push('resume_autopilot','requeue_blocked');
  if(/step|gate|check/.test(q)&&/not|won|stuck/.test(q))actions.push('recheck_steps');
  const ticket=!actions.length&&(!hit||hit.score<2)||/bug|broken|doesn.?t work|not working|error|refund|delete my|complain/.test(q);
  return {reply:hit&&hit.score>=2?hit.answer:actions.length?'Let me fix that for you now.':'Thanks for telling me. I\'ve passed this to the Duke Forger team, and they\'ll get back to you.',
    actions,ticket:ticket?{create:true,subject:text.slice(0,80),summary:text,severity:/payment|charged|refund|lost|deleted/.test(q)?'high':'normal'}:null};
}

export function registerSupport(r){
  r.get('/api/support/faq',()=>({faq:FAQ.map(([category,q,a])=>({category,q,a}))}));
  r.post('/api/support/chat',async({req,body})=>{
    rate(req);
    const db=await load();const u=await userFromRequest(req,db);
    const msgs=(Array.isArray(body.messages)?body.messages:[]).slice(-12).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,2000)}));
    const last=msgs.filter(m=>m.role==='user').at(-1)?.content||'';if(!last.trim())throw new HttpError(400,'Write your question');
    const ctx=accountContext(db,u);
    const live=await llmJson(`You are Duke Forger's friendly support assistant. Duke Forger is a paid web platform that guides beginners through 67 steps to make a high-end Unreal Engine 5 game, with Build mode, Course mode, Duke Link (desktop tools live in the browser), an optional AI Team with Autopilot, and plans Free, Creator $39, Academy $69, Studio $149 a month.
Answer in plain, simple words, 1-4 short sentences. Never invent features or promises. Never ask for passwords or card numbers.
You may run these safe fixes on the customer's own account when they clearly apply: ${Object.entries(SAFE_ACTIONS).map(([k,v])=>`${k} (${v})`).join('; ')}.
Create a ticket for the owner when you cannot fully solve it: bugs, refunds, data loss, account deletion, legal, anything unclear or anything a fix did not solve.
FAQ:\n${FAQ.map(([c,q,a])=>`- ${q} ${a}`).join('\n')}`,
      `ACCOUNT (only this customer's data): ${JSON.stringify(ctx).slice(0,6000)}\n\nCONVERSATION:\n${msgs.map(m=>`${m.role}: ${m.content}`).join('\n')}\n\nReturn JSON: {"reply":"...","actions":["action names to run now"],"ticket":null or {"create":true,"subject":"...","summary":"what is wrong, what you tried","severity":"low|normal|high"}}`,{maxTokens:900});
    const out=live&&typeof live.reply==='string'?live:localReply(last,ctx);
    const actions=[];
    if(u)for(const a of [...new Set(out.actions||[])].filter(a=>SAFE_ACTIONS[a]).slice(0,4)){try{actions.push({name:a,label:SAFE_ACTIONS[a],result:await runAction(a,u)});}catch(e){actions.push({name:a,label:SAFE_ACTIONS[a],error:e.message});recordError('support action '+a,e);}}
    let ticket=null;
    if(out.ticket?.create){
      const email=u?.email||String(body.email||'').slice(0,120);
      ticket={id:nanoid(6).toUpperCase(),userId:u?.id||null,email,subject:String(out.ticket.subject||last).slice(0,120),summary:String(out.ticket.summary||last).slice(0,3000),
        severity:['low','normal','high'].includes(out.ticket.severity)?out.ticket.severity:'normal',transcript:msgs,context:ctx,errors:ERRORS.slice(-10),actions,status:'open',at:now(),replies:[]};
      await mutate(db=>{db.tickets ||= {};db.tickets[ticket.id]=ticket;return true;});void notifyOwner(ticket);
    }
    const fixed=actions.filter(a=>a.result?.changed>0||a.result?.updated);
    return {reply:out.reply+(fixed.length?`\n\nDone: ${fixed.map(a=>a.label.toLowerCase()).join('; ')}.`:''),actions,ticket:ticket?{id:ticket.id}:null,needEmail:!!ticket&&!ticket.email,source:live?brainName():'Duke help'};
  });
  r.get('/api/support/tickets',async({req})=>{const u=await requireUser(req);const db=await load();
    return {tickets:Object.values(db.tickets||{}).filter(t=>t.userId===u.id).map(({context,errors,transcript,...t})=>t).sort((a,b)=>b.at.localeCompare(a.at))};});
  // ---- owner inbox ----
  const admin=async req=>{const u=await requireUser(req);if(!isAdminEmail(u.email))throw new HttpError(403,'Owners only');return u;};
  r.get('/api/admin/overview',async({req})=>{await admin(req);const db=await load();
    const users=Object.values(db.users||{});const paying=users.filter(u=>['active','trialing','past_due'].includes(u.sub?.status)&&!u.sub?.test&&!isAdminEmail(u.email));
    const mrr=paying.filter(u=>u.sub.status==='active').reduce((s,u)=>s+(u.sub.interval==='year'?PLANS[u.sub.plan].month*10/12:PLANS[u.sub.plan].month),0);
    return {users:users.length,trialing:paying.filter(u=>u.sub.status==='trialing').length,paying:paying.filter(u=>u.sub.status==='active').length,mrr:Math.round(mrr),
      projects:Object.keys(db.projects).length,tickets:Object.values(db.tickets||{}).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,200),errors:ERRORS.slice(-30).reverse()};});
  r.post('/api/admin/tickets/:id',async({req,params,body})=>{const u=await admin(req);
    return mutate(db=>{const t=db.tickets?.[params.id];if(!t)throw new HttpError(404,'ticket not found');
      if(body.reply){t.replies.push({at:now(),by:u.email,text:String(body.reply).slice(0,4000)});}
      if(['open','closed','auto-fixed'].includes(body.status))t.status=body.status;return {ticket:t};});});
}
