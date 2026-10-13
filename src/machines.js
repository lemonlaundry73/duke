// Which of a creator's PCs does Duke's Unreal work. A creator can run the Duke app on several PCs with
// the same key (for example their own PC and a Shadow or Azure cloud PC). Duke uses one of them for
// Unreal jobs, Live Unreal and Duke Link: the one the creator picked, otherwise the strongest one online
// (Unreal installed first, then the most graphics memory). The others wait on standby.
const reg=new Map(); // agent token -> Map(machineId -> info)
const ONLINE_MS=45000;

export function machineId(req){return String(req.headers['x-duke-machine']||'pc').slice(0,80)||'pc';}

export function seen(tok,mid,info){
  let m=reg.get(tok);if(!m){m=new Map();reg.set(tok,m);}
  const cur=m.get(mid)||{id:mid,host:mid};
  if(info){
    if(info.host)cur.host=String(info.host).slice(0,80);
    if(info.gpu!==undefined)cur.gpu=String(info.gpu||'').slice(0,120);
    if(info.vramGB!==undefined)cur.vramGB=Math.round((Number(info.vramGB)||0)*10)/10;
    if(info.engine!==undefined)cur.engine=String(info.engine||'').slice(0,20);
    if(info.hello)cur.hello=info.hello;
    if(info.editor!==undefined)cur.editor=info.editor;
  }
  cur.seenAt=Date.now();m.set(mid,cur);return cur;
}

export function machinesOf(tok){
  const now=Date.now();
  return [...(reg.get(tok)?.values()||[])].map(x=>({...x,online:now-x.seenAt<ONLINE_MS}));
}

const score=m=>(m.engine?1000:0)+(Number(m.vramGB)||0);

export function activeMachine(db,tok){
  const list=machinesOf(tok).filter(m=>m.online);if(!list.length)return null;
  const pref=db?.agents?.[tok]?.forgeMachine;
  const p=pref&&list.find(m=>m.id===pref);if(p)return p;
  return list.sort((a,b)=>score(b)-score(a))[0];
}

export function isActive(db,tok,mid){const a=activeMachine(db,tok);return !a||a.id===mid;}
