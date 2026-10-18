// Duke Forger workspace: the simple cast list and the Duke 3D Generator.
// Loaded after forge.js (shares $, api, post, esc, toast, S, go).
const G3={recipes:null,cast:null,jobs:null,sel:null,files:{},checks:{},castFor:null};
const VIEW_ORDER=['front','back','left','right','three_quarter','detail'];
const STATE_TXT={GENERATING:'Generating',FINISHING:'AAA finishing on your worker',RIGGING:'Adding the skeleton',AAA:'AAA ✓',BELOW_AAA:'Below AAA',FAILED:'Failed',BLOCKED:'Blocked',READY:'Ready to approve',APPROVED:'Approved',BELOW_AAA_:'Below AAA'};
const STATE_CLS={GENERATING:'IMPLEMENTING',FINISHING:'OPTIMIZING',RIGGING:'OPTIMIZING',AAA:'READY',READY:'READY',APPROVED:'READY',BELOW_AAA:'FIXING',FAILED:'BLOCKED',BLOCKED:'BLOCKED'};
const st=s=>`<span class="state ${STATE_CLS[s]||''}">${esc(STATE_TXT[s]||s)}</span>`;
async function g3Recipes(){if(!G3.recipes)G3.recipes=await api('/api/forge/gen3d/recipes');return G3.recipes;}
let mvLoaded=false;function modelViewer(){if(mvLoaded)return;mvLoaded=true;const s=document.createElement('script');s.type='module';s.src='https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js';document.head.appendChild(s);}

// ---------------------------------------------------------------- photo checks in the browser
// Size, sharpness, plain background, subject size and exposure. Results travel with the upload.
function checkImage(file){
  return new Promise(res=>{const img=new Image();const url=URL.createObjectURL(file);
    img.onload=()=>{const W=img.naturalWidth,H=img.naturalHeight;const n=256;const c=document.createElement('canvas');c.width=c.height=n;const x=c.getContext('2d');x.drawImage(img,0,0,n,n);
      const d=x.getImageData(0,0,n,n).data;const g=new Float32Array(n*n);let alpha=0;for(let i=0;i<n*n;i++){g[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];if(d[i*4+3]<250)alpha++;}
      let lap=0,lm=0,cnt=0;for(let y=1;y<n-1;y++)for(let xx=1;xx<n-1;xx++){const i=y*n+xx;const v=4*g[i]-g[i-1]-g[i+1]-g[i-n]-g[i+n];lap+=v*v;lm+=v;cnt++;}
      const sharp=lap/cnt-(lm/cnt)**2;
      const border=[];for(let i=0;i<n;i++){border.push(g[i],g[(n-1)*n+i],g[i*n],g[i*n+n-1]);}
      const bm=border.reduce((a,b)=>a+b,0)/border.length;const bsd=Math.sqrt(border.reduce((a,b)=>a+(b-bm)**2,0)/border.length);
      let subj=0;for(let i=0;i<n*n;i++)if(Math.abs(g[i]-bm)>28||d[i*4+3]<128)subj++;const fill=alpha>n*n*0.05?1-alpha/(n*n):subj/(n*n);
      const mean=g.reduce((a,b)=>a+b,0)/g.length;
      const out=[
        {ok:Math.min(W,H)>=1024,text:`${W}×${H} px`+(Math.min(W,H)<1024?' (need 1024+)':Math.min(W,H)<2048?' (2048+ is best)':'')},
        {ok:sharp>60,warn:sharp>25&&sharp<=60,text:sharp>60?'Sharp':sharp>25?'A little soft':'Blurry'},
        {ok:alpha>n*n*0.05||bsd<14,warn:bsd>=14&&bsd<30,text:alpha>n*n*0.05?'Transparent background':bsd<14?'Plain background':bsd<30?'Background a bit busy':'Busy background'},
        {ok:fill>0.12&&fill<0.85,text:fill<=0.12?'Subject too small in frame':fill>=0.85?'Subject cut off or too close':'Subject well framed'},
        {ok:mean>50&&mean<215,text:mean<=50?'Too dark':mean>=215?'Too bright':'Good exposure'}];
      URL.revokeObjectURL(url);res({w:W,h:H,checks:out,pass:out.every(c=>c.ok||c.warn)});};
    img.onerror=()=>{URL.revokeObjectURL(url);res({w:0,h:0,checks:[{ok:false,text:'Not an image this browser can read'}],pass:false});};img.src=url;});
}
const checkList=c=>c?`<div class="chk">${c.checks.map(x=>`<span class="${x.ok?'ok':x.warn?'warn':'bad'}">${x.ok?'✓':x.warn?'!':'✗'} ${esc(x.text)}</span>`).join('')}</div>`:'';

function rulesCard(r,open){return `<details class="card" ${open?'open':''}><summary><b>Photo requirements for AAA results</b> <span class="muted small">— read once, it decides the quality</span></summary>
  <ol class="rules">${r.rules.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>
  <div class="angles">${['front','back','left','right'].map(v=>`<div class="ang"><div class="pose ${v}"></div><b>${esc(r.views[v].label)}</b><span class="muted small">${esc(r.views[v].hint)}</span></div>`).join('')}</div></details>`;}

// ---------------------------------------------------------------- Characters: the cast list
async function rCast(){
  if(!S.proj){$('#main').innerHTML='<p class="pad muted">Create or pick a project first.</p>';return;}
  const r=await g3Recipes();
  const {cast}=await api(`/api/forge/projects/${S.pid}/cast`);G3.cast=cast;
  $('#main').innerHTML=`<div class="head"><div><h1>Characters</h1><p class="muted">Your cast: a name, a role and four photos each. Then one click turns a character into an AAA 3D model.</p></div></div>
    ${rulesCard(r,!cast.length)}
    <div class="card"><div class="row"><input type="text" id="cName" placeholder="Name, for example Cole Mercer" style="max-width:260px"/><input type="text" id="cRole" placeholder="Role, for example Hero / Enemy soldier" style="max-width:260px"/><button class="btn gold" id="cAdd">Add character</button></div></div>
    <div class="cast">${cast.map(c=>`<div class="card castRow" data-cid="${c.id}">
      <div class="castHead"><div><input class="cn" value="${esc(c.name)}" data-f="name"/><input class="cr muted" value="${esc(c.role)}" data-f="role" placeholder="Role"/></div>
        <div class="row">${c.models.length?`<span class="badge ok">${c.models.length} 3D model${c.models.length>1?'s':''}</span>`:''}
          <select class="in cRecipe" style="width:auto">${r.recipes.filter(x=>x.kind==='character').map(x=>`<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select>
          <button class="btn gold" data-make="${c.id}" ${c.ready?'':'disabled title="Upload front, back, left and right first"'}>Make 3D model</button>
          <button class="btn sm danger" data-del="${c.id}">Delete</button></div></div>
      <div class="views">${['front','back','left','right'].map(v=>{const im=c.views[v];return `<label class="slot ${im?'has':''}">${im?`<img src="${esc(im.url)}" alt=""/>`:`<div class="pose ${v}"></div>`}
        <span class="vl">${esc(r.views[v].label)}${im?` · ${im.w}×${im.h}`:''}</span>${im?.checks?checkList(im.checks):''}
        <input type="file" accept="image/png,image/jpeg,image/webp" data-up="${c.id}" data-view="${v}" hidden/></label>`;}).join('')}</div></div>`).join('')||'<p class="muted pad">No characters yet. Add your first one above.</p>'}</div>`;
  $('#cAdd').onclick=async()=>{const name=$('#cName').value.trim();if(!name)return toast('Give the character a name',true);
    try{await post(`/api/forge/projects/${S.pid}/cast`,{name,role:$('#cRole').value});rCast();}catch(e){toast(e.message,true);}};
  $$('.castRow input[data-f]').forEach(i=>i.onchange=async()=>{try{await api(`/api/forge/cast/${i.closest('[data-cid]').dataset.cid}`,{method:'PATCH',body:JSON.stringify({[i.dataset.f]:i.value})});toast('Saved');}catch(e){toast(e.message,true);}});
  $$('[data-up]').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;const chk=await checkImage(f);
    if(chk.w&&Math.min(chk.w,chk.h)<1024)return toast(`That photo is ${chk.w}×${chk.h}. AAA needs at least 1024×1024.`,true);
    const fd=new FormData();fd.append('checks',JSON.stringify(chk));fd.append('file',f);
    try{await post(`/api/forge/cast/${inp.dataset.up}/view/${inp.dataset.view}`,fd);if(!chk.pass)toast('Uploaded, but check the warnings under the photo: they lower the quality.',true);rCast();}catch(e){toast(e.message,true);}});
  $$('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this character and its photos?'))return;await api(`/api/forge/cast/${b.dataset.del}`,{method:'DELETE'});rCast();});
  $$('[data-make]').forEach(b=>b.onclick=()=>{const c=cast.find(x=>x.id===b.dataset.make);G3.castFor={id:c.id,name:c.name,recipe:b.closest('.castRow').querySelector('.cRecipe').value};go('gen3d');});
}

// ---------------------------------------------------------------- Duke 3D Generator
async function rGen3d(){
  if(!S.proj){$('#main').innerHTML='<p class="pad muted">Create or pick a project first.</p>';return;}
  const r=await g3Recipes();const {jobs}=await api(`/api/forge/projects/${S.pid}/gen3d`);G3.jobs=jobs;
  if(G3.sel){const j=jobs.find(x=>x.id===G3.sel);if(j)return rGenJob(j,r);G3.sel=null;}
  const pre=G3.castFor;G3.castFor=null;G3.files={};G3.checks={};
  const ready=r.providers.filter(p=>p.ready);
  $('#main').innerHTML=`<div class="head"><div><h1>3D Generator</h1><p class="muted">Upload photos of what you want, press Generate. Duke runs the best image-to-3D models side by side, finishes each result to the AAA spec on your GPU worker, checks it, and lets you approve the best one.</p></div></div>
    ${ready.length?'':`<div class="card warnbox"><b>No 3D generator is connected yet.</b> The site owner adds <span class="mono">RODIN_API_KEY</span> (Hyper3D Rodin Gen-2) and/or <span class="mono">MESHY_API_KEY</span> (Meshy 7.1) in the server settings. With both, Duke generates with both and you pick the better one.</div>`}
    <div class="card"><div class="grid2">
      <div><label class="muted small">What are you making?</label><select class="in" id="gRecipe">${r.recipes.map(x=>`<option value="${x.id}" ${pre?.recipe===x.id?'selected':''}>${esc(x.label)}</option>`).join('')}</select><p class="muted small" id="gFor"></p></div>
      <div><label class="muted small">Name</label><input type="text" id="gName" value="${esc(pre?.name||'')}" placeholder="For example Cole Mercer, Halvard R-16 Rifle"/>
        <div class="row" style="margin-top:8px"><label class="muted small" id="gSizeL">Size</label><input type="number" step="0.01" id="gSize" style="max-width:110px"/><span class="muted small">meters</span></div></div>
    </div>
    <label class="muted small">Notes for the texture (optional)</label><input type="text" id="gNotes" placeholder="For example: worn ranger-green jacket, faded unit patch, no logos"/>
    <div id="gSpec" class="muted small" style="margin-top:8px"></div></div>
    ${rulesCard(r,false)}
    <div class="card"><h2>Photos</h2>${pre?`<p class="muted small">Using the four photos of <b>${esc(pre.name)}</b> from Characters. Add more angles below if you have them.</p>`:''}<div class="views" id="gViews"></div></div>
    <div class="card row"><select class="in" id="gProv" style="width:auto"><option value="best">Best of all connected generators (${ready.map(p=>esc(p.label)).join(' + ')||'none'})</option>${ready.map(p=>`<option value="${p.id}">Only ${esc(p.label)}</option>`).join('')}</select>
      <button class="btn gold" id="gGo" ${ready.length?'':'disabled'}>Generate AAA 3D model</button><span class="muted small" id="gMiss"></span></div>
    <div class="card"><h2>Recent 3D models</h2><table><tr><th>Name</th><th>Type</th><th>Status</th><th>Started</th></tr>${jobs.map(j=>`<tr><td><a href="#" data-job="${j.id}">${esc(j.name)}</a></td><td>${esc(r.recipes.find(x=>x.id===j.recipe)?.label||j.recipe)}</td><td>${st(j.state)}</td><td class="muted">${ago(j.createdAt)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">None yet.</td></tr>'}</table></div>`;
  const draw=()=>{const R=r.recipes.find(x=>x.id===$('#gRecipe').value);$('#gFor').textContent=R.for;$('#gSizeL').textContent=R.size.what;if(!$('#gSize').dataset.touched)$('#gSize').value=R.size.m;
    $('#gSpec').innerHTML=`AAA spec: LOD0 up to ${R.lods[0].toLocaleString()} triangles, ${R.lods.length} levels of detail, ${R.texture}px PBR textures${R.pose?`, ${R.pose}`:''}, collision, real-world scale, Unreal-ready FBX.`;
    const views=[...R.views,...R.optional];
    $('#gViews').innerHTML=views.map(v=>{const has=G3.files[v]||(pre&&['front','back','left','right'].includes(v));const req=R.views.includes(v);
      return `<label class="slot ${has?'has':''}">${G3.files[v]?`<img src="${URL.createObjectURL(G3.files[v])}"/>`:pre&&['front','back','left','right'].includes(v)?`<img src="/api/forge/cast/${pre.id}/view/${v}"/>`:`<div class="pose ${v}"></div>`}
        <span class="vl">${esc(r.views[v].label)}${req?' <b class="req">required</b>':''}</span>${checkList(G3.checks[v])}<input type="file" accept="image/png,image/jpeg,image/webp" data-gv="${v}" hidden/></label>`;}).join('');
    $$('[data-gv]').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;G3.checks[inp.dataset.gv]=await checkImage(f);G3.files[inp.dataset.gv]=f;draw();});
    const miss=R.views.filter(v=>!(G3.files[v]||(pre&&['front','back','left','right'].includes(v))));$('#gMiss').textContent=miss.length?`Still needed: ${miss.map(v=>r.views[v].label).join(', ')}`:'';
    $('#gGo').disabled=!ready.length||miss.length>0;};
  $('#gRecipe').onchange=()=>{$('#gSize').dataset.touched='';draw();};$('#gSize').oninput=()=>$('#gSize').dataset.touched='1';draw();
  $$('[data-job]').forEach(a=>a.onclick=e=>{e.preventDefault();G3.sel=a.dataset.job;rGen3d();});
  $('#gGo').onclick=async()=>{const bad=Object.entries(G3.checks).filter(([,c])=>!c.pass);
    if(bad.length&&!confirm(`${bad.length} photo(s) have problems (see the red marks). Bad photos make bad models. Generate anyway?`))return;
    const fd=new FormData();fd.append('recipe',$('#gRecipe').value);fd.append('name',$('#gName').value);fd.append('size_m',$('#gSize').value);fd.append('notes',$('#gNotes').value);fd.append('providers',$('#gProv').value);
    if(pre)fd.append('castId',pre.id);for(const [v,f] of Object.entries(G3.files))fd.append('view_'+v,f);
    $('#gGo').disabled=true;$('#gGo').textContent='Uploading…';
    try{const {job}=await post(`/api/forge/projects/${S.pid}/gen3d`,fd);G3.sel=job.id;toast('Generating. Results appear here as each one finishes.');rGen3d();}catch(e){toast(e.message,true);$('#gGo').disabled=false;$('#gGo').textContent='Generate AAA 3D model';}};
}

function rGenJob(j,r){
  modelViewer();const R=r.recipes.find(x=>x.id===j.recipe);
  $('#main').innerHTML=`<div class="head"><div><a href="#" id="gBack" class="small">← 3D Generator</a><h1>${esc(j.name)}</h1><p class="muted">${esc(R?.label||j.recipe)} · ${j.size_m} m · ${st(j.state)} · started ${ago(j.createdAt)}</p></div>
      <div class="row"><button class="btn" id="gRe">Refresh</button>${j.candidates.some(c=>['FAILED'].includes(c.state))?'<button class="btn" id="gRetry">Retry failed</button>':''}${j.candidates.some(c=>c.files.length&&['BLOCKED','BELOW_AAA'].includes(c.state))?'<button class="btn" id="gFin">Finish again</button>':''}</div></div>
    <div class="card"><h3>Photos used</h3><div class="thumbs">${j.inputs.map(i=>`<figure><img src="${esc(i.url)}"/><figcaption>${esc(i.view.replace('_',' '))}</figcaption></figure>`).join('')}</div></div>
    <div class="cands">${j.candidates.map(c=>{const glb=c.finished.find(f=>/^S[KM]_.*\.glb$/.test(f.name)&&!/_LOD/.test(f.name))||c.files.find(f=>/\.glb$/i.test(f.name));
      const renders=c.finished.filter(f=>/^render_/.test(f.name));const v=c.verdict;
      return `<div class="card cand"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(c.label)}</h2>${st(c.state)}</div>
        ${['GENERATING','FINISHING','RIGGING'].includes(c.state)?`<div class="bar"><i style="width:${c.progress||3}%"></i></div><p class="muted small">${c.state==='FINISHING'?'Waiting for or running on your GPU worker (Duke app + Blender).':c.state==='RIGGING'?'Adding a humanoid skeleton and walk/run animations.':'The generator is building the model from your photos.'}</p>`:''}
        ${c.error?`<p class="bad">${esc(c.error)}</p>`:''}
        ${glb?`<model-viewer src="${esc(glb.url)}" camera-controls auto-rotate shadow-intensity="1" exposure="1" environment-image="neutral" style="width:100%;height:380px;background:#11161f;border-radius:6px"></model-viewer>`:''}
        ${renders.length?`<div class="thumbs">${renders.map(f=>`<figure><img src="${esc(f.url)}"/><figcaption>${esc(f.name.replace(/^render_|\.png$/g,''))}</figcaption></figure>`).join('')}</div>`:''}
        ${v?`<div class="verdict ${v.aaa?'ok':'bad'}"><b>${v.aaa?'Passed every AAA check':'Did not pass every AAA check'}</b>${v.fails.map(x=>`<div class="bad">✗ ${esc(x)}</div>`).join('')}${v.passes.map(x=>`<div class="okt">✓ ${esc(x)}</div>`).join('')}</div>`:''}
        ${c.report?.steps?`<details><summary class="small">What the finishing script did</summary><ul class="small">${c.report.steps.map(s=>`<li>${esc(s)}</li>`).join('')}${(c.report.warnings||[]).map(s=>`<li class="warn">${esc(s)}</li>`).join('')}</ul></details>`:''}
        ${c.finished.length||c.files.length?`<details><summary class="small">Files (${c.finished.length} finished, ${c.files.length} raw)</summary><div class="small">${c.finished.map(f=>`<a href="${esc(f.url)}" download>${esc(f.name)}</a> <span class="muted">${fmtB(f.size)}</span>`).join('<br>')}${c.files.length?`<p class="muted">Raw from the generator (not finished):</p>${c.files.map(f=>`<a href="${esc(f.url)}" download>${esc(f.name)}</a>`).join('<br>')}`:''}</div></details>`:''}
        ${j.approved===c.provider?'<p><span class="badge ok">Approved</span></p>':j.approved?'':v?`<div class="row">${v.aaa?`<button class="btn gold" data-ap="${c.provider}">Approve and send to Unreal</button>`:`<button class="btn" data-apo="${c.provider}">Approve anyway (below AAA)</button>`}</div>`:''}
      </div>`;}).join('')}</div>`;
  $('#gBack').onclick=e=>{e.preventDefault();G3.sel=null;rGen3d();};$('#gRe').onclick=()=>rGen3d();
  $('#gRetry')?.addEventListener('click',async()=>{await post(`/api/forge/gen3d/${j.id}/retry`);rGen3d();});
  $('#gFin')?.addEventListener('click',async()=>{await post(`/api/forge/gen3d/${j.id}/finish`);toast('Queued for your GPU worker.');rGen3d();});
  const ap=async(provider,override)=>{try{const o=await post(`/api/forge/gen3d/${j.id}/approve`,{provider,override});toast(o.job?'Approved. Your worker is importing it into Unreal.':'Approved and added to the Asset Library.');rGen3d();}catch(e){toast(e.message,true);}};
  $$('[data-ap]').forEach(b=>b.onclick=()=>ap(b.dataset.ap));
  $$('[data-apo]').forEach(b=>b.onclick=()=>{if(confirm('This model failed some AAA checks. Approve it anyway?'))ap(b.dataset.apo,true);});
  if(['GENERATING','FINISHING','RIGGING'].includes(j.state)){clearTimeout(G3.t);G3.t=setTimeout(()=>{if(S.section==='gen3d'&&G3.sel===j.id)rGen3d();},8000);}
}
