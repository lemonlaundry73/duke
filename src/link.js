// Duke Link: the creator's desktop tools (Unreal Engine 5, Blender, Character Creator 5, Visual Studio)
// shown live inside Duke and operated from Duke. The build agent on the creator's PC captures the chosen
// app window and sends frames; Duke relays them to the browser as an MJPEG stream, and relays the
// creator's clicks, keys and tool actions back to the agent. Everything is per user and in memory.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { load, mutate } from './store.js';
import { HttpError, id as nanoid, readBody } from './http.js';
import { requireUser } from './auth.js';
import { agentFor, settle, ctxFor, ownerPlan } from './ctx.js';
import { evaluate } from './progress.js';
import { STEPS } from './roadmap.js';
import { UPLOAD_DIR } from './paths.js';

const now=()=>new Date().toISOString();
const PROOF_DIR=path.join(UPLOAD_DIR,'private');
const MAX_FRAME=3*1024*1024;
const links=new Map(); // agent token -> live state
function L(tok){
  let s=links.get(tok);
  if(!s){s={frame:null,seq:0,frameAt:0,w:0,h:0,window:null,windows:[],tools:{},control:null,stateAt:0,queue:[],waiters:[],watchers:new Set(),watchUntil:0,results:new Map(),fps:0,fpsCount:0,fpsAt:Date.now()};links.set(tok,s);}
  return s;
}
function push(s,cmd){
  cmd.id ||= nanoid(8);s.queue.push(cmd);if(s.queue.length>400)s.queue.splice(0,s.queue.length-400);
  const w=s.waiters.splice(0);for(const fn of w)fn();
  return cmd.id;
}
async function agentTok(req){
  const tok=String(req.headers['x-duke-agent']||'');const db=await load();
  if(!tok||!db.agents?.[tok])throw new HttpError(401,'Invalid agent token');
  return {tok,agent:db.agents[tok],db};
}
async function userLink(req){
  const user=await requireUser(req);const db=await load();const a=agentFor(db,user.id);
  if(!a)throw new HttpError(409,'Connect your PC first (step 9): download DukeSetup.cmd.');
  return {user,a,s:L(a.token),db};
}
const online=s=>Date.now()-s.stateAt<20000;

// Tool catalog shown to creators, in plain words.
export const TOOLS=[
  {id:'ue',name:'Unreal Engine 5',does:'Where your game is built: levels, lighting, gameplay, packaging.',match:['Unreal Editor','UnrealEditor']},
  {id:'cc5',name:'Character Creator 5',does:'Makes your characters, including your own face with Headshot 3.',match:['Character Creator']},
  {id:'blender',name:'Blender',does:'Models, fixes and fits clothes, props and creatures.',match:['Blender']},
  {id:'vs',name:'Visual Studio',does:'Opens game code when you want to look at or change it.',match:['Visual Studio']}
];

export function registerLink(r){
  // ---------------- agent side ----------------
  r.post('/api/agent/link/state',async({req,body})=>{
    const {tok}=await agentTok(req);const s=L(tok);s.stateAt=Date.now();
    s.windows=(Array.isArray(body.windows)?body.windows:[]).slice(0,60).map(w=>({id:String(w.id),title:String(w.title||'').slice(0,160),tool:String(w.tool||'').slice(0,20)}));
    s.window=body.window?String(body.window):null;s.tools=body.tools||{};s.control=body.control??s.control;s.capture=!!body.capture;
    s.pixel=body.pixel&&/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(String(body.pixel.url||''))?{url:String(body.pixel.url),port:Number(/:(\d+)/.exec(String(body.pixel.url).slice(6))?.[1])||80}:null;
    if(!s.pixel)s.hdCache=new Map();
    if(Array.isArray(body.exports))s.exports=body.exports.slice(0,30).map(f=>({path:String(f.path||'').slice(0,400),name:String(f.name||'').slice(0,160),size:Number(f.size)||0,mtime:Number(f.mtime)||0,kind:String(f.kind||'').slice(0,12),from:String(f.from||'').slice(0,40),imported:f.imported?String(f.imported).slice(0,200):null,proof:!!f.proof}));
    s.blender=body.blender?{installed:!!body.blender.installed,connected:Date.now()-Number(body.blender.seen||0)<60000||!!body.blender.connected}:s.blender||null;
    return {watch:Date.now()<s.watchUntil};
  });
  r.post('/api/agent/link/poll',async({req,res})=>{
    const {tok}=await agentTok(req);const s=L(tok);s.stateAt=Date.now();
    if(!s.queue.length)await new Promise(done=>{const t=setTimeout(done,20000);s.waiters.push(()=>{clearTimeout(t);done();});req.on('close',()=>{clearTimeout(t);done();});});
    const cmds=s.queue.splice(0,100);
    return {commands:cmds,watch:Date.now()<s.watchUntil};
  });
  r.post('/api/agent/link/frame',async({req})=>{
    const {tok}=await agentTok(req);const s=L(tok);
    const buf=await readBody(req,MAX_FRAME);
    if(buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)throw new HttpError(400,'Expected a JPEG frame');
    s.frame=buf;s.seq++;s.frameAt=Date.now();s.stateAt=Date.now();
    s.w=Number(req.headers['x-frame-w'])||0;s.h=Number(req.headers['x-frame-h'])||0;s.window=String(req.headers['x-window']||s.window||'');
    s.fpsCount++;if(Date.now()-s.fpsAt>=2000){s.fps=Math.round(s.fpsCount*1000/(Date.now()-s.fpsAt));s.fpsCount=0;s.fpsAt=Date.now();}
    for(const res of s.watchers)writeFrame(res,buf);
    return {watch:Date.now()<s.watchUntil};
  });
  r.post('/api/agent/link/upload',async({req})=>{
    const {tok,agent}=await agentTok(req);
    const pid=String(req.headers['x-project']||''),collection=String(req.headers['x-collection']||''),eid=String(req.headers['x-entity']||''),slot=String(req.headers['x-slot']||'model');
    const name=path.basename(decodeURIComponent(String(req.headers['x-filename']||'file'))).replace(/[^\w.\- ]/g,'_').slice(0,120);
    const ext=path.extname(name).toLowerCase();
    const allowed={model:['.fbx','.glb'],rig:['.fbx'],concept:['.png','.jpg','.jpeg']};
    if(!(allowed[slot]||[]).includes(ext))throw new HttpError(400,`A ${slot} must be ${(allowed[slot]||[]).join(' or ')}`);
    const db=await load();const p=db.projects[pid];if(!p||p.ownerId!==agent.userId)throw new HttpError(404,'project not found');
    const e=(p.design?.[collection]||[]).find(x=>x.id===eid);if(!e)throw new HttpError(404,'item not found');
    const buf=await readBody(req,300*1024*1024);
    const dir=path.join(UPLOAD_DIR,'p',pid,eid);await fs.mkdir(dir,{recursive:true});
    const file=slot==='rig'?'rig.fbx':slot==='concept'?`concept_upload_${Date.now()}${ext}`:`model${ext}`;
    await fs.writeFile(path.join(dir,file),buf);const url=`/uploads/p/${pid}/${eid}/${file}`;
    return mutate(db=>{const q=db.projects[pid];const x=(q.design[collection]||[]).find(y=>y.id===eid);if(!x)return {ok:false};const a=x.art ||= {};
      if(slot==='rig')a.rig={fbx:url,source:'duke-link'};
      else if(slot==='concept'){a.concepts=[...(a.concepts||[]),{url,at:now(),source:'duke-link'}];a.approved=url;}
      else a.model={[ext==='.glb'?'glb':'fbx']:url,source:'duke-link'};
      const done=settle(db,q);q.updatedAt=now();return {ok:true,url,completed:done};});
  });
  r.post('/api/agent/link/result',async({req,body})=>{
    const {tok}=await agentTok(req);const s=L(tok);
    s.results.set(String(body.id),{ok:!!body.ok,output:String(body.output||'').slice(0,20000),at:Date.now()});
    if(s.results.size>200)s.results.delete(s.results.keys().next().value);
    if(body.control!==undefined)s.control=body.control;
    return {ok:true};
  });

  // ---------------- creator side ----------------
  r.get('/api/link/status',async({req})=>{
    const user=await requireUser(req);const db=await load();const agent=agentFor(db,user.id);
    if(!agent)return {online:false,pcName:null,windows:[],window:null,tools:TOOLS.map(t=>({...t,installed:false,open:false})),frameAge:null,fps:0,size:[0,0],control:null,capture:false,noAgent:true};
    const {s,a}=await userLink(req);s.watchUntil=Math.max(s.watchUntil,Date.now()+30000);
    const m=a.machine||{};
    return {online:online(s),pcName:m.host||null,windows:s.windows,window:s.window,tools:TOOLS.map(t=>({...t,installed:t.id==='ue'?(m.engines||[]).length>0:t.id==='vs'?!!m.visualStudio:!!m.tools?.[t.id],open:s.windows.some(w=>w.tool===t.id)})),
      frameAge:s.frameAt?Date.now()-s.frameAt:null,fps:s.fps,size:[s.w,s.h],control:s.control,capture:!!s.capture,pixel:s.pixel?{...s.pixel,relay:`/api/link/hd/${hdTokenFor(s,a.token)}/`}:null,exports:s.exports||[],autoImport:a.autoImport!==false,blender:s.blender||null};
  });
  // Bring a file the agent found (a Character Creator or Blender export) into the game: the agent uploads it
  // to the chosen character/item and copies it into the Unreal project, importing it if Unreal is open.
  r.post('/api/link/import',async({req,body})=>{
    const {s,user,db}=await userLink(req);if(!online(s))throw new HttpError(409,'Your PC is offline.');
    const f=(s.exports||[]).find(x=>x.path===body.path);if(!f)throw new HttpError(400,'That file is no longer in the list. Refresh and try again.');
    const p=db.projects[String(body.projectId||'')];if(!p||p.ownerId!==user.id)throw new HttpError(404,'project not found');
    const collection=String(body.collection||''),eid=String(body.entityId||''),slot=['model','rig','concept'].includes(body.slot)?body.slot:'model';
    if(collection&&!(p.design?.[collection]||[]).some(e=>e.id===eid))throw new HttpError(400,'Pick what this file is for');
    return {id:push(s,{type:'import',path:f.path,name:f.name,projectId:p.id,collection,entityId:eid,slot,projectPath:p.roadmap?.answers?.project_path||''})};
  });
  r.get('/api/link/stream',async({req,res})=>{
    const {s}=await userLink(req);
    res.writeHead(200,{'content-type':'multipart/x-mixed-replace; boundary=dukeframe','cache-control':'no-store','connection':'close','x-accel-buffering':'no'});
    s.watchers.add(res);s.watchUntil=Date.now()+30000;
    if(s.frame)writeFrame(res,s.frame);
    const keep=setInterval(()=>{s.watchUntil=Date.now()+30000;},10000);
    await new Promise(done=>req.on('close',done));
    clearInterval(keep);s.watchers.delete(res);
  });
  r.get('/api/link/frame.jpg',async({res})=>{throw new HttpError(404,'Use /api/link/stream');});
  r.post('/api/link/command',async({req,body})=>{
    const {s}=await userLink(req);s.watchUntil=Date.now()+30000;
    const type=String(body.type||'');
    if(!['launch','focus','input','action','python','capture'].includes(type))throw new HttpError(400,'Unknown command');
    if(!online(s))throw new HttpError(409,'Your PC is offline. Turn it on and make sure the Duke agent is running.');
    const cmd={type};
    if(type==='launch'){if(!TOOLS.some(t=>t.id===body.tool))throw new HttpError(400,'Unknown tool');cmd.tool=body.tool;cmd.project=String(body.project||'').slice(0,400);}
    if(type==='focus'){cmd.window=String(body.window||'');}
    if(type==='capture'){cmd.on=!!body.on;}
    if(type==='input'){
      const e=body.e||{};const k=String(e.k||'');if(!['move','down','up','wheel','key','text'].includes(k))throw new HttpError(400,'Unknown input');
      cmd.e={k,x:clamp01(e.x),y:clamp01(e.y),b:['left','right','middle'].includes(e.b)?e.b:'left',d:Math.max(-20,Math.min(20,Number(e.d)||0)),
        key:String(e.key||'').slice(0,30),code:String(e.code||'').slice(0,30),down:!!e.down,text:String(e.text||'').slice(0,500),mods:Array.isArray(e.mods)?e.mods.filter(m=>['ctrl','shift','alt'].includes(m)):[]};
    }
    if(type==='action'){if(!ACTIONS[body.action])throw new HttpError(400,'Unknown action');cmd.action=body.action;cmd.project=String(body.project||'').slice(0,400);}
    if(type==='python'){cmd.code=String(body.code||'').slice(0,20000);if(!cmd.code)throw new HttpError(400,'No code');}
    return {id:push(s,cmd)};
  });
  r.get('/api/link/result/:id',async({req,params})=>{const {s}=await userLink(req);return s.results.get(params.id)||{pending:true};});
  // ---------------- never hunt for files, and Duke beside your tools ----------------
  r.get('/api/link/guide',async({req})=>{
    const user=await requireUser(req);const db=await load();return guideFor(db,agentFor(db,user.id)||{userId:user.id});
  });
  r.post('/api/link/settings',async({req,body})=>{
    const {a}=await userLink(req);
    return mutate(db=>{const x=db.agents[a.token];if('autoImport' in body)x.autoImport=!!body.autoImport;return {autoImport:x.autoImport!==false};});
  });
  // What the creator is working on right now, for the Blender add-on, the PC agent and the pop-out guide.
  r.get('/api/agent/guide',async({req})=>{const {agent,db}=await agentTok(req);return guideFor(db,agent);});
  // A screenshot taken by a connected tool (Blender add-on, or the agent when a Character Creator export appears).
  r.post('/api/agent/proof',async({req})=>{
    const {agent}=await agentTok(req);
    const pid=String(req.headers['x-project']||'');const key=String(req.headers['x-key']||'').replace(/[^\w-]/g,'').slice(0,40);
    const source=String(req.headers['x-source']||'duke-agent').replace(/[^\w-]/g,'').slice(0,30);
    const label=decodeURIComponent(String(req.headers['x-label']||'')).replace(/[^\w .,()'-]/g,'').slice(0,80);
    if(!PROOF_KEYS.has(key))throw new HttpError(400,'Unknown proof');
    const buf=await readBody(req,15*1024*1024);
    const png=buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),jpg=buf[0]===0xff&&buf[1]===0xd8;
    if(!png&&!jpg)throw new HttpError(400,'Proof must be a PNG or JPEG image');
    const db0=await load();const p0=db0.projects[pid];if(!p0||p0.ownerId!==agent.userId)throw new HttpError(404,'project not found');
    const dir=path.join(PROOF_DIR,pid);await fs.mkdir(dir,{recursive:true});
    const file=`${nanoid(24)}.${png?'png':'jpg'}`;await fs.writeFile(path.join(dir,file),buf);
    return mutate(db=>{const p=db.projects[pid];if(!p||p.ownerId!==agent.userId)throw new HttpError(404,'project not found');
      p.roadmap.proof[key] ||= [];p.roadmap.proof[key].push({id:nanoid(8),file,name:`${label||'Screenshot'} ${new Date().toLocaleString('en-US')}.${png?'png':'jpg'}`,mime:png?'image/png':'image/jpeg',size:buf.length,at:now(),source});
      const completed=settle(db,p);p.updatedAt=now();return {ok:true,completed,count:p.roadmap.proof[key].length,guide:guideFor(db,db.agents[agent.token]||agent)};});
  });

  // ---------------- HD mode: Epic's Pixel Streaming, relayed so it works from any device ----------------
  // The agent fetches the Pixel Streaming player from Unreal on the creator's PC and tunnels its signalling
  // WebSocket through Duke. The video itself goes straight from the PC to the browser over WebRTC.
  r.post('/api/agent/link/hd/http/:id',async({req,params})=>{
    const {tok}=await agentTok(req);const s=L(tok);const w=s.hdReqs?.get(params.id);
    const body=await readBody(req,30*1024*1024);
    if(w){s.hdReqs.delete(params.id);w({status:Number(req.headers['x-status'])||502,type:String(req.headers['x-type']||'application/octet-stream').slice(0,100),body});}
    return {ok:true};
  });
  r.post('/api/agent/link/hdws/poll',async({req,res})=>{
    const {tok}=await agentTok(req);const s=L(tok);const W=hdWs(s);
    if(!W.out.length)await new Promise(done=>{const t=setTimeout(done,20000);W.waiters.push(()=>{clearTimeout(t);done();});req.on('close',()=>{clearTimeout(t);done();});});
    return {msgs:W.out.splice(0,200)};
  });
  r.post('/api/agent/link/hdws/send',async({req,body})=>{
    const {tok}=await agentTok(req);const W=hdWs(L(tok));
    for(const m of (Array.isArray(body.msgs)?body.msgs:[]).slice(0,200)){
      const c=W.chans.get(String(m.chan||''));if(!c)continue;
      if(m.close){wsClose(c.socket);W.chans.delete(String(m.chan));continue;}
      if(typeof m.data==='string')wsSend(c.socket,Buffer.from(m.data),1);
      else if(typeof m.b64==='string')wsSend(c.socket,Buffer.from(m.b64,'base64'),2);
    }
    return {ok:true};
  });
  // Save what's on the live view as proof for a step (it never leaves the creator's private files).
  r.post('/api/projects/:id/link/snap',async({req,params,body})=>{
    const {user,s}=await userLink(req);
    if(!s.frame||Date.now()-s.frameAt>15000)throw new HttpError(409,'Nothing live to capture. Open a tool in Duke Link first.');
    const key=String(body.key||'').replace(/[^\w-]/g,'').slice(0,40);if(!key)throw new HttpError(400,'Which step is this for?');
    const dir=path.join(PROOF_DIR,params.id);await fs.mkdir(dir,{recursive:true});
    const file=`${nanoid(24)}.jpg`;await fs.writeFile(path.join(dir,file),s.frame);
    return mutate(db=>{const p=db.projects[params.id];if(!p||p.ownerId!==user.id)throw new HttpError(404,'project not found');
      p.roadmap.proof[key] ||= [];p.roadmap.proof[key].push({id:nanoid(8),file,name:`${(s.window||'Live view').slice(0,60)} ${new Date().toLocaleString('en-US')}.jpg`,mime:'image/jpeg',size:s.frame.length,at:new Date().toISOString(),source:'duke-link'});
      const completed=settle(db,p);p.updatedAt=new Date().toISOString();return {ok:true,completed,count:p.roadmap.proof[key].length};});
  });
}
// Lets server features (the AI Team) queue an action for a creator's PC agent.
export function pushLinkCommand(token,cmd){return push(L(token),{...cmd});}
const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));
function writeFrame(res,buf){
  try{res.write(`--dukeframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);res.write(buf);res.write('\r\n');}catch{}
}

// One-click tool actions, explained in plain words. The agent runs them (Unreal ones through Unreal's
// Python remote execution in the open editor, or by editing the project files while the editor is closed).
export const ACTIONS={
  ue_enable_remote:{tool:'ue',label:'Let Duke talk to Unreal',plain:'Turns on Unreal\'s Python remote control for this project, so Duke\'s buttons work. Restart Unreal once after.'},
  ue_enable_plugins:{tool:'ue',label:'Turn on the plugins (step 12)',plain:'Turns on PCG, Mass Crowd, State Tree and Python in your project. Close Unreal first; Duke edits the project file.'},
  ue_make_folders:{tool:'ue',label:'Make the 7 folders (step 13)',plain:'Creates Characters, Environments, Gameplay, Maps, Animation, Audio and UI in your Content folder.'},
  ue_git_init:{tool:'ue',label:'Turn on version control (step 13)',plain:'Makes your project a Git repository with LFS for big files, and saves the first snapshot.'},
  ue_save_all:{tool:'ue',label:'Save everything',plain:'Saves every changed level and asset in the open Unreal editor.'},
  ue_blockout_room:{tool:'ue',label:'Drop a gray test room (step 15)',plain:'Adds a simple floor, four walls and a doorway at the center of the open level, for your blockout.'},
  ue_pixel_streaming:{tool:'ue',label:'Turn on HD mode (Pixel Streaming)',plain:'Turns on Epic\'s Pixel Streaming and reopens Unreal so it shows in Duke smooth and sharp. Works when you use Duke on the same PC. Save your work first.'},
  ue_play:{tool:'ue',label:'Play in the editor',plain:'Starts playing the open level inside Unreal.'},
  ue_stop:{tool:'ue',label:'Stop playing',plain:'Stops play mode.'},
  blender_new:{tool:'blender',label:'Open Blender ready to model',plain:'Starts Blender with an empty scene. Export to anywhere: Duke finds your files.'},
  blender_connect:{tool:'blender',label:'Put the Duke panel in Blender',plain:'Adds a Duke tab to Blender (press N in the 3D view): your step beside your work, Send to my game, and automatic proof screenshots.'},
  open_exports:{tool:'cc5',label:'Open my Duke exports folder',plain:'Opens the folder Duke watches. Exporting here (or Desktop, Downloads, Documents) is enough: Duke finds the file.'},
  git_commit:{tool:'ue',label:'Save a snapshot (commit)',plain:'Records the current state of your project in version control, so you can always go back.'}
};
export const publicActions=()=>Object.entries(ACTIONS).map(([id,a])=>({id,...a}));

// ---------------------------------------------------------------- guide for connected tools
const PROOF_KEYS=new Set(STEPS.flatMap(s=>s.checks.filter(c=>c.t==='proof').map(c=>c.key)));
function stepTool(s){const t=[s.title,...(s.how||[]),s.plain||''].join(' ');
  return /Character Creator|Headshot/i.test(t)?'cc5':/Blender/i.test(t)?'blender':/Unreal|level|PCG|World Partition/i.test(t)?'ue':'';}
export function guideFor(db,agent){
  const mine=Object.values(db.projects||{}).filter(p=>p.ownerId===agent.userId).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const p=mine[0];if(!p)return {project:null};
  const ev=evaluate(p,ownerPlan(db,p),ctxFor(db,p));const st=STEPS[ev.current-1];const sv=ev.steps[ev.current-1];
  const checks=st.checks.map((c,i)=>({t:c.t,key:c.key||null,label:c.label||c.key||'',ok:!!sv.checks[i]?.ok,have:c.t==='proof'?(p.roadmap.proof?.[c.key]||[]).length:null,min:c.min||null}));
  const next=checks.find(c=>c.t==='proof'&&!c.ok);
  return {project:{id:p.id,name:p.design?.vision?.title||p.name,path:p.roadmap?.answers?.project_path||''},
    step:{n:st.n,title:st.title,plain:st.plain,how:st.how||[],progress:sv.progress,status:sv.status,tool:stepTool(st)},
    checks,nextProof:next?{key:next.key,label:next.label}:null,overall:ev.overall,autoImport:agent.autoImport!==false};
}

// ---------------------------------------------------------------- HD relay (HTTP + WebSocket)
const hdIndex=new Map(); // HD token -> agent token
function hdTokenFor(s,tok){
  if(!s.hd||s.hd.exp<Date.now()){if(s.hd)hdIndex.delete(s.hd.t);s.hd={t:nanoid(32),exp:Date.now()+12*3600e3};hdIndex.set(s.hd.t,tok);}
  return s.hd.t;
}
function linkByHd(t){const tok=hdIndex.get(t);const s=tok&&links.get(tok);return s&&s.hd?.t===t&&s.hd.exp>Date.now()?s:null;}
function hdWs(s){return s.hdws ||= {chans:new Map(),out:[],waiters:[]};}
function hdOut(W,m){W.out.push(m);if(W.out.length>2000)W.out.splice(0,W.out.length-2000);for(const fn of W.waiters.splice(0))fn();}
const hdPage=(res,status,msg)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0a101c;color:#f1f4fa;font:15px Inter,system-ui,sans-serif;text-align:center;padding:20px"><div><b style="color:#ff815f">Duke Forger HD mode</b><p>${msg}</p></div></body>`);};
// GET /api/link/hd/<token>/<path>: the Pixel Streaming player, fetched from Unreal on the creator's PC.
export async function handleHd(req,res,pathname,search){
  const m=/^\/api\/link\/hd\/([\w-]+)(\/.*)?$/.exec(pathname);if(!m)return false;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return true;}
  const s=linkByHd(m[1]);
  if(!s)return hdPage(res,404,'This HD link has expired. Open HD mode from Duke Link again.'),true;
  if(!m[2]){res.writeHead(302,{location:`/api/link/hd/${m[1]}/${search||''}`});res.end();return true;}
  if(!online(s)||!s.pixel)return hdPage(res,503,'Your PC is not streaming right now. Open Duke Link and tap <b>Turn on HD mode</b>.'),true;
  const sub=(m[2]+(search||'')).slice(0,1000);
  s.hdCache ||= new Map();let hit=s.hdCache.get(sub);
  if(!hit){
    s.hdReqs ||= new Map();const id=nanoid(10);
    hit=await new Promise(done=>{const t=setTimeout(()=>{s.hdReqs.delete(id);done(null);},25000);s.hdReqs.set(id,v=>{clearTimeout(t);done(v);});push(s,{id,type:'hd_http',path:sub});});
    if(!hit)return hdPage(res,504,'Your PC did not answer in time. Check that Unreal is still open and try again.'),true;
    if(/text\/html/i.test(hit.type))hit={...hit,body:Buffer.from(rewriteHd(hit.body.toString('utf8'),m[1]))};
    else if(hit.status===200){let total=0;for(const v of s.hdCache.values())total+=v.body.length;if(total+hit.body.length<40*1024*1024)s.hdCache.set(sub,hit);}
  }
  const html=/text\/html/i.test(hit.type);
  res.writeHead(hit.status,{'content-type':hit.type,'content-length':hit.body.length,'cache-control':html?'no-store':'private, max-age=3600','referrer-policy':'no-referrer',
    'x-content-type-options':'nosniff','content-security-policy':"frame-ancestors 'self'",'permissions-policy':'fullscreen=(self), gamepad=(self), autoplay=(self)'});
  res.end(req.method==='HEAD'?undefined:hit.body);return true;
}
// Points the player at Duke's WebSocket tunnel and keeps its files under the HD path.
function rewriteHd(html,t){
  const base=`/api/link/hd/${t}/`;
  const shim=`<base href="${base}"><script>(function(){var P=location.origin.replace(/^http/,'ws')+'/api/link/hdws/${t}';var W=window.WebSocket;function D(u,p){try{var x=new URL(u,location.href);if(x.host===location.host&&x.pathname.indexOf('/api/link/hdws/')!==0)u=P;}catch(e){}return p===undefined?new W(u):new W(u,p);}D.prototype=W.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k,i){D[k]=i;});window.WebSocket=D;})();</script>`;
  html=html.replace(/(\s(?:src|href)=["'])\/(?!\/)/gi,`$1${base}`);
  return /<head[^>]*>/i.test(html)?html.replace(/<head[^>]*>/i,h=>h+shim):shim+html;
}
// WebSocket upgrade for /api/link/hdws/<token>: a minimal RFC 6455 server, relayed to the agent.
export function handleHdUpgrade(req,socket){
  const m=/^\/api\/link\/hdws\/([\w-]+)$/.exec(new URL(req.url,'http://x').pathname);
  const s=m&&linkByHd(m[1]);const key=req.headers['sec-websocket-key'];
  if(!s||!key||!online(s)){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
  const W=hdWs(s);
  if(W.chans.size>=6){socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const proto=String(req.headers['sec-websocket-protocol']||'').split(',')[0].trim();
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto?`Sec-WebSocket-Protocol: ${proto}\r\n`:''}\r\n`);
  socket.setNoDelay(true);
  const chan=nanoid(10);W.chans.set(chan,{socket});hdOut(W,{chan,open:true,port:s.pixel?.port||null});
  let buf=Buffer.alloc(0),frag=null,fragOp=0;
  const end=()=>{if(W.chans.delete(chan))hdOut(W,{chan,close:true});};
  socket.on('data',d=>{
    buf=Buffer.concat([buf,d]);if(buf.length>4*1024*1024){socket.destroy();return;}
    for(;;){
      if(buf.length<2)return;const fin=buf[0]&0x80,op=buf[0]&0x0f,masked=buf[1]&0x80;let len=buf[1]&0x7f,off=2;
      if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);off=4;}else if(len===127){if(buf.length<10)return;len=Number(buf.readBigUInt64BE(2));off=10;}
      if(len>2*1024*1024){socket.destroy();return;}
      const mo=off;if(masked)off+=4;if(buf.length<off+len)return;
      let pl=Buffer.from(buf.subarray(off,off+len));if(masked)for(let i=0;i<pl.length;i++)pl[i]^=buf[mo+(i&3)];
      buf=buf.subarray(off+len);
      if(op===8){wsClose(socket);end();return;}
      if(op===9){wsSend(socket,pl,10);continue;}
      if(op===10)continue;
      if(op===0){if(!frag)continue;frag.push(pl);if(!fin)continue;pl=Buffer.concat(frag);frag=null;}
      else if(!fin){frag=[pl];fragOp=op;continue;}
      const kind=op===0?fragOp:op;
      hdOut(W,kind===2?{chan,b64:pl.toString('base64')}:{chan,data:pl.toString('utf8')});
    }
  });
  socket.on('close',end);socket.on('error',end);
}
function wsSend(socket,payload,op=1){
  try{const n=payload.length;const head=n<126?Buffer.from([0x80|op,n]):n<65536?Buffer.from([0x80|op,126,n>>8,n&255]):Buffer.concat([Buffer.from([0x80|op,127]),(()=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b;})()]);
    socket.write(Buffer.concat([head,payload]));}catch{}
}
function wsClose(socket){try{socket.write(Buffer.from([0x88,0]));socket.end();}catch{}}
