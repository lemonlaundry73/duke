// Seeded coastal city generator shared by the live preview (browser) and the Unreal export (server).
// Creator districts are zoned onto the block grid; each district style drives its architecture.
import { rng } from './math.js';

export const B=60, ROAD=7, WALK=11;
export const DIRS=[[1,0],[0,1],[-1,0],[0,-1]]; // +x,+z,-x,-z
export const yawOf=d=>Math.atan2(DIRS[d][0],DIRS[d][1]);
export const rightOf=d=>[-DIRS[d][1],DIRS[d][0]];
export const SIZES={'Small (8×8 blocks)':8,'Medium (12×12 blocks)':12,'Large (16×16 blocks)':16};

const PASTEL=[[.96,.66,.72],[.48,.82,.8],[.68,.9,.76],[.98,.88,.62],[.78,.7,.93],[.94,.93,.9],[1,.76,.6],[.62,.78,.95]];
const CONCRETE=[[.62,.6,.56],[.7,.66,.6],[.5,.49,.5],[.75,.72,.66],[.55,.36,.3],[.66,.58,.5],[.82,.8,.76]];
const GLASS=[[.42,.62,.75],[.38,.48,.58],[.55,.66,.62],[.6,.62,.7],[.32,.52,.66]];
const INDUSTRIAL=[[.45,.47,.5],[.55,.4,.32],[.36,.42,.48],[.6,.58,.5],[.5,.52,.46]];
// anchor position (block-space fraction) per district style
const ANCHOR={'Beachfront art deco':[0,.5],'Downtown towers':[.58,.46],'Nightlife strip':[.78,.62],'Industrial docks':[.5,1],'Residential':[.25,.18],'Suburbs':[.9,.12]};
const DEFAULT_DISTRICTS=[{id:'d-ocean',name:'Ocean Drive',style:'Beachfront art deco'},{id:'d-down',name:'Downtown',style:'Downtown towers'},
  {id:'d-neon',name:'Neon Row',style:'Nightlife strip'},{id:'d-harbor',name:'Harbor Docks',style:'Industrial docks'},{id:'d-palm',name:'Palm Heights',style:'Residential'},{id:'d-sun',name:'Sunset Hills',style:'Suburbs'}];

export function buildCity(seed,opts={}){
  const N=opts.n||14,E=N*B;
  const R=rng(seed||1),pick=a=>a[Math.floor(R()*a.length)];
  const districts=(opts.districts&&opts.districts.length?opts.districts:DEFAULT_DISTRICTS).map((d,i)=>({...d,index:i}));
  const hasBeach=districts.some(d=>d.style==='Beachfront art deco');
  // anchors, nudging duplicates of the same style apart
  const seen={};
  for(const d of districts){const a=ANCHOR[d.style]||[.5,.5];const k=seen[d.style]=(seen[d.style]||0)+1;
    d.anchor=[Math.min(.98,Math.max(0,a[0]+(k-1)*.18*(a[0]>.5?-1:1))),Math.min(1,Math.max(0,a[1]+(k-1)*.22*(a[1]>.5?-1:1)))];}
  const blocks=new Uint8Array(N*N),zone=new Uint8Array(N*N);
  const centers=districts.map(()=>[0,0,0]);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const u=(i+.5)/N,v=(j+.5)/N;let best=0,bd=1e9;
    for(const d of districts){
      if(d.style==='Beachfront art deco'&&i>1)continue;
      if(hasBeach&&i<=1&&d.style!=='Beachfront art deco')continue;
      const dd=Math.hypot(u-d.anchor[0],(v-d.anchor[1])*(d.style==='Industrial docks'?1.6:1));
      if(dd<bd){bd=dd;best=d.index;}
    }
    zone[j*N+i]=best;const c=centers[best];c[0]+=i;c[1]+=j;c[2]++;
  }
  districts.forEach((d,k)=>{const c=centers[k];d.center=c[2]?[(c[0]/c[2]+.5)*B,(c[1]/c[2]+.5)*B]:[E/2,E/2];d.blocks=c[2];});
  const buildings=[],palms=[],trees=[],lamps=[],parked=[],blockBuildings=Array.from({length:N*N},()=>[]);
  const downtown=districts.find(d=>d.style==='Downtown towers');
  const dc=downtown?[downtown.center[0]/B,downtown.center[1]/B]:[N*.58,N*.46];
  // landmark slots: the block nearest each district's centre
  const landmarkSlots=[];const used=new Set();
  for(const lm of opts.landmarks||[]){
    const d=districts.find(x=>x.id===lm.district);if(!d)continue;
    let best=-1,bd=1e9;
    for(let k=0;k<N*N;k++){if(zone[k]!==d.index||used.has(k))continue;const i=k%N,j=Math.floor(k/N);const dd=Math.hypot((i+.5)*B-d.center[0],(j+.5)*B-d.center[1]);if(dd<bd){bd=dd;best=k;}}
    if(best<0)continue;used.add(best);blocks[best]=3;
    const i=best%N,j=Math.floor(best/N);landmarkSlots.push({id:lm.id,name:lm.name,x:(i+.5)*B,z:(j+.5)*B,size:B-2*WALK-6,block:[i,j]});
  }
  const addB=(x,z,w,d,h,style,color,i,j)=>{const b={x,z,w,d,h,style,color,seed:Math.floor(R()*997)};buildings.push(b);blockBuildings[j*N+i].push(b);return b;};
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const k=j*N+i;if(blocks[k]===3){palms.push({x:(i+.5)*B-14,z:(j+.5)*B-14,yaw:R()*6.28,s:1},{x:(i+.5)*B+14,z:(j+.5)*B+14,yaw:R()*6.28,s:1});continue;}
    const x0=i*B+WALK+1,x1=(i+1)*B-WALK-1,z0=j*B+WALK+1,z1=(j+1)*B-WALK-1,S=x1-x0;
    const style=districts[zone[k]].style,dist=Math.hypot(i+.5-dc[0],j+.5-dc[1])/N;
    let type=0;const r=R();
    const parkP=style==='Suburbs'?.2:style==='Residential'?.12:style==='Downtown towers'?.05:style==='Beachfront art deco'?0:.07;
    const lotP=style==='Industrial docks'?.18:style==='Nightlife strip'?.1:.05;
    if(r<parkP)type=1;else if(r<parkP+lotP)type=2;
    blocks[k]=type;
    if(type===1){for(let n=0;n<7;n++){const a=R()*Math.PI*2,rr=12+R()*4;(R()<.5?palms:trees).push({x:i*B+B/2+Math.cos(a)*rr,z:j*B+B/2+Math.sin(a)*rr,yaw:R()*6.28,s:.85+R()*.4});}continue;}
    if(type===2){for(let row=0;row<3;row++)for(let n=0;n<11;n++)if(R()<.45)parked.push({x:x0+1.5+n*3,z:z0+6+row*12,yaw:R()<.5?0:Math.PI,type:R()<.25?'suv':'car',color:carColor(R)});continue;}
    const lot=(qx0,qz0,qx1,qz1,h,st,color)=>{
      const w=qx1-qx0,d=qz1-qz0,b=addB((qx0+qx1)/2,(qz0+qz1)/2,w,d,h,st,color,i,j);
      if(h>55&&R()<.75){const t=.55+R()*.25,h2=h*(.18+R()*.3);const tb=addB(b.x,b.z,w*t,d*t,h+h2,st,color,i,j);tb.base=h;
        if(R()<.5){const t2=t*.55;const sp=addB(b.x,b.z,w*t2,d*t2,h+h2+6+R()*14,st,color,i,j);sp.base=h+h2;}}
      return b;
    };
    const grid=(cols,rows,hmin,hmax,styleFn,gap=1,skip=.1)=>{const sx=S/cols,sz=S/rows;
      for(let a=0;a<cols;a++)for(let c=0;c<rows;c++){if(R()<skip)continue;const st=styleFn();lot(x0+a*sx+gap,z0+c*sz+gap,x0+(a+1)*sx-gap,z0+(c+1)*sz-gap,hmin+R()*(hmax-hmin),st[0],st[1]);}};
    switch(style){
      case 'Beachfront art deco':{const n=R()<.5?2:3,step=S/n;for(let q=0;q<n;q++)lot(x0,z0+q*step+.8,x1-(R()*6),z0+(q+1)*step-.8,9+R()*20,R()<.3?3:2,pick(PASTEL));break;}
      case 'Downtown towers':{const h=70+R()*150*Math.max(.25,1-dist*3);
        if(R()<.5)lot(x0+1,z0+1,x1-1,z1-1,h,R()<.68?1:0,R()<.68?pick(GLASS):pick(CONCRETE));
        else{const m=(x0+x1)/2;lot(x0,z0,m-1.5,z1,h,1,pick(GLASS));lot(m+1.5,z0,x1,z1,h*(.5+R()*.4),R()<.5?1:0,R()<.5?pick(GLASS):pick(CONCRETE));}break;}
      case 'Nightlife strip':grid(2,2,12,34,()=>{const s=R();return s<.6?[2,pick(PASTEL)]:[0,pick(CONCRETE)];},1.5,.05);break;
      case 'Industrial docks':grid(R()<.5?1:2,2,7,15,()=>[0,pick(INDUSTRIAL)],1.5,.15);break;
      case 'Suburbs':grid(3,3,4,8,()=>[2,pick(PASTEL)],2.2,.25);for(let n=0;n<4;n++)trees.push({x:x0+R()*S,z:z0+R()*S,yaw:R()*6,s:.8+R()*.4});break;
      default:grid(R()<.5?2:3,2,6,20,()=>{const s=R();return s<.55?[2,pick(PASTEL)]:[0,pick(CONCRETE)];});
    }
  }
  for(let i=0;i<=N;i++)for(let j=0;j<N;j++)for(const o of [15,45])lamps.push({x:i*B+10,z:j*B+o,yaw:0});
  for(let j=0;j<=N;j++)for(let i=0;i<N;i++)for(const o of [15,45])lamps.push({x:i*B+o,z:j*B+10,yaw:-Math.PI/2});
  if(hasBeach){for(let z=-150;z<E+150;z+=11)palms.push({x:-15.5+(R()-.5),z:z+(R()-.5)*2,yaw:R()*6.28,s:.9+R()*.35});
    for(let n=0;n<Math.round(5*N);n++)palms.push({x:-24-R()*16,z:-100+R()*(E+200),yaw:R()*6.28,s:.8+R()*.5});}
  for(let i=0;i<=N;i++)for(let j=0;j<N;j++){
    const st=districts[zone[Math.min(N-1,j)*N+Math.min(N-1,i)]].style;
    if(st!=='Downtown towers'&&st!=='Industrial docks'&&R()<.45)for(const s of [-1,1])palms.push({x:i*B+s*9.3,z:j*B+B/2,yaw:R()*6.28,s:.8+R()*.3});
  }
  for(let n=0;n<Math.round(11*N);n++){const x=E+40+R()*400,z=-200+R()*(E+400);(R()<.4?palms:trees).push({x,z,yaw:R()*6.28,s:.9+R()*.6});}
  const districtOf=(i,j)=>districts[zone[Math.max(0,Math.min(N-1,j))*N+Math.max(0,Math.min(N-1,i))]].name;
  return {seed,N,E,blocks,zone,districts,buildings,blockBuildings,palms,trees,lamps,parked,landmarkSlots,hasBeach,districtOf,
    center:downtown?downtown.center:[dc[0]*B,dc[1]*B]};
}

export function carColor(R){
  const c=[[.75,.05,.05],[.05,.08,.12],[.9,.9,.9],[.55,.57,.6],[.06,.2,.55],[.1,.45,.4],[.95,.55,.1],[.95,.8,.1],[.6,.2,.65],[.15,.15,.15],[.95,.4,.55],[.2,.65,.9]];
  return c[Math.floor(R()*c.length)];
}
export function nearbyBuildings(city,x,z){
  const out=[],N=city.N,bi=Math.floor(x/B),bj=Math.floor(z/B);
  for(let j=bj-1;j<=bj+1;j++)for(let i=bi-1;i<=bi+1;i++){if(i<0||j<0||i>=N||j>=N)continue;for(const b of city.blockBuildings[j*N+i])out.push(b);}
  for(const s of city.landmarkSlots)if(Math.abs(s.x-x)<B&&Math.abs(s.z-z)<B)out.push({x:s.x,z:s.z,w:s.size*.8,d:s.size*.8,h:30,landmark:true});
  return out;
}
export function collide(city,x,z,r,y=0){
  let hit=false,nx=0,nz=0;
  for(const b of nearbyBuildings(city,x,z)){
    if((b.base||0)>y+2)continue;
    const hx=b.w/2,hz=b.d/2,dx=x-b.x,dz=z-b.z;
    const px=Math.max(-hx,Math.min(hx,dx)),pz=Math.max(-hz,Math.min(hz,dz));
    let ex=dx-px,ez=dz-pz,d=Math.hypot(ex,ez);
    if(d<r){hit=true;
      if(d<1e-4){const ox=hx-Math.abs(dx),oz=hz-Math.abs(dz);if(ox<oz){ex=Math.sign(dx)||1;ez=0;x=b.x+ex*(hx+r);}else{ez=Math.sign(dz)||1;ex=0;z=b.z+ez*(hz+r);}nx=ex;nz=ez;}
      else{ex/=d;ez/=d;x+=ex*(r-d);z+=ez*(r-d);nx=ex;nz=ez;}}
  }
  return {x,z,hit,nx,nz};
}
export function insideBuilding(city,x,y,z){
  for(const b of nearbyBuildings(city,x,z))if(y<b.h+.5&&y>(b.base||0)-.5&&Math.abs(x-b.x)<b.w/2+.3&&Math.abs(z-b.z)<b.d/2+.3)return true;
  return false;
}
// Serializable layout for the Unreal build (metres, x/z ground plane, y up).
export function exportLayout(city){
  const r2=v=>Math.round(v*100)/100;
  return {version:1,blockSize:B,road:ROAD,walk:WALK,n:city.N,extent:city.E,hasBeach:city.hasBeach,center:city.center,
    blocks:Array.from(city.blocks),zone:Array.from(city.zone),
    districts:city.districts.map(d=>({id:d.id,name:d.name,style:d.style,center:d.center.map(r2)})),
    buildings:city.buildings.map(b=>({x:r2(b.x),z:r2(b.z),w:r2(b.w),d:r2(b.d),h:r2(b.h),base:r2(b.base||0),style:b.style,color:b.color.map(r2),seed:b.seed})),
    palms:city.palms.map(p=>({x:r2(p.x),z:r2(p.z),yaw:r2(p.yaw),s:r2(p.s)})),trees:city.trees.map(p=>({x:r2(p.x),z:r2(p.z),yaw:r2(p.yaw),s:r2(p.s)})),
    lamps:city.lamps.map(p=>({x:r2(p.x),z:r2(p.z),yaw:r2(p.yaw)})),parked:city.parked.map(p=>({x:r2(p.x),z:r2(p.z),yaw:r2(p.yaw)})),
    landmarks:city.landmarkSlots.map(s=>({id:s.id,name:s.name,x:s.x,z:s.z,size:s.size}))};
}
