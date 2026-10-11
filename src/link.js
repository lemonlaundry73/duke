// Duke Link: the creator's desktop tools (Unreal Engine 5, Blender, Character Creator 5, Visual Studio)
// shown live inside Duke and operated from Duke. The build agent on the creator's PC captures the chosen
// app window and sends frames; Duke relays them to the browser as an MJPEG stream, and relays the
// creator's clicks, keys and tool actions back to the agent. Everything is per user and in memory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { load, mutate } from './store.js';
import { HttpError, id as nanoid, readBody } from './http.js';
import { requireUser } from './auth.js';
import { agentFor, settle } from './ctx.js';
import { UPLOAD_DIR } from './paths.js';

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
  r.post('/api/agent/link/result',async({req,body})=>{
    const {tok}=await agentTok(req);const s=L(tok);
    s.results.set(String(body.id),{ok:!!body.ok,output:String(body.output||'').slice(0,20000),at:Date.now()});
    if(s.results.size>200)s.results.delete(s.results.keys().next().value);
    if(body.control!==undefined)s.control=body.control;
    return {ok:true};
  });

  // ---------------- creator side ----------------
  r.get('/api/link/status',async({req})=>{
    const {s,a}=await userLink(req);s.watchUntil=Math.max(s.watchUntil,Date.now()+30000);
    const m=a.machine||{};
    return {online:online(s),pcName:m.host||null,windows:s.windows,window:s.window,tools:TOOLS.map(t=>({...t,installed:t.id==='ue'?(m.engines||[]).length>0:t.id==='vs'?!!m.visualStudio:!!m.tools?.[t.id],open:s.windows.some(w=>w.tool===t.id)})),
      frameAge:s.frameAt?Date.now()-s.frameAt:null,fps:s.fps,size:[s.w,s.h],control:s.control,capture:!!s.capture};
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
  ue_play:{tool:'ue',label:'Play in the editor',plain:'Starts playing the open level inside Unreal.'},
  ue_stop:{tool:'ue',label:'Stop playing',plain:'Stops play mode.'},
  blender_new:{tool:'blender',label:'Open Blender ready to model',plain:'Starts Blender with an empty scene.'},
  git_commit:{tool:'ue',label:'Save a snapshot (commit)',plain:'Records the current state of your project in version control, so you can always go back.'}
};
export const publicActions=()=>Object.entries(ACTIONS).map(([id,a])=>({id,...a}));
