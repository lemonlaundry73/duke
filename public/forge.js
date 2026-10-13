// Duke Forger workspace: the web side of the closed loop (command -> orchestrator -> Unreal worker -> evidence).
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtB=n=>n==null?'':n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(2)} GB`;
const ago=t=>{if(!t)return '';const s=(Date.now()-new Date(t))/1000;return s<60?'just now':s<3600?`${Math.round(s/60)} min ago`:s<86400?`${Math.round(s/3600)} h ago`:new Date(t).toLocaleDateString();};
async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt,headers:{...(opt.body&&!(opt.body instanceof FormData)?{'content-type':'application/json'}:{}),...(opt.headers||{})}});
  if(r.status===401){location.href='/login?next=/forge';throw new Error('Log in');}
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;
}
const post=(u,b)=>api(u,{method:'POST',body:b instanceof FormData?b:JSON.stringify(b||{})});
function toast(m,bad){const t=$('#toast');t.textContent=m;t.className='show'+(bad?' bad':'');clearTimeout(t._t);t._t=setTimeout(()=>t.className='',5000);}

const SECTIONS=[['Build',[['command','Command Center'],['projects','Projects'],['live','Live Unreal']]],
  ['Project',[['files','File Vault'],['source','Source Editor'],['history','History']]],
  ['Content',[['concepts','Concept Studio'],['assets','Asset Library'],['world','World Browser'],['characters','Characters'],['vehicles','Vehicles & Ships'],['quests','Quests']]],
  ['Ship',[['builds','Builds'],['tests','Tests'],['logs','Logs'],['settings','Settings']]]];
const S={section:location.hash.slice(1)||'command',state:null,pid:localStorage.getItem('forge.pid')||null,proj:null,tree:null,file:null,concept:null};

function nav(){
  $('#sections').innerHTML=SECTIONS.map(([g,items])=>`<div class="grp">${g}</div>`+items.map(([id,l])=>`<button data-s="${id}" class="${S.section===id?'on':''}">${l}</button>`).join('')).join('');
  $$('#sections button').forEach(b=>b.onclick=()=>go(b.dataset.s));
}
function go(s){S.section=s;location.hash=s;nav();render();}
function workerBox(){
  const w=S.state?.worker;
  $('#workerBox').innerHTML=!w?'<span class="dot"></span>No Unreal worker yet. <a href="/api/agent/DukeForger.py">Get the Duke app</a> for your Windows PC.'
    :w.online?`<span class="dot on"></span><b>Unreal worker online</b><br>${w.hello?.engine?`Unreal ${esc(w.hello.engine)} · `:''}app ${esc(w.hello?.version||'?')}`
    :`<span class="dot"></span><b>Unreal worker offline</b><br>Start DukeForger.py on your PC. Jobs wait for it.`;
}
async function refresh(){
  S.state=await api('/api/forge/state');
  const ps=S.state.projects;if(!S.pid||!ps.some(p=>p.id===S.pid))S.pid=ps[0]?.id||null;
  $('#projPick').innerHTML=ps.length?ps.map(p=>`<option value="${p.id}" ${p.id===S.pid?'selected':''}>${esc(p.name)}${p.status!=='ready'?' (creating)':''}</option>`).join(''):'<option>No projects yet</option>';
  workerBox();
  if(S.pid){S.proj=await api(`/api/forge/projects/${S.pid}`);localStorage.setItem('forge.pid',S.pid);}else S.proj=null;
}
$('#projPick').onchange=async e=>{S.pid=e.target.value;S.tree=null;S.file=null;await refresh();render();};

function needProject(){if(S.proj)return false;$('#main').innerHTML=`<div class="head"><div><h1>Start a project</h1><p class="muted">Duke Forger creates a real Unreal Engine 5 C++ project on your Unreal worker.</p></div></div>${newProjectCard()}`;bindNew();return true;}
function newProjectCard(){return `<div class="card"><h2>New Unreal project</h2><div class="row"><input type="text" id="npName" placeholder="Project name, for example GalacticGame" maxlength="30" style="max-width:340px"/><button class="btn gold" id="npGo">Create project</button></div>
  <p class="muted small" style="margin-top:8px">Creates the project from the Duke Forger template, adds the Duke Forger Unreal plugin, turns on Git with LFS, compiles it, opens it in Unreal Editor with Pixel Streaming, builds a start map and commits. The first editor start compiles shaders, which can take 10 to 40 minutes.</p></div>`;}
function bindNew(){$('#npGo')?.addEventListener('click',async()=>{try{const r=await post('/api/forge/projects',{name:$('#npName').value});S.pid=r.project.id;await refresh();go('command');toast('Project created. Your Unreal worker is setting it up.');}catch(e){toast(e.message,true);}});}

// ---------------------------------------------------------------- Command Center
const ROLES=['Director','World builder','Gameplay engineer','Build engineer','QA'];
function agentStatus(j){
  const st={};for(const r of ROLES)st[r]='Waiting';
  if(!j)return st;st.Director=j.plan?'Planned':['READY','BLOCKED','STOPPED'].includes(j.state)?'Done':'Planning';
  for(const s of j.steps){const r=s.role||(s.kind==='ubt.build'||s.kind==='git.commit'||s.kind==='uat.package'?'Build engineer':s.kind==='test'?'QA':s.kind==='bridge'?'World builder':null);if(!r)continue;
    if(s.state==='running')st[r]='Working';else if(s.state==='failed')st[r]='Failed';else if(s.state==='done'&&st[r]!=='Working')st[r]='Done';}
  return st;
}
function jobCard(j,open){
  const done=j.steps.filter(s=>s.state==='done').length;
  return `<div class="card" id="job_${j.id}"><div class="row" style="justify-content:space-between"><div><b>${esc(j.title)}</b> <span class="muted small">· ${ago(j.createdAt)}${j.repairs?` · ${j.repairs} repair(s)`:''}</span></div><span class="state ${j.state}">${j.state}</span></div>
    ${j.reason?`<p class="${j.state==='BLOCKED'?'':'muted'} small" style="color:${j.state==='BLOCKED'?'var(--bad)':''};white-space:pre-wrap">${esc(j.reason)}</p>`:''}
    ${j.plan?`<p class="muted small">Plan by ${esc(j.plan.source)}: ${j.plan.tasks.map(t=>`<b>${esc(t.role)}</b> ${esc(t.title)}`).join(' → ')}</p>`:''}
    <div class="muted small">${done}/${j.steps.length} steps${j.commit?` · commit <span class="mono">${esc(j.commit.sha.slice(0,8))}</span>`:''}${j.tests.length?` · tests ${j.tests.filter(t=>t.passed).length}/${j.tests.length} passed`:''}</div>
    <details ${open?'open':''}><summary class="small muted" style="cursor:pointer;margin-top:6px">Steps and logs</summary><ul class="steps">${j.steps.map(s=>`<li><span class="si ${s.state}"></span><div>${esc(s.label)}${s.role?` <span class="muted small">· ${esc(s.role)}</span>`:''}${s.summary?`<div class="muted small">${esc(s.summary)}</div>`:''}${s.error?`<div class="small" style="color:var(--bad);white-space:pre-wrap">${esc(s.error.slice(0,1500))}</div>`:''}
      ${s.log?.length?`<details><summary class="small muted" style="cursor:pointer">Log (${s.log.length})</summary><pre class="log">${esc(s.log.join('\n'))}</pre></details>`:''}</div><span class="muted small">${s.attempts>1?`try ${s.attempts}`:''}</span></li>`).join('')}</ul></details>
    ${j.tests.map(t=>`<div class="small" style="margin-top:8px"><b>${t.passed?'✓':'✗'} ${esc(t.name)}</b> ${t.checks.map(c=>`<span class="badge ${c.ok?'ok':'bad'}">${esc(c.expr)}</span>`).join(' ')}</div>`).join('')}
    ${j.evidence.length?`<div class="ev">${j.evidence.map(e=>e.type==='screenshot'?`<a href="${esc(e.url)}" target="_blank"><img src="${esc(e.url)}" alt="${esc(e.name)}" loading="lazy"/></a>`:`<a class="btn sm" href="${esc(e.url)}" target="_blank">${esc(e.name)}</a>`).join('')}</div>`:''}
    ${!['READY','BLOCKED','STOPPED'].includes(j.state)?`<div class="row" style="margin-top:8px"><button class="btn sm danger" data-stop="${j.id}">Stop</button></div>`:''}</div>`;
}
function rCommand(){
  if(needProject())return;
  const p=S.proj.project,jobs=S.proj.jobs,cur=jobs.find(j=>!['READY','BLOCKED','STOPPED'].includes(j.state))||jobs[0];const st=agentStatus(cur);
  const lastBuild=S.proj.builds[0];const problems=jobs.filter(j=>j.state==='BLOCKED').length;
  $('#main').innerHTML=`<div class="head"><div><h1>${esc(p.name)}</h1><p class="muted">${p.status==='ready'?'Tell Duke Forger what to build. It plans, writes code, builds in Unreal, compiles, tests in Play-In-Editor, repairs, commits and shows the result.':'Your project is being created on your Unreal worker.'}</p></div>
    <div class="row"><button class="btn" data-go="live">View live</button><button class="btn" data-live="play" ${p.status!=='ready'?'disabled':''}>Play</button><button class="btn" data-go="files">Files</button><button class="btn" data-job="build" ${p.status!=='ready'?'disabled':''}>Build</button><button class="btn" data-go="history">History</button></div></div>
    <div class="grid2"><div class="card"><h2>Command</h2><div class="cmd"><textarea id="cmdText" placeholder="Create a room with a floor, four walls, two lights, a player start, a red cube, and a door that opens when the player approaches."></textarea></div>
      <div class="row" style="margin-top:8px"><button class="btn gold" id="cmdGo" ${p.status!=='ready'?'disabled':''}>Run</button><button class="btn" data-job="actor_test" ${p.status!=='ready'?'disabled':''}>Run acceptance test: actor → compile → PIE</button></div>
      ${S.state.hasModel?'':'<p class="muted small" style="margin-top:8px">No AI model connected: Duke Forger\'s built-in interpreter handles rooms (floor, walls, lights, player start, colored cube, a door that opens on approach). Connect a model in AI Team for anything else.</p>'}</div>
    <div class="card"><h2>Status</h2><div class="agents">${ROLES.map(r=>`<span>${r}</span><span>${st[r]}</span>`).join('')}
      <span>Current build</span><span>${lastBuild?`#${String(lastBuild.number).padStart(5,'0')}`:'none yet'}</span><span>Problems</span><span>${problems}</span></div></div></div>
    <h2 style="margin-top:6px">Jobs</h2>${jobs.length?jobs.map((j,i)=>jobCard(j,i===0)).join(''):'<p class="muted">No jobs yet.</p>'}`;
  $('#cmdGo')?.addEventListener('click',async()=>{const t=$('#cmdText').value.trim();if(!t)return toast('Type a command first',true);try{await post(`/api/forge/projects/${S.pid}/jobs`,{kind:'command',prompt:t});await refresh();render();}catch(e){toast(e.message,true);}});
  bindCommon();
}
function bindCommon(){
  $$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  $$('[data-job]').forEach(b=>b.onclick=async()=>{try{await post(`/api/forge/projects/${S.pid}/jobs`,{kind:b.dataset.job});toast('Queued for your Unreal worker.');await refresh();go('command');}catch(e){toast(e.message,true);}});
  $$('[data-stop]').forEach(b=>b.onclick=async()=>{await post(`/api/forge/jobs/${b.dataset.stop}/stop`);await refresh();render();});
  $$('[data-live]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await post(`/api/forge/projects/${S.pid}/live/${b.dataset.live}`);toast(b.dataset.live==='screenshot'&&r?.path?'Screenshot saved in the project (Saved/DukeForger/evidence).':'Done.');}catch(e){toast(e.message,true);}b.disabled=false;});
}

// ---------------------------------------------------------------- Projects
function rProjects(){
  const ps=S.state.projects;
  $('#main').innerHTML=`<div class="head"><div><h1>Projects</h1><p class="muted">Real Unreal Engine projects on your Unreal worker.</p></div></div>
    <div class="card"><table><tr><th>Project</th><th>Status</th><th>Folder on the worker</th><th>Updated</th></tr>${ps.map(p=>`<tr><td><a href="#" data-open="${p.id}">${esc(p.name)}</a></td><td><span class="state ${p.status==='ready'?'READY':'IMPLEMENTING'}">${p.status==='ready'?'READY':'CREATING'}</span></td><td class="mono">${esc(p.root||'—')}</td><td class="muted">${ago(p.updatedAt)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">None yet.</td></tr>'}</table></div>${newProjectCard()}`;
  $$('[data-open]').forEach(a=>a.onclick=async e=>{e.preventDefault();S.pid=a.dataset.open;S.tree=null;await refresh();go('command');});bindNew();
}

// ---------------------------------------------------------------- File Vault
function buildTree(files){const root={d:{},f:[]};for(const f of files){const parts=f.p.split('/');let n=root;for(const part of parts.slice(0,-1))n=n.d[part] ||= {d:{},f:[]};n.f.push({...f,name:parts.at(-1)});}return root;}
function treeHtml(n,path='',depth=0){
  const dirs=Object.keys(n.d).sort(),open=S.openDirs ||= new Set(['','@Duke']);
  return dirs.map(d=>{const p=path?`${path}/${d}`:d;const isOpen=open.has(p);const count=countFiles(n.d[d]);
    return `<div class="d" data-dir="${esc(p)}" style="padding-left:${depth*14}px">${isOpen?'▾':'▸'} ${esc(d)} <span class="sz">${count}</span></div>${isOpen?treeHtml(n.d[d],p,depth+1):''}`;}).join('')+
    n.f.sort((a,b)=>a.name.localeCompare(b.name)).map(f=>`<div class="f ${S.file?.path===f.p?'sel':''}" data-file="${esc(f.p)}" ${f.url?`data-url="${esc(f.url)}"`:''} style="padding-left:${depth*14+14}px">${esc(f.name)} <span class="sz">${fmtB(f.s)}</span></div>`).join('');
}
const countFiles=n=>n.f.length+Object.values(n.d).reduce((a,x)=>a+countFiles(x),0);
async function rFiles(){
  if(needProject())return;
  $('#main').innerHTML=`<div class="head"><div><h1>File Vault</h1><p class="muted">Every file of ${esc(S.proj.project.name)}: the Unreal project on your worker (code, content, maps, config, plugins, logs) plus concepts, builds and test evidence kept by Duke Forger.</p></div><div class="row"><button class="btn" id="treeReload">Refresh</button></div></div>
    <div class="split"><div class="card"><div id="tree" class="tree muted">Reading the project from your worker…</div></div><div id="viewer" class="card"><p class="muted">Pick a file.</p></div></div>`;
  $('#treeReload').onclick=()=>{S.tree=null;rFiles();};
  if(!S.tree){try{S.tree=await api(`/api/forge/projects/${S.pid}/tree`);}catch(e){$('#tree').textContent=e.message;return;}}
  const t=S.tree;const all=[...t.files,...t.extra];
  $('#tree').innerHTML=`${t.live?`<div class="small muted" style="margin-bottom:6px">Live from <span class="mono">${esc(t.root)}</span> · ${t.files.length} files</div>`:`<div class="small" style="color:var(--warn);margin-bottom:6px">${esc(t.error||'Worker offline')}${t.at?` Showing the copy from ${ago(t.at)}.`:''}</div>`}${treeHtml(buildTree(all))}`;
  bindTree();if(S.file)showFile(S.file.path);
}
function bindTree(){
  $$('#tree [data-dir]').forEach(d=>d.onclick=()=>{const p=d.dataset.dir;S.openDirs.has(p)?S.openDirs.delete(p):S.openDirs.add(p);rFiles();});
  $$('#tree [data-file]').forEach(f=>f.onclick=()=>f.dataset.url?openExtra(f.dataset.file,f.dataset.url):showFile(f.dataset.file));
}
function openExtra(name,url){
  $('#viewer').innerHTML=`<h3 class="mono">${esc(name)}</h3>${/\.png/.test(name)?`<img src="${esc(url)}" style="max-width:100%;border-radius:6px"/>`:''}<p><a class="btn" href="${esc(url)}" target="_blank">Open / download</a></p>`;
}
async function showFile(p){
  S.file={path:p};$('#viewer').innerHTML='<p class="muted">Opening…</p>';
  try{const f=await api(`/api/forge/projects/${S.pid}/file?path=${encodeURIComponent(p)}`);S.file=f;
    $('#viewer').innerHTML=`<div class="row" style="justify-content:space-between"><h3 class="mono" style="margin:0">${esc(p)}</h3><span class="muted small">${fmtB(f.size)}</span></div>
      ${f.image?`<img src="data:${f.mime};base64,${f.image}" style="max-width:100%;margin-top:10px;border-radius:6px"/>`:f.binary?`<p class="muted">Binary file${/\.(uasset|umap)$/.test(p)?' (Unreal asset, stored with Git LFS)':''}. It is versioned with the project.</p>`:
        `<pre class="log" style="max-height:520px">${esc(f.text.slice(0,200000))}</pre>${f.editable?`<div class="row" style="margin-top:8px"><button class="btn gold" id="editThis">Edit in Source Editor</button><button class="btn" id="histThis">History of this file</button></div>`:''}`}`;
    $('#editThis')?.addEventListener('click',()=>{S.source={path:p,text:f.text,orig:f.text};go('source');});
    $('#histThis')?.addEventListener('click',()=>{S.histPath=p;go('history');});
  }catch(e){$('#viewer').innerHTML=`<p style="color:var(--bad)">${esc(e.message)}</p>`;}
}

// ---------------------------------------------------------------- Source Editor
function diffHtml(text){return esc(text).split('\n').map(l=>/^\+(?!\+\+)/.test(l)?`<span class="a">${l}</span>`:/^-(?!--)/.test(l)?`<span class="r">${l}</span>`:/^(@@|diff |commit |index )/.test(l)?`<span class="h">${l}</span>`:l).join('\n');}
function rSource(){
  if(needProject())return;
  const src=S.source;
  $('#main').innerHTML=`<div class="head"><div><h1>Source Editor</h1><p class="muted">Edit text files of the Unreal project (C++, config, Python, docs). Save writes the file on your worker; Commit records it in Git.</p></div></div>
    <div class="card"><div class="row"><input type="text" id="srcPath" class="mono" placeholder="Path, for example Config/DefaultGame.ini" value="${esc(src?.path||'')}" style="max-width:520px"/><button class="btn" id="srcOpen">Open</button></div></div>
    ${src?`<div class="card"><textarea id="srcText" class="editor" spellcheck="false">${esc(src.text)}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn gold" id="srcSave">Save</button><input type="text" id="srcMsg" placeholder="Commit message" style="max-width:420px"/><button class="btn" id="srcCommit">Commit</button><span class="muted small" id="srcState"></span></div></div>
      <div class="card"><h3>Changes since the last commit</h3><div id="srcDiff" class="diff muted">Save to see the diff.</div></div>`:''}`;
  $('#srcOpen').onclick=async()=>{try{const f=await api(`/api/forge/projects/${S.pid}/file?path=${encodeURIComponent($('#srcPath').value)}`);if(f.binary||f.image)return toast('That is not a text file',true);S.source={path:f.path,text:f.text,orig:f.text};rSource();}catch(e){toast(e.message,true);}};
  $('#srcText')?.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const t=e.target,s=t.selectionStart;t.setRangeText('\t',s,t.selectionEnd,'end');}});
  $('#srcSave')?.addEventListener('click',async()=>{try{const r=await post(`/api/forge/projects/${S.pid}/file`,{path:src.path,content:$('#srcText').value});src.text=$('#srcText').value;$('#srcDiff').innerHTML=r.diff?diffHtml(r.diff):'No changes from the last commit.';$('#srcState').textContent='Saved';S.tree=null;}catch(e){toast(e.message,true);}});
  $('#srcCommit')?.addEventListener('click',async()=>{try{const r=await post(`/api/forge/projects/${S.pid}/commit`,{message:$('#srcMsg').value||`Edit ${src.path}`,paths:[src.path]});toast(r.summary);$('#srcState').textContent=r.summary;}catch(e){toast(e.message,true);}});
}

// ---------------------------------------------------------------- History
async function rHistory(){
  if(needProject())return;
  $('#main').innerHTML=`<div class="head"><div><h1>History</h1><p class="muted">Every commit${S.histPath?` that touched <span class="mono">${esc(S.histPath)}</span> <a href="#" id="histAll">(show all)</a>`:''}. Open one to see its diff, or roll it back. A rollback is a new commit, so nothing is lost.</p></div></div>
    <div class="split"><div class="card" id="commits">Loading…</div><div class="card" id="commitView"><p class="muted">Pick a commit.</p></div></div>`;
  $('#histAll')?.addEventListener('click',e=>{e.preventDefault();S.histPath=null;rHistory();});
  try{const r=await api(`/api/forge/projects/${S.pid}/history${S.histPath?`?path=${encodeURIComponent(S.histPath)}`:''}`);
    $('#commits').innerHTML=r.commits.length?`<table>${r.commits.map(c=>`<tr><td><a href="#" data-sha="${c.sha}" class="mono">${c.sha.slice(0,8)}</a></td><td>${esc(c.message)}<div class="muted small">${esc(c.author)} · ${ago(c.date)}</div></td></tr>`).join('')}</table>`:'<p class="muted">No commits yet.</p>';
    $$('[data-sha]').forEach(a=>a.onclick=async e=>{e.preventDefault();const sha=a.dataset.sha;$('#commitView').innerHTML='Loading…';
      const d=await api(`/api/forge/projects/${S.pid}/diff?rev=${sha}${S.histPath?`&path=${encodeURIComponent(S.histPath)}`:''}`);
      $('#commitView').innerHTML=`<div class="row" style="justify-content:space-between"><h3 class="mono" style="margin:0">${sha.slice(0,12)}</h3><div class="row">${S.histPath?`<button class="btn" id="restoreFile">Restore ${esc(S.histPath.split('/').pop())} to this version</button>`:''}<button class="btn danger" id="revertC">Roll back this commit</button></div></div><div class="diff" style="margin-top:8px">${diffHtml(d.diff)}</div>`;
      $('#revertC').onclick=async()=>{if(!confirm('Undo this commit with a new commit?'))return;try{const r2=await post(`/api/forge/projects/${S.pid}/rollback`,{rev:sha});toast(r2.summary||'Rolled back');S.tree=null;rHistory();}catch(e2){toast(e2.message,true);}};
      $('#restoreFile')?.addEventListener('click',async()=>{try{const r2=await post(`/api/forge/projects/${S.pid}/rollback`,{rev:sha,path:S.histPath});toast(r2.summary);rHistory();}catch(e2){toast(e2.message,true);}});});
  }catch(e){$('#commits').innerHTML=`<p style="color:var(--bad)">${esc(e.message)}</p>`;}
}

// ---------------------------------------------------------------- Concept Studio
const CATS=['character','weapon','vehicle','ship','building','planet','creature','environment','ui','prop'];
function rConcepts(){
  if(needProject())return;
  const cs=S.proj.concepts;const c=S.concept&&cs.find(x=>x.id===S.concept);
  if(c)return conceptDetail(c);
  $('#main').innerHTML=`<div class="head"><div><h1>Concept Studio</h1><p class="muted">Concept art for every part of the game. Edits are never destructive: every version is kept, compared and approved.</p></div></div>
    <div class="card"><h2>New concept</h2><div class="grid3"><input type="text" id="ncName" placeholder="Name, for example Rebel armor"/><select id="ncCat" class="in">${CATS.map(x=>`<option>${x}</option>`).join('')}</select><input type="file" id="ncFile" accept="image/png,image/jpeg,image/webp"/></div>
      <input type="text" id="ncNote" placeholder="Description or the prompt it was made from (kept as provenance)" style="margin-top:8px"/><div class="row" style="margin-top:8px"><button class="btn gold" id="ncGo">Add concept</button></div></div>
    <div class="concepts">${cs.map(x=>{const rv=x.revisions.find(r=>r.n===x.approved)||x.revisions.at(-1);return `<div class="c" data-c="${x.id}"><img src="${esc(rv.url)}" alt=""/><div><b>${esc(x.name)}</b><div class="muted small">${x.category} · ${x.revisions.length} version(s) ${x.approved?'<span class="badge ok">approved</span>':''}</div></div></div>`;}).join('')||'<p class="muted">No concepts yet.</p>'}</div>`;
  $('#ncGo').onclick=async()=>{const f=$('#ncFile').files[0];if(!f)return toast('Pick an image',true);const fd=new FormData();fd.append('name',$('#ncName').value||f.name.replace(/\.\w+$/,''));fd.append('category',$('#ncCat').value);fd.append('note',$('#ncNote').value||'Original');fd.append('prompt',$('#ncNote').value);fd.append('file',f);
    try{const r=await post(`/api/forge/projects/${S.pid}/concepts`,fd);await refresh();S.concept=r.concept.id;rConcepts();}catch(e){toast(e.message,true);}};
  $$('[data-c]').forEach(d=>d.onclick=()=>{S.concept=d.dataset.c;rConcepts();});
}
function conceptDetail(c){
  S.cmpA ??= c.revisions[0].n;S.cmpB ??= c.revisions.at(-1).n;
  const A=c.revisions.find(r=>r.n===S.cmpA)||c.revisions[0],B=c.revisions.find(r=>r.n===S.cmpB)||c.revisions.at(-1);
  const revCard=r=>`<div><img src="${esc(r.url)}"/><div class="row" style="margin-top:6px;justify-content:space-between"><b>Version ${r.n}</b><span class="badge ${r.status==='approved'?'ok':r.status==='rejected'?'bad':''}">${r.status}</span></div>
    <div class="muted small">${esc(r.note)}${r.parent?` · from v${r.parent}`:''} · ${esc(r.source)} · ${ago(r.at)}</div>
    <div class="row" style="margin-top:6px">${r.status!=='approved'?`<button class="btn sm gold" data-approve="${r.n}">Approve</button>`:''}${r.status==='review'?`<button class="btn sm" data-reject="${r.n}">Reject</button>`:''}</div></div>`;
  $('#main').innerHTML=`<div class="head"><div><a href="#" id="cBack" class="small">← All concepts</a><h1>${esc(c.name)}</h1><p class="muted">${c.category} · ${c.revisions.length} version(s) · ${c.approved?`version ${c.approved} approved and registered in the Asset Library`:'not approved yet'}</p></div></div>
    <div class="card"><h3>Versions</h3><div class="rev">${c.revisions.map(r=>`<div class="r ${r.n===A.n||r.n===B.n?'on':''}" data-pick="${r.n}"><img src="${esc(r.url)}"/><small>v${r.n} · ${r.status}</small></div>`).join('')}</div><p class="muted small">Click two versions to compare them.</p></div>
    <div class="card"><div class="compare">${revCard(A)}${revCard(B)}</div></div>
    <div class="card"><h2>Edit concept</h2><p class="muted small">Make a new version from version <b>${(c.approved||B.n)}</b>. The original stays untouched.</p>
      <div class="grid2"><div><h3>Adjust</h3>
        <label class="tog">Hue shift <input type="range" id="adHue" min="-180" max="180" value="0"/></label><label class="tog">Saturation <input type="range" id="adSat" min="0" max="200" value="100"/></label>
        <label class="tog">Brightness <input type="range" id="adBri" min="40" max="160" value="100"/></label><label class="tog">Tint <input type="color" id="adTint" value="#ffffff"/> strength <input type="range" id="adTintA" min="0" max="80" value="0"/></label>
        <label class="tog"><input type="checkbox" id="adFlip"/> Mirror</label><input type="text" id="adNote" placeholder="What changed (for example: visor from red to blue)"/>
        <div class="row" style="margin-top:8px"><button class="btn gold" id="adSave">Save as new version</button></div></div>
        <div><h3>Preview</h3><canvas id="adCanvas" style="width:100%;border-radius:6px;border:1px solid var(--line);background:#070c16"></canvas></div></div>
      <h3 style="margin-top:14px">Or upload a new version</h3><div class="row"><input type="file" id="upFile" accept="image/png,image/jpeg,image/webp"/><input type="text" id="upNote" placeholder="What changed" style="max-width:360px"/><button class="btn" id="upGo">Add version</button></div></div>`;
  $('#cBack').onclick=e=>{e.preventDefault();S.concept=null;S.cmpA=S.cmpB=null;rConcepts();};
  $$('[data-pick]').forEach(d=>d.onclick=()=>{const n=Number(d.dataset.pick);S.cmpA=S.cmpB;S.cmpB=n;conceptDetail(c);});
  const review=async(n,decision)=>{try{await post(`/api/forge/concepts/${c.id}/review`,{n,decision});await refresh();rConcepts();toast(decision==='approve'?'Approved and registered in the Asset Library.':'Marked rejected.');}catch(e){toast(e.message,true);}};
  $$('[data-approve]').forEach(b=>b.onclick=()=>review(Number(b.dataset.approve),'approve'));$$('[data-reject]').forEach(b=>b.onclick=()=>review(Number(b.dataset.reject),'reject'));
  const base=c.revisions.find(r=>r.n===(c.approved||B.n));const img=new Image();img.src=base.url;const cv=$('#adCanvas');
  const draw=()=>{if(!img.complete)return;cv.width=img.naturalWidth;cv.height=img.naturalHeight;const x=cv.getContext('2d');x.save();
    if($('#adFlip').checked){x.translate(cv.width,0);x.scale(-1,1);}
    x.filter=`hue-rotate(${$('#adHue').value}deg) saturate(${$('#adSat').value}%) brightness(${$('#adBri').value}%)`;x.drawImage(img,0,0);x.restore();
    const a=$('#adTintA').value/100;if(a>0){x.globalCompositeOperation='color';x.globalAlpha=a;x.fillStyle=$('#adTint').value;x.fillRect(0,0,cv.width,cv.height);x.globalCompositeOperation='source-over';x.globalAlpha=1;}};
  img.onload=draw;['adHue','adSat','adBri','adTint','adTintA','adFlip'].forEach(id=>$('#'+id).oninput=draw);
  const addVersion=async(blob,note,source)=>{const fd=new FormData();fd.append('note',note);fd.append('source',source);fd.append('parent',String(base.n));fd.append('file',blob,'variation.png');
    try{await post(`/api/forge/concepts/${c.id}/revisions`,fd);await refresh();S.cmpA=base.n;S.cmpB=null;const nc=S.proj.concepts.find(x=>x.id===c.id);S.cmpB=nc.revisions.at(-1).n;rConcepts();toast('New version added. Compare and approve it.');}catch(e){toast(e.message,true);}};
  $('#adSave').onclick=()=>{draw();const note=$('#adNote').value||`Adjusted: hue ${$('#adHue').value}°, saturation ${$('#adSat').value}%, brightness ${$('#adBri').value}%`;cv.toBlob(b=>addVersion(b,note,'Concept Studio adjust'),'image/png');};
  $('#upGo').onclick=()=>{const f=$('#upFile').files[0];if(!f)return toast('Pick an image',true);addVersion(f,$('#upNote').value||'New version','upload');};
}

// ---------------------------------------------------------------- Asset Library and browsers
function rAssets(filter,title,blurb){
  if(needProject())return;
  let as=S.proj.assets;if(filter)as=as.filter(filter);
  $('#main').innerHTML=`<div class="head"><div><h1>${title||'Asset Library'}</h1><p class="muted">${blurb||'Every registered asset with its source, Unreal path, revision and provenance. Statuses are only shown once actually validated.'}</p></div></div>
    <div class="card"><table><tr><th></th><th>Name</th><th>Type</th><th>Status</th><th>Revision</th><th>Project path / Unreal path</th><th>Provenance</th><th>Updated</th></tr>
    ${as.map(a=>`<tr><td>${a.thumbnail?`<img src="${esc(a.thumbnail)}" style="width:56px;height:56px;object-fit:cover;border-radius:4px"/>`:''}</td><td><b>${esc(a.name)}</b><div class="muted small mono">${a.id}</div></td><td>${esc(a.type)}</td><td><span class="badge">${esc(a.status)}</span></td><td>v${a.revision}</td>
      <td class="mono small">${esc(a.projectPath||'')}<br>${esc(a.unrealPath||'not in Unreal yet')}</td><td class="small">${esc(a.provenance?.source||'')}${a.prompt?`<div class="muted">${esc(a.prompt.slice(0,120))}</div>`:''}</td><td class="muted small">${ago(a.updatedAt)}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">Nothing here yet.</td></tr>'}</table></div>`;
}
async function rWorld(){
  if(needProject())return;
  $('#main').innerHTML=`<div class="head"><div><h1>World Browser</h1><p class="muted">Every level (map) in the project. Open one in Live Unreal.</p></div></div><div class="card" id="maps">Reading maps…</div>`;
  try{S.tree ||= await api(`/api/forge/projects/${S.pid}/tree`);const maps=S.tree.files.filter(f=>/^Content\/.*\.umap$/.test(f.p));
    $('#maps').innerHTML=maps.length?`<table><tr><th>Map</th><th>Size</th><th>Changed</th><th></th></tr>${maps.map(m=>{const up='/Game/'+m.p.replace(/^Content\//,'').replace(/\.umap$/,'');return `<tr><td class="mono">${esc(up)}</td><td>${fmtB(m.s)}</td><td class="muted">${ago(m.m)}</td><td><button class="btn sm" data-map="${esc(up)}">Open in Live Unreal</button></td></tr>`;}).join('')}</table>`:'<p class="muted">No maps yet.</p>';
    $$('[data-map]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await post(`/api/forge/projects/${S.pid}/live/open_map`,{map:b.dataset.map});go('live');}catch(e){toast(e.message,true);}b.disabled=false;});
  }catch(e){$('#maps').textContent=e.message;}
}
async function rFolderBrowser(kind,title,re,cats){
  if(needProject())return;
  $('#main').innerHTML=`<div class="head"><div><h1>${title}</h1><p class="muted">${title} in the Unreal project and their concepts.</p></div></div><div class="card" id="fb">Reading…</div>`;
  let files=[];try{S.tree ||= await api(`/api/forge/projects/${S.pid}/tree`);files=S.tree.files.filter(f=>re.test(f.p));}catch{}
  const concepts=S.proj.concepts.filter(c=>cats.includes(c.category));
  $('#fb').innerHTML=`<h3>Concepts</h3>${concepts.length?`<div class="concepts">${concepts.map(c=>{const rv=c.revisions.find(r=>r.n===c.approved)||c.revisions.at(-1);return `<div class="c" data-cc="${c.id}"><img src="${esc(rv.url)}"/><div><b>${esc(c.name)}</b><div class="muted small">${c.category}${c.approved?' · approved':''}</div></div></div>`;}).join('')}</div>`:`<p class="muted">No ${kind} concepts yet. Add them in Concept Studio.</p>`}
    <h3 style="margin-top:14px">In Unreal</h3>${files.length?`<table>${files.map(f=>`<tr><td class="mono">${esc(f.p)}</td><td>${fmtB(f.s)}</td></tr>`).join('')}</table>`:`<p class="muted">No ${kind} assets in the Unreal project yet.</p>`}`;
  $$('[data-cc]').forEach(d=>d.onclick=()=>{S.concept=d.dataset.cc;go('concepts');});
}

// ---------------------------------------------------------------- Live Unreal
async function rLive(){
  if(needProject())return;
  let st={};try{st=await api('/api/link/status');}catch{}
  const relay=st.pixel?.relay;const ready=S.proj.project.status==='ready';
  $('#main').innerHTML=`<div class="head"><div><h1>Live Unreal</h1><p class="muted">The real Unreal Editor running ${esc(S.proj.project.name)} on your Unreal worker${relay?', streamed with Epic\'s Pixel Streaming. Click into it to use it.':'.'}</p></div></div>
    <div class="card"><div class="row"><button class="btn gold" data-live="play" ${ready?'':'disabled'}>▶ Play (PIE)</button><button class="btn" data-live="stop" ${ready?'':'disabled'}>■ Stop</button><button class="btn" data-live="save" ${ready?'':'disabled'}>Save</button>
      <button class="btn" data-job="compile" ${ready?'':'disabled'}>Compile</button><button class="btn" data-live="screenshot" ${ready?'':'disabled'}>Screenshot</button><button class="btn" data-job="actor_test" ${ready?'':'disabled'}>Run test</button><button class="btn" data-job="build" ${ready?'':'disabled'}>Package build</button><button class="btn" data-job="open" ${ready?'':'disabled'}>Open editor</button><button class="btn" data-job="restart" ${ready?'':'disabled'}>Restart editor</button></div></div>
    <div class="live">${relay?`<iframe src="${esc(relay)}" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write" title="Unreal Editor (Pixel Streaming)"></iframe>`:st.online&&(st.windows||[]).some(w=>w.tool==='ue')?`<img src="/api/link/stream?t=${Date.now()}" alt="Unreal Editor live view"/>`:`<div class="empty">${st.online?'Unreal Editor is not streaming yet. Press "Open editor"; Pixel Streaming starts with it.':'Your Unreal worker is offline. Start DukeForger.py on your Windows PC.'}</div>`}</div>
    <p class="muted small">${relay?'Pixel Streaming: the picture and your input go directly between your browser and the Unreal worker.':st.online?'Showing the editor window picture until Pixel Streaming is running.':''} ${relay?`<a href="${esc(relay)}" target="_blank">Open full screen</a>`:''}</p>`;
  bindCommon();
}

// ---------------------------------------------------------------- Builds, Tests, Logs, Settings
function rBuilds(){
  if(needProject())return;
  const bs=S.proj.builds;
  $('#main').innerHTML=`<div class="head"><div><h1>Builds</h1><p class="muted">Playable Windows builds packaged by Unreal AutomationTool on your worker. Logs are kept with each build.</p></div><div class="row"><button class="btn gold" data-job="build" ${S.proj.project.status!=='ready'?'disabled':''}>Package a Windows build</button></div></div>
    <div class="card"><table><tr><th>Build</th><th>Platform</th><th>Config</th><th>Size</th><th>Made</th><th></th></tr>${bs.map(b=>{const j=S.proj.jobs.find(x=>x.id===b.jobId);const log=j?.evidence.find(e=>e.type==='log');
      return `<tr><td>#${String(b.number).padStart(5,'0')}</td><td>${b.platform}</td><td>${b.config}</td><td>${fmtB(b.size)}</td><td class="muted">${ago(b.createdAt)}</td><td><a class="btn sm gold" href="${b.url}">Download</a> ${log?`<a class="btn sm" href="${esc(log.url)}" target="_blank">Build log</a>`:''}</td></tr>`;}).join('')||'<tr><td colspan="6" class="muted">No builds yet.</td></tr>'}</table></div>
    ${S.proj.jobs.filter(j=>j.kind==='build').slice(0,5).map(j=>jobCard(j,false)).join('')}`;
  bindCommon();
}
function rTests(){
  if(needProject())return;
  const rows=S.proj.jobs.flatMap(j=>j.tests.map(t=>({...t,job:j})));
  $('#main').innerHTML=`<div class="head"><div><h1>Tests</h1><p class="muted">Play-In-Editor tests run by the QA agent, with the values they measured and screenshots.</p></div><div class="row"><button class="btn" data-job="actor_test" ${S.proj.project.status!=='ready'?'disabled':''}>Run the actor acceptance test</button></div></div>
    <div class="card"><table><tr><th>Result</th><th>Test</th><th>Checks</th><th>Measured</th><th>When</th></tr>${rows.map(t=>`<tr><td><span class="state ${t.passed?'READY':'BLOCKED'}">${t.passed?'PASSED':'FAILED'}</span></td><td>${esc(t.name)}<div class="muted small">${esc(t.job.title)}</div></td>
      <td>${t.checks.map(c=>`<div class="small">${c.ok?'✓':'✗'} <span class="mono">${esc(c.expr)}</span></div>`).join('')}</td><td class="mono small">${esc(Object.entries(t.vars).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('  ').slice(0,400))}</td><td class="muted small">${ago(t.at)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No tests yet.</td></tr>'}</table></div>`;
  bindCommon();
}
async function rLogs(){
  if(needProject())return;
  $('#main').innerHTML=`<div class="head"><div><h1>Logs</h1><p class="muted">The Unreal Editor log from your worker, classified. Job step logs are on each job in the Command Center.</p></div><div class="row"><select id="lvl" class="in" style="width:auto"><option value="">Everything</option><option value="err">Errors only</option><option value="warn">Warnings and errors</option></select><button class="btn" id="lgRe">Refresh</button></div></div><div class="card"><div id="lg" class="lvl">Loading…</div></div>`;
  const load=async()=>{try{const r=await api(`/api/forge/projects/${S.pid}/logs`);const f=$('#lvl').value;
    const lines=r.lines.filter(l=>!f||(f==='err'?/ERROR|CRASH/.test(l.level):l.level!=='INFO'));
    $('#lg').innerHTML=lines.length?lines.map(l=>`<div class="${l.level}">${l.level==='INFO'?'':`[${l.level}] `}${esc(l.text)}</div>`).join(''):'<span class="muted">Nothing to show.</span>';}catch(e){$('#lg').textContent=e.message;}};
  $('#lgRe').onclick=load;$('#lvl').onchange=load;load();
}
function rSettings(){
  if(needProject())return;
  const s=S.proj.project.settings;
  $('#main').innerHTML=`<div class="head"><div><h1>Settings</h1><p class="muted">Project configuration Duke Forger follows. Autonomy settings control the repair loop and when work counts as READY.</p></div><button class="btn gold" id="setSave">Save</button></div>
    <div class="grid2">${Object.entries(s).map(([sec,vals])=>`<div class="card"><h3>${sec}</h3>${Object.entries(vals).map(([k,v])=>typeof v==='boolean'?`<label class="tog"><input type="checkbox" data-k="${sec}.${k}" ${v?'checked':''}/> ${k.replace(/_/g,' ')}</label>`:
      `<label class="tog" style="justify-content:space-between">${k.replace(/_/g,' ')} <input type="${typeof v==='number'?'number':'text'}" data-k="${sec}.${k}" value="${esc(Array.isArray(v)?v.join(','):v)}" style="max-width:160px"/></label>`).join('')}</div>`).join('')}</div>`;
  $('#setSave').onclick=async()=>{const out={};$$('[data-k]').forEach(i=>{const [sec,k]=i.dataset.k.split('.');out[sec] ||= {};const d=s[sec][k];out[sec][k]=i.type==='checkbox'?i.checked:typeof d==='number'?Number(i.value):Array.isArray(d)?i.value.split(',').map(x=>x.trim()).filter(Boolean):i.value;});
    try{await api(`/api/forge/projects/${S.pid}/settings`,{method:'PATCH',body:JSON.stringify(out)});await refresh();toast('Saved');}catch(e){toast(e.message,true);}};
}

function render(){
  const f={command:rCommand,projects:rProjects,files:rFiles,source:rSource,history:rHistory,concepts:rConcepts,assets:()=>rAssets(),live:rLive,builds:rBuilds,tests:rTests,logs:rLogs,settings:rSettings,world:rWorld,
    characters:()=>rFolderBrowser('character','Characters',/^Content\/.*(Characters?|Heroes|NPCs?)\/.*\.uasset$/i,['character','creature']),
    vehicles:()=>rFolderBrowser('vehicle and ship','Vehicles & Ships',/^Content\/.*(Vehicles?|Ships?|Spacecraft)\/.*\.uasset$/i,['vehicle','ship']),
    quests:()=>rFolderBrowser('quest','Quests',/^(Content\/.*(Quests?|Missions?)\/.*\.uasset|Content\/Data\/Quests\/.*\.json)$/i,[])}[S.section]||rCommand;
  f();
}
// Live job updates
function stream(){
  const es=new EventSource('/api/forge/events');
  es.onmessage=e=>{const ev=JSON.parse(e.data);if(ev.type!=='job'||!S.proj||ev.job.projectId!==S.pid)return;
    const i=S.proj.jobs.findIndex(j=>j.id===ev.job.id);if(i>=0)S.proj.jobs[i]=ev.job;else S.proj.jobs.unshift(ev.job);
    if(ev.job.state==='READY'&&ev.job.kind==='create_project')refresh().then(render);
    if(['command','tests','builds'].includes(S.section)&&!document.activeElement?.matches('textarea,input')){const open=new Set($$('details[open]').map(d=>d.closest('.card')?.id));render();
      $$('details').forEach(d=>{if(open.has(d.closest('.card')?.id))d.open=true;});}};
  es.onerror=()=>{es.close();setTimeout(stream,5000);};
}
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(h&&h!==S.section)go(h);});
(async()=>{nav();try{await refresh();}catch(e){$('#main').innerHTML=`<p class="pad">${esc(e.message)}</p>`;return;}render();stream();setInterval(()=>api('/api/forge/state').then(s=>{S.state=s;workerBox();}).catch(()=>{}),15000);})();
