// Duke Forger studio: 67 gated steps from idea to released Unreal Engine 5 game, in Build mode or Course mode.
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const S={schema:null,road:null,me:null,projects:[],project:null,rm:null,step:1,tab:'learn',open:new Set(),jobs:{},busy:{},answer:{},quiz:{},video:{},interval:'month'};
let toastT;
function toast(m,err){const t=$('#toast');t.textContent=m;t.classList.toggle('err',!!err);t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),err?6000:3000);}
class ApiError extends Error{constructor(m,status){super(m);this.status=status;}}
async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt,headers:opt.body&&!(opt.body instanceof FormData)?{'content-type':'application/json',...(opt.headers||{})}:opt.headers});
  const isJson=(r.headers.get('content-type')||'').includes('json');const data=isJson?await r.json():await r.text();
  if(r.status===401&&!url.startsWith('/api/auth/')){location.href='/login?next=/studio';throw new ApiError('Log in to continue',401);}
  if(!r.ok)throw new ApiError((isJson&&data.error)||`Request failed (${r.status})`,r.status);return data;
}
const post=(u,b)=>api(u,{method:'POST',body:JSON.stringify(b||{})});
const patch=(u,b)=>api(u,{method:'PATCH',body:JSON.stringify(b||{})});
const del=u=>api(u,{method:'DELETE'});
window.addEventListener('unhandledrejection',e=>{const err=e.reason;if(err?.status===401)return;toast(err?.message||'Something went wrong',true);if(err?.status===402)setTimeout(()=>plansModal(),600);});

const P=()=>S.project,D=()=>S.project.design,pid=()=>S.project.id,R=()=>S.project.roadmap;
const stepDef=n=>S.road.steps[n-1],stepEv=n=>S.rm.steps[n-1];
const stageDef=id=>S.schema.stages.find(s=>s.id===id);
const plan=()=>S.me.billing.plan,feat=f=>!!S.me.billing.features?.[f];
const KIND={auto:['Verified by Duke','auto'],proof:['Proof','proof'],input:['You write it','input'],self:['You confirm it','self']};

// ---------------------------------------------------------------- glossary links + popover
let TERMS=[];
const NOLINK=new Set(['budget','camera','mix','level','mission','variation','species','district','landmark','requirements','subtitles','crowd','asset']);
function buildTerms(){const er=w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  TERMS=Object.entries(S.road.glossary).filter(([k])=>!NOLINK.has(k)).flatMap(([slug,g])=>[g.term,...g.aka].map(w=>({slug,re:new RegExp(`(^|[^\\w-])(${er(esc(w))})(?![\\w-])`,'i')}))).sort((a,b)=>b.re.source.length-a.re.source.length);}
function terms(text,seen=new Set(),max=6){
  let html=esc(text),n=0;
  for(const {slug,re} of TERMS){if(n>=max||seen.has(slug))continue;
    const parts=html.split(/(<button class="term"[^>]*>.*?<\/button>)/);let hit=false;
    for(let i=0;i<parts.length&&!hit;i++){if(parts[i].startsWith('<button'))continue;if(re.test(parts[i])){parts[i]=parts[i].replace(re,(m,a,b)=>`${a}<button class="term" data-term="${slug}">${b}</button>`);hit=true;}}
    if(hit){html=parts.join('');seen.add(slug);n++;}}
  return html;
}
document.addEventListener('click',e=>{
  const t=e.target.closest('.term');const pop=$('#termPop');
  if(!t){if(!e.target.closest('#termPop'))pop.classList.remove('show');return;}
  e.preventDefault();const g=S.road.glossary[t.dataset.term];if(!g)return;
  pop.innerHTML=`<b>${esc(g.term)}</b><p>${esc(g.def)}</p><a href="/glossary/${t.dataset.term}" target="_blank" rel="noopener">Open in the glossary ↗</a>`;
  const r=t.getBoundingClientRect();pop.classList.add('show');
  const w=Math.min(320,innerWidth-24);pop.style.width=w+'px';pop.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left))+'px';
  const below=r.bottom+8+pop.offsetHeight<innerHeight;pop.style.top=(below?r.bottom+8:r.top-pop.offsetHeight-8)+'px';
});

// ---------------------------------------------------------------- boot
async function boot(){
  const [me,schema,road]=await Promise.all([api('/api/me'),api('/api/pipeline'),api('/api/roadmap')]);
  S.me=me;S.schema=schema;S.road=road;buildTerms();
  $('#providerLine').innerHTML=`AI director: <b>${esc(road.brain||'Duke templates')}</b> · 3D: <b>${road.meshy?'Meshy':'not connected'}</b>`;
  S.projects=await api('/api/projects');
  if(!S.projects.length){const p=await post('/api/projects',{name:'My First Game'});S.projects=[{id:p.id,title:p.design?.vision?.title||p.name}];}
  let last;try{last=localStorage.getItem('dukeProject')}catch{}
  await openProject((S.projects.find(p=>p.id===last)||S.projects.at(-1)).id);
  try{if(localStorage.getItem('dukeNoSide')==='1')toggleSide(false)}catch{}
  if(innerWidth<900)toggleSide(false,true);
  const q=new URLSearchParams(location.search);
  if(q.get('upgrade'))plansModal(q.get('upgrade'));
  if(q.get('welcome')){toast(`Welcome to ${q.get('welcome')[0].toUpperCase()+q.get('welcome').slice(1)}. Your plan is active.`);refreshMe();}
  if(q.size)history.replaceState(null,'','/studio');
  setInterval(poll,5000);
  linkStatus().then(()=>{if(S.view!=='link'&&S.view!=='team')renderStep();});
  loadTeam().catch(()=>{});
}
async function refreshMe(){S.me=await api('/api/me');renderRail();}
async function openProject(id){
  const v=await api(`/api/projects/${id}/roadmap`);apply(v,true);
  try{localStorage.setItem('dukeProject',id)}catch{}
  S.step=S.rm.current;S.tab=firstCourseTab(S.step);S.answer={};S.open.clear();
  renderProjects();render();loadPreview(true);
}
function apply(v,quiet){
  if(v.project)S.project=v.project;if(v.roadmap)S.rm=v.roadmap;
  if(!quiet&&v.completed?.length){const n=v.completed.at(-1);toast(v.completed.length>1?`Steps ${v.completed.join(', ')} complete`:`Step ${n} complete: ${stepDef(n).title}`);}
  const i=S.projects.findIndex(p=>p.id===S.project.id);if(i>=0)S.projects[i].title=D().vision?.title||P().name;
}
async function refreshRm(quietToast){const v=await api(`/api/projects/${pid()}/roadmap`);const before=S.rm?.doneCount;apply(v,true);
  if(!quietToast&&before!=null&&S.rm.doneCount>before)toast(`Step ${S.rm.current-1} complete. Step ${S.rm.current} is open.`);}
function renderProjects(){$('#projectSelect').innerHTML=S.projects.map(p=>`<option value="${p.id}" ${p.id===pid()?'selected':''}>${esc(p.title||p.name)}</option>`).join('');}
$('#projectSelect').onchange=e=>openProject(e.target.value);
$('#newProject').onclick=()=>modal(`<span class="eyebrow">NEW GAME</span><h2 style="margin:6px 0 14px">What's your game called?</h2>
  <div class="field"><input id="npName" placeholder="Working title (you can change it later)"/></div>
  <div class="row gap10" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn gold" id="npGo">Start at step 1</button></div>`,()=>{
  $('#npName').focus();$('#npGo').onclick=async()=>{const p=await post('/api/projects',{name:$('#npName').value.trim()||'Untitled Game'});S.projects.push({id:p.id,title:p.name});closeModal();await openProject(p.id);toast('New game created. Start with step 1.');};});
$$('.modeSwitch button').forEach(b=>b.onclick=async()=>{
  if(b.dataset.mode==='course'&&!feat('course')){plansModal('academy');return;}
  apply(await post(`/api/projects/${pid()}/mode`,{mode:b.dataset.mode}));S.tab=firstCourseTab(S.step);render();
  toast(P().mode==='course'?'Course mode: each step is a lesson on your own game.':'Build mode: straight to the work, with the same gates.');});
function firstCourseTab(n){const l=P()?.course?.lessons?.[n]||{};return !l.learn?'learn':!l.watch?'watch':'do';}

// ---------------------------------------------------------------- rail
function renderRail(){
  const rm=S.rm,b=S.me.billing;
  $('#overallBar').style.width=rm.overall+'%';$('#overallPct').textContent=`${rm.doneCount}/67`;
  $$('.modeSwitch button').forEach(x=>x.classList.toggle('on',x.dataset.mode===(P().mode||'build')));
  const cur=stepDef(S.step).phase;
  $('#stepNav').innerHTML=S.road.phases.map(ph=>{const st=rm.steps.filter(s=>s.phase===ph.n);const done=st.filter(s=>s.status==='done').length;
    const open=ph.n===cur||st.some(s=>s.n===rm.current);
    return `<details class="phaseGroup" ${open?'open':''}><summary><span class="pn ${done===st.length?'done':''}">${done===st.length?'✓':ph.n}</span><span class="pt"><b>${esc(ph.title)}</b><small>${done}/${st.length} steps</small></span></summary>
      ${st.map(s=>{const d=stepDef(s.n);const icon=s.status==='done'?'✓':s.status==='locked'?'·':s.status==='upgrade'?'★':s.n;
        return `<button class="stepBtn ${s.status} ${s.n===rm.current?'current':''} ${s.n===S.step?'active':''}" data-step="${s.n}" title="${esc(d.title)}"><span class="dot">${icon}</span><span class="lbl">${s.n}. ${esc(d.title)}</span></button>`;}).join('')}</details>`;}).join('');
  $$('[data-step]').forEach(x=>x.onclick=()=>goStep(Number(x.dataset.step)));
  const c=b.credits;
  $('#planBadge').innerHTML=`<span class="pl ${b.plan}">${esc(b.planName)}${b.sub?.status==='trialing'?' · trial':''}</span><span class="muted small">${c?.total?`${c.left} credits left`:b.plan==='free'?'Upgrade to build':''}</span><span class="acct">${esc(S.me.user.name||S.me.user.email)} ▾</span>`;
  $('#mobileTitle').textContent=`Step ${S.step} of 67`;
}
$('#planBadge').onclick=()=>accountModal();
function goStep(n){S.view='step';S.step=n;S.tab=firstCourseTab(n);S.answer={};render();$('#main').scrollTop=0;document.body.classList.remove('railOpen');}

// ---------------------------------------------------------------- step page
function render(){$('#app').classList.toggle('linkMode',S.view==='link'||S.view==='team');document.body.classList.toggle('linkModeBody',S.view==='link');renderRail();$('#linkBtn').classList.toggle('active',S.view==='link');$('#teamBtn').classList.toggle('active',S.view==='team');if(S.view==='team'){stopStream();renderTeam();}else if(S.view==='link'){renderLink();}else{stopStream();renderStep();}$('#previewTitle').textContent=D().world?.city_name||D().vision?.title||'Your world';}
function renderStep(){
  const n=S.step,s=stepDef(n),ev=stepEv(n),el=$('#stage');const keep=$('#main').scrollTop;
  const course=P().mode==='course';const ph=S.road.phases[s.phase-1];
  const banner=ev.status==='locked'?`<div class="banner"><b>Locked.</b> Finish step ${S.rm.current} (${esc(stepDef(S.rm.current).title)}) first. Duke keeps the order so nothing breaks later. <button class="btn sm" data-go="${S.rm.current}">Go to step ${S.rm.current}</button></div>`
    :ev.status==='upgrade'?`<div class="banner gold"><b>Step ${n} is part of the ${esc(planName(ev.needPlan))} plan.</b> You have finished planning your game. Upgrade to build it. <button class="btn gold sm" data-plans="${ev.needPlan}">See plans</button></div>`:'';
  const workable=ev.status==='open'||ev.status==='done';
  const head=`<div class="stepHead"><div><span class="eyebrow">PHASE ${s.phase} · ${esc(ph.title.toUpperCase())} · STEP ${n} OF 67</span><h1>${esc(s.title)}</h1>
      <div class="row gap6 wrap"><span class="role">You are the ${esc(s.role.toLowerCase())}</span>${ev.status==='done'?'<span class="pill ok">COMPLETE</span>':ev.status==='open'?`<span class="pill run">${ev.progress}% of the gate</span>`:''}</div></div>
      <div class="row gap6">${n>1?`<button class="btn sm ghost" data-go="${n-1}">← ${n-1}</button>`:''}${n<67?`<button class="btn sm ghost" data-go="${n+1}">${n+1} →</button>`:''}</div></div>`;
  const coach=`<div class="director"><div class="face">D</div><div class="msg"><b>DUKE · YOUR DIRECTOR</b><span>${esc(n===S.rm.current?S.rm.coach:ev.status==='done'?`Step ${n} is complete. Refine it anytime, or continue with step ${S.rm.current}.`:ev.status==='locked'?`This step opens after step ${n-1}.`:S.rm.coach)}</span></div>
      <div class="row gap6">${workable&&hasDraft(s)?`<button class="btn gold sm" id="draftBtn">${S.busy.draft?'Drafting…':'Draft with Duke'}</button>`:''}${ev.status==='done'&&n!==S.rm.current&&S.rm.current<=67?`<button class="btn sm" data-go="${S.rm.current}">Step ${S.rm.current} →</button>`:''}</div></div>`;
  let body;
  if(course){
    const l=P().course.lessons[n]||{};
    const tabs=[['learn','1 · Learn',l.learn],['watch','2 · Watch',l.watch],['do','3 · Do',ev.status==='done'||ev.passing],['check','4 · Check',ev.status==='done']];
    body=`<div class="tabs">${tabs.map(([k,label,ok])=>`<button class="${S.tab===k?'on':''}" data-tab="${k}">${label}${ok?' ✓':''}</button>`).join('')}</div>`+
      (S.tab==='learn'?learnHtml(s,ev,l):S.tab==='watch'?watchHtml(s,ev,l):S.tab==='do'?`<div class="grid2"><div>${aiHtml(s,ev)}${workable?workspace(s):needsHtml(s)}</div><div class="sticky">${gateHtml(s,ev)}</div></div>`:checkHtml(s,ev));
  }else{
    body=`<div class="grid2"><div>${whyHtml(s)}${aiHtml(s,ev)}${workable?workspace(s):''}</div><div class="sticky">${gateHtml(s,ev)}</div></div>`;
  }
  el.innerHTML=head+banner+coach+body;
  bindStep(s,ev);
  $('#main').scrollTop=keep;
}
const planName=id=>S.road.plans.find(p=>p.id===id)?.name||id;
const hasDraft=s=>s.inputs.some(f=>f.key!=='project_path')||s.panels.some(p=>p.p==='stage');
function whyHtml(s){const seen=new Set();
  return `<div class="card"><h3>What and why</h3><p class="lead">${terms(s.plain,seen)}</p><h3 style="margin-top:14px">How to do it</h3><ol class="how">${s.how.map(h=>`<li>${terms(h,seen,3)}</li>`).join('')}</ol></div>`;}
function aiHtml(s,ev){
  const a=S.answer[s.n];
  return `<div class="card ai"><div class="sectionTitle"><h3>How AI helps here</h3></div><p>${terms(s.ai)}</p>
    <div class="askRow"><input id="askInput" placeholder="Ask Duke about this step… (e.g. “what does this mean for my game?”)"/><button class="btn sm" id="askBtn">${S.busy.ask?'Thinking…':'Ask'}</button></div>
    ${a?`<div class="answer">${esc(a)}</div>`:''}</div>`;}
function needsHtml(s){return `<div class="card"><h3>What this step will need</h3><ul class="plain">${s.checks.map(c=>`<li>${esc(checkLabel(s,c))}</li>`).join('')}</ul></div>`;}
const checkLabel=(s,c)=>c.t==='input'?(s.inputs.find(f=>f.key===c.key)?.label||c.key):c.label;
function learnHtml(s,ev,l){
  const seen=new Set();const tl=s.terms.filter(t=>S.road.glossary[t]);
  return `<div class="lesson"><div class="card"><span class="eyebrow">LEARN</span><p class="lead">${terms(s.plain,seen)}</p><h3>The steps, in order</h3><ol class="how">${s.how.map(h=>`<li>${terms(h,seen,3)}</li>`).join('')}</ol>
    ${tl.length?`<h3 style="margin-top:16px">Words to know</h3><dl class="defs">${tl.map(t=>`<dt>${esc(S.road.glossary[t].term)}</dt><dd>${esc(S.road.glossary[t].def)}</dd>`).join('')}</dl>`:''}
    <div class="row gap10" style="margin-top:16px">${l.learn?'<span class="pill ok">LEARNED</span>':''}<button class="btn gold" data-lesson="learn">${l.learn?'Next: Watch →':'I understand this. Next: Watch →'}</button></div></div></div>`;}
function watchHtml(s,ev,l){
  const v=S.video[s.n];
  const player=v===undefined?'<div class="videoBox muted">Loading…</div>':v?(/youtube\.com|youtu\.be/.test(v)?`<iframe class="videoBox" src="${esc(v.replace('watch?v=','embed/').replace('youtu.be/','www.youtube.com/embed/'))}" allowfullscreen title="Lesson video"></iframe>`:`<video class="videoBox" src="${esc(v)}" controls preload="metadata"></video>`):'';
  return `<div class="lesson"><div class="card"><span class="eyebrow">WATCH</span>${player}
    <h3>${v?'':'Walkthrough: '}how it looks on the sample game</h3><p class="lead">${esc(s.sample)}</p>
    <p class="muted small">The sample game, Ashfall, is a third-person adventure on a volcanic frontier world with two species. Every lesson shows the same step on it, so you can compare with yours.</p>
    <div class="row gap10" style="margin-top:14px">${l.watch?'<span class="pill ok">WATCHED</span>':''}<button class="btn gold" data-lesson="watch">${l.watch?'Next: Do it on your game →':'Got it. Next: Do it on your game →'}</button></div></div></div>`;}
function checkHtml(s,ev){
  const last=S.road.steps.filter(x=>x.phase===s.phase).at(-1).n===s.n;
  return `<div class="grid2"><div>${gateHtml(s,ev)}</div><div>${last?quizHtml(s.phase):`<div class="card"><h3>Phase ${s.phase} quiz</h3><p class="muted small">The quiz for this phase is on its last step (step ${S.road.steps.filter(x=>x.phase===s.phase).at(-1).n}).</p></div>`}</div></div>`;}
function quizHtml(phase){
  const q=S.quiz[phase],res=P().course.quizzes?.[phase],cert=P().course.certificates?.[phase];
  const allDone=S.rm.steps.filter(x=>x.phase===phase).every(x=>x.status==='done');
  if(!q)return `<div class="card"><h3>Phase ${phase} quiz</h3><p class="muted">Loading…</p></div>`;
  return `<div class="card"><div class="sectionTitle"><h3>Phase ${phase} quiz</h3>${res?`<span class="pill ${res.passed?'ok':''}">${res.score}/${res.total}${res.passed?' PASSED':''}</span>`:''}</div>
    <form id="quiz">${q.questions.map((x,i)=>`<fieldset><legend>${i+1}. ${esc(x.q)}</legend>${x.options.map((o,j)=>`<label class="opt"><input type="radio" name="q${i}" value="${j}" ${S.quiz[phase].sel?.[i]==j?'checked':''}/> ${esc(o)}</label>`).join('')}
      ${q.grade?`<p class="small ${q.grade.results[i].correct?'okText':'badText'}">${q.grade.results[i].correct?'Correct.':'Not quite.'} ${esc(q.grade.results[i].why)}</p>`:''}</fieldset>`).join('')}
      <button class="btn gold" type="submit">Check my answers</button></form>
    <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px"><h3>Certificate</h3>
    ${cert?`<p>Issued. <a href="/certificate/${esc(cert)}" target="_blank" rel="noopener">View and share your certificate ↗</a></p>`:`<p class="muted small">Unlocks when every step in Phase ${phase} is complete${allDone?' ✓':''} and the quiz is passed${res?.passed?' ✓':''}.</p><button class="btn" id="certBtn" ${allDone&&res?.passed?'':'disabled'}>Get my Phase ${phase} certificate</button>`}</div></div>`;}

function gateHtml(s,ev){
  const course=P().mode==='course';
  const items=ev.checks.map((c,i)=>{const [label,cls]=KIND[c.kind];
    const ctl=c.kind==='self'?`<input type="checkbox" data-tick="${i}" ${c.ok?'checked':''} ${ev.status==='open'||ev.status==='done'?'':'disabled'} aria-label="${esc(c.label)}"/>`:`<div class="ic">${c.ok?'✓':''}</div>`;
    return `<label class="check ${c.ok?'ok':''}" ${c.kind!=='self'?`data-jump="${esc(c.key||c.id||'')}" data-kind="${c.kind}"`:''}>${ctl}<div><span>${esc(c.label)}</span><small class="kind ${cls}">${label}</small>${c.detail&&!c.ok?`<small>${esc(c.detail)}</small>`:c.detail&&c.kind==='auto'?`<small>${esc(c.detail)}</small>`:''}</div></label>`;}).join('');
  const lesson=course&&!ev.lessonDone&&ev.status!=='done'?`<div class="check"><div class="ic"></div><div><span>Learn and Watch this lesson</span><small class="kind input">Course</small></div></div>`:'';
  const foot=ev.status==='done'?`<div class="gateDone">✓ Completed ${new Date(ev.completedAt).toLocaleDateString()}${s.n<67?`<button class="btn gold sm" data-go="${s.n+1}">Step ${s.n+1} →</button>`:''}</div>`
    :ev.status==='open'?`<p class="muted small" style="margin:10px 0 0">When every item is ticked, step ${s.n} completes and step ${Math.min(67,s.n+1)} opens automatically.</p>`:'';
  return `<div class="card gate"><div class="sectionTitle"><h3>Gate: before you move on</h3><span class="muted small">${ev.checks.filter(c=>c.ok).length}/${ev.checks.length}</span></div>${lesson}${items}${foot}</div>`;
}

// ---------------------------------------------------------------- workspace panels
function workspace(s){
  let h=s.phase>=2?linkCardHtml(s):'';
  if(s.inputs.length)h+=`<div class="card"><div class="sectionTitle"><h2>Your answers</h2><span class="muted small">Saves automatically</span></div>
    <div class="form" data-scope="ans">${s.inputs.map(f=>fieldHtml(f,R().answers[f.key],'ans',f.required&&!stepEv(s.n).checks.find(c=>c.key===f.key)?.ok)).join('')}</div></div>`;
  for(const p of s.panels)h+=panelHtml(s,p);
  return h;
}
function panelHtml(s,p){
  switch(p.p){
    case 'stage':{const def=stageDef(p.stage);const vals=D()[S.schema.fieldHome[p.stage]]||{};const fields=def.fields.filter(f=>p.keys.includes(f.key));
      return `<div class="card"><div class="sectionTitle"><h2>${esc(def.title)}</h2><span class="muted small">Saves automatically</span></div><div class="form" data-scope="stage" data-stage="${p.stage}">${fields.map(f=>fieldHtml(f,vals[f.key],'stage',false)).join('')}</div></div>`;}
    case 'collection':return collectionHtml(p.c);
    case 'proof':return proofHtml(s,p.key);
    case 'assets':return assetsHtml();
    case 'machine':return machineHtml();
    case 'project':return projectHtml();
    case 'build':return buildHtml();
    case 'publish':return publishHtml();
    case 'requirements':return requirementsHtml();
    case 'expansion':return expansionHtml();
  }
  return '';
}
const fileUrl=f=>`/api/projects/${pid()}/files/${encodeURIComponent(f.file)}`;
function proofHtml(s,key){
  const c=s.checks.find(x=>x.t==='proof'&&x.key===key);const list=R().proof[key]||[];
  return `<div class="card" id="proof_${esc(key)}"><div class="sectionTitle"><div><h2>${esc(c?.label||'Uploads')}</h2><span class="muted small">${list.length}${c?` of ${c.min} needed`:''} · private to you</span></div>
    <label class="btn gold sm upload">Upload<input type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime" data-proof="${esc(key)}"/></label></div>
    ${list.length?`<div class="proofGrid">${list.map(f=>`<div class="pf">${/^video/.test(f.mime)?`<video src="${fileUrl(f)}" preload="metadata" muted></video>`:`<a href="${fileUrl(f)}" target="_blank" rel="noopener"><img src="${fileUrl(f)}" alt="${esc(f.name)}" loading="lazy"/></a>`}<button class="x" data-unproof="${esc(key)}:${f.id}" title="Remove">✕</button></div>`).join('')}</div>`:`<div class="empty">Drop screenshots or short clips here. They are only visible to you.</div>`}</div>`;
}
function assetsHtml(){
  const rows=R().assets;const sel=(k,opts,v,id)=>`<select data-asset="${id}" data-k="${k}"><option value="">—</option>${opts.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  const inp=(k,v,id,ph)=>`<input data-asset="${id}" data-k="${k}" value="${esc(v||'')}" placeholder="${esc(ph)}"/>`;
  return `<div class="card"><div class="sectionTitle"><div><h2>Asset list</h2><span class="muted small">${rows.length} assets · ${rows.filter(a=>a.name&&a.action&&a.source&&a.license).length} complete</span></div>
    <div class="row gap6"><button class="btn sm" id="assetSuggest">Suggest from my mission</button><button class="btn gold sm" id="assetAdd">+ Add asset</button></div></div>
    ${rows.length?`<div class="assetTable"><div class="ah"><span>Asset</span><span>Kind</span><span>Make / buy / generate</span><span>Source</span><span>License</span><span>Status</span><span></span></div>
    ${rows.map(a=>`<div class="ar ${a.name&&a.action&&a.source&&a.license?'':'incomplete'}">${inp('name',a.name,a.id,'Name')}${sel('kind',S.road.assetKinds,a.kind,a.id)}${sel('action',S.road.assetActions,a.action,a.id)}${inp('source',a.source,a.id,'Where it comes from')}${inp('license',a.license,a.id,'License or terms')}${sel('status',S.road.assetStatus,a.status,a.id)}<button class="x" data-delasset="${a.id}" title="Delete">✕</button></div>`).join('')}</div>`
    :'<div class="empty">No assets yet. Let Duke suggest a list from your first mission, then edit it.</div>'}
    <p class="muted small" style="margin:10px 0 0">Every asset needs a source and a license, so you never ship something you cannot legally use.</p></div>`;
}
function agentBlock(){
  const ag=S.rm.agent,m=ag?.machine,seen=ag?.seenAt&&Date.now()-Date.parse(ag.seenAt)<10*60e3;
  return {ag,m,seen};
}
function machineHtml(){
  const {ag,m,seen}=agentBlock();const t=m?.tools||{};
  const row=(k,v,ok)=>`<span>${k}</span><span class="${ok===false?'badText':ok?'okText':''}">${v}</span>`;
  return `<div class="card"><div class="sectionTitle"><h2>Your PC</h2>${seen?'<span class="status succeeded">CONNECTED</span>':'<span class="status canceled">NOT CONNECTED</span>'}</div>
    ${m?`<div class="kv">${row('Computer',esc(m.host))}${row('Processor',esc(m.cpu||'—')+(m.cpuCores?` · ${m.cpuCores} cores`:''))}${row('Memory',m.ramGB?`${m.ramGB} GB`:'—',m.ramGB?m.ramGB>=32:undefined)}
      ${row('Graphics',(m.gpus||[]).map(g=>`${esc(g.name)} (${g.vramGB} GB)`).join(', ')||'—',(m.gpus||[]).length?(m.gpus||[]).some(g=>g.vramGB>=8):undefined)}
      ${row('Unreal Engine',(m.engines||[]).length?esc(m.engines.join(', ')):'Not installed',(m.engines||[]).length>0)}${row('C++ build tools',m.visualStudio?'Installed':'Missing',!!m.visualStudio)}
      ${row('Character Creator 5',t.cc5?'Installed':'Not found',!!t.cc5)}${row('Headshot',t.headshot?'Installed':'Not found',!!t.headshot)}${row('Blender',t.blender?esc(t.blender):'Not found',!!t.blender)}
      ${row('Git / Git LFS',`${t.git?esc(t.git):'Git not found'} · ${t.lfs?'LFS ok':'LFS not found'}`,!!(t.git&&t.lfs))}${row('Last seen',ag.seenAt?new Date(ag.seenAt).toLocaleString():'—')}</div>`:''}
    ${seen?'':`<h3 style="margin:16px 0 8px">Connect your Windows PC</h3>
    <ol class="stepsList"><li>Download <b>DukeForgerSetup.cmd</b> and double-click it. It's a plain text file: right-click it and choose <b>Edit</b> to read every step. It installs Python, the C++ build tools and the Epic Games Launcher, then starts the Duke agent in a small window.</li>
      <li>Windows may say <b>"Windows protected your PC"</b> because the file is new and not from a big company. Click <b>More info</b>, then <b>Run anyway</b>.</li>
      <li>Install <b>Unreal Engine 5.8</b> from the Epic Games Launcher (your own Epic account is needed for this one step).</li><li>This panel turns green when your PC checks in.</li></ol>
    <div class="row gap6 wrap" style="margin-top:12px"><a class="btn gold" href="/api/agent/DukeSetup.cmd" download>Download DukeForgerSetup.cmd</a><button class="btn" id="showManual">No download: copy 3 commands</button></div>
    <div id="manual" style="display:none;margin-top:12px"><p class="muted small">Open <b>Terminal</b> from the Start menu and paste these one at a time:</p><div class="codeBox" id="agentCmd">Loading…</div></div>`}</div>`;
}
const REQUIRED_PLUGINS=[['PCG','PCG'],['MassCrowd','Mass Crowd'],['StateTree','State Tree'],['PythonScriptPlugin','Python Editor Script']];
const FOLDERS=['Characters','Environments','Gameplay','Maps','Animation','Audio','UI'];
function projectHtml(){
  const i=S.rm.inspect,{seen}=agentBlock();const path=R().answers.project_path;
  if(!path)return `<div class="card"><h2>Your Unreal project</h2><p class="muted">Add the path to your .uproject file in step 11 so Duke's agent can check it.</p></div>`;
  const on=new Set(i?.plugins||[]),have=new Set(i?.folders||[]);
  return `<div class="card"><div class="sectionTitle"><h2>Your Unreal project</h2>${i?.exists?'<span class="status succeeded">FOUND</span>':'<span class="status canceled">NOT FOUND YET</span>'}</div>
    <div class="kv"><span>Path</span><span class="mono">${esc(path)}</span><span>Checked</span><span>${i?.at?new Date(i.at).toLocaleString():seen?'Within a minute…':'When your PC is connected'}</span>
    ${i?.exists?`<span>Plugins</span><span>${REQUIRED_PLUGINS.map(([k,l])=>`<span class="chip ${on.has(k)?'ok':''}">${on.has(k)?'✓':'○'} ${l}</span>`).join(' ')}</span>
    <span>Folders</span><span>${FOLDERS.map(f=>`<span class="chip ${have.has(f)?'ok':''}">${have.has(f)?'✓':'○'} ${f}</span>`).join(' ')}</span>
    <span>Version control</span><span class="${i.git&&i.lfs?'okText':'badText'}">${i.git?'Git repository':'Not a Git repository'}${i.git?i.lfs?' with LFS':' (LFS missing)':''}</span>
    <span>Duke design sync</span><span class="${i.syncedAt?'okText':''}">${i.syncedAt?`Synced ${new Date(i.syncedAt).toLocaleString()} into Content/DukeForge`:'Waiting'}</span>`:''}</div></div>`;
}

// ---------------------------------------------------------------- fields (shared with the original pipeline stages)
function fieldHtml(f,v,scope,missing){
  const id=`f_${scope}_${f.key}`;const req=f.required?'<i>*</i>':'';
  let input;
  if(f.type==='textarea')input=`<textarea id="${id}" data-key="${f.key}" rows="${f.rows||3}" placeholder="${esc(f.placeholder||'')}">${esc(v)}</textarea>`;
  else if(f.type==='list')input=`<textarea id="${id}" data-key="${f.key}" data-list="1" rows="${Math.max(4,Math.min(10,(v||[]).length+1))}" placeholder="One per line${f.placeholder?`, e.g. ${esc(f.placeholder)}`:''}">${esc((v||[]).join('\n'))}</textarea>`;
  else if(f.type==='select'){
    const opts=f.source?(D()[f.source]||[]).map(x=>[x.id,x.name||'(unnamed)']):(f.options||[]).map(o=>[o,o]);
    input=`<select id="${id}" data-key="${f.key}"><option value="">Choose…</option>${opts.map(([val,l])=>`<option value="${esc(val)}" ${val===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
  }
  else if(f.type==='bool')input=`<label class="switch" style="margin-top:4px"><input type="checkbox" id="${id}" data-key="${f.key}" ${v?'checked':''}/><span></span>${v?'On':'Off'}</label>`;
  else input=`<input id="${id}" data-key="${f.key}" type="${f.type==='number'?'number':'text'}" step="any" value="${esc(v??'')}" placeholder="${esc(f.placeholder||'')}"/>`;
  const wide=f.type==='textarea'||f.type==='list'||(f.placeholder||'').length>40;
  const count=f.type==='list'&&f.min?`<span class="help">${(v||[]).length} of ${f.min} minimum</span>`:f.min&&f.type!=='list'?`<span class="help">${String(v||'').length} of ${f.min} characters minimum</span>`:'';
  return `<div class="field ${wide?'full':''} ${missing?'missing':''}" id="wrap_${id}"><label for="${id}">${terms(f.label,new Set(),2)} ${req}</label>${input}${f.help?`<span class="help">${terms(f.help,new Set(),2)}</span>`:''}${count}</div>`;
}
function readField(el){if(el.type==='checkbox')return el.checked;if(el.dataset.list)return el.value.split('\n').map(x=>x.trim()).filter(Boolean);return el.value;}

function bindStep(s,ev){
  $$('[data-go]').forEach(b=>b.onclick=()=>goStep(Number(b.dataset.go)));
  $$('[data-plans]').forEach(b=>b.onclick=()=>plansModal(b.dataset.plans));
  $$('[data-tab]').forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;renderStep();});
  $$('[data-lesson]').forEach(b=>b.onclick=async()=>{
    if(stepEv(s.n).status==='locked'){toast(`Finish step ${S.rm.current} first`,true);return;}
    const part=b.dataset.lesson;apply(await post(`/api/projects/${pid()}/lessons/${s.n}`,{part}));S.tab=part==='learn'?'watch':'do';render();});
  if(P().mode==='course'&&S.tab==='watch'&&S.video[s.n]===undefined)api(`/api/lessons/${s.n}/video`).then(r=>{S.video[s.n]=r.video||null;if(S.step===s.n)renderStep();});
  const last=S.road.steps.filter(x=>x.phase===s.phase).at(-1).n===s.n;
  if(P().mode==='course'&&S.tab==='check'&&last&&!S.quiz[s.phase])api(`/api/course/quiz/${s.phase}`).then(q=>{S.quiz[s.phase]={...q,sel:{}};if(S.step===s.n)renderStep();});
  $('#quiz')?.addEventListener('change',e=>{const m=/^q(\d+)$/.exec(e.target.name);if(m)S.quiz[s.phase].sel[m[1]]=Number(e.target.value);});
  $('#quiz')?.addEventListener('submit',async e=>{e.preventDefault();const q=S.quiz[s.phase];const answers=q.questions.map((_,i)=>q.sel[i]);
    if(answers.some(a=>a===undefined)){toast('Answer every question first',true);return;}
    const r=await post(`/api/projects/${pid()}/quiz/${s.phase}`,{answers});apply(r);q.grade=r.grade;render();toast(r.grade.passed?`Passed: ${r.grade.score}/${r.grade.total}`:`${r.grade.score}/${r.grade.total}. Review the explanations and try again.`,!r.grade.passed);});
  $('#certBtn')?.addEventListener('click',async()=>{const r=await post(`/api/projects/${pid()}/certificates/${s.phase}`);await refreshRm(true);render();window.open(`/certificate/${r.certificate.id}`,'_blank','noopener');});
  $('#draftBtn')?.addEventListener('click',async()=>{S.busy.draft=1;renderStep();try{const r=await post(`/api/projects/${pid()}/steps/${s.n}/draft`);apply(r);toast(`Duke drafted the empty fields (${r.source}). Make them yours.`);}finally{S.busy.draft=0;render();pushPreview();}});
  const ask=async()=>{const q=$('#askInput').value.trim();if(!q)return;S.busy.ask=1;renderStep();try{const r=await post(`/api/projects/${pid()}/steps/${s.n}/ask`,{question:q});S.answer[s.n]=r.answer;}finally{S.busy.ask=0;renderStep();}};
  $('#askBtn')?.addEventListener('click',ask);$('#askInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')ask();});
  // answers
  $$('[data-scope="ans"] [data-key]').forEach(el=>el.addEventListener('change',async()=>{apply(await patch(`/api/projects/${pid()}/steps/${s.n}/answers`,{values:{[el.dataset.key]:readField(el)}}));render();}));
  // stage fields
  $$('[data-scope="stage"] [data-key]').forEach(el=>el.addEventListener('change',async()=>{
    const st=el.closest('[data-stage]')?.dataset.stage||'build';
    const r=await patch(`/api/projects/${pid()}/stage/${st}`,{values:{[el.dataset.key]:readField(el)}});S.project=r.project;
    await refreshRm();if(st==='vision')renderProjects();render();pushPreview();}));
  // gate
  $$('[data-tick]').forEach(cb=>cb.addEventListener('change',async()=>{apply(await post(`/api/projects/${pid()}/steps/${s.n}/tick`,{i:Number(cb.dataset.tick),on:cb.checked}));render();}));
  $$('.check[data-jump]').forEach(c=>c.onclick=e=>{e.preventDefault();const k=c.dataset.jump,kind=c.dataset.kind;
    if(P().mode==='course'&&S.tab!=='do'){S.tab='do';renderStep();}
    const el=kind==='input'?document.getElementById(`f_ans_${k}`):kind==='proof'?document.getElementById(`proof_${k}`):null;
    (el||$('.grid2 > div > .card:last-child'))?.scrollIntoView({behavior:'smooth',block:'center'});el?.focus?.();});
  // proof uploads
  $$('[data-proof]').forEach(inp=>inp.onchange=()=>uploadProof(inp.dataset.proof,inp.files));
  $$('[data-unproof]').forEach(b=>b.onclick=async()=>{const [k,id]=b.dataset.unproof.split(':');apply(await del(`/api/projects/${pid()}/proof/${k}/${id}`));render();});
  $$('.card[id^="proof_"]').forEach(card=>{card.ondragover=e=>{e.preventDefault();card.classList.add('drag');};card.ondragleave=()=>card.classList.remove('drag');
    card.ondrop=e=>{e.preventDefault();card.classList.remove('drag');uploadProof(card.id.slice(6),e.dataTransfer.files);};});
  // assets
  $('#assetAdd')?.addEventListener('click',async()=>{apply(await post(`/api/projects/${pid()}/asset-list`,{values:{}}));render();$$('.ar input[data-k="name"]').at(-1)?.focus();});
  $('#assetSuggest')?.addEventListener('click',async()=>{apply(await post(`/api/projects/${pid()}/asset-list/suggest`));render();toast('Duke added the assets your first mission needs. Fill in the missing licenses.');});
  $$('[data-asset]').forEach(el=>el.addEventListener('change',async()=>{apply(await patch(`/api/projects/${pid()}/asset-list/${el.dataset.asset}`,{values:{[el.dataset.k]:el.value}}));render();}));
  $$('[data-delasset]').forEach(b=>b.onclick=async()=>{apply(await del(`/api/projects/${pid()}/asset-list/${b.dataset.delasset}`));render();});
  // machine
  $('#showManual')?.addEventListener('click',async()=>{const m=$('#manual');m.style.display=m.style.display==='none'?'block':'none';const a=await api('/api/agent/setup');$('#agentCmd').textContent=(a.manual||[a.command]).join('\n');});
  $$('[data-openlink]').forEach(b=>b.onclick=()=>openLink(b.dataset.openlink));
  bindCollections();bindBuild();bindPublish();bindRequirements();bindExpansion();
}
async function uploadProof(key,files){
  if(!files?.length)return;const fd=new FormData();for(const f of files)fd.append('files',f);
  toast(`Uploading ${files.length} file${files.length>1?'s':''}…`);
  apply(await api(`/api/projects/${pid()}/proof/${encodeURIComponent(key)}`,{method:'POST',body:fd}));render();toast('Uploaded');
}

// ---------------------------------------------------------------- collections (characters, districts, weapons, ...)
const ART_LABEL={character:'Character',vehicle:'Vehicle',weapon:'Weapon',prop:'Prop'};
function collectionHtml(c){
  const C=S.schema.collections[c],list=D()[c]||[];
  return `<div class="card" data-coll="${c}"><div class="sectionTitle"><div><h2>${esc(C.plural)}</h2><span class="muted small">${list.length} so far${c==='kit'?' · optional: real 3D models for the preview\'s trees and lamps':''}</span></div>
    <div class="row gap6"><button class="btn sm" data-propose="${c}">${S.busy['propose_'+c]?'Thinking…':'Suggest with Duke'}</button><button class="btn gold sm" data-add="${c}">+ Add ${esc(C.label.toLowerCase())}</button></div></div>
    <div class="entities">${list.length?list.map(e=>entityHtml(c,e)).join(''):`<div class="empty">No ${esc(C.plural.toLowerCase())} yet. Add one yourself, or let Duke suggest one that fits your game.</div>`}</div></div>`;
}
function entityPills(c,e){
  const C=S.schema.collections[c];if(!C.art)return '';
  const a=e.art||{},out=[];
  out.push(a.approved?'<span class="pill ok">CONCEPT</span>':'<span class="pill">CONCEPT</span>');
  out.push(a.model?'<span class="pill ok">3D</span>':'<span class="pill">3D</span>');
  if(C.art==='character'){out.push(a.rig?'<span class="pill ok">RIGGED</span>':'<span class="pill">RIG</span>');}
  if(a.busy)out.push(`<span class="pill run">${esc(a.busy.toUpperCase())}…</span>`);
  return out.join('');
}
function entityHtml(c,e){
  const C=S.schema.collections[c],a=e.art||{},open=S.open.has(e.id);
  const thumb=a.model?.thumb||a.approved||'';
  const sub=[e.role,e.class,e.type,e.kind,e.style,c==='missions'&&e.objective].filter(Boolean).join(' · ');
  return `<div class="entity" id="ent_${e.id}"><div class="entityHead" data-toggle="${e.id}">
    ${C.art?`<div class="thumb" style="${thumb?`background-image:url('${esc(thumb)}')`:''}">${thumb?'':esc((e.name||'?')[0])}</div>`:''}
    <div class="t"><b>${esc(e.name||`Unnamed ${C.label.toLowerCase()}`)}</b><span>${esc(sub)}</span>${C.art?`<div class="pills" style="margin-top:6px">${entityPills(c,e)}</div>`:''}</div><span class="muted">${open?'▾':'▸'}</span></div>
    ${open?`<div class="entityBody"><div class="form" data-scope="entity" data-coll="${c}" data-id="${e.id}" style="margin-top:12px">${C.fields.map(f=>fieldHtml(f,e[f.key],e.id,f.required&&!(e[f.key]!=null&&String(e[f.key]).trim()))).join('')}</div>
      ${C.art?artHtml(c,e):''}
      <div class="row between" style="margin-top:14px"><span class="muted small">Saves automatically</span><button class="btn sm danger" data-del="${c}:${e.id}">Delete</button></div></div>`:''}</div>`;
}
function artHtml(c,e){
  const C=S.schema.collections[c],kind=C.art,a=e.art||{},job=a.job&&S.jobs[a.job];
  const running=a.busy&&job&&job.status==='running';const cost=S.road.creditCost;const can=feat('build');
  const step=(n,title,ok,open,desc,body,actions)=>`<div class="step ${ok?'ok':''} ${open||ok?'':'locked'}"><h4><span>${n}. ${title}</span>${ok?'<span style="color:var(--green)">✓</span>':''}</h4><p>${desc}</p>${body||''}<div class="row gap6 wrap">${actions||''}</div></div>`;
  const gen=(s,label)=>can?`<button class="btn sm gold" data-art="${c}:${e.id}:${s}" ${a.busy?'disabled':''}>${a.busy===s?'Working…':`${label} · ${cost[s]} cr`}</button>`:`<button class="btn sm" data-plans="creator">${label} (Creator plan)</button>`;
  const up=(slot,label,accept)=>`<label class="btn sm upload">${label}<input type="file" data-upload="${c}:${e.id}:${slot}" accept="${accept}"/></label>`;
  const concepts=(a.concepts||[]).map(x=>`<button class="${x.url===a.approved?'on':''}" style="background-image:url('${esc(x.url)}')" data-approve="${c}:${e.id}" data-url="${esc(x.url)}" title="Approve this concept"></button>`).join('');
  let steps=step(1,'Concept art',!!a.approved,true,a.concepts?.length?'Click the version you like to approve it.':'Generate concept art from your description, or upload your own (a CC5 render works too).',
    concepts?`<div class="concepts">${concepts}</div>`:'',gen('concept',a.concepts?.length?'More concepts':'Generate concepts')+up('concept','Upload image','image/png,image/jpeg'));
  steps+=step(2,'3D model',!!a.model,!!a.approved,a.model?`${a.model.source==='upload'?'Your uploaded model':'Generated model'} with PBR textures.`:kind==='character'?'Upload your Character Creator export (FBX), or generate a background-quality model from the concept.':'Upload a model, or generate one from the approved concept.',
    a.model?.thumb?`<img src="${esc(a.model.thumb)}" style="width:100%;border-radius:8px;background:#0d0f10"/>`:'',
    (a.approved?gen('model',a.model?'Rebuild':'Generate 3D'):'')+(a.model?.glb?`<button class="btn sm" data-view="${c}:${e.id}">View 3D</button>`:'')+up('model','Upload GLB/FBX','.glb,.fbx'));
  if(kind==='character'){
    steps+=step(3,'Rig + walk/run',!!a.rig,!!a.model,'A rigged FBX lets the character move. Character Creator exports come rigged: upload the FBX here.','',
      (a.model?gen('rig',a.rig?'Re-rig':'Auto-rig'):'')+up('rig','Upload rigged FBX','.fbx'));
  }
  const prog=running?`<div style="margin-top:10px"><div class="progress"><i style="width:${job.progress||3}%"></i></div><div class="jobLog">${esc((job.logs||[]).slice(-3).join('\n'))}</div></div>`:'';
  const failed=job&&job.status==='failed'?`<div class="answer" style="margin:10px 0 0;border-color:var(--red)">${esc(job.error)}</div>`:'';
  return `<div class="art"><div class="sectionTitle"><h3>${ART_LABEL[kind]} assets</h3><span class="muted small">Upload your own, or generate with Meshy</span></div><div class="steps">${steps}</div>${prog}${failed}</div>`;
}
function bindCollections(){
  $$('[data-toggle]').forEach(h=>h.onclick=e=>{if(e.target.closest('button'))return;const id=h.dataset.toggle;S.open.has(id)?S.open.delete(id):S.open.add(id);renderStep();});
  $$('[data-add]').forEach(b=>b.onclick=async()=>{const c=b.dataset.add;const r=await post(`/api/projects/${pid()}/design/${c}`,{values:{}});S.project=r.project;await refreshRm(true);S.open.add(D()[c].at(-1).id);render();});
  $$('[data-propose]').forEach(b=>b.onclick=async()=>{const c=b.dataset.propose;S.busy['propose_'+c]=1;renderStep();
    try{const r=await post(`/api/projects/${pid()}/director/propose`,{collection:c,count:1});S.project=r.project;await refreshRm();S.open.add(D()[c].at(-1).id);toast(`Duke added a ${S.schema.collections[c].label.toLowerCase()} (${r.source}). Make it yours.`);}
    finally{S.busy['propose_'+c]=0;render();pushPreview();}});
  $$('[data-scope="entity"] [data-key]').forEach(el=>el.addEventListener('change',async()=>{
    const f=el.closest('[data-scope]');const r=await patch(`/api/projects/${pid()}/design/${f.dataset.coll}/${f.dataset.id}`,{values:{[el.dataset.key]:readField(el)}});S.project=r.project;await refreshRm();render();pushPreview();}));
  $$('[data-del]').forEach(b=>b.onclick=async()=>{const [c,id]=b.dataset.del.split(':');if(!confirm('Delete this item?'))return;
    const r=await del(`/api/projects/${pid()}/design/${c}/${id}`);S.project=r.project;await refreshRm(true);render();pushPreview();});
  $$('[data-approve]').forEach(b=>b.onclick=async()=>{const [c,id]=b.dataset.approve.split(':');const r=await post(`/api/projects/${pid()}/design/${c}/${id}/art/approve`,{url:b.dataset.url});S.project=r.project;await refreshRm();render();toast('Concept approved');});
  $$('[data-art]').forEach(b=>b.onclick=async()=>{const [c,id,step]=b.dataset.art.split(':');
    const job=await post(`/api/projects/${pid()}/design/${c}/${id}/art/${step}`);S.jobs[job.id]=job;
    S.project=await api(`/api/projects/${pid()}`);refreshMe();render();pollJob(job.id);});
  $$('[data-upload]').forEach(inp=>inp.onchange=async()=>{const [c,id,slot]=inp.dataset.upload.split(':');if(!inp.files.length)return;
    const fd=new FormData();fd.append('slot',slot);for(const f of inp.files)fd.append('files',f);
    toast('Uploading…');const r=await api(`/api/projects/${pid()}/design/${c}/${id}/art/upload`,{method:'POST',body:fd});S.project=r.project;await refreshRm();render();pushPreview();toast('Uploaded');});
  $$('[data-view]').forEach(b=>b.onclick=()=>{const [c,id]=b.dataset.view.split(':');viewModel(c,id);});
  $$('[data-plans]').forEach(b=>b.onclick=()=>plansModal(b.dataset.plans));
  for(const c of Object.keys(S.schema.collections))for(const e of D()[c]||[])if(e.art?.busy&&e.art.job&&!S.jobs[e.art.job]?.polling)pollJob(e.art.job);
}
async function pollJob(jobId){
  const j=S.jobs[jobId] ||= {id:jobId};if(j.polling)return;j.polling=true;
  while(true){
    let job;try{job=await api(`/api/jobs/${jobId}`);}catch{break;}
    Object.assign(j,job);
    if(job.status!=='running'){j.polling=false;S.project=await api(`/api/projects/${pid()}`);await refreshRm();refreshMe();render();pushPreview();
      toast(job.status==='complete'?(job.logs.at(-1)||'Done'):`Failed: ${job.error}`,job.status!=='complete');break;}
    const card=document.getElementById(`ent_${job.entityId}`);if(card){const bar=card.querySelector('.progress i');if(bar)bar.style.width=(job.progress||3)+'%';else renderStep();}
    await new Promise(r=>setTimeout(r,2500));
  }
}
function viewModel(c,id){
  const e=D()[c].find(x=>x.id===id);const url=e.art.model.glb;const yaw=e.art.yaw||0;const orient=c!=='characters';
  modal(`<div class="row between"><div><span class="eyebrow">3D MODEL</span><h2>${esc(e.name)}</h2></div><button class="btn ghost sm" data-close>Close</button></div>
    <iframe class="viewerFrame" id="viewerFrame" style="margin-top:12px" src="/viewer.html?url=${encodeURIComponent(url)}&yaw=${yaw}${orient?'&arrow=1':''}"></iframe>
    ${orient?`<div class="row between" style="margin-top:12px"><span class="muted small">Make the model face the gold arrow (the front in the game).</span><div class="row gap6"><button class="btn sm" id="rotL">⟲ 90°</button><button class="btn sm" id="rotR">90° ⟳</button></div></div>`:''}`,()=>{
    let cur=yaw;const rot=async d=>{cur=((cur+d)%360+360)%360;$('#viewerFrame').contentWindow.postMessage({type:'yaw',deg:cur},'*');const r=await patch(`/api/projects/${pid()}/design/${c}/${id}`,{yaw:cur});S.project=r.project;pushPreview();};
    $('#rotL')?.addEventListener('click',()=>rot(-90));$('#rotR')?.addEventListener('click',()=>rot(90));},true);
}

// ---------------------------------------------------------------- build + publish
function buildHtml(){
  const {seen,m}=agentBlock();const builds=P().builds||[];const live=builds.some(b=>['queued','running'].includes(b.status));
  const mine=!!S.rm.inspect?.exists;const cloud=feat('cloud');const cfg=D().build?.config||'Shipping';
  return `<div class="card"><div class="sectionTitle"><h2>Build the game</h2><a class="btn sm" href="/api/projects/${pid()}/unreal.zip">Download Duke's starter project</a></div>
    ${!feat('build')?`<p>Builds are part of the Creator plan. <button class="btn gold sm" data-plans="creator">See plans</button></p>`:`
    <div class="form"><div class="field"><label for="bSource">What to build</label><select id="bSource"><option value="mine" ${mine?'selected':''} ${mine?'':'disabled'}>My Unreal project${mine?'':' (not found yet)'}</option><option value="duke" ${mine?'':'selected'}>Duke's generated project (from my design)</option></select></div>
      <div class="field"><label for="bConfig">Build type</label><select id="bConfig"><option ${cfg==='Shipping'?'selected':''}>Shipping</option><option ${cfg==='Development'?'selected':''}>Development</option></select></div>
      <div class="field"><label for="bWhere">Where</label><select id="bWhere"><option value="pc">My PC ${seen?'(connected)':'(not connected)'}</option><option value="cloud" ${cloud?'':'disabled'}>Cloud build server${cloud?'':' (Studio plan)'}</option></select></div></div>
    <div class="row gap10" style="margin-top:14px"><button class="btn gold" id="buildBtn" ${live?'disabled':''}>Build my game</button><span class="muted small">Your PC compiles, cooks and packages a playable Windows game, then uploads it here.</span></div>
    ${!seen?'<p class="muted small" style="margin-top:8px">Your PC is not connected. Builds wait until it checks in (step 9 sets it up).</p>':''}`}</div>
  ${builds.length?`<div class="card"><h2 style="margin-bottom:10px">Builds</h2>${builds.map(buildRow).join('')}</div>`:''}`;
}
function buildRow(b){
  const live=['queued','running'].includes(b.status);
  return `<div style="padding:12px 0;border-top:1px solid var(--line)"><div class="row between gap10 wrap"><div><b>${esc(b.phase||b.status)}</b><div class="muted small">${new Date(b.createdAt).toLocaleString()} · ${esc(b.config||'')} · ${b.source==='mine'?'your project':'Duke project'}${b.cloud?' · cloud':''}</div></div>
    <div class="row gap6"><span class="status ${b.status}">${b.status.toUpperCase()}</span>${b.artifact?`<a class="btn gold sm" href="/api/projects/${pid()}/builds/${b.id}/download">Download (${(b.artifact.size/1048576).toFixed(0)} MB)</a>`:''}${live?`<button class="btn sm" data-cancel="${b.id}">Cancel</button>`:''}</div></div>
    ${live?`<div class="progress" style="margin:10px 0"><i style="width:${b.progress||2}%"></i></div>`:''}
    ${b.itchUrl?`<p class="small">Live on itch.io: <a href="${esc(b.itchUrl)}" target="_blank" rel="noreferrer">${esc(b.itchUrl)}</a></p>`:''}
    <details ${live||b.status==='failed'?'open':''}><summary class="muted small" style="cursor:pointer;margin-top:6px">Build log</summary><div class="buildLog">${esc((b.logs||[]).slice(-120).join('\n'))}</div></details></div>`;
}
function bindBuild(){
  $('#buildBtn')?.addEventListener('click',async()=>{const r=await post(`/api/projects/${pid()}/builds`,{source:$('#bSource').value,config:$('#bConfig').value,cloud:$('#bWhere').value==='cloud'});S.project=r.project;await refreshRm(true);render();toast('Build queued');});
  $$('[data-cancel]').forEach(b=>b.onclick=async()=>{const r=await post(`/api/projects/${pid()}/builds/${b.dataset.cancel}/cancel`);S.project=r.project;render();});
  $$('.buildLog').forEach(l=>l.scrollTop=l.scrollHeight);
}
function publishHtml(){
  const ok=(P().builds||[]).find(b=>b.status==='succeeded'&&b.artifact);const pub=D().publish||{};const sc=P().showcase||{};
  const shots=Object.values(R().proof).flat().filter(f=>/^image\//.test(f.mime));
  return `<div class="card"><h2>Your game</h2>${ok?`<p>Latest playable build: <b>${new Date(ok.finishedAt||ok.createdAt).toLocaleString()}</b></p><a class="btn gold" href="/api/projects/${pid()}/builds/${ok.id}/download">Download ${esc(ok.artifact.name)}</a>${ok.itchUrl?` <a class="btn" href="${esc(ok.itchUrl)}" target="_blank" rel="noreferrer">Open on itch.io</a>`:''}
    <p class="muted small" style="margin-top:12px">Unzip and run the .exe. Share it on itch.io, or submit it to Steam through Steamworks.</p>`:'<p class="muted">Build your game first.</p>'}</div>
  <div class="card"><div class="sectionTitle"><h2>Publish to itch.io automatically</h2></div>
    <p class="muted small">Create the game page on itch.io once, then fill these in. Your PC pushes every new build with itch's <a href="https://itch.io/docs/butler/" target="_blank" rel="noreferrer">butler</a> tool (install it and run <code>butler login</code> once).</p>
    <div class="form" data-scope="stage" data-stage="publish">${stageDef('publish').fields.map(f=>fieldHtml(f,pub[f.key],'stage',false)).join('')}</div></div>
  <div class="card"><div class="sectionTitle"><h2>Showcase</h2>${sc.on?'<span class="status succeeded">PUBLIC</span>':''}</div>
    <p class="muted small">Show your game on the Duke Forger showcase with one screenshot and a short description. Your other uploads stay private.</p>
    <div class="form"><div class="field full"><label for="scBlurb">Description</label><textarea id="scBlurb" rows="2">${esc(sc.blurb||D().vision?.logline||'')}</textarea></div>
    <div class="field full"><label for="scCover">Cover screenshot</label><select id="scCover"><option value="">Keep current</option>${shots.map(f=>`<option value="${esc(f.file)}">${esc(f.name)}</option>`).join('')}</select></div></div>
    <div class="row gap6" style="margin-top:12px"><button class="btn gold sm" id="scOn">${sc.on?'Update showcase':'Show it publicly'}</button>${sc.on?`<button class="btn sm" id="scOff">Remove</button><a class="btn sm ghost" href="/showcase/${pid()}" target="_blank" rel="noopener">View ↗</a>`:''}</div></div>`;
}
function bindPublish(){
  const go=async on=>{apply(await post(`/api/projects/${pid()}/showcase`,{on,blurb:$('#scBlurb')?.value,coverFile:$('#scCover')?.value||undefined}));render();toast(on?'Your game is on the showcase':'Removed from the showcase');};
  $('#scOn')?.addEventListener('click',()=>go(true));$('#scOff')?.addEventListener('click',()=>go(false));
}

// ---------------------------------------------------------------- requirements + expansion loop
function requirementsHtml(){
  const rq=R().requirements;
  return `<div class="card"><div class="sectionTitle"><div><h2>Requirements</h2><span class="muted small">The numbers your finished game must reach</span></div><button class="btn sm" id="reqAdd">+ Add requirement</button></div>
    <div class="reqTable"><div class="rh"><span>Requirement</span><span>Target</span><span>Current</span><span>Progress</span><span></span></div>
    ${rq.map(q=>{const t=Number(q.target)||0,c=Number(q.current)||0;const pct=t?Math.min(100,Math.round(c/t*100)):0;
      return `<div class="rr">${q.key==='custom'?`<input data-req="${q.id}" data-k="label" value="${esc(q.label)}" placeholder="Requirement"/>`:`<span>${esc(q.label)}</span>`}
      <input type="number" min="0" data-req="${q.id}" data-k="target" value="${q.target??''}" placeholder="target"/><input type="number" min="0" data-req="${q.id}" data-k="current" value="${q.current??0}"/>
      <span class="mini"><i style="width:${pct}%" class="${pct>=100?'full':''}"></i></span>${q.key==='custom'?`<button class="x" data-unreq="${q.id}">✕</button>`:'<span></span>'}</div>`;}).join('')}</div>
    <p class="muted small" style="margin:10px 0 0">Current values update when expansion passes merge${feat('expansion')?'':'. On your plan you update them yourself as you build'}.</p></div>`;
}
function expansionHtml(){
  const passes=R().passes;const can=feat('expansion');const openPass=passes.find(x=>['planned','review','failed'].includes(x.status));
  const passCard=x=>{const shots=R().proof[`pass-${x.id}`]||[];
    return `<div class="pass ${x.status}"><div class="row between gap10"><div><b>${esc(x.title)}</b><div class="muted small">${esc(x.label)} · started at ${x.before} · ${new Date(x.createdAt).toLocaleDateString()} · planned by ${esc(x.source||'Duke')}</div></div><span class="status ${x.status==='merged'?'succeeded':x.status==='rejected'||x.status==='failed'?'failed':'running'}">${x.status.toUpperCase()}</span></div>
      <p>${esc(x.plan)}</p>
      ${x.checks?`<div class="passChecks">${x.checks.map(c=>`<span class="chip ${c.ok?'ok':'bad'}">${c.ok?'✓':'✕'} ${esc(c.label)}: ${esc(c.detail)}</span>`).join('')}</div>`:''}
      ${x.status==='planned'||x.status==='failed'?`<div class="form" style="margin-top:10px"><div class="field"><label>How many were added</label><input type="number" min="0" id="pAdded" value="${x.added??''}" placeholder="${x.size}"/></div>
        <div class="field"><label>Frame rate on your target PC (fps)</label><input type="number" min="0" id="pFps" value="${x.fps??''}"/></div><div class="field full"><label>Notes</label><input id="pNote" value="${esc(x.note||'')}" placeholder="What changed, where to look"/></div></div>
        <div class="row gap6 wrap" style="margin-top:10px"><label class="btn sm upload">Upload after screenshots (${shots.length})<input type="file" multiple accept="image/*" data-proof="pass-${x.id}"/></label><button class="btn gold sm" data-psubmit="${x.id}">Run automatic checks</button></div>`:''}
      ${x.status==='review'?`<div class="proofGrid" style="margin-top:10px">${shots.map(f=>`<div class="pf"><a href="${fileUrl(f)}" target="_blank" rel="noopener"><img src="${fileUrl(f)}" alt="" loading="lazy"/></a></div>`).join('')}</div>
        <p class="muted small">Compare these with your vertical slice screenshots (step 59). Approve only if it meets the same bar.</p>
        <div class="row gap6"><button class="btn gold sm" data-preview="${x.id}:1">Approve and merge</button><button class="btn sm danger" data-preview="${x.id}:0">Send back</button></div>`:''}</div>`;};
  return `<div class="card"><div class="sectionTitle"><div><h2>Expansion loop</h2><span class="muted small">Measure the gap → build in the Sandbox → automatic checks → your review → merge</span></div>
    ${can?`<button class="btn gold sm" id="planPass" ${openPass?'disabled':''}>${S.busy.pass?'Planning…':'Plan the next pass'}</button>`:`<button class="btn sm" data-plans="studio">Studio plan</button>`}</div>
    ${!can?'<p class="muted">On Studio, Duke measures your biggest gap, plans each pass from your kits and rules, runs the automatic checks and keeps the review queue. On your plan, build in passes yourself and update the current numbers above.</p>':''}
    ${passes.length?passes.slice(0,12).map(passCard).join(''):can?'<div class="empty">No passes yet. Set your targets above, then plan the first pass.</div>':''}</div>`;
}
function bindRequirements(){
  $$('[data-req]').forEach(el=>el.addEventListener('change',async()=>{apply(await patch(`/api/projects/${pid()}/requirements`,{items:[{id:el.dataset.req,[el.dataset.k]:el.value}]}));render();}));
  $('#reqAdd')?.addEventListener('click',async()=>{apply(await patch(`/api/projects/${pid()}/requirements`,{items:[{label:'New requirement'}]}));render();});
  $$('[data-unreq]').forEach(b=>b.onclick=async()=>{apply(await patch(`/api/projects/${pid()}/requirements`,{items:[{id:b.dataset.unreq,remove:true}]}));render();});
}
function bindExpansion(){
  $('#planPass')?.addEventListener('click',async()=>{S.busy.pass=1;renderStep();try{apply(await post(`/api/projects/${pid()}/passes`));toast('Pass planned. Build it in the Sandbox, then report the results.');}finally{S.busy.pass=0;render();}});
  $$('[data-psubmit]').forEach(b=>b.onclick=async()=>{const r=await post(`/api/projects/${pid()}/passes/${b.dataset.psubmit}/submit`,{added:$('#pAdded').value,fps:$('#pFps').value,note:$('#pNote').value});apply(r);render();
    const x=R().passes.find(z=>z.id===b.dataset.psubmit);toast(x.status==='review'?'Checks passed. Ready for your review.':'A check failed. Fix it and run the checks again.',x.status!=='review');});
  $$('[data-preview]').forEach(b=>b.onclick=async()=>{const [id,ok]=b.dataset.preview.split(':');apply(await post(`/api/projects/${pid()}/passes/${id}/review`,{approve:ok==='1'}));render();toast(ok==='1'?'Merged. Duke measured again.':'Sent back.');});
}


// ---------------------------------------------------------------- Duke Link: your desktop tools, live inside Duke
const STEP_TOOL=s=>s.phase===4?(/Blender|costume|surface|game-ready/i.test(s.title)?'blender':'cc5'):'ue';
const LS={status:null,control:false,log:[],timer:null,lastMove:0};
function linkCardHtml(s){
  const t=STEP_TOOL(s);const name=S.road.tools.find(x=>x.id===t)?.name||'your tools';const st=LS.status;
  return `<div class="card linkCard"><div><b>Do this step without leaving Duke</b><p class="muted small">Open ${esc(name)} in Duke Link: it runs on your PC and shows up live here, and one tap saves what you see as proof for this step.</p></div>
    <button class="btn gold sm" data-openlink="${t}">${st?.online?'Open Duke Link':'Set up Duke Link'} →</button></div>`;
}
function openLink(tool){S.view='link';LS.want=tool;render();$('#main').scrollTop=0;document.body.classList.remove('railOpen');}
$('#linkBtn').onclick=()=>openLink();
async function linkStatus(){try{LS.status=await api('/api/link/status');}catch(e){LS.status={online:false,error:e.message,tools:S.road.tools.map(t=>({...t}))};}
  $('#linkDot').className='ldot '+(LS.status.online?'on':'');$('#linkSub').textContent=LS.status.online?`${LS.status.pcName||'Your PC'} is connected`:'Your tools, live in Duke';}
function stopStream(){const img=$('#liveImg');if(img)img.src='';clearInterval(LS.timer);LS.timer=null;}
function renderLink(){
  const st=LS.status||{tools:S.road.tools,windows:[]};const s=stepDef(S.rm.current);const ev=stepEv(S.rm.current);
  const proofs=s.checks.filter(c=>c.t==='proof');const tool=st.windows?.find(w=>w.title===st.window)?.tool;
  const acts=S.road.actions.filter(a=>!tool||a.tool===tool);
  $('#stage').innerHTML=`<div class="stepHead"><div><span class="eyebrow">DUKE LINK</span><h1>Your tools, live in Duke</h1>
      <p class="muted">Your tools run on your own PC, and Duke shows them here. Open one, then turn on <b>Use it here</b> to click and type in the picture as if you were sitting at your PC.</p></div>
      <button class="btn sm ghost" data-go="${S.rm.current}">← Back to step ${S.rm.current}</button></div>
    ${!st.online?`<div class="banner gold"><b>Your PC is not connected.</b> Duke Link uses the Duke agent on your PC. ${S.rm.agent?.seenAt?'Turn your PC on and make sure the Duke agent is running.':`Download <a href="/api/agent/DukeSetup.cmd" download>DukeSetup.cmd</a> and run it once (step 9 walks you through it).`}</div>`:''}
    <div class="toolRow">${st.tools.map(t=>`<div class="toolCard ${t.open?'open':''} ${LS.want===t.id?'want':''}"><b>${esc(t.name)}</b><p>${esc(t.does)}</p>
      <div class="row gap6 wrap"><span class="chip ${t.installed?'ok':''}">${t.installed?'✓ Installed':'Not installed'}</span>${t.open?'<span class="chip ok">● Open</span>':''}</div>
      <div class="row gap6" style="margin-top:8px">${t.open?`<button class="btn sm gold" data-showtool="${t.id}">Show here</button>`:`<button class="btn sm ${t.installed?'gold':''}" data-launch="${t.id}" ${st.online&&t.installed?'':'disabled'}>Open</button>`}</div></div>`).join('')}</div>
    <div class="linkGrid"><div>
      <div class="liveBar"><select id="winPick" aria-label="Window">${(st.windows||[]).length?st.windows.map(w=>`<option value="${esc(w.id)}" ${w.title===st.window?'selected':''}>${esc(w.title)}</option>`).join(''):'<option>No tool windows open yet</option>'}</select>
        <label class="switch"><input type="checkbox" id="ctlToggle" ${LS.control?'checked':''} ${st.online?'':'disabled'}/><span></span>Use it here</label>
        <span class="muted small">${st.online&&st.frameAge!=null&&st.frameAge<5000?`Live · ${st.fps||0} fps`:''}</span>
        <button class="btn sm" id="liveFull">Full screen</button></div>
      <div class="liveWrap ${LS.control?'ctl':''}" id="liveWrap" tabindex="0">${st.online&&(st.windows||[]).length?`<img id="liveImg" alt="Live view of ${esc(st.window||'your tool')}" draggable="false"/>`:`<div class="liveEmpty">${st.online?'Open Unreal, Blender or Character Creator above. It appears here.':'Waiting for your PC…'}</div>`}
        ${LS.control?'<div class="ctlNote">You are controlling your PC. Press Esc twice to stop.</div>':''}</div>
      ${st.control===false?'<p class="badText small">Control was declined on your PC. Restart the Duke agent to be asked again.</p>':'<p class="muted small">The first time you use it here, your PC asks you to allow it. Only Unreal, Blender, Character Creator and Visual Studio windows are ever shown.</p>'}
    </div>
    <div class="sticky">
      <div class="card"><span class="eyebrow">STEP ${s.n} · ${ev.progress}% DONE</span><h3 style="margin:4px 0 8px">${esc(s.title)}</h3><ol class="how small">${s.how.map(h=>`<li>${terms(h,new Set(),2)}</li>`).join('')}</ol>
        ${proofs.length?proofs.map(c=>{const n=(R().proof[c.key]||[]).length;return `<button class="btn gold sm full" data-snap="${esc(c.key)}" ${st.online?'':'disabled'}>📸 Snap this for “${esc(c.label)}” (${n}/${c.min})</button>`;}).join(''):'<p class="muted small">This step has no screenshots to take. Use the steps above, then go back and tick the gate.</p>'}
        <button class="btn sm ghost full" data-go="${s.n}" style="margin-top:6px">Open step ${s.n} →</button></div>
      <div class="card"><h3>One-tap actions</h3><p class="muted small">Duke does these for you on your PC.</p>
        ${acts.map(a=>`<button class="actBtn" data-act="${a.id}" ${st.online?'':'disabled'}><b>${esc(a.label)}</b><span>${esc(a.plain)}</span></button>`).join('')||'<p class="muted small">Open a tool to see its actions.</p>'}
        ${LS.log.length?`<div class="actLog">${LS.log.slice(-5).reverse().map(l=>`<div class="${l.ok===false?'badText':l.ok?'okText':''}">${esc(l.text)}</div>`).join('')}</div>`:''}</div>
    </div></div>`;
  bindLink();
  const img=$('#liveImg');if(img&&!img.src.includes('/api/link/stream'))img.src=`/api/link/stream?t=${Date.now()}`;
  if(!LS.timer)LS.timer=setInterval(async()=>{if(S.view!=='link'||document.hidden)return;const before=JSON.stringify([LS.status?.online,LS.status?.windows,LS.status?.window,LS.status?.control]);await linkStatus();
    if(JSON.stringify([LS.status?.online,LS.status?.windows,LS.status?.window,LS.status?.control])!==before&&!$('#liveWrap')?.matches(':focus'))renderLink();
    else{const f=$('.liveBar .muted');if(f)f.textContent=LS.status.online&&LS.status.frameAge<5000?`Live · ${LS.status.fps||0} fps`:'';}},3000);
}
async function linkCmd(body,label){
  const r=await post('/api/link/command',body);if(body.type==='input')return;
  LS.log.push({text:`${label}…`});renderLink();
  for(let i=0;i<60;i++){await new Promise(x=>setTimeout(x,1000));const res=await api(`/api/link/result/${r.id}`);
    if(!res.pending){LS.log.push({text:res.output||label,ok:res.ok});await linkStatus();if(S.view==='link')renderLink();toast(res.output||label,!res.ok);return;}}
  LS.log.push({text:`${label}: no answer from your PC yet`,ok:false});if(S.view==='link')renderLink();
}
function bindLink(){
  $$('[data-go]').forEach(b=>b.onclick=()=>goStep(Number(b.dataset.go)));
  const proj=R().answers.project_path||'';
  $$('[data-launch]').forEach(b=>b.onclick=()=>linkCmd({type:'launch',tool:b.dataset.launch,project:proj},`Opening ${S.road.tools.find(t=>t.id===b.dataset.launch).name}`));
  $$('[data-showtool]').forEach(b=>b.onclick=()=>{const w=LS.status.windows.find(x=>x.tool===b.dataset.showtool);if(w)linkCmd({type:'focus',window:w.id},`Showing ${w.title}`);});
  $('#winPick')?.addEventListener('change',e=>linkCmd({type:'focus',window:e.target.value},'Switching window'));
  $$('[data-act]').forEach(b=>b.onclick=()=>{const a=S.road.actions.find(x=>x.id===b.dataset.act);linkCmd({type:'action',action:a.id,project:proj},a.label);});
  $$('[data-snap]').forEach(b=>b.onclick=async()=>{const r=await post(`/api/projects/${pid()}/link/snap`,{key:b.dataset.snap});await refreshRm(true);
    toast(r.completed?.length?`Saved. Step ${r.completed.at(-1)} complete!`:`Saved as proof (${r.count}).`);render();});
  $('#liveFull')?.addEventListener('click',()=>$('#liveWrap')?.requestFullscreen?.().catch(()=>{}));
  $('#ctlToggle')?.addEventListener('change',e=>{LS.control=e.target.checked;renderLink();if(LS.control)$('#liveWrap')?.focus();});
  const wrap=$('#liveWrap'),img=$('#liveImg');if(!wrap||!img||!LS.control)return;
  const pos=e=>{const r=img.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
  const btn=e=>['left','middle','right'][e.button]||'left';
  const send=e=>post('/api/link/command',{type:'input',e}).catch(()=>{});
  img.addEventListener('mousedown',e=>{e.preventDefault();wrap.focus();send({k:'down',b:btn(e),...pos(e)});});
  img.addEventListener('mouseup',e=>{e.preventDefault();send({k:'up',b:btn(e),...pos(e)});});
  img.addEventListener('mousemove',e=>{const t=performance.now();if(t-LS.lastMove<50)return;LS.lastMove=t;send({k:'move',...pos(e)});});
  img.addEventListener('contextmenu',e=>e.preventDefault());
  img.addEventListener('wheel',e=>{e.preventDefault();send({k:'wheel',d:Math.sign(e.deltaY)*Math.min(3,Math.ceil(Math.abs(e.deltaY)/100)),...pos(e)});},{passive:false});
  let lastEsc=0;
  wrap.addEventListener('keydown',e=>{
    if(e.key==='Escape'){const t=Date.now();if(t-lastEsc<600){LS.control=false;renderLink();return;}lastEsc=t;}
    e.preventDefault();send({k:'key',key:e.key,code:e.code,down:true});});
  wrap.addEventListener('keyup',e=>{e.preventDefault();send({k:'key',key:e.key,code:e.code,down:false});});
}


// ---------------------------------------------------------------- AI Team + Autopilot
const TM={data:null,adv:false,timer:null,file:null};
const money=n=>`$${(Number(n)||0).toFixed(2)}`;
const FLOW=[['Describe',[1]],['Build',[2,4,5,6,7]],['Play',[3]],['Refine',[8]],['Release',[9]]];
$('#teamBtn').onclick=async()=>{S.view='team';await loadTeam();render();$('#main').scrollTop=0;document.body.classList.remove('railOpen');};
async function loadTeam(){TM.data=await api(`/api/projects/${pid()}/team`);const ap=TM.data.team.autopilot;
  $('#teamDot').className='ldot '+(ap.state==='running'?'on':'');$('#teamSub').textContent=ap.state==='running'?`Autopilot on · ${TM.data.team.agents.length} agents`:'Agents that build day and night';}
function renderTeam(){
  const d=TM.data;if(!d){$('#stage').innerHTML='<p class="muted">Loading…</p>';return;}
  const t=d.team,ap=t.autopilot,phase=stepDef(S.rm.current).phase;const today=new Date().toISOString().slice(0,10);
  const paid=feat('build');const prov=d.providers;
  const flow=`<div class="flow">${FLOW.map(([n,ph])=>`<span class="${ph.includes(phase)?'on':''}">${n}</span>`).join('<i>→</i>')}</div>`;
  const runningT=t.tasks.filter(x=>x.status==='running');const needs=t.tasks.filter(x=>['needs_you','needs_review','blocked'].includes(x.status));
  const done=t.tasks.filter(x=>x.status==='done'&&!x.kind).slice(-12).reverse();const queued=t.tasks.filter(x=>x.status==='queued'||x.status==='review');
  const files=Object.entries(t.files).sort((a,b)=>b[1].at.localeCompare(a[1].at)).slice(0,14);
  const credOpts=d.creds.map(c=>`<option value="${c.id}">${esc(c.label)} · ${esc(prov[c.provider].name)}</option>`).join('');
  $('#stage').innerHTML=`<div class="stepHead"><div><span class="eyebrow">AI TEAM · OPTIONAL</span><h1>Your AI Team</h1>
      <p class="muted">Optional: connect AI accounts you already pay for, give each agent a job, and turn on <b>Autopilot</b>. They keep moving your game forward while you sleep and bring you only the decisions that matter. You can skip this and build everything yourself.</p>${flow}</div>
      <button class="btn sm ghost" data-go="${S.rm.current}">← Back to step ${S.rm.current}</button></div>
    ${!paid?`<div class="banner gold"><b>The AI Team is part of the Creator plan and up.</b> <button class="btn gold sm" data-plans="creator">See plans</button></div>`:''}
    <div class="teamGrid"><div>
    <div class="card"><div class="sectionTitle"><div><h2>1. Connect your AI accounts</h2><span class="muted small">Your keys are encrypted on our server and never shown again, never put in prompts or project files.</span></div></div>
      ${d.creds.length?`<div class="credList">${d.creds.map(c=>`<div class="cred"><b>${esc(c.label)}</b><span class="muted small">${esc(prov[c.provider].name)} · key ${esc(c.hint||'none')} ${c.lastTest?.ok?'<span class="okText">● connected</span>':c.lastTest?`<span class="badText">● ${esc(c.lastTest.error||'failed')}</span>`:''}</span>
        <span class="row gap6"><button class="btn sm" data-ctest="${c.id}">Test</button><button class="btn sm danger" data-cdel="${c.id}">Remove</button></span></div>`).join('')}</div>`:''}
      <details ${d.creds.length?'':'open'} class="addCred"><summary class="btn sm gold">+ Connect an AI account</summary>
        <div class="form" style="margin-top:12px"><div class="field"><label>Provider</label><select id="cProv">${Object.entries(prov).map(([k,v])=>`<option value="${k}">${esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Name (optional)</label><input id="cLabel" placeholder="e.g. My Claude key"/></div>
        <div class="field full"><label>API key</label><input id="cKey" type="password" autocomplete="off" placeholder="Paste your API key"/><span class="help" id="cHelp"></span></div>
        <div class="field full" id="cBaseWrap" style="display:none"><label>Endpoint base URL</label><input id="cBase" placeholder="https://api.llama.com/compat/v1 or http://your-server:11434/v1"/></div></div>
        <div class="row gap10" style="margin-top:10px"><button class="btn gold sm" id="cGo">Connect and test</button><span class="muted small" id="cMsg"></span></div></details></div>

    <div class="card"><div class="sectionTitle"><div><h2>2. Your agents</h2><span class="muted small">${t.agents.length} of ${d.limits.agents} agents on your plan · an agent can hold several roles</span></div>
      <div class="row gap6"><button class="btn gold sm" id="setupTeam" ${d.creds.length?'':'disabled'}>Set Up My Team</button>${d.creds.length?`<button class="btn sm" id="addAgent">+ Agent</button>`:''}</div></div>
      ${t.agents.length?t.agents.map(a=>{const cr=d.creds.find(c=>c.id===a.credId);const models=cr?.lastTest?.models||[a.model];const cur=runningT.find(x=>x.agentId===a.id);
        return `<div class="agent ${a.status}"><div class="row between gap10 wrap"><div><input class="aname" data-agent="${a.id}" data-k="name" value="${esc(a.name)}"/>
          <div class="muted small">${esc(prov[a.provider]?.name||a.provider)} · ${a.status==='disconnected'?'<span class="badText">disconnected</span>':a.status}${cur?` · <span class="okText">working on “${esc(cur.title)}”</span>`:''}</div></div>
          <div class="row gap6"><span class="chip">${money(a.spent)} of ${money(a.limitUSD)}</span>${a.status==='active'?`<button class="btn sm" data-astatus="${a.id}:paused">Pause</button>`:a.status==='paused'?`<button class="btn sm" data-astatus="${a.id}:active">Resume</button>`:''}<button class="btn sm danger" data-adel="${a.id}">Disconnect</button></div></div>
          <div class="roles">${Object.entries(d.roles).map(([k,r])=>`<label class="rchip ${a.roles.includes(k)?'on':''}" title="${esc(r.does)}"><input type="checkbox" data-role="${a.id}:${k}" ${a.roles.includes(k)?'checked':''}/>${esc(r.label)}</label>`).join('')}</div>
          ${TM.adv?`<div class="form advForm"><div class="field"><label>Connection</label><select data-agent="${a.id}" data-k="credId">${d.creds.map(c=>`<option value="${c.id}" ${c.id===a.credId?'selected':''}>${esc(c.label)}</option>`).join('')}</select></div>
            <div class="field"><label>Model</label><select data-agent="${a.id}" data-k="model">${models.map(m=>`<option ${m===a.model?'selected':''}>${esc(m)}</option>`).join('')}</select></div>
            <div class="field"><label>Monthly spending limit ($)</label><input type="number" min="0" step="1" data-agent="${a.id}" data-k="limitUSD" value="${a.limitUSD}"/></div>
            <div class="field"><label>Tasks at once</label><input type="number" min="1" max="4" data-agent="${a.id}" data-k="maxConcurrent" value="${a.maxConcurrent}"/></div>
            <div class="field"><label>Price per 1M input tokens ($)</label><input type="number" min="0" step="0.01" data-agent="${a.id}" data-k="priceIn" value="${a.priceIn}"/></div>
            <div class="field"><label>Price per 1M output tokens ($)</label><input type="number" min="0" step="0.01" data-agent="${a.id}" data-k="priceOut" value="${a.priceOut}"/></div>
            <div class="field full"><label>Tools this agent may use</label><div class="roles">${[...new Set(a.roles.flatMap(r=>d.roles[r].tools))].map(tl=>`<label class="rchip ${a.tools.includes(tl)?'on':''}"><input type="checkbox" data-tool="${a.id}:${tl}" ${a.tools.includes(tl)?'checked':''}/>${esc(tl.replace(/_/g,' '))}</label>`).join('')||'<span class="muted small">No tools for these roles</span>'}</div></div></div>`:''}
          </div>`;}).join(''):`<div class="empty">${d.creds.length?'Press <b>Set Up My Team</b>: Duke spreads the ten studio roles across the accounts you connected, with a separate independent tester.':'Connect at least one AI account first.'}</div>`}
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="advToggle" ${TM.adv?'checked':''}/><span></span>Show advanced settings (models, limits, prices, tools)</label>
      ${TM.adv?'<p class="muted small">Prices are estimates you can edit. Check your provider\'s pricing page; budgets are enforced using these numbers.</p>':''}</div>

    <div class="card"><h2>Tell the team what to change</h2><p class="muted small">Write it in plain words. The director turns it into revision work.</p>
      <div class="askRow"><input id="corrText" placeholder="e.g. Make the main character older and the tone less dark"/><button class="btn sm" id="corrGo">Send</button></div>
      ${t.corrections.slice(-3).reverse().map(c=>`<div class="muted small">“${esc(c.text)}” · ${esc(c.status)}</div>`).join('')}</div>
    </div>

    <div class="sticky">
      <div class="card autopilot ${ap.state}"><div class="sectionTitle"><h2>Autopilot</h2><span class="status ${ap.state==='running'?'succeeded':ap.state==='paused'?'running':'canceled'}">${ap.state.toUpperCase()}</span></div>
        ${ap.milestone?`<p class="small"><span class="muted">Next milestone:</span> <b>${esc(ap.milestone)}</b></p>`:''}
        ${ap.reason?`<p class="small ${ap.state==='paused'?'badText':'muted'}">${esc(ap.reason)}</p>`:''}
        <div class="row gap6 wrap">${ap.state==='running'?'<button class="btn sm" data-ap="pause">Pause</button>':`<button class="btn gold sm" data-ap="${ap.state==='paused'?'resume':'start'}" ${t.agents.length?'':'disabled'}>${ap.state==='paused'?'Resume':'Start Autopilot'}</button>`}${ap.state!=='stopped'?'<button class="btn sm danger" data-ap="stop">Stop</button>':''}</div>
        <div class="kv" style="margin-top:12px"><span>Spent today</span><span>${money(t.spend.days[today])} of ${money(ap.dailyLimit)}</span><span>Spent on project</span><span>${money(t.spend.total)} of ${money(ap.projectLimit)}</span>
          <span>Working now</span><span>${runningT.length} of ${ap.maxParallel} at once</span><span>Queue</span><span>${queued.length} waiting</span></div>
        <div class="form" style="margin-top:12px"><div class="field"><label>When</label><select id="apMode"><option value="always" ${ap.mode==='always'?'selected':''}>Day and night</option><option value="window" ${ap.mode==='window'?'selected':''}>Only between set hours</option></select></div>
          <div class="field"><label>Jobs at once</label><input id="apPar" type="number" min="1" max="8" value="${ap.maxParallel}"/></div>
          ${ap.mode==='window'?`<div class="field"><label>From</label><input id="apFrom" type="time" value="${ap.windowStart}"/></div><div class="field"><label>Until</label><input id="apTo" type="time" value="${ap.windowEnd}"/></div>`:''}
          <div class="field"><label>Daily limit ($)</label><input id="apDay" type="number" min="0" value="${ap.dailyLimit}"/></div><div class="field"><label>Project limit ($)</label><input id="apProj" type="number" min="0" value="${ap.projectLimit}"/></div></div>
        <p class="muted small" style="margin-top:8px">Autopilot runs on our servers, so it keeps going when you close this page. Work inside Unreal also needs your PC on with the Duke agent running ${d.pc.online?'<span class="okText">(your PC is connected)</span>':'<span class="badText">(your PC is offline)</span>'}.</p></div>

      ${needs.length||(t.humanSteps||[]).length?`<div class="card"><h2>Needs you</h2>
        ${(t.humanSteps||[]).map(h=>`<div class="need"><b>Only you can do this:</b> ${esc(h)}</div>`).join('')}
        ${needs.map(x=>x.status==='needs_you'?(()=>{const dd=t.decisions.find(z=>z.id===x.decisionId);return `<div class="need"><b>${esc(dd?.question||x.title)}</b><div class="row gap6 wrap" style="margin-top:6px">${(dd?.options||[]).map(o=>`<button class="btn sm" data-decide="${dd.id}" data-ans="${esc(o)}">${esc(o)}</button>`).join('')}<input class="decIn" data-decin="${dd?.id}" placeholder="Or type your answer"/></div></div>`;})()
          :x.status==='needs_review'?`<div class="need"><b>Approve: ${esc(x.title)}</b><p class="muted small">${esc(x.summary||'')} (no independent tester is free, so you review it)</p>${outputsHtml(x)}<div class="row gap6"><button class="btn gold sm" data-appr="${x.id}:1">Approve</button><button class="btn sm" data-appr="${x.id}:0">Send back</button></div></div>`
          :`<div class="need blocked"><b>Blocked: ${esc(x.title)}</b><p class="small badText">${esc(x.blocker||'')}</p></div>`).join('')}</div>`:''}

      <div class="card"><h2>What the team did</h2>${done.length?done.map(x=>`<div class="doneItem"><div class="row between"><b>${esc(x.title)}</b><span class="chip ok">✓ ${x.integratedBy==='you'?'approved by you':'tested'}</span></div>
        <div class="muted small">${esc(x.agentName||'')}${x.review?` · reviewed by ${esc(x.review.by)}: ${esc(x.review.notes||'pass')}`:''}</div>${(x.changed||[]).length?`<div class="small">${x.changed.map(esc).join(' · ')}</div>`:''}</div>`).join(''):'<p class="muted small">Nothing yet. Start Autopilot to see real work appear here.</p>'}</div>

      <div class="card"><h2>Files changed</h2>${files.length?files.map(([fp,f])=>`<button class="fileRow" data-file="${esc(fp)}"><span class="mono">${esc(fp)}</span><span class="muted small">v${f.version} · ${esc(f.by||'')}</span></button>`).join(''):'<p class="muted small">No files yet.</p>'}
        ${TM.file?`<div class="codeBox" style="margin-top:8px;max-height:300px">${esc(TM.file.content)}</div>`:''}
        <p class="muted small" style="margin-top:6px">${d.build?`Latest verified playable build: ${new Date(d.build.finishedAt||d.build.createdAt).toLocaleString()}.`:'No playable build yet. Files sync into your Unreal project through the Duke agent.'}</p></div>

      <div class="card"><h2>Activity</h2><div class="actLog">${t.log.slice(-14).reverse().map(l=>`<div class="${l.kind==='warn'?'badText':l.kind==='ok'?'okText':''}"><span class="muted">${new Date(l.at).toLocaleTimeString()}</span> ${esc(l.msg)}</div>`).join('')||'<span class="muted">Quiet so far.</span>'}</div></div>
    </div></div>`;
  bindTeam();
  clearInterval(TM.timer);TM.timer=setInterval(async()=>{if(S.view!=='team'||document.hidden)return;const a=document.activeElement;if(a&&a.closest('#stage')&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;
    const before=JSON.stringify(TM.data?.team);await loadTeam();if(JSON.stringify(TM.data.team)!==before)renderTeam();},4000);
}
function outputsHtml(x){return `<div class="small mono" style="margin:6px 0">${(x.outputs||[]).map(o=>o.type==='file'?`file ${esc(o.path)}`:o.type==='design'?`${esc(o.stage)}.${esc(o.key)}`:o.type==='answer'?`step ${o.step}: ${esc(o.key)}`:esc(o.type)).join(' · ')}</div>`;}
function bindTeam(){
  $$('[data-go]').forEach(b=>b.onclick=()=>goStep(Number(b.dataset.go)));$$('[data-plans]').forEach(b=>b.onclick=()=>plansModal(b.dataset.plans));
  const prov=TM.data.providers;const help=()=>{const k=$('#cProv')?.value;if(!k)return;$('#cHelp').innerHTML=`${esc(prov[k].billing)} ${prov[k].keyUrl?`<a href="${prov[k].keyUrl}" target="_blank" rel="noopener">Get a key ↗</a>`:''}`;$('#cBaseWrap').style.display=k==='llama'?'':'none';};
  $('#cProv')?.addEventListener('change',help);help();
  $('#cGo')?.addEventListener('click',async()=>{$('#cMsg').textContent='Testing the connection…';
    try{await post('/api/team/connections',{provider:$('#cProv').value,label:$('#cLabel').value,apiKey:$('#cKey').value,baseUrl:$('#cBase').value});$('#cKey').value='';await loadTeam();renderTeam();toast('Connected and tested');}
    catch(e){$('#cMsg').textContent=e.message;}});
  $$('[data-ctest]').forEach(b=>b.onclick=async()=>{b.textContent='Testing…';const r=await post(`/api/team/connections/${b.dataset.ctest}/test`);await loadTeam();renderTeam();toast(r.connection.lastTest.ok?'Connection works':r.connection.lastTest.error,!r.connection.lastTest.ok);});
  $$('[data-cdel]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this connection? Agents using it will be disconnected.'))return;await del(`/api/team/connections/${b.dataset.cdel}`);await loadTeam();renderTeam();});
  $('#setupTeam')?.addEventListener('click',async()=>{TM.data=await post(`/api/projects/${pid()}/team/setup`);renderTeam();toast('Your team is ready. Start Autopilot when you are.');});
  $('#addAgent')?.addEventListener('click',async()=>{TM.data=await post(`/api/projects/${pid()}/team/agents`,{credId:TM.data.creds[0].id,name:'New agent',roles:['content']});TM.adv=true;renderTeam();});
  const pa=(id,body)=>patch(`/api/projects/${pid()}/team/agents/${id}`,body).then(d=>{TM.data=d;renderTeam();});
  $$('[data-agent]').forEach(el=>el.addEventListener('change',()=>pa(el.dataset.agent,{[el.dataset.k]:el.value})));
  $$('[data-role]').forEach(cb=>cb.addEventListener('change',()=>{const [id,role]=cb.dataset.role.split(':');const a=TM.data.team.agents.find(x=>x.id===id);
    const roles=cb.checked?[...a.roles,role]:a.roles.filter(x=>x!==role);pa(id,{roles,tools:[...new Set(roles.flatMap(r=>TM.data.roles[r].tools))]});}));
  $$('[data-tool]').forEach(cb=>cb.addEventListener('change',()=>{const [id,tl]=cb.dataset.tool.split(':');const a=TM.data.team.agents.find(x=>x.id===id);pa(id,{tools:cb.checked?[...a.tools,tl]:a.tools.filter(x=>x!==tl)});}));
  $$('[data-astatus]').forEach(b=>b.onclick=()=>{const [id,st]=b.dataset.astatus.split(':');pa(id,{status:st});});
  $$('[data-adel]').forEach(b=>b.onclick=async()=>{if(!confirm('Disconnect this agent? Its open work goes back to the queue.'))return;TM.data=await del(`/api/projects/${pid()}/team/agents/${b.dataset.adel}`);renderTeam();});
  $('#advToggle')?.addEventListener('change',e=>{TM.adv=e.target.checked;renderTeam();});
  const settings=()=>({mode:$('#apMode').value,maxParallel:$('#apPar').value,dailyLimit:$('#apDay').value,projectLimit:$('#apProj').value,windowStart:$('#apFrom')?.value,windowEnd:$('#apTo')?.value,tzOffsetMin:new Date().getTimezoneOffset()});
  ['#apMode','#apPar','#apDay','#apProj','#apFrom','#apTo'].forEach(sel=>$(sel)?.addEventListener('change',async()=>{TM.data=await post(`/api/projects/${pid()}/team/autopilot`,{settings:settings()});renderTeam();}));
  $$('[data-ap]').forEach(b=>b.onclick=async()=>{if(b.dataset.ap==='stop'&&!confirm('Stop Autopilot and cancel the open tasks?'))return;TM.data=await post(`/api/projects/${pid()}/team/autopilot`,{action:b.dataset.ap,settings:settings()});await loadTeam();render();
    toast(b.dataset.ap==='start'||b.dataset.ap==='resume'?'Autopilot is on. It keeps working when you close this page.':'Autopilot '+b.dataset.ap+(b.dataset.ap==='stop'?'ped':'d'));});
  $('#corrGo')?.addEventListener('click',async()=>{const text=$('#corrText').value.trim();if(!text)return;TM.data=await post(`/api/projects/${pid()}/team/correct`,{text});renderTeam();toast('Sent to the director');});
  $$('[data-decide]').forEach(b=>b.onclick=async()=>{TM.data=await post(`/api/projects/${pid()}/team/decisions/${b.dataset.decide}`,{answer:b.dataset.ans});renderTeam();});
  $$('[data-decin]').forEach(i=>i.addEventListener('keydown',async e=>{if(e.key!=='Enter'||!i.value.trim())return;TM.data=await post(`/api/projects/${pid()}/team/decisions/${i.dataset.decin}`,{answer:i.value.trim()});renderTeam();}));
  $$('[data-appr]').forEach(b=>b.onclick=async()=>{const [id,okk]=b.dataset.appr.split(':');TM.data=await post(`/api/projects/${pid()}/team/tasks/${id}/approve`,{approve:okk==='1'});await refreshRm(true);renderTeam();});
  $$('[data-file]').forEach(b=>b.onclick=async()=>{TM.file=await api(`/api/projects/${pid()}/team/file?path=${encodeURIComponent(b.dataset.file)}`);renderTeam();});
}

// ---------------------------------------------------------------- plans + account
function plansModal(highlight){
  const b=S.me.billing;const iv=S.interval;
  const card=p=>{const cur=b.plan===p.id;const price=iv==='year'?p.year:p.month;
    return `<div class="planCard ${p.id===highlight?'hl':''} ${cur?'cur':''}"><h3>${esc(p.name)}</h3><p class="price"><b>$${price}</b>${p.month?`/${iv}`:''}</p><p class="muted small">${esc(p.blurb)}</p>
      ${p.id==='free'?(cur?'<span class="pill">CURRENT</span>':''):cur?'<span class="pill ok">CURRENT PLAN</span>':`<button class="btn gold sm" data-buy="${p.id}">${b.trialAvailable?'Start 7-day trial':'Choose '+esc(p.name)}</button>`}</div>`;};
  modal(`<div class="row between"><div><span class="eyebrow">PLANS</span><h2>Build the whole game</h2></div><button class="btn ghost sm" data-close>Close</button></div>
    <div class="ivToggle"><button data-iv="month" class="${iv==='month'?'on':''}">Monthly</button><button data-iv="year" class="${iv==='year'?'on':''}">Yearly · 2 months free</button></div>
    <div class="planGrid">${S.road.plans.map(card).join('')}</div>
    ${b.mode==='test'?'<p class="muted small">Test mode: payments are not connected on this server, so plans activate instantly for testing.</p>':b.mode==='off'?'<p class="badText small">Payments are not set up on this server yet.</p>':'<p class="muted small">Secure checkout by Stripe. Cancel anytime.</p>'}`,()=>{
    $$('[data-iv]').forEach(x=>x.onclick=()=>{S.interval=x.dataset.iv;plansModal(highlight);});
    $$('[data-buy]').forEach(x=>x.onclick=async()=>{x.disabled=true;x.textContent='Opening…';
      try{const r=await post('/api/billing/checkout',{plan:x.dataset.buy,interval:S.interval});
        if(r.url){location.href=r.url;return;}
        if(r.activated){closeModal();await refreshMe();await refreshRm(true);render();toast(`${planName(x.dataset.buy)} is active${r.status.sub?.status==='trialing'?' (7-day trial)':''}.`);}}
      catch(e){x.disabled=false;x.textContent='Try again';throw e;}});
  },true);
}
function accountModal(){
  const b=S.me.billing,u=S.me.user,c=b.credits;
  modal(`<div class="row between"><div><span class="eyebrow">ACCOUNT</span><h2>${esc(u.name||u.email)}</h2><p class="muted small">${esc(u.email)}</p></div><button class="btn ghost sm" data-close>Close</button></div>
    <div class="kv" style="margin-top:14px"><span>Plan</span><span><b>${esc(b.planName)}</b>${b.sub?` · ${esc(b.sub.status)}${b.sub.currentPeriodEnd?` · ${b.sub.cancelAtPeriodEnd?'ends':'renews'} ${new Date(b.sub.currentPeriodEnd).toLocaleDateString()}`:''}`:''}</span>
      <span>3D credits</span><span>${c?.total?`${c.left} of ${c.total} left this month`:'Included from the Creator plan'}</span>
      <span>Course mode</span><span>${b.features.course?'Included':'Academy plan'}</span><span>Expansion loop</span><span>${b.features.expansion?'Included':'Studio plan'}</span></div>
    <div class="row gap6 wrap" style="margin-top:18px"><button class="btn gold sm" id="accPlans">${b.plan==='studio'?'View plans':'Upgrade'}</button>${b.sub&&b.sub.status!=='canceled'?`<button class="btn sm" id="accManage">${b.mode==='test'?'Cancel plan (test mode)':'Manage billing'}</button>`:''}<a class="btn sm ghost" href="/guide" target="_blank" rel="noopener">Public guide ↗</a><button class="btn sm danger" id="accOut">Log out</button></div>`,()=>{
    $('#accPlans').onclick=()=>plansModal();
    $('#accManage')?.addEventListener('click',async()=>{const r=await post('/api/billing/portal');if(r.url)location.href=r.url;else{closeModal();await refreshMe();await refreshRm(true);render();toast('Plan canceled');}});
    $('#accOut').onclick=async()=>{await post('/api/auth/logout');location.href='/';};
  });
}

// ---------------------------------------------------------------- live preview, polling
let previewKey='';
function loadPreview(force){const f=$('#preview');const url=`/play.html?embed=1&project=${encodeURIComponent(pid())}&s=${P().world?.seed||7}`;if(force||previewKey!==url){previewKey=url;f.src=url;}}
function pushPreview(){$('#preview').contentWindow?.postMessage({type:'project',project:P()},'*');}
function toggleSide(show,noSave){$('#app').classList.toggle('noSide',!show);document.body.classList.toggle('noSideBody',!show);if(!noSave)try{localStorage.setItem('dukeNoSide',show?'0':'1')}catch{}}
$('#sideToggle').onclick=()=>toggleSide(false);$('#showSide').onclick=()=>toggleSide(true);$('#showSideM').onclick=()=>toggleSide($('#app').classList.contains('noSide'));
$('#previewFull').onclick=()=>{$('#preview').requestFullscreen?.().catch(()=>{});};
$('#railOpen').onclick=()=>document.body.classList.add('railOpen');$('#railClose').onclick=()=>document.body.classList.remove('railOpen');
const LIVE_PANELS=['machine','project','build','expansion'];
async function poll(){
  if(!S.project||document.hidden||$('#modal').classList.contains('open'))return;
  const s=stepDef(S.step);if(!s.panels.some(p=>LIVE_PANELS.includes(p.p)))return;
  const a=document.activeElement;if(a&&a.closest('#stage')&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;
  const before=JSON.stringify([S.rm,P().builds]);
  const v=await api(`/api/projects/${pid()}/roadmap`).catch(()=>null);if(!v)return;
  const was=S.rm.doneCount;apply(v,true);
  if(JSON.stringify([S.rm,P().builds])!==before){if(S.rm.doneCount>was)toast(`Step ${S.rm.current-1} complete. Step ${S.rm.current} is open.`);render();}
}

// ---------------------------------------------------------------- modal
function modal(html,after,wide){const m=$('#modal'),c=$('#modalCard');c.className='modalCard'+(wide?' wide':'');c.innerHTML=html;m.classList.add('open');
  c.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);after?.();}
function closeModal(){$('#modal').classList.remove('open');$('#modalCard').innerHTML='';}
$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#termPop').classList.remove('show');}});

boot();
