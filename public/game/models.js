import { Geo, BOX, BASEBOX, cylinder, sphere } from './geo.js';

// Material ids (must match shader): 0 paint,1 glass,2 tire,3 headlight,4 taillight,5 trim,6 lightbar,
// 7 bark,8 foliage,9 metal,10 lamp,11 marker,12 skin,13 shirt,14 pants,15 hair,16 shoe,17 rim
export const MAT={PAINT:0,GLASS:1,TIRE:2,HEAD:3,TAIL:4,TRIM:5,BAR:6,BARK:7,LEAF:8,METAL:9,LAMP:10,MARKER:11,SKIN:12,SHIRT:13,PANTS:14,HAIR:15,SHOE:16,RIM:17};

function carBody(g,{len=4.5,wid=1.9,cabH=.58,cabLen=2.3,cabOff=-.25,rideH=.32,bodyH=.6,suv=false}={}){
  const M=MAT, top=rideH+bodyH;
  // lower body + slightly narrower upper shoulder
  g.box(wid,bodyH,len,M.PAINT,[['t',0,rideH+bodyH/2,0]]);
  g.box(wid*.96,.08,len*.98,M.TRIM,[['t',0,rideH+.06,0]]);
  // hood & trunk wedges (sloped boxes)
  g.box(wid*.94,.14,len*.30,M.PAINT,[['rx',-.12],['t',0,top+.02,len*.33]]);
  g.box(wid*.94,.1,len*.18,M.PAINT,[['rx',.1],['t',0,top+.02,-len*.40]]);
  // cabin glass with paint pillars and roof
  g.box(wid*.86,cabH,cabLen,M.GLASS,[['t',0,top+cabH/2,cabOff]]);
  g.box(wid*.88,.07,cabLen*.86,M.PAINT,[['t',0,top+cabH+.02,cabOff-.05]]);
  for(const s of [-1,1]){
    g.box(.06,cabH,.12,M.PAINT,[['t',s*wid*.43,top+cabH/2,cabOff+cabLen/2-.06]]);
    g.box(.06,cabH,.14,M.PAINT,[['t',s*wid*.43,top+cabH/2,cabOff-cabLen/2+.07]]);
    g.box(.05,.06,len*.7,M.TRIM,[['t',s*wid*.5,top-.18,0]]); // door line
    g.box(.08,.1,.16,M.PAINT,[['t',s*(wid*.5+.04),top+.08,cabOff+cabLen/2-.25]]); // mirror
  }
  // lights, grille, bumpers
  for(const s of [-1,1]){
    g.box(.42,.13,.06,M.HEAD,[['t',s*wid*.33,top-.12,len/2+.005]]);
    g.box(.38,.13,.06,M.TAIL,[['t',s*wid*.34,top-.12,-len/2-.005]]);
  }
  g.box(wid*.38,.16,.05,M.TRIM,[['t',0,top-.2,len/2+.01]]);
  g.box(wid*1.01,.16,.18,M.TRIM,[['t',0,rideH+.12,len/2-.02]]);
  g.box(wid*1.01,.16,.18,M.TRIM,[['t',0,rideH+.12,-len/2+.02]]);
  // wheels
  const wr=suv?.42:.36;
  for(const sx of [-1,1])for(const sz of [-1,1]){
    g.add(cylinder(wr,wr,.26,14),M.TIRE,[['t',0,-.13,0],['rz',Math.PI/2],['t',sx*(wid/2-.08),wr,sz*len*.32]]);
    g.add(cylinder(wr*.6,wr*.6,.27,10),M.RIM,[['t',0,-.135,0],['rz',Math.PI/2],['t',sx*(wid/2-.07),wr,sz*len*.32]]);
  }
  return g;
}

export function carGeo(){return carBody(new Geo());}
export function suvGeo(){return carBody(new Geo(),{len:4.8,wid:2,cabH:.72,cabLen:2.9,cabOff:-.45,rideH:.42,bodyH:.68,suv:true});}
export function policeGeo(){
  const g=carBody(new Geo());
  g.box(1.1,.13,.32,MAT.BAR,[['t',0,1.6,-.3]]);
  g.box(.5,.05,.5,MAT.METAL,[['t',0,1.52,-.3]]);
  return g;
}

export function pedGeo(){
  const g=new Geo(),M=MAT;
  g.box(.44,.6,.25,M.SHIRT,[['t',0,1.24,0]]);
  g.box(.38,.12,.24,M.PANTS,[['t',0,.96,0]]);
  g.box(.12,.1,.12,M.SKIN,[['t',0,1.58,0]]);
  g.add(sphere(.13,10,7),M.SKIN,[['s',1,1.12,1],['t',0,1.73,0]]);
  g.add(sphere(.138,10,7),M.HAIR,[['s',1,.75,1.02],['t',0,1.79,-.02]]);
  for(const [s,part] of [[-1,1],[1,2]]){
    g.box(.17,.86,.2,M.PANTS,[['t',s*.11,.52,0]],part);
    g.box(.18,.1,.3,M.SHOE,[['t',s*.11,.05,.04]],part);
  }
  for(const [s,part] of [[-1,3],[1,4]]){
    g.box(.13,.32,.15,M.SHIRT,[['t',s*.29,1.38,0]],part);
    g.box(.1,.3,.11,M.SKIN,[['t',s*.29,1.08,0]],part);
    g.add(sphere(.06,6,4),M.SKIN,[['t',s*.29,.9,0]],part);
  }
  return g;
}

export function palmGeo(){
  const g=new Geo(),M=MAT,segs=7,segH=1.3;let x=0,y=0,tilt=0;
  for(let k=0;k<segs;k++){
    const r0=.24-k*.012,r1=r0-.012;
    g.add(cylinder(r1,r0,segH+.05,8,false),M.BARK,[['rz',-tilt],['t',x,y,0]]);
    g.add(cylinder(r0+.03,r0+.03,.08,8,false),M.BARK,[['t',x,y,0]]); // ring
    x+=Math.sin(tilt)*segH;y+=Math.cos(tilt)*segH;tilt+=.045;
  }
  const tx=x,ty=y;
  for(let i=0;i<11;i++){
    const a=i/11*Math.PI*2+(i%2)*.2, up=.25+(i%3)*.12;
    g.box(.55,.04,1.9,M.LEAF,[['t',0,0,.95],['rx',-up],['ry',a],['t',tx,ty,0]]);
    // drooping outer half
    const ox=Math.sin(a)*Math.cos(up)*1.85,oy=Math.sin(up)*1.85,oz=Math.cos(a)*Math.cos(up)*1.85;
    g.box(.45,.04,1.8,M.LEAF,[['t',0,0,.9],['rx',.55],['ry',a],['t',tx+ox,ty+oy,oz]]);
  }
  for(let i=0;i<4;i++)g.add(sphere(.13,6,4),M.BARK,[['t',tx+Math.cos(i*1.6)*.22,ty-.2,Math.sin(i*1.6)*.22]]);
  return g;
}

export function treeGeo(){
  const g=new Geo(),M=MAT;
  g.add(cylinder(.18,.28,3.2,8),M.BARK,[]);
  g.add(sphere(2.2,12,8),M.LEAF,[['s',1,.85,1],['t',0,4.6,0]]);
  g.add(sphere(1.6,10,7),M.LEAF,[['t',1.1,4,.6]]);
  g.add(sphere(1.5,10,7),M.LEAF,[['t',-.9,4.2,-.8]]);
  g.add(sphere(1.4,10,7),M.LEAF,[['t',-.2,5.6,.3]]);
  return g;
}

export function lampGeo(){
  const g=new Geo(),M=MAT;
  g.add(cylinder(.08,.12,7.2,8),M.METAL,[]);
  g.add(cylinder(.2,.2,.5,8),M.METAL,[]);
  g.box(2.6,.1,.1,M.METAL,[['t',-1.25,7.15,0]]);
  g.box(.75,.16,.36,M.METAL,[['t',-2.45,7.1,0]]);
  g.box(.62,.06,.28,M.LAMP,[['t',-2.45,7.0,0]]);
  return g;
}

export function markerGeo(){
  const g=new Geo();
  g.add(cylinder(1.8,1.8,.12,24,true),MAT.MARKER,[]);
  g.add(cylinder(.18,.18,40,10,false),MAT.MARKER,[]);
  g.add(cylinder(.6,0,1.1,4,true),MAT.MARKER,[['rx',Math.PI],['t',0,3.6,0]]);
  return g;
}

export function buildingGeo(){return new Geo().add(BASEBOX,0);}
export function rooftopGeo(){ // AC units / water tank cluster, unit-scaled
  const g=new Geo();
  g.box(.25,.12,.2,MAT.METAL,[['t',-.2,.06,.15]]);
  g.box(.18,.1,.25,MAT.METAL,[['t',.22,.05,-.18]]);
  g.add(cylinder(.09,.09,.18,10),MAT.TRIM,[['t',.15,0,.25]]);
  return g;
}
export { BOX };
