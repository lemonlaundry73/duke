// Duke Forger playable city: on-foot + driving, traffic, pedestrians, NPCs, jobs, day/night, weather.
import { Renderer, INST_FLOATS } from './renderer.js';
import * as M from './models.js';
import { buildCity, collide, insideBuilding, carColor, B, DIRS, yawOf, rightOf, SIZES } from './city.js';
import { loadGLB } from './glb.js';
let N=14,E=840; // current city size (one Game per page)
import { clamp, lerp, smooth, mix3, norm3, angleDiff, rng, project } from './math.js';

const KEYS=[[-.25,[.004,.007,.02],[.025,.03,.07],[.22,.28,.45]],[-.02,[.05,.06,.18],[.5,.25,.22],[.9,.35,.2]],[.06,[.12,.17,.42],[1,.5,.3],[2.6,1.3,.6]],[.16,[.11,.2,.52],[1,.6,.36],[3.3,1.95,.95]],[.3,[.1,.25,.6],[.78,.74,.72],[3.3,2.7,2]],[.55,[.08,.24,.64],[.55,.72,.92],[3.3,3.1,2.85]]];
function envAt(tod,rain){
  const a=(tod-6)/12*Math.PI;
  const sun=norm3([Math.cos(a),Math.sin(a)*.92,.38]);
  const el=sun[1];let k=0;while(k<KEYS.length-2&&el>KEYS[k+1][0])k++;
  const t=smooth(KEYS[k][0],KEYS[k+1][0],el);
  let top=mix3(KEYS[k][1],KEYS[k+1][1],t),hor=mix3(KEYS[k][2],KEYS[k+1][2],t),col=mix3(KEYS[k][3],KEYS[k+1][3],t);
  const night=smooth(.06,-.14,el);
  let light=sun;
  if(el<0){light=norm3([-sun[0],Math.max(-sun[1],.25),-sun[2]]);col=mix3(col,[.22,.28,.45],smooth(-.02,-.12,el));}
  if(rain>0){const g=x=>x.map(v=>lerp(v,(x[0]+x[1]+x[2])/3*.55,rain*.75));top=g(top);hor=g(hor);col=col.map(v=>v*(1-rain*.65));}
  return {sunDir:sun,lightDir:light,lightColor:col,skyTop:top,skyHor:hor,sunVis:smooth(-.04,.04,el)*(1-rain*.85),night,rain,
    fog:.00075+night*.0003,exposure:lerp(1,1.45,night)*(1+rain*.15)};
}

const PED_SHIRTS=[[.9,.9,.88],[.15,.35,.7],[.8,.2,.25],[.95,.75,.2],[.2,.6,.45],[.95,.5,.65],[.1,.1,.12],[.45,.75,.9],[.98,.55,.25],[.55,.35,.7]];

export class Game{
  constructor(canvas,{project,mode='play',hud=null,onTalk=null}={}){
    this.canvas=canvas;this.mode=mode;this.hud=hud;this.onTalk=onTalk;
    this.r=new Renderer(canvas,{shadowSize:mode==='play'?2048:1536,maxScale:mode==='play'?1.5:1.25});
    this.keys={};this.running=false;this.t0=performance.now();this.time=0;
    this.tod=mode==='play'?17.25:17.4;this.rain=0;this.rainTarget=0;
    this.money=0;this.camYaw=0;this.camPitch=.32;this.lastMouse=0;this.shake=0;
    this.frameMs=16;this.ui={};
    const R=this.r;
    this.meshes={
      building:R.mesh(M.buildingGeo(),800),car:R.mesh(M.carGeo(),80),suv:R.mesh(M.suvGeo(),40),police:R.mesh(M.policeGeo(),20),
      ped:R.mesh(M.pedGeo(),160),palm:R.mesh(M.palmGeo(),700),tree:R.mesh(M.treeGeo(),300),lamp:R.mesh(M.lampGeo(),900),marker:R.mesh(M.markerGeo(),2)
    };
    this.glbCache={};this.models={};
    this.setProject(project||{name:'Duke City',world:{seed:7},npcs:[],systems:{}});
    if(mode==='play')this.bindInput();
  }
  // what the city layout depends on; changing any of these rebuilds the world
  layoutKey(p){const d=p.design||{};return JSON.stringify([p.world?.seed||7,d.world?.size,(d.districts||[]).map(x=>[x.id,x.style,x.name]),(d.landmarks||[]).map(x=>[x.id,x.district])]);}
  setProject(p){
    const d=p.design||{};
    const key=this.layoutKey(p);
    const sameWorld=this.project&&this.project.id===p.id&&this.key===key;
    this.project=p;this.design=d;
    if(d.world?.default_time!=null&&d.world.default_time!==''&&!sameWorld)this.tod=Number(d.world.default_time)%24;
    if(!sameWorld&&d.world?.weather)this.rainTarget=this.rain=d.world.weather==='Stormy'?1:0;
    if(sameWorld){this.syncNpcs();this.syncModels();return;}
    this.key=key;const seed=(p.world?.seed||7)>>>0;this.seed=seed;this.R=rng(seed^0x9e3779b9);
    this.city=buildCity(seed,{n:SIZES[d.world?.size]||(d.world?.size?12:14),districts:(d.districts||[]).filter(x=>x.name&&x.style),landmarks:(d.landmarks||[]).filter(x=>x.district)});
    N=this.city.N;E=this.city.E;
    const R=this.r;
    if(this.blocksTex)R.gl.deleteTexture(this.blocksTex);
    this.blocksTex=R.dataTexture(this.city.blocks,N,N);
    this.ground={blocks:this.blocksTex,B,N,planes:[R.plane(this.city.hasBeach?-46:-6000,-6000,E+6000,E+6000,0)]};
    this.water=this.city.hasBeach?R.plane(-6000,-6000,-46,E+6000,.12):null;
    this.uploadStatic();
    this.spawnWorld();
    this.syncModels();
  }
  // Load creator GLB models (vehicles, landmarks) into textured meshes.
  async glb(url){
    if(!this.glbCache[url])this.glbCache[url]=loadGLB(url).then(m=>({model:m,mesh:this.r.texMesh(m,64)})).catch(e=>{console.warn('GLB failed',url,e.message);return null;});
    return this.glbCache[url];
  }
  syncModels(){
    const d=this.design||{},want={};
    for(const v of d.vehicles||[])if(v.art?.model?.glb)want['veh:'+v.id]={url:v.art.model.glb,yaw:(v.art.yaw||0)*Math.PI/180,len:v.class==='Motorbike'?2.2:v.class==='Truck'?7:v.class==='SUV'?4.9:4.6,kind:'vehicle',ent:v};
    for(const l of d.landmarks||[])if(l.art?.model?.glb)want['lm:'+l.id]={url:l.art.model.glb,yaw:(l.art.yaw||0)*Math.PI/180,kind:'landmark',ent:l};
    const KIT={'Palm tree':'palm','Street tree':'tree'};for(const k of d.kit||[]){const n=KIT[k.kind];if(n&&k.art?.model?.glb&&!want['kit:'+n])want['kit:'+n]={url:k.art.model.glb,yaw:(k.art.yaw||0)*Math.PI/180,kind:'kit',height:n==='palm'?9:7,ent:k};}
    this.models=Object.fromEntries(Object.entries(this.models).filter(([k])=>want[k]));
    for(const [k,w] of Object.entries(want)){
      if(this.models[k]?.url===w.url){Object.assign(this.models[k],{yaw:w.yaw,ent:w.ent});continue;}
      this.models[k]={...w,loading:true};
      this.glb(w.url).then(res=>{const m=this.models[k];if(!m||m.url!==w.url)return;m.loading=false;m.res=res;this.refreshStatic();});
    }
    this.refreshStatic();
  }
  refreshStatic(){if(this.city){this.uploadStatic();if(!this.running)this.renderOnce?.(0);}}
  sys(k){return this.project.systems?.[k]!==false;}
  put(mesh,i,x,y,z,yaw,sx,sy,sz,c,e){
    const d=mesh.data,o=i*INST_FLOATS;
    d[o]=x;d[o+1]=y;d[o+2]=z;d[o+3]=yaw;d[o+4]=sx;d[o+5]=sy;d[o+6]=sz;d[o+7]=0;
    d[o+8]=c[0];d[o+9]=c[1];d[o+10]=c[2];d[o+11]=c[3]??1;d[o+12]=e[0];d[o+13]=e[1];d[o+14]=e[2];d[o+15]=e[3];
  }
  ensure(mesh,n){if(n>mesh.capacity){const d=new Float32Array(n*INST_FLOATS);d.set(mesh.data);mesh.data=d;}}
  uploadStatic(){
    const c=this.city,m=this.meshes;
    this.ensure(m.building,c.buildings.length);
    const lmBuild=c.landmarkSlots.filter(sl=>!this.models['lm:'+sl.id]?.res);
    this.ensure(m.building,c.buildings.length+lmBuild.length);
    c.buildings.forEach((b,i)=>{const base=b.base||0;this.put(m.building,i,b.x,base,b.z,0,b.w,b.h-base,b.d,b.color,[b.style,b.seed,base,0]);});
    lmBuild.forEach((sl,k)=>this.put(m.building,c.buildings.length+k,sl.x,0,sl.z,0,sl.size*.7,34,sl.size*.7,[.95,.78,.35],[2,77+k,0,0]));
    this.r.upload(m.building,c.buildings.length+lmBuild.length);
    this.glbDraw=[];
    for(const sl of c.landmarkSlots){const md=this.models['lm:'+sl.id];if(!md?.res)continue;const sz=md.res.model.size,fit=sl.size*.85/Math.max(sz[0],sz[2],1e-3);
      this.put(md.res.mesh,0,sl.x,0,sl.z,md.yaw,fit,fit,fit,[1,1,1],[0,0,0,0]);this.r.upload(md.res.mesh,1);this.glbDraw.push({mesh:md.res.mesh,kind:0});}
    const kitDraw=[];
    for(const [name,list,mesh,tint] of [['palm',c.palms,m.palm,i=>[.28+.08*Math.sin(i),.48,.2]],['tree',c.trees,m.tree,i=>[.2+.06*Math.sin(i*3),.42,.16]]]){
      const kd=this.models['kit:'+name];
      if(kd?.res){const km=kd.res.mesh,k=kd.height/Math.max(kd.res.model.size[1],1e-3);this.ensure(km,list.length);
        list.forEach((p,i)=>this.put(km,i,p.x,0,p.z,p.yaw+kd.yaw,k*p.s,k*p.s,k*p.s,[1,1,1],[0,0,0,0]));this.r.upload(km,list.length);mesh.n=0;kitDraw.push({mesh:km,kind:0});continue;}
      this.ensure(mesh,list.length);list.forEach((p,i)=>this.put(mesh,i,p.x,0,p.z,p.yaw,p.s,p.s,p.s,tint(i),[0,0,0,0]));this.r.upload(mesh,list.length);
    }
    this.ensure(m.lamp,c.lamps.length);
    c.lamps.forEach((p,i)=>this.put(m.lamp,i,p.x,0,p.z,p.yaw,1,1,1,[1,1,1],[0,0,0,0]));
    this.r.upload(m.lamp,c.lamps.length);
    this.drawList=[
      {mesh:m.building,kind:1},{mesh:m.palm,kind:0},{mesh:m.tree,kind:0},{mesh:m.lamp,kind:0},
      {mesh:m.car,kind:0},{mesh:m.suv,kind:0},{mesh:m.police,kind:0},{mesh:m.ped,kind:2},{mesh:m.marker,kind:0,noShadow:true},...this.glbDraw,...kitDraw
    ];
    this.buildMinimap();
  }
  // ---------- world population ----------
  spawnWorld(){
    const R=this.R,c=this.city;
    this.cars=[];
    for(const p of c.parked)this.cars.push({type:p.type,vid:this.pickVehicle(false),color:p.color,x:p.x,z:p.z,yaw:p.yaw,v:0,ai:false,vx:0,vz:0});
    const dens={Light:.55,Normal:1,Heavy:1.5};const dw=this.design?.world||{};
    const traffic=this.sys('traffic')?Math.round((this.mode==='play'?55:45)*(dens[dw.traffic]||1)*(N/14)):0;
    for(let k=0;k<traffic;k++)this.spawnTraffic();
    this.peds=[];
    for(let k=0;k<Math.round((this.mode==='play'?95:70)*(dens[dw.crowds]||1)*(N/14));k++)this.spawnPed();
    if(c.hasBeach)for(let k=0;k<26;k++)this.peds.push(this.beachPed());
    this.syncNpcs();
    const start=this.findSidewalkSpot(c.center[0]-40,c.center[1]);
    this.player={x:start[0],z:start[1],y:0,vy:0,yaw:0,phase:0,speed:0,car:null};
    (this.design?.vehicles||[]).filter(v=>v.spawn==='Player garage').forEach((v,k)=>this.cars.push({type:'car',vid:v.id,color:[.9,.9,.9],x:start[0]-3.5,z:start[1]+6+k*6,yaw:0,v:0,ai:false,vx:0,vz:0}));
    this.camYaw=0;
    this.newJob();
  }
  pickVehicle(police){
    const vs=this.design?.vehicles||[];
    const pool=police?vs.filter(v=>v.class==='Police'):vs.filter(v=>v.class!=='Police'&&v.spawn!=='Police only'&&v.spawn!=='Player garage');
    if(!pool.length)return null;const w=pool.map(v=>v.spawn==='Rare traffic'?1:3);let r=this.R()*w.reduce((a,b)=>a+b,0);
    for(let k=0;k<pool.length;k++){r-=w[k];if(r<=0)return pool[k].id;}return pool[0].id;
  }
  findSidewalkSpot(x,z){const i=Math.round(x/B),j=Math.floor(z/B);return [i*B+9,j*B+B/2+4];}
  spawnTraffic(x){
    const R=this.R;
    const d=Math.floor(R()*4),i=Math.floor(R()*(N+1)),j=Math.floor(R()*(N+1));
    const node=[i*B,j*B];const lane=R()<.5?1.75:5.25;
    // place along the segment leading into node
    const prev=[node[0]-DIRS[d][0]*B,node[1]-DIRS[d][1]*B];
    if(prev[0]<0||prev[1]<0||prev[0]>E||prev[1]>E)return this.spawnTraffic();
    const t=.2+R()*.5,rt=rightOf(d);
    const police=this.sys('police')&&R()<.1;
    const type=police?'police':R()<.25?'suv':'car';
    this.cars.push({type,vid:this.pickVehicle(police),color:police?[.92,.92,.94]:carColor(R),x:lerp(prev[0],node[0],t)+rt[0]*lane,z:lerp(prev[1],node[1],t)+rt[1]*lane,
      yaw:yawOf(d),v:8,ai:true,dir:d,lane,node:[i,j],stage:0,wp:null,vx:0,vz:0,siren:police&&R()<.3,cruise:10+R()*5});
    this.planWaypoint(this.cars[this.cars.length-1]);
  }
  planWaypoint(c){
    const [i,j]=c.node,nd=[i*B,j*B];
    if(c.stage===0){const rt=rightOf(c.dir);c.wp=[nd[0]-DIRS[c.dir][0]*12+rt[0]*c.lane,nd[1]-DIRS[c.dir][1]*12+rt[1]*c.lane];}
    else{
      if(c.next==null){
        const opts=[0,1,2,3].filter(d=>d!==(c.dir+2)%4&&i+DIRS[d][0]>=0&&j+DIRS[d][1]>=0&&i+DIRS[d][0]<=N&&j+DIRS[d][1]<=N);
        const straight=opts.includes(c.dir);c.next=straight&&this.R()<.55?c.dir:opts[Math.floor(this.R()*opts.length)];
      }
      const rt=rightOf(c.next);c.wp=[nd[0]+DIRS[c.next][0]*12+rt[0]*c.lane,nd[1]+DIRS[c.next][1]*12+rt[1]*c.lane];
    }
  }
  spawnPed(){
    const R=this.R;const i=Math.floor(R()*N),j=Math.floor(R()*N);
    const corner=Math.floor(R()*4);const p=this.cornerPos(i,j,corner);const t=R();
    const n=this.cornerPos(i,j,(corner+1)%4);
    this.peds.push(this.makePed(lerp(p[0],n[0],t),lerp(p[1],n[1],t),{i,j,corner:(corner+1)%4,dirn:1}));
  }
  makePed(x,z,nav,extra={}){
    const R=this.R;
    return {x,z,yaw:0,phase:R()*6,speed:1.1+R()*.5,base:1.1+R()*.5,shirt:PED_SHIRTS[Math.floor(R()*PED_SHIRTS.length)],
      pants:R(),skin:R(),hair:R(),off:(R()-.5)*1.4,nav,flee:0,...extra};
  }
  beachPed(){const R=this.R;const z=-80+R()*(E+160),x=-20-R()*22;return this.makePed(x,z,null,{beach:true,tx:x,tz:z,idle:R()*5});}
  cornerPos(i,j,c){const x0=i*B+9,x1=(i+1)*B-9,z0=j*B+9,z1=(j+1)*B-9;return [[x0,z0],[x1,z0],[x1,z1],[x0,z1]][c];}
  syncNpcs(){
    if(!this.peds)return;
    this.peds=this.peds.filter(p=>!p.npc);
    const pid=this.project.id||'';
    const cast=(this.design?.characters||[]).filter(ch=>ch.name&&ch.role!=='Protagonist').map(ch=>({id:ch.id,name:ch.name,role:ch.role,bio:ch.personality||ch.backstory||'',chatUrl:`/api/projects/${pid}/design/characters/${ch.id}/chat`}));
    const list=[...cast,...(this.project.npcs||[]).map(n=>({...n,chatUrl:`/api/projects/${pid}/npcs/${n.id}/chat`}))];const c=this.city.center;
    list.forEach((n,k)=>{
      const i=clamp(Math.floor(c[0]/B)-1+(k%3),0,N-1),j=clamp(Math.floor(c[1]/B)+Math.floor(k/3)%3-1,0,N-1);
      const p=this.cornerPos(i,j,k%4);
      this.peds.push(this.makePed(p[0],p[1],{i,j,corner:(k+1)%4,dirn:k%2?1:-1},{npc:n,shirt:[.95,.78,.25],base:1}));
    });
  }
  // ---------- jobs ----------
  newJob(){
    const R=this.R,p=this.player;let x,z,tries=0;
    do{const i=Math.floor(R()*N),j=Math.floor(R()*N),c=this.cornerPos(i,j,Math.floor(R()*4));x=c[0];z=c[1];tries++;}
    while(Math.hypot(x-p.x,z-p.z)<220&&tries<40);
    this.job={x,z,start:this.time,dist:Math.hypot(x-p.x,z-p.z),district:this.city.districtOf(Math.floor(x/B),Math.floor(z/B))};
  }
  // ---------- input ----------
  bindInput(){
    const c=this.canvas;
    this._kd=e=>{if(!this.running||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))return;const k=e.key.toLowerCase();
      if(['w','a','s','d',' ','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(k))e.preventDefault();
      if(!this.keys[k]){if(k==='f')this.toggleCar();if(k==='e')this.talk();if(k==='t')this.tod=(this.tod+1)%24;if(k==='r'&&this.sys('weather'))this.rainTarget=this.rainTarget>0?0:1;if(k==='h')this.hud?.toggleHelp?.();}
      this.keys[k]=true;};
    this._ku=e=>{this.keys[e.key.toLowerCase()]=false;};
    this._mm=e=>{if(document.pointerLockElement===c||this.dragging){this.camYaw-=e.movementX*.0025;this.camPitch=clamp(this.camPitch+e.movementY*.002,-.15,1.2);this.lastMouse=this.time;}};
    this._md=e=>{if(!this.running)return;if(c.requestPointerLock&&e.button===0){try{c.requestPointerLock()}catch{}}this.dragging=true;};
    this._mu=()=>{this.dragging=false;};
    window.addEventListener('keydown',this._kd);window.addEventListener('keyup',this._ku);
    window.addEventListener('mousemove',this._mm);c.addEventListener('mousedown',this._md);window.addEventListener('mouseup',this._mu);
    this._blur=()=>{this.keys={};};window.addEventListener('blur',this._blur);
  }
  toggleCar(){
    const p=this.player;
    if(p.car){
      const car=p.car,rt=[Math.cos(car.yaw),-Math.sin(car.yaw)];
      let nx=car.x+rt[0]*2.2,nz=car.z+rt[1]*2.2;const r=collide(this.city,nx,nz,.4);
      p.x=r.x;p.z=r.z;p.yaw=car.yaw;car.driven=false;car.ai=false;car.v=0;p.car=null;this.toast?.('On foot');return;
    }
    let best=null,bd=5;
    for(const c of this.cars){const d=Math.hypot(c.x-p.x,c.z-p.z);if(d<bd){bd=d;best=c;}}
    if(best){best.ai=false;best.driven=true;best.siren=false;best.vx=Math.sin(best.yaw)*best.v;best.vz=Math.cos(best.yaw)*best.v;p.car=best;this.camYaw=best.yaw;}
  }
  nearbyNpc(){const p=this.player;if(p.car)return null;let best=null,bd=3.2;for(const q of this.peds)if(q.npc){const d=Math.hypot(q.x-p.x,q.z-p.z);if(d<bd){bd=d;best=q;}}return best;}
  talk(){const q=this.nearbyNpc();if(q&&this.onTalk){this.keys={};if(document.pointerLockElement)document.exitPointerLock();q.talking=true;this.onTalk(q.npc,()=>{q.talking=false;});}}
  // ---------- simulation ----------
  update(dt){
    this.time+=dt;
    this.tod=(this.tod+dt/(this.mode==='play'?45:90))%24;
    this.rain=lerp(this.rain,this.rainTarget,1-Math.exp(-dt*.5));
    if(this.mode==='play')this.updatePlayer(dt);
    this.updateTraffic(dt);
    this.updatePeds(dt);
    if(this.mode==='play'&&this.job){const p=this.player.car||this.player;if(Math.hypot(p.x-this.job.x,p.z-this.job.z)<4.5){
      const secs=this.time-this.job.start,pay=Math.round(120+this.job.dist*.6+Math.max(0,90-secs)*3);this.money+=pay;this.toast?.(`Delivery complete  +$${pay}`);this.newJob();}}
  }
  updatePlayer(dt){
    const p=this.player,k=this.keys,city=this.city;
    const fw=(k.w||k.arrowup?1:0)-(k.s||k.arrowdown?1:0),st=(k.a||k.arrowleft?1:0)-(k.d||k.arrowright?1:0);
    if(p.car){
      const c=p.car;const f=[Math.sin(c.yaw),Math.cos(c.yaw)],r=[-f[1],f[0]];
      let vf=c.vx*f[0]+c.vz*f[1],vl=c.vx*r[0]+c.vz*r[1];
      const hb=!!k[' '];
      if(fw>0)vf+=(vf<0?22:13*(1-Math.max(0,vf)/46))*dt;
      else if(fw<0)vf-=(vf>.5?24:7*(1+vf/12))*dt;
      else vf-=Math.sign(vf)*Math.min(Math.abs(vf),2.2*dt);
      if(hb)vf-=Math.sign(vf)*Math.min(Math.abs(vf),9*dt);
      vf*=1-.12*dt;
      const steerMax=.6/(1+Math.abs(vf)/18);
      c.steer=lerp(c.steer||0,st*steerMax,1-Math.exp(-dt*8));
      const yawRate=vf*Math.tan(c.steer)/2.7*(hb?1.5:1);
      c.yaw+=yawRate*dt;
      vl*=Math.exp(-(hb?1.2:9)*dt);
      vl+=-yawRate*vf*dt*(hb?.25:.02);
      const f2=[Math.sin(c.yaw),Math.cos(c.yaw)],r2=[-f2[1],f2[0]];
      c.vx=f2[0]*vf+r2[0]*vl;c.vz=f2[1]*vf+r2[1]*vl;
      c.x+=c.vx*dt;c.z+=c.vz*dt;
      c.brake=fw<0&&vf>.5||hb?1:0;
      // world collision (two circles)
      for(const s of [1.3,-1.3]){
        const cx=c.x+f2[0]*s,cz=c.z+f2[1]*s,res=collide(city,cx,cz,1.05);
        if(res.hit){c.x+=res.x-cx;c.z+=res.z-cz;const vn=c.vx*res.nx+c.vz*res.nz;if(vn<0){c.vx-=vn*res.nx*1.4;c.vz-=vn*res.nz*1.4;c.vx*=.7;c.vz*=.7;this.shake=Math.min(1,Math.abs(vn)/15);}}
      }
      c.v=Math.hypot(c.vx,c.vz)*Math.sign(vf||1);
      p.x=c.x;p.z=c.z;p.yaw=c.yaw;p.speed=Math.abs(vf);
      if(this.time-this.lastMouse>1.4&&Math.abs(vf)>2)this.camYaw+=angleDiff(this.camYaw,vf>=0?c.yaw:c.yaw)*(1-Math.exp(-dt*2.5));
    }else{
      const run=k.shift?1:0,spd=run?7.5:3.6;
      const cf=[Math.sin(this.camYaw),Math.cos(this.camYaw)],cr=[-cf[1],cf[0]];
      let mx=cf[0]*fw-cr[0]*st,mz=cf[1]*fw-cr[1]*st;const ml=Math.hypot(mx,mz);
      if(ml>0){mx/=ml;mz/=ml;p.yaw+=angleDiff(p.yaw,Math.atan2(mx,mz))*(1-Math.exp(-dt*12));}
      p.speed=lerp(p.speed,ml>0?spd:0,1-Math.exp(-dt*10));
      p.x+=Math.sin(p.yaw)*p.speed*dt;p.z+=Math.cos(p.yaw)*p.speed*dt;
      if(k[' ']&&p.y<=0)p.vy=5.2;
      p.vy-=16*dt;p.y=Math.max(0,p.y+p.vy*dt);
      const res=collide(city,p.x,p.z,.4,p.y);p.x=res.x;p.z=res.z;
      for(const c of this.cars){if(Math.abs(c.x-p.x)>4||Math.abs(c.z-p.z)>4)continue;const f=[Math.sin(c.yaw),Math.cos(c.yaw)];
        for(const o of [1.2,0,-1.2]){const cx=c.x+f[0]*o,cz=c.z+f[1]*o,dx=p.x-cx,dz=p.z-cz,d=Math.hypot(dx,dz);if(d<1.35&&d>1e-3&&p.y<1.2){p.x=cx+dx/d*1.35;p.z=cz+dz/d*1.35;}}}
      p.phase+=p.speed*dt*2.6;
    }
    p.x=clamp(p.x,-44,E+600);p.z=clamp(p.z,-600,E+600);
  }
  updateTraffic(dt){
    const cars=this.cars,pl=this.player;
    for(const c of cars){
      if(!c.ai)continue;
      const f=[Math.sin(c.yaw),Math.cos(c.yaw)];
      // waypoint following
      const dx=c.wp[0]-c.x,dz=c.wp[1]-c.z,dist=Math.hypot(dx,dz);
      if(dist<3.2){
        if(c.stage===0)c.stage=1;
        else{c.stage=0;c.dir=c.next;c.next=null;c.node=[c.node[0]+DIRS[c.dir][0],c.node[1]+DIRS[c.dir][1]];}
        this.planWaypoint(c);continue;
      }
      const want=Math.atan2(dx,dz);
      c.yaw+=clamp(angleDiff(c.yaw,want),-1.5*dt*Math.max(.4,c.v/8),1.5*dt*Math.max(.4,c.v/8));
      let target=c.stage===1?6:c.cruise;
      if(c.stage===0&&dist<25)target=Math.min(target,lerp(6,c.cruise,dist/25));
      // yield to anything ahead
      const look=8+c.v*1.1;
      const check=(ox,oz,rad)=>{const rx=ox-c.x,rz=oz-c.z,fwd=rx*f[0]+rz*f[1];if(fwd<=0||fwd>look)return;const lat=Math.abs(rx*f[1]-rz*f[0]);if(lat<rad)target=Math.min(target,Math.max(0,(fwd-6)*.9));};
      for(const o of cars)if(o!==c)check(o.x,o.z,2.2);
      check(pl.x,pl.z,2.4);
      for(const q of this.peds)if(!q.beach)check(q.x,q.z,1.6);
      // intersection courtesy: wait if crossing traffic inside the box
      if(c.stage===0&&dist<6){const nd=[c.node[0]*B,c.node[1]*B];for(const o of cars){if(o===c||!o.ai)continue;if(Math.abs(o.x-nd[0])<9&&Math.abs(o.z-nd[1])<9&&o.dir%2!==c.dir%2){target=0;break;}}}
      c.brake=target<c.v-1?1:0;
      c.v=lerp(c.v,target,1-Math.exp(-dt*(target<c.v?3:1.2)));
      c.x+=Math.sin(c.yaw)*c.v*dt;c.z+=Math.cos(c.yaw)*c.v*dt;
    }
    // car-car contact with the player's car
    const pc=pl.car;
    if(pc)for(const o of cars){if(o===pc)continue;const dx=o.x-pc.x,dz=o.z-pc.z,d=Math.hypot(dx,dz);if(d<3.4&&d>.01){const nx=dx/d,nz=dz/d,push=(3.4-d);o.x+=nx*push*.6;o.z+=nz*push*.6;pc.x-=nx*push*.4;pc.z-=nz*push*.4;
      const vn=pc.vx*nx+pc.vz*nz;if(vn>0){pc.vx-=vn*nx*1.2;pc.vz-=vn*nz*1.2;this.shake=Math.min(1,vn/12);if(o.ai)o.v=0;}}}
  }
  updatePeds(dt){
    const pl=this.player,pc=pl.car;
    for(const q of this.peds){
      if(q.talking){q.yaw+=angleDiff(q.yaw,Math.atan2(pl.x-q.x,pl.z-q.z))*(1-Math.exp(-dt*6));q.phase=0;continue;}
      let tx,tz;
      if(q.beach){
        if(q.idle>0){q.idle-=dt;q.phase=0;continue;}
        tx=q.tx;tz=q.tz;if(Math.hypot(tx-q.x,tz-q.z)<1){q.tx=-19-this.R()*24;q.tz=q.z+(this.R()-.5)*40;q.idle=this.R()*8;continue;}
      }else{
        const n=q.nav,cp=this.cornerPos(n.i,n.j,n.corner);tx=cp[0];tz=cp[1];
        if(Math.hypot(tx-q.x,tz-q.z)<1.2){
          if(!q.npc&&this.R()<.3){ // cross the street
            const c=n.corner,xs=[[-1,1],[1,0],[1,3],[-1,2]][c],zs=[[-1,3],[-1,2],[1,1],[1,0]][c];
            const opt=this.R()<.5?[xs[0],0,xs[1]]:[0,zs[0],zs[1]];const ni=n.i+opt[0],nj=n.j+opt[1];
            if(ni>=0&&nj>=0&&ni<N&&nj<N){n.i=ni;n.j=nj;n.corner=opt[2];continue;}
          }
          n.corner=(n.corner+n.dirn+4)%4;continue;
        }
        // keep a lateral lane offset
        const ddx=tx-q.x,ddz=tz-q.z,l=Math.hypot(ddx,ddz)||1;tx+=-ddz/l*q.off;tz+=ddx/l*q.off;
      }
      // flee from fast cars
      if(pc&&Math.abs(pc.v)>4){const dx=q.x-pc.x,dz=q.z-pc.z,d=Math.hypot(dx,dz);if(d<5){q.x+=dx/d*(5-d)*.5;q.z+=dz/d*(5-d)*.5;q.flee=3;}}
      const playerNear=!pc&&Math.hypot(pl.x-q.x,pl.z-q.z)<1.1;
      if(q.flee>0)q.flee-=dt;
      q.speed=lerp(q.speed,playerNear?0:q.flee>0?4.5:q.base,1-Math.exp(-dt*4));
      q.yaw+=angleDiff(q.yaw,Math.atan2(tx-q.x,tz-q.z))*(1-Math.exp(-dt*5));
      q.x+=Math.sin(q.yaw)*q.speed*dt;q.z+=Math.cos(q.yaw)*q.speed*dt;
      q.phase+=q.speed*dt*2.6;
    }
  }
  // ---------- camera ----------
  camera(){
    if(this.mode!=='play'){
      const c=this.city.center,a=this.time*.035+.6,rad=330;
      const eye=[c[0]+Math.cos(a)*rad,95+Math.sin(this.time*.05)*15,c[1]+Math.sin(a)*rad];
      return {eye,target:[c[0]-30,35,c[1]],fov:.95,shadowCenter:[c[0]+Math.cos(a)*120,0,c[1]+Math.sin(a)*120],shadowRadius:220};
    }
    const p=this.player,car=p.car;
    const dist=car?9.5+Math.min(4,p.speed*.08):5.2,th=car?1.9:1.55;
    const tgt=[p.x,p.y+th,p.z];
    const pitch=this.camPitch*(car?.75:1)+(car?.08:0);
    const cf=[Math.sin(this.camYaw),Math.cos(this.camYaw)];
    let d=dist;
    for(let s=.6;s<=dist;s+=.4){const x=tgt[0]-cf[0]*s*Math.cos(pitch),y=tgt[1]+s*Math.sin(pitch),z=tgt[2]-cf[1]*s*Math.cos(pitch);if(insideBuilding(this.city,x,y,z)){d=Math.max(.8,s-.6);break;}}
    const sh=this.shake;this.shake*=.9;
    const eye=[tgt[0]-cf[0]*d*Math.cos(pitch)+(Math.random()-.5)*sh*.4,Math.max(.4,tgt[1]+d*Math.sin(pitch))+(Math.random()-.5)*sh*.4,tgt[2]-cf[1]*d*Math.cos(pitch)];
    const look=[tgt[0]+cf[0]*2,tgt[1]+(car?.2:.1),tgt[2]+cf[1]*2];
    const fov=car?1.05+Math.min(.25,p.speed*.006):1.0;
    return {eye,target:look,fov,shadowCenter:[p.x+cf[0]*40,0,p.z+cf[1]*40],shadowRadius:130};
  }
  // ---------- instance upload ----------
  uploadDynamic(env,camEye){
    const m=this.meshes,night=env.night>.3?1:0;
    const by={car:[],suv:[],police:[]},byModel={};
    for(const c of this.cars){const md=c.vid&&this.models['veh:'+c.vid];if(md?.res){(byModel['veh:'+c.vid] ||= []).push(c);}else by[c.type].push(c);}
    const live=new Set();
    for(const [k,list] of Object.entries(byModel)){const md=this.models[k],mesh=md.res.mesh,sz=md.res.model.size;
      const along=Math.abs(Math.cos(md.yaw))>.7?sz[2]:sz[0];const fit=md.len/Math.max(along,1e-3);
      this.ensure(mesh,list.length);list.forEach((c,i)=>this.put(mesh,i,c.x,0,c.z,c.yaw+md.yaw,fit,fit,fit,[1,1,1],[0,0,0,0]));this.r.upload(mesh,list.length);live.add(mesh);}
    for(const md of Object.values(this.models))if(md.kind==='vehicle'&&md.res&&!live.has(md.res.mesh))md.res.mesh.n=0;
    const vm=Object.values(this.models).filter(md=>md.kind==='vehicle'&&md.res).map(md=>md.res.mesh);
    for(const mesh of vm)if(!this.drawList.some(it=>it.mesh===mesh))this.drawList.push({mesh,kind:0});
    for(const t of ['car','suv','police']){
      const list=by[t];this.ensure(m[t],list.length);
      list.forEach((c,i)=>this.put(m[t],i,c.x,0,c.z,c.yaw,1,1,1,[...c.color,c.siren||c.type==='police'&&c.driven?1:0],[0,0,night||c.driven&&env.night>.15?1:0,c.brake?1:0]));
      this.r.upload(m[t],list.length);
    }
    const peds=this.peds,pl=this.player;const n=peds.length+(this.mode==='play'&&!pl.car?1:0);
    this.ensure(m.ped,n);
    peds.forEach((q,i)=>this.put(m.ped,i,q.x,0,q.z,q.yaw,1,1,1,[...q.shirt,q.npc?2:1],[q.phase,Math.min(.6,q.speed*.28),q.pants,q.skin]));
    if(n>peds.length)this.put(m.ped,peds.length,pl.x,pl.y,pl.z,pl.yaw,1,1,1,[.12,.62,.62,1],[pl.phase,pl.y>0?.25:Math.min(.75,pl.speed*.13),.62,.35]);
    this.r.upload(m.ped,n);
    if(this.mode==='play'&&this.job){this.put(m.marker,0,this.job.x,0,this.job.z,this.time,1,1,1,[1,.75,.2],[0,0,0,0]);this.r.upload(m.marker,1);}else m.marker.n=0;
    // headlights for ground pools: nearest cars to camera
    const heads=[];
    if(env.night>.05){
      const sorted=this.cars.filter(c=>c.ai||c.driven).map(c=>[c,(c.x-camEye[0])**2+(c.z-camEye[2])**2]).sort((a,b)=>a[1]-b[1]).slice(0,12);
      for(const [c] of sorted){const f=[Math.sin(c.yaw),Math.cos(c.yaw)];heads.push([c.x+f[0]*2.2,c.z+f[1]*2.2,f[0],f[1]]);}
    }
    return heads;
  }
  // ---------- frame ----------
  frame(now){
    if(!this.running)return;
    this.raf=requestAnimationFrame(t=>this.frame(t));
    const dt=Math.min(.05,(now-(this.last||now))/1000);this.last=now;
    if(dt>0){const steps=Math.ceil(dt/.02);for(let s=0;s<steps;s++)this.update(dt/steps);}
    const env=envAt(this.tod,this.rain);env.time=this.time;
    const cam=this.camera();env.eye=cam.eye;
    const heads=this.uploadDynamic(env,cam.eye);
    this.r.render({env,fov:cam.fov,target:cam.target,shadowCenter:cam.shadowCenter,shadowRadius:cam.shadowRadius,meshes:this.drawList,ground:this.ground,water:this.water,heads,vignette:this.mode==='play'?.9:.7});
    // adaptive resolution
    this.frameMs=lerp(this.frameMs,dt*1000,.05);
    if(this.time>3&&(this.adaptAt||0)<this.time){this.adaptAt=this.time+2;
      if(this.frameMs>34&&this.r.scale>.55){this.r.scale-=.1;}else if(this.frameMs<18&&this.r.scale<1){this.r.scale=Math.min(1,this.r.scale+.1);}}
    if(this.mode==='play')this.updateHud(env);
  }
  start(){if(this.running)return;this.running=true;this.last=0;this.raf=requestAnimationFrame(t=>this.frame(t));}
  stop(){this.running=false;cancelAnimationFrame(this.raf);this.keys={};if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
  renderOnce(seconds=0){ // for tests / thumbnails
    for(let s=0;s<seconds*50;s++)this.update(.02);
    const env=envAt(this.tod,this.rain);env.time=this.time;const cam=this.camera();env.eye=cam.eye;
    const heads=this.uploadDynamic(env,cam.eye);
    this.r.render({env,fov:cam.fov,target:cam.target,shadowCenter:cam.shadowCenter,shadowRadius:cam.shadowRadius,meshes:this.drawList,ground:this.ground,water:this.water,heads});
    if(this.mode==='play')this.updateHud(env);
  }
  destroy(){
    this.stop();
    window.removeEventListener('keydown',this._kd);window.removeEventListener('keyup',this._ku);window.removeEventListener('mousemove',this._mm);
    window.removeEventListener('mouseup',this._mu);window.removeEventListener('blur',this._blur);this.canvas.removeEventListener('mousedown',this._md);
    this.r.destroy();
  }
  // ---------- HUD ----------
  buildMinimap(){
    const s=.5,pad=220,W=Math.ceil((E+pad*2)*s),cv=document.createElement('canvas');cv.width=cv.height=W;
    const g=cv.getContext('2d');const X=x=>(x+pad)*s;
    g.fillStyle='#2c3a2a';g.fillRect(0,0,W,W);
    g.fillStyle='#d8c79c';g.fillRect(0,0,X(-11),W);
    g.fillStyle='#1d5b78';g.fillRect(0,0,X(-46),W);
    g.fillStyle='#6b6f74';g.fillRect(X(-11),X(-11),(E+22)*s,(E+22)*s);
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){
      const t=this.city.blocks[j*N+i];g.fillStyle=t===1?'#3f6b3a':t===2?'#444':'#2b2f33';
      g.fillRect(X(i*B+7),X(j*B+7),(B-14)*s,(B-14)*s);
    }
    g.fillStyle='#4a5058';for(const b of this.city.buildings)if(!b.base)g.fillRect(X(b.x-b.w/2),X(b.z-b.d/2),b.w*s,b.d*s);
    this.mini={cv,s,pad};
  }
  updateHud(env){
    const h=this.hud;if(!h)return;const p=this.player;
    const hh=Math.floor(this.tod),mm=Math.floor((this.tod%1)*60);
    h.set('clock',`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);
    h.set('money',`$${this.money.toLocaleString()}`);
    h.set('district',this.city.districtOf(clamp(Math.floor(p.x/B),0,N-1),clamp(Math.floor(p.z/B),0,N-1)));
    h.set('weather',this.rain>.5?'Rain':env.night>.5?'Clear night':'Clear');
    h.set('speed',p.car?`${Math.round(Math.abs(p.car.v)*3.6)}<small> km/h</small>`:'');
    const j=this.job;
    if(j)h.set('job',`Deliver the package to <b>${j.district}</b> · ${Math.round(Math.hypot(j.x-p.x,j.z-p.z))} m`);
    const npc=this.nearbyNpc();
    let prompt='';
    if(npc)prompt=`<kbd>E</kbd> Talk to ${escapeHtml(npc.npc.name)}`;
    else if(!p.car){let near=false;for(const c of this.cars)if(Math.hypot(c.x-p.x,c.z-p.z)<5){near=true;break;}if(near)prompt='<kbd>F</kbd> Enter vehicle';}
    else prompt='';
    h.set('prompt',prompt);
    // nametags for project NPCs
    const tags=[];
    for(const q of this.peds)if(q.npc){const d=Math.hypot(q.x-p.x,q.z-p.z);if(d>45)continue;const s=project(this.r.vp,[q.x,2.15,q.z]);if(s[2]<=0)continue;tags.push({x:(s[0]*.5+.5)*100,y:(1-(s[1]*.5+.5))*100,name:q.npc.name,role:q.npc.role,d});}
    h.tags?.(tags);
    // minimap
    const mc=h.minimap;if(!mc)return;const g=mc.getContext('2d'),W=mc.width,mini=this.mini;
    g.clearRect(0,0,W,W);g.save();g.beginPath();g.arc(W/2,W/2,W/2-2,0,Math.PI*2);g.clip();
    g.fillStyle='#1d5b78';g.fillRect(0,0,W,W);
    g.translate(W/2,W/2);g.rotate(this.camYaw+Math.PI);g.scale(1.4,1.4);
    g.drawImage(mini.cv,-(p.x+mini.pad)*mini.s,-(p.z+mini.pad)*mini.s);
    const dot=(x,z,col,r)=>{g.fillStyle=col;g.beginPath();g.arc((x-p.x)*mini.s,(z-p.z)*mini.s,r,0,Math.PI*2);g.fill();};
    for(const c of this.cars)if(c.type==='police')dot(c.x,c.z,'#5aa0ff',1.6);
    for(const q of this.peds)if(q.npc)dot(q.x,q.z,'#f5c84b',2);
    if(j){const dx=(j.x-p.x)*mini.s,dz=(j.z-p.z)*mini.s,l=Math.hypot(dx,dz),R=W/2/1.4-8;
      const k=l>R?R/l:1;g.fillStyle='#ffbf3a';g.strokeStyle='#000';g.lineWidth=1;g.beginPath();g.arc(dx*k,dz*k,4.2,0,Math.PI*2);g.fill();g.stroke();}
    g.restore();
    g.save();g.translate(W/2,W/2);g.rotate(this.camYaw-p.yaw);g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=1.5;
    g.beginPath();g.moveTo(0,-8);g.lineTo(6,6);g.lineTo(0,3);g.lineTo(-6,6);g.closePath();g.fill();g.stroke();g.restore();
    g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=3;g.beginPath();g.arc(W/2,W/2,W/2-2,0,Math.PI*2);g.stroke();
  }
}
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export { envAt };
