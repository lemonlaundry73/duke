// Duke Forger server — zero runtime dependencies (Node.js 22+ built-ins only).
import http from 'node:http';
import fs from 'node:fs/promises';
import './src/paths.js';
import { load, mutate } from './src/store.js';
import { Router, HttpError, id as nanoid, readJson, send, serveStatic } from './src/http.js';
import { registerProduction } from './src/routes-production.js';
import { registerRoadmap, roadmapView } from './src/routes-roadmap.js';
import { registerAuth, userFromRequest, requireUser, isAdminEmail } from './src/auth.js';
import { registerBilling, PLANS, planOf, stripeAutoSetup } from './src/billing.js';
import { emptyDesign, ensureDesign } from './src/pipeline.js';
import { settle } from './src/ctx.js';
import { runArt } from './src/art.js';
import { renderSite } from './src/site.js';
import { registerForge, startForgeSweeper } from './src/forge/index.js';
import { handleHd, handleHdUpgrade, registerLink } from './src/link.js';
import { registerTeam, startTeamWorker } from './src/team.js';
import { registerSupport, recordError } from './src/support.js';
import { PUBLIC_DIR, UPLOAD_DIR } from './src/paths.js';

export const VERSION='4.0.0';
const port=Number(process.env.PORT||3000);
await fs.mkdir(UPLOAD_DIR,{recursive:true});

// Jobs that were running when the server last stopped: resume Meshy jobs that have task ids, fail the rest.
const resumeArt=[];
await mutate(db=>{
  db.users ||= {};db.sessions ||= {};db.agents ||= {};db.certificates ||= {};
  for(const j of Object.values(db.jobs||{})){
    if(j.status!=='running') continue;
    if(j.type==='art'&&j.tasks&&Object.keys(j.tasks).length){ j.logs.push('Server restarted, resuming'); resumeArt.push(j.id); continue; }
    j.status='failed'; j.error='Server restarted while this job was running. Run it again.'; j.logs=[...(j.logs||[]),`ERROR: ${j.error}`];
  }
  return true;
});

const now=()=>new Date().toISOString();
const notFound=(what='not found')=>{ throw new HttpError(404,what); };

const r=new Router();
registerAuth(r);
registerBilling(r);
registerRoadmap(r);
registerProduction(r);
registerLink(r);
registerForge(r);
registerTeam(r);
registerSupport(r);
for(const id of resumeArt) void runArt(id);

r.get('/api/health',()=>({ok:true,version:VERSION}));

r.get('/api/projects',async({req})=>{
  const u=await requireUser(req);const db=await load();
  return Object.values(db.projects).filter(p=>p.ownerId===u.id).map(p=>(ensureDesign(p),{id:p.id,name:p.name,title:p.design?.vision?.title||p.name,updatedAt:p.updatedAt,mode:p.mode||'build'}));
});
r.post('/api/projects',async({req,body})=>{
  const u=await requireUser(req);const plan=PLANS[planOf(u)];
  const id=nanoid(10), t=now();
  const p=await mutate(db=>{
    const mine=Object.values(db.projects).filter(x=>x.ownerId===u.id).length;
    if(!isAdminEmail(u.email)&&mine>=plan.projects)throw new HttpError(402,`The ${plan.name} plan includes ${plan.projects} game${plan.projects===1?'':'s'}. Upgrade to start another.`);
    const p={id,ownerId:u.id,name:String(body.name||'Untitled Game').slice(0,120),createdAt:t,updatedAt:t,world:{seed:Math.floor(Math.random()*1e9)},npcs:[],design:emptyDesign(),mode:'build'};
    p.design.vision.title=p.name==='Untitled Game'?'':p.name;
    db.projects[id]=p;settle(db,p);return p;
  });
  return roadmapView(await load(),p).project;
});
r.get('/api/projects/:id',async({params})=>{const db=await load();const p=db.projects[params.id];if(!p)notFound();settle(db,p);return p;});
r.patch('/api/projects/:id',async({params,body})=>{
  const seed=Number(body.worldSeed);
  const p=await mutate(db=>{const p=db.projects[params.id];if(!p)return null;
    if('name' in body)p.name=String(body.name||'Untitled Game').slice(0,120);
    if(Number.isFinite(seed)){p.world ||= {};p.world.seed=Math.abs(Math.floor(seed))%1e9;}
    p.updatedAt=now();return p;});
  return p||notFound();
});
r.del('/api/projects/:id',async({params})=>{
  await mutate(db=>{if(!db.projects[params.id])return null;delete db.projects[params.id];return true;});
  return {ok:true};
});
r.get('/api/jobs/:id',async({params})=>(await load()).jobs[params.id]||notFound());

// Routes that do not need a logged-in user (agents authenticate with their own token, Stripe with a signature).
const OPEN_API=[/^\/api\/health$/,/^\/api\/auth\//,/^\/api\/billing\/(plans|webhook)$/,/^\/api\/roadmap$/,/^\/api\/course\/quiz\/\d+$/,/^\/api\/lessons\/\d+\/video$/,/^\/api\/pipeline$/,/^\/api\/support\/(chat|faq)$/,
  /^\/api\/agent\/(hello|next|inspect|setup\.ps1|guide|proof)$/,/^\/api\/agent\/builds\//,/^\/api\/agent\/link\//,/^\/api\/agent\/forge\//,/^\/api\/agent\/projects\//];
async function guard(req,pathname){
  if(OPEN_API.some(re=>re.test(pathname)))return;
  const db=await load();
  const u=await userFromRequest(req,db);
  if(!u)throw new HttpError(401,'Log in to continue');
  req.user=u;
  const pm=/^\/api\/projects\/([^/]+)/.exec(pathname);
  if(pm){const p=db.projects[decodeURIComponent(pm[1])];if(!p||p.ownerId!==u.id)throw new HttpError(404,'project not found');}
  const jm=/^\/api\/jobs\/([^/]+)/.exec(pathname);
  if(jm){const j=db.jobs?.[decodeURIComponent(jm[1])];if(!j||db.projects[j.projectId]?.ownerId!==u.id)throw new HttpError(404,'not found');}
}

const PAGES={'/win':'/agent/win.ps1','/studio':'/studio.html','/login':'/login.html','/signup':'/login.html','/admin':'/admin.html','/companion':'/companion.html','/forge':'/forge.html','/reset':'/login.html','/forgot':'/login.html'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const pathname=url.pathname;
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('referrer-policy','strict-origin-when-cross-origin');
  try{
    if(pathname.startsWith('/api/link/hd/')&&await handleHd(req,res,pathname,url.search))return;
    if(pathname.startsWith('/api/')){
      const m=r.match(req.method,pathname);
      if(!m) throw new HttpError(404,'Unknown API route');
      if(m.methodNotAllowed) throw new HttpError(405,'Method not allowed');
      await guard(req,pathname);
      const ct=req.headers['content-type']||'';
      const skipBody=/multipart\/form-data/i.test(ct)||/application\/(zip|octet-stream)|image\//i.test(ct)||pathname==='/api/billing/webhook';
      const body=(['POST','PATCH'].includes(req.method)&&!skipBody)?await readJson(req):{};
      const out=await m.handler({req,res,params:m.params,body,query:url.searchParams});
      if(!res.headersSent) send(res,200,out??{ok:true});
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD') throw new HttpError(405,'Method not allowed');
    if(pathname.startsWith('/uploads/')){
      // Proof files live under uploads/private and are only served through the owner-checked API.
      if(pathname.startsWith('/uploads/private/'))throw new HttpError(404,'not found');
      if(await serveStatic(req,res,UPLOAD_DIR,pathname.slice('/uploads'.length))) return;
      throw new HttpError(404,'not found');
    }
    if(PAGES[pathname]&&await serveStatic(req,res,PUBLIC_DIR,PAGES[pathname])) return;
    if(pathname!=='/'&&await serveStatic(req,res,PUBLIC_DIR,pathname)) return;
    const page=await renderSite(pathname,req);
    if(page){res.writeHead(page.status||200,{'content-type':page.type||'text/html; charset=utf-8','cache-control':page.cache||'public, max-age=300'});return res.end(req.method==='HEAD'?undefined:page.body);}
    throw new HttpError(404,'not found');
  }catch(err){
    const status=err instanceof HttpError?err.status:500;
    if(!(err instanceof HttpError)){console.error(`[${req.method} ${pathname}]`,err);recordError(`${req.method} ${pathname}`,err);}
    if(pathname.startsWith('/api/')) return send(res,status,{error:status===500?'Server error':err.message||'Server error'});
    const page=await renderSite('/__404',req).catch(()=>null);
    if(page&&!res.headersSent){res.writeHead(404,{'content-type':'text/html; charset=utf-8'});return res.end(page.body);}
    send(res,status,{error:err.message||'Server error'});
  }
});

server.on('upgrade',(req,socket)=>{socket.on('error',()=>{});if(req.url.startsWith('/api/link/hdws/'))handleHdUpgrade(req,socket);else socket.destroy();});
server.listen(port,()=>{console.log(`Duke Forger v${VERSION} running on http://localhost:${port}`);void stripeAutoSetup();startForgeSweeper();if(process.env.TEAM_WORKER!=='0')startTeamWorker(Number(process.env.TEAM_TICK_MS)||4000);});
const shutdown=()=>server.close(()=>process.exit(0));
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
