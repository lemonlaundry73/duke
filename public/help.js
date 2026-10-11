// Duke Forger help bubble: AI support chat on every page. It can fix common account problems
// and sends anything it cannot solve to the Duke Forger team as a ticket.
(()=>{
  const css=`
#dfHelpBtn{position:fixed;right:18px;bottom:18px;z-index:60;display:flex;align-items:center;gap:8px;background:#ff815f;color:#101622;border:0;border-radius:6px;padding:11px 15px;font:700 13px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}
#dfHelp{position:fixed;right:18px;bottom:70px;z-index:61;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 100px));display:none;flex-direction:column;background:#101a2a;border:1px solid #2b3a51;border-radius:8px;box-shadow:0 18px 50px rgba(0,0,0,.55);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f1f4fa;overflow:hidden}
#dfHelp.open{display:flex}
#dfHelp header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #2b3a51;background:#132239}
#dfHelp header b{font-size:14px}#dfHelp header span{display:block;font-size:11px;color:#9eacc1}
#dfHelp header button{background:none;border:0;color:#9eacc1;font-size:18px;cursor:pointer}
#dfLog{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.dfm{max-width:88%;padding:9px 11px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word}
.dfm.u{align-self:flex-end;background:#ff815f;color:#101622}.dfm.a{align-self:flex-start;background:#18243a;border:1px solid #2b3a51}
.dfm.t{align-self:center;background:transparent;border:1px dashed #435471;color:#9eacc1;font-size:12px}
#dfQuick{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}
#dfQuick button{background:#18243a;border:1px solid #2b3a51;color:#c1ccdc;border-radius:6px;padding:5px 9px;font-size:12px;cursor:pointer}
#dfForm{display:flex;gap:6px;padding:10px;border-top:1px solid #2b3a51}
#dfForm input{flex:1;min-width:0;background:#0b1322;border:1px solid #2b3a51;border-radius:6px;padding:9px 10px;color:#f1f4fa;font:inherit;outline:none}
#dfForm input:focus{border-color:#ff815f}
#dfForm button{background:#ff815f;border:0;border-radius:6px;color:#101622;font-weight:700;padding:0 13px;cursor:pointer}
#dfHelp a{color:#ff9a7d}
@media (max-width:760px){#dfHelpBtn{bottom:12px;right:12px}#dfHelp{right:12px;bottom:62px}}`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  const btn=document.createElement('button');btn.id='dfHelpBtn';btn.type='button';btn.innerHTML='<span aria-hidden="true">?</span> Help';btn.setAttribute('aria-label','Open help chat');
  const box=document.createElement('section');box.id='dfHelp';box.setAttribute('aria-label','Duke Forger help');
  box.innerHTML=`<header><div><b>Duke Forger help</b><span>Answers right away · fixes common account problems</span></div><button type="button" aria-label="Close help">✕</button></header>
    <div id="dfLog" aria-live="polite"></div>
    <div id="dfQuick"><button type="button">My build failed</button><button type="button">I paid but my plan didn't change</button><button type="button">Something is stuck</button><button type="button">How do I start?</button></div>
    <form id="dfForm"><input id="dfIn" placeholder="Describe the problem in your own words" autocomplete="off"/><button>Send</button></form>`;
  document.body.append(btn,box);
  const log=box.querySelector('#dfLog');const msgs=[];let email='';let busy=false;
  const add=(cls,text)=>{const d=document.createElement('div');d.className='dfm '+cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;};
  add('a','Hi! Ask me anything about Duke Forger, or tell me what is not working. I can fix many account problems right here, and anything I can\'t fix goes straight to the team. See also the FAQ.').insertAdjacentHTML('beforeend',' <a href="/faq">Open FAQ</a>');
  let shown=false;
  btn.onclick=async()=>{box.classList.toggle('open');if(!box.classList.contains('open'))return;box.querySelector('#dfIn').focus();
    if(shown)return;shown=true;
    try{const r=await fetch('/api/support/tickets',{credentials:'same-origin'});if(!r.ok)return;const d=await r.json();
      for(const t of d.tickets.slice(0,3))for(const x of t.replies||[])add('a',`Reply from the team on ticket ${t.id} (${t.subject}): ${x.text}`);}catch{}};
  box.querySelector('header button').onclick=()=>box.classList.remove('open');
  box.querySelectorAll('#dfQuick button').forEach(b=>b.onclick=()=>send(b.textContent));
  box.querySelector('#dfForm').onsubmit=e=>{e.preventDefault();const i=box.querySelector('#dfIn');const v=i.value.trim();if(v){i.value='';send(v);}};
  async function send(text){
    if(busy)return;busy=true;
    if(/@/.test(text)&&!email&&/^\S+@\S+\.\S+$/.test(text.trim())){email=text.trim();add('u',text);add('a','Thanks, the team will reply to that email.');busy=false;return;}
    add('u',text);msgs.push({role:'user',content:text});const wait=add('a','…');
    try{
      const r=await fetch('/api/support/chat',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({messages:msgs,email,page:location.pathname})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Help is unavailable right now');
      wait.textContent=d.reply;msgs.push({role:'assistant',content:d.reply});
      if(d.ticket)add('t',`Ticket ${d.ticket.id} sent to the Duke Forger team.`);
      if(d.needEmail)add('a','What email should the team reply to?');
    }catch(e){wait.textContent=e.message;}
    busy=false;
  }
})();
