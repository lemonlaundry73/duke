import { Game } from './game.js';

const qs=new URLSearchParams(location.search);
const mode=qs.get('mode')==='flyover'?'flyover':'play';
const embed=qs.has('embed');
if(embed)document.body.classList.add('embed');
if(mode==='flyover')document.body.classList.add('flyover');
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function loadProject(){
  const id=qs.get('project');
  try{
    if(id){const r=await fetch(`/api/projects/${encodeURIComponent(id)}`);if(r.ok)return r.json();}
    const r=await fetch('/api/projects');if(r.ok){const all=await r.json();if(all.length)return all[0];}
  }catch{}
  return {name:'Duke City',world:{seed:Number(qs.get('seed'))||7},npcs:[],systems:{}};
}

let toastTimer;
const hud={
  minimap:$('h-mini'),
  set(k,v){const el=$('h-'+k);if(!el)return;if(el._v===v)return;el._v=v;el.innerHTML=v;if(k==='prompt')el.classList.toggle('show',!!v);},
  tags(list){const box=$('h-tags');box.innerHTML=list.map(t=>`<div class="tag" style="left:${t.x}%;top:${t.y}%;opacity:${Math.max(.3,1-t.d/45)}">${esc(t.name)}<span>${esc(t.role||'')}</span></div>`).join('');},
  toggleHelp(){$('overlay').classList.toggle('hidden');}
};

(async()=>{
  const project=await loadProject();
  if(qs.has('seed'))project.world={...(project.world||{}),seed:Number(qs.get('seed'))};
  const words=String(project.design?.world?.city_name||project.design?.vision?.title||project.name||'Duke City').split(/\s+/);
  $('o-title').innerHTML=`${esc(words.slice(0,-1).join(' ')||'DUKE')} <em>${esc(words.at(-1))}</em>`.toUpperCase();
  const castN=(project.design?.characters||[]).filter(c=>c.role!=='Protagonist').length+(project.npcs||[]).length;
  $('o-sub').textContent=`Live preview · ${castN} character${castN===1?'':'s'} in the city · seed ${project.world?.seed??'—'}`;
  let game;
  try{game=new Game($('game'),{project,mode,hud,onTalk:openChat});}
  catch(e){document.body.innerHTML=`<div class="err"><div><h2>3D needs WebGL2</h2><p>${esc(e.message)}</p><p>Try the latest Chrome, Edge, Firefox or Safari with hardware acceleration on.</p></div></div>`;parent.postMessage({type:'duke-play',error:e.message},'*');return;}
  window.__game=game;
  game.toast=msg=>{const t=$('h-toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200);};
  if(qs.has('tod'))game.tod=Number(qs.get('tod'));
  if(qs.has('rain'))game.rainTarget=game.rain=Number(qs.get('rain'));
  const overlay=$('overlay');
  if(mode==='flyover'){game.start();}
  else{
    overlay.addEventListener('click',()=>{overlay.classList.add('hidden');$('game').focus();try{$('game').requestPointerLock()}catch{}game.start();});
    document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&!$('chat').classList.contains('open')&&game.running&&!qs.has('nolockpause')){/* keep running; click canvas to re-lock */}});
    game.renderOnce(0); // show the city behind the start card
  }
  window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='pause')game.stop();if(m.type==='resume'&&(mode==='flyover'||overlay.classList.contains('hidden')))game.start();
    if(m.type==='project'&&m.project){game.setProject(m.project);if(!game.running)game.renderOnce(0);}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)game.stop();else if(mode==='flyover'||overlay.classList.contains('hidden'))game.start();});

  // NPC chat
  let chatNpc=null,chatDone=null;
  function openChat(npc,done){
    chatNpc=npc;chatDone=done;$('c-name').textContent=npc.name;$('c-role').textContent=npc.role||'Citizen';
    $('c-log').innerHTML=`<div class="bub them">${esc(npc.bio?`I'm ${npc.name}. ${npc.bio}`:`Hey. I'm ${npc.name}.`)}</div>`;
    $('chat').classList.add('open');setTimeout(()=>$('c-input').focus(),30);
  }
  function closeChat(){$('chat').classList.remove('open');chatDone?.();chatNpc=null;$('game').focus();try{$('game').requestPointerLock()}catch{}}
  $('c-input').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeChat();}e.stopPropagation();});
  $('c-form').addEventListener('submit',async e=>{
    e.preventDefault();const msg=$('c-input').value.trim();if(!msg||!chatNpc)return;$('c-input').value='';
    const log=$('c-log');log.insertAdjacentHTML('beforeend',`<div class="bub me">${esc(msg)}</div>`);log.scrollTop=log.scrollHeight;
    try{
      if(!project.id)throw new Error('offline');
      const r=await fetch(chatNpc.chatUrl||`/api/projects/${project.id}/npcs/${chatNpc.id}/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:msg})});
      const out=await r.json();log.insertAdjacentHTML('beforeend',`<div class="bub them">${esc(out.text||out.error||'…')}</div>`);
    }catch{log.insertAdjacentHTML('beforeend',`<div class="bub them">…</div>`);}
    log.scrollTop=log.scrollHeight;
  });
  parent.postMessage({type:'duke-play',ready:true},'*');
})();
