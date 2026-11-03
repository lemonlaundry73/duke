// Duke Local assistant page: everything shown here comes from the backend on this PC.
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let CSRF='',ST=null,TASKS=[];const open=new Set();
async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',...o,headers:{...(o.body&&!(o.body instanceof FormData)?{'content-type':'application/json'}:{}),...(o.method&&o.method!=='GET'?{'x-duke-csrf':CSRF}:{}),...(o.headers||{})}});
  if(r.status===401){document.body.innerHTML='<p style="padding:30px">Open Duke with the "Duke Local" launcher on this PC to log in.</p>';throw new Error('login');}
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;}
const post=(u,b)=>api(u,{method:'POST',body:b instanceof FormData?b:JSON.stringify(b||{})});
function toast(m,bad){const t=$('#toast');t.textContent=m;t.className='show'+(bad?' bad':'');clearTimeout(t._t);t._t=setTimeout(()=>t.className='',6000);}
const gb=mb=>mb==null?'?':(mb/1024).toFixed(1)+' GB';

function renderStatus(){
  const s=ST,h=s.hardware,g=h.gpus[0];
  const b=$('#badge');
  if(s.verified){b.className='lbadge ok';b.textContent=`Local inference — no paid AI API · ${s.model.name}`;}
  else if(!s.ollama.running){b.className='lbadge bad';b.textContent='Ollama is not running on this PC';}
  else if(s.model.error||!s.model.installed&&!s.model.capabilities){b.className='lbadge bad';b.textContent=`Model ${s.model.name} is not installed`;}
  else{b.className='lbadge';b.textContent=`${s.model.name} ready · not yet verified (no local request made yet)`;}
  $('#sys').innerHTML=`<h3>This PC</h3><div class="kv2">
    <span>Graphics</span><span>${g?`${esc(g.name)} · ${gb(g.vramTotalMB)}`:'No NVIDIA GPU found'}</span>
    ${g&&g.vramUsedMB!=null?`<span>VRAM used</span><span>${gb(g.vramUsedMB)} of ${gb(g.vramTotalMB)} · GPU ${g.utilPct}%</span>`:''}
    <span>Memory (RAM)</span><span>${h.ramFreeGB} GB free of ${h.ramTotalGB} GB</span>
    <span>Disk free</span><span>${h.disk?`${h.disk.freeGB} GB of ${h.disk.totalGB} GB`:'?'}</span>
    <span>CPU</span><span>${esc(h.cpu)} (${h.cores} threads)</span></div>
    ${g&&g.vramUsedMB!=null?`<div class="meter"><i style="width:${Math.round(100*g.vramUsedMB/g.vramTotalMB)}%"></i></div>`:''}
    <h3 style="margin-top:10px">Model</h3><div class="kv2">
    <span>Runtime</span><span>${s.ollama.running?`Ollama ${esc(s.ollama.version)} at ${esc(s.ollama.base)}`:`Not running (${esc(s.ollama.error||'')})`}</span>
    <span>Model</span><span>${esc(s.model.name)}${s.model.params?` · ${esc(s.model.params)} ${esc(s.model.quant||'')}`:''}</span>
    <span>Can see images</span><span>${s.model.capabilities?(s.model.vision?'yes (verified by Ollama)':'<b class="bad">no</b>'):'?'}</span>
    <span>Tool calls</span><span>${s.model.capabilities?(s.model.tools?'yes (verified by Ollama)':'<b class="bad">no</b>'):'?'}</span>
    <span>Loaded</span><span>${s.ollama.loaded.map(m=>`${esc(m.name)} (${gb(m.vram/1048576)} in VRAM)`).join(', ')||'not loaded yet'}</span>
    <span>Settings</span><span>context ${s.recommend.num_ctx} tokens</span></div>
    <p class="small ${s.recommend.ok?'muted':'warn'}">${esc(s.recommend.reason)}${s.recommend.suggest?` A smaller model would fit: <b>${esc(s.recommend.suggest)}</b> (not downloaded automatically).`:''}</p>
    ${s.ollama.running&&!s.model.capabilities?`<button class="btn sm" id="pull">Download ${esc(s.model.name)} (several GB)</button>`:''}
    <p class="small muted">Running: ${s.running.task?esc(s.running.action):'nothing'}</p>`;
  $('#pull')?.addEventListener('click',async()=>{if(!confirm(`Download ${s.model.name}? This is a large download (about 6–7 GB for a 9B model).`))return;toast((await post('/api/local/model/pull',{model:s.model.name})).note);});
  $('#caps').innerHTML=`${s.blender.exe?`<p class="muted">Blender: <span class="mono">${esc(s.blender.exe)}</span></p>`:'<p class="bad">Blender not found. Choose blender.exe below or run the setup script.</p>'}
    <b>Supported</b><ul>${s.blender.supported.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><b>Not supported</b><ul>${s.blender.unsupported.map(x=>`<li class="muted">${esc(x)}</li>`).join('')}</ul>
    <p class="muted">Unreal: ${s.unreal?`${esc(s.unreal.project)} · ${s.unreal.bridge?'editor bridge running':'editor bridge not running (Unreal steps unavailable)'}`:'not selected (the assistant does not act in Unreal)'}</p>`;
  const st=s.settings;
  $('#proj').innerHTML=st.projectRoot?`Project: <span class="mono">${esc(st.projectRoot)}</span>${st.scene?` · scene <span class="mono">${esc(st.scene.split(/[\\/]/).pop())}</span>`:''}`:'<b class="warn">Choose a project folder (right) or create a sample project first.</b>';
  if(!$('#setf').dataset.done){$('#setf').dataset.done='1';$('#setf').innerHTML=`
    <div class="field"><label>Project folder</label><div class="row"><input id="fRoot" value="${esc(st.projectRoot)}"/><button class="btn sm" data-pick="fRoot">Browse</button></div></div>
    <div class="field"><label>Asset folders (read-only, one per line)</label><textarea id="fAssets" rows="2">${esc((st.assetDirs||[]).join('\n'))}</textarea></div>
    <div class="field"><label>Blender scene to work on (.blend, optional)</label><input id="fScene" value="${esc(st.scene)}"/></div>
    <div class="field"><label>blender.exe (blank = find automatically)</label><input id="fBlender" value="${esc(st.blenderExe)}"/></div>
    <div class="field"><label>Unreal project (.uproject, optional)</label><input id="fUe" value="${esc(st.unrealProject)}"/></div>
    <div class="field"><label>Local model</label><input id="fModel" value="${esc(st.model)}"/></div>
    <div class="row"><button class="btn gold" id="fSave">Save</button><button class="btn" id="fSample">Create a sample project</button></div>`;
    $('#fSave').onclick=async()=>{try{await post('/api/local/settings',{projectRoot:$('#fRoot').value,assetDirs:$('#fAssets').value.split('\n'),scene:$('#fScene').value,blenderExe:$('#fBlender').value,unrealProject:$('#fUe').value,model:$('#fModel').value});toast('Saved');refresh();}catch(e){toast(e.message,true);}};
    $('#fSample').onclick=async()=>{try{const r=await post('/api/local/sample');$('#fRoot').value=r.settings.projectRoot;$('#fScene').value=r.settings.scene;toast(r.blender?'Sample project created with an empty scene.':'Sample project created (Blender not found, so no scene yet).');refresh();}catch(e){toast(e.message,true);}};
    $$('[data-pick]').forEach(b=>b.onclick=()=>pick(b.dataset.pick));}
}
function stepHtml(t,s){return `<div class="st"><span class="role">${esc(s.role)}</span><div><b>${esc(s.title)}</b>${s.check?`<div class="muted small">Done when: ${esc(s.check)}</div>`:''}
  ${s.result?.summary?`<div class="small">${esc(s.result.summary)}</div>`:''}
  ${s.result&&s.role==='reviewer'&&!s.result.skipped?`<div class="small">${(s.result.observations||[]).map(o=>`<div class="okt">• ${esc(o)}</div>`).join('')}${(s.result.problems||[]).map(o=>`<div class="bad">✗ ${esc(o)}</div>`).join('')}</div>`:''}
  ${s.error?`<div class="bad small">${esc(s.error)}</div>`:''}
  ${s.fixes?.length?`<div class="small warn">Repair attempts: ${s.fixes.map(f=>esc(f.what)).join(' · ')}</div>`:''}
  ${s.log?.length?`<details><summary class="small muted">Log (${s.log.length})</summary><pre class="log">${esc(s.log.join('\n'))}</pre></details>`:''}</div><span class="state ${s.state==='done'?'READY':s.state==='failed'||s.state==='stopped'?'BLOCKED':s.state==='running'?'TESTING':''}">${esc(s.state)}</span></div>`;}
function renderTasks(){
  $('#tasks').innerHTML=TASKS.map(t=>`<div class="card task ${t.state}" data-t="${t.id}"><div class="row" style="justify-content:space-between"><b>${esc(t.request.slice(0,140))}</b><span class="state ${t.state==='DONE'?'READY':['FAILED','STOPPED'].includes(t.state)?'BLOCKED':t.state==='RUNNING'?'TESTING':'FIXING'}">${esc(t.state.replace('_',' '))}</span></div>
    <div class="muted small">${new Date(t.createdAt).toLocaleString()}${t.model?` · ${esc(t.model.name)}`:''}${t.checkpoint?` · checkpoint ${esc(t.checkpoint.id.slice(0,10))}`:''}${ST?.running.task===t.id?` · <b>${esc(ST.running.action)}</b>`:''}</div>
    ${t.pending?`<div class="card warnbox" style="margin-top:8px"><b>Needs your approval:</b> ${esc(t.pending.action)}<div class="mono small">${esc(t.pending.detail)}</div><div class="row" style="margin-top:6px"><button class="btn gold sm" data-ap="${t.id}">Approve</button><button class="btn sm" data-deny="${t.id}">Decline</button></div></div>`:''}
    ${t.error?`<p class="bad small">${esc(t.error)}</p>`:''}
    ${t.unsupported?.length?`<p class="warn small">Not supported: ${t.unsupported.map(esc).join('; ')}</p>`:''}
    ${t.previews?.before||t.previews?.after?`<div class="prev">${t.previews.before?`<figure><img src="/api/local/tasks/${t.id}/file/before.png?${Date.parse(t.updatedAt)}"/><figcaption>Before</figcaption></figure>`:'<div></div>'}${t.previews.after?`<figure><img src="/api/local/tasks/${t.id}/file/after.png?${Date.parse(t.updatedAt)}"/><figcaption>After (actual render)</figcaption></figure>`:''}</div>`:''}
    <details ${open.has(t.id)?'open':''} data-o="${t.id}"><summary class="small">Steps (${t.steps.filter(s=>s.state==='done').length}/${t.steps.length})${t.verify?` · verified: ${t.verify.map(v=>`${esc(v.file)} ${v.exists===false||v.reopened===false?'✗':'✓'}${v.reopened?` reopens (${v.objects} objects)`:''}`).join(', ')}`:''}</summary>${t.steps.map(s=>stepHtml(t,s)).join('')}
      ${t.log?.length?`<pre class="log">${esc(t.log.join('\n'))}</pre>`:''}</details>
    <div class="row" style="margin-top:8px">${t.checkpoint&&t.state!=='RUNNING'?`<button class="btn sm" data-restore="${t.id}">Restore checkpoint</button>`:''}${t.outputs?.length?`<span class="muted small">Files: ${t.outputs.map(o=>esc(o.file)).join(', ')}</span>`:''}</div></div>`).join('')||'<p class="muted">No tasks yet.</p>';
  $$('details[data-o]').forEach(d=>d.ontoggle=()=>d.open?open.add(d.dataset.o):open.delete(d.dataset.o));
  $$('[data-ap]').forEach(b=>b.onclick=async()=>{await post(`/api/local/tasks/${b.dataset.ap}/approve`,{decision:'approve'});toast('Approved. The task continues.');refresh();});
  $$('[data-deny]').forEach(b=>b.onclick=async()=>{await post(`/api/local/tasks/${b.dataset.deny}/approve`,{decision:'deny'});refresh();});
  $$('[data-restore]').forEach(b=>b.onclick=async()=>{if(!confirm('Put the project back to how it was before this task? Files created since then are moved to .duke/trash (not deleted).'))return;
    try{const r=await post(`/api/local/tasks/${b.dataset.restore}/restore`);toast(`Restored. ${r.movedToTrash||0} newer file(s) moved to .duke/trash.`);refresh();}catch(e){toast(e.message,true);}});
}
async function refresh(){
  try{const [s,t,l]=await Promise.all([api('/api/local/status'),api('/api/local/tasks'),api('/api/local/logs')]);ST=s;TASKS=t.tasks;
    renderStatus();renderTasks();
    $('#bPause').classList.toggle('gold',t.paused);
    const reqs=l.modelRequests.slice(-6).reverse();
    $('#mlog').innerHTML=`${reqs.map(r=>`<div>${new Date(r.at).toLocaleTimeString()} · ${esc(r.role)} · <span class="mono">${esc(r.endpoint)}</span> · ${(r.ms/1000).toFixed(1)} s${r.images?` · ${r.images} image(s)`:''} ${r.ok?'':'<b class="bad">failed</b>'}</div>`).join('')||'No model requests yet.'}
      ${l.blockedNetwork.length?`<p class="warn">Blocked network calls: ${l.blockedNetwork.length} (last: ${esc(l.blockedNetwork.at(-1).url)})</p>`:'<p class="okt">No outside network calls attempted.</p>'}`;
  }catch(e){if(e.message!=='login')toast(e.message,true);}
}
async function pick(field){
  const m=$('#picker');m.classList.add('open');let cur=$('#'+field).value||'';
  const show=async p=>{const d=await api('/api/local/browse?path='+encodeURIComponent(p||''));cur=d.path;$('#pkPath').textContent=d.path;
    $('#pkDrive').innerHTML=d.drives.map(x=>`<option ${d.path.startsWith(x)?'selected':''}>${esc(x)}</option>`).join('');$('#pkDrive').onchange=()=>show($('#pkDrive').value);
    $('#pkList').innerHTML=(d.parent?`<div data-p="${esc(d.parent)}">⬑ ..</div>`:'')+d.folders.map(f=>`<div data-p="${esc(d.path.replace(/[\\/]$/,'')+(d.path.includes('\\')?'\\':'/')+f)}">📁 ${esc(f)}</div>`).join('')+d.files.map(f=>`<div class="muted">· ${esc(f)}</div>`).join('');
    $$('#pkList [data-p]').forEach(x=>x.onclick=()=>show(x.dataset.p));};
  await show(cur);$('#pkCancel').onclick=()=>m.classList.remove('open');$('#pkOk').onclick=()=>{$('#'+field).value=cur;m.classList.remove('open');};
}
$('#refs').onchange=()=>{$('#refN').textContent=$('#refs').files.length?`${$('#refs').files.length} image(s)`:'';};
$('#send').onclick=async()=>{const fd=new FormData();fd.append('request',$('#req').value);for(const f of $('#refs').files)fd.append('ref',f);
  try{await post('/api/local/tasks',fd);$('#req').value='';$('#refs').value='';$('#refN').textContent='';toast('Queued. Press Start if Duke is paused.');refresh();}catch(e){toast(e.message,true);}};
$('#bStart').onclick=async()=>{await post('/api/local/start');toast('Started');refresh();};
$('#bPause').onclick=async()=>{toast((await post('/api/local/pause')).note);refresh();};
$('#bStop').onclick=async()=>{const r=await post('/api/local/stop');toast(r.note,r.stillRunning.length>0);refresh();};
(async()=>{try{CSRF=(await api('/api/local/session')).csrf;}catch{return;}refresh();setInterval(refresh,4000);})();
