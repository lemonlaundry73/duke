// GLSL ES 3.00 shaders for the Duke Forger renderer.
const HEAD=`#version 300 es
precision highp float;
precision highp sampler2D;
precision highp int;
`;

export const COMMON=`
uniform vec3 uCamPos; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyTop; uniform vec3 uSkyHor;
uniform vec3 uSunDisk; uniform float uSunVis; uniform float uNight; uniform float uRain; uniform float uTime; uniform float uFog;
uniform mat4 uShadowMat; uniform sampler2D uShadow; uniform float uShadowOn;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float hash3(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*noise(p);p*=2.03;a*=.5;}return s;}
vec3 sky(vec3 d){
  float h=max(d.y,0.);
  vec3 c=mix(uSkyHor,uSkyTop,pow(h,.5));
  float sd=max(dot(d,uSunDisk),0.);
  float low=1.-smoothstep(.0,.35,uSunDisk.y);
  c+=uSunVis*(pow(sd,6.)*(.25+.6*low)+pow(sd,48.)*(.4+.8*low))*vec3(1.,.62,.36);
  c=mix(c,uSkyHor*.6,clamp(-d.y*4.,0.,1.));
  return c;
}
float shadowAt(vec3 wp,vec3 n,float ndl){
  if(uShadowOn<.5)return 1.;
  vec4 sp=uShadowMat*vec4(wp+n*(.18+.35*(1.-ndl)),1.);
  vec3 c=sp.xyz/sp.w*.5+.5;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.)return 1.;
  vec2 ts=1./vec2(textureSize(uShadow,0));float s=0.;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){float d=texture(uShadow,c.xy+vec2(x,y)*ts*1.25).r;s+=c.z-(.0008+.0025*(1.-ndl))>d?0.:1.;}
  float fade=smoothstep(.85,1.,max(abs(c.x-.5),abs(c.y-.5))*2.);
  return mix(s/9.,1.,fade);
}
vec3 shade(vec3 alb,vec3 n,vec3 wp,float spec,float gloss,vec3 emis,float ao){
  vec3 v=normalize(uCamPos-wp);
  float ndl=dot(n,uSunDir);
  float sh=ndl>0.?shadowAt(wp,n,ndl):0.;ndl=max(ndl,0.);
  vec3 amb=mix(uSkyHor*.45+vec3(.012,.01,.008),uSkyTop*.75+uSkyHor*.25,n.y*.5+.5)*ao;
  amb+=vec3(.05,.04,.06)*uNight*ao; // city glow
  vec3 h=normalize(uSunDir+v);
  float sp=pow(max(dot(n,h),0.),gloss)*(gloss+8.)/40.*spec;
  float fr=spec*(.04+.96*pow(1.-max(dot(n,v),0.),5.));
  vec3 refl=sky(reflect(-v,n));
  return alb*(1.-fr*.6)*(amb+uSunColor*ndl*sh)+uSunColor*sp*sh+refl*fr*ao+emis;
}
vec3 fog(vec3 c,vec3 wp){
  vec3 d=wp-uCamPos;float dist=length(d);
  float f=1.-exp(-dist*uFog*(1.+uRain*2.));
  float hf=exp(-max(wp.y,0.)*.01);
  vec3 fd=normalize(vec3(d.x,.03*length(d.xz),d.z));
  return mix(c,sky(fd)*(1.-uRain*.25),clamp(f*hf,0.,1.));
}
`;

export const VS_LIT=HEAD+`
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in float aMat; layout(location=3) in float aPart;
layout(location=4) in vec4 iPY; layout(location=5) in vec4 iScale; layout(location=6) in vec4 iColor; layout(location=7) in vec4 iExtra;
uniform mat4 uVP; uniform int uKind;
out vec3 vW; out vec3 vN; out vec3 vL; flat out vec4 vC; flat out vec4 vE; flat out vec3 vS; flat out float vM;
void main(){
  vec3 p=aPos,n=aNrm;
  if(uKind==2&&aPart>.5){
    bool leg=aPart<2.5;
    float sgn=(aPart<1.5||(aPart>2.5&&aPart<3.5))?1.:-1.;
    float ang=sin(iExtra.x)*iExtra.y*sgn*(leg?1.:-.85);
    float py=leg?.95:1.52;
    float c=cos(ang),s=sin(ang),y=p.y-py;
    p=vec3(p.x,y*c-p.z*s+py,y*s+p.z*c);n=vec3(n.x,n.y*c-n.z*s,n.y*s+n.z*c);
  }
  vL=p*iScale.xyz;
  vec3 q=vL;n=n/iScale.xyz;
  float c=cos(iPY.w),s=sin(iPY.w);
  q=vec3(q.x*c+q.z*s,q.y,-q.x*s+q.z*c);n=vec3(n.x*c+n.z*s,n.y,-n.x*s+n.z*c);
  vW=q+iPY.xyz;vN=normalize(n);vC=iColor;vE=iExtra;vS=iScale.xyz;vM=aMat;
  gl_Position=uVP*vec4(vW,1.);
}`;

export const FS_DEPTH=HEAD+`out vec4 o;void main(){o=vec4(1);}`;

export const FS_LIT=HEAD+COMMON+`
uniform int uKind;
in vec3 vW; in vec3 vN; in vec3 vL; flat in vec4 vC; flat in vec4 vE; flat in vec3 vS; flat in float vM;
out vec4 o;
void main(){
  vec3 n=normalize(vN);
  vec3 alb=vC.rgb;float spec=.08,gloss=16.;vec3 em=vec3(0);float ao=1.;
  if(uKind==1){
    vec3 sz=vS,lp=vL;float style=vE.x,seed=vE.y;
    if(n.y>.5){
      alb=vec3(.34,.33,.32)*(.8+.35*noise(lp.xz*.4));
      float edge=min(min(lp.x+sz.x*.5,sz.x*.5-lp.x),min(lp.z+sz.z*.5,sz.z*.5-lp.z));
      if(edge<.45)alb=vC.rgb*.85;
      if(style>2.5){alb=vec3(.15,.4,.5);spec=.6;gloss=200.;} // rooftop pool
    }else if(n.y<-.5){alb=vec3(.1);}
    else{
      float u=abs(n.x)>.5?lp.z:lp.x;
      float face=abs(n.x)>.5?(n.x>0.?1.:2.):(n.z>0.?3.:4.);
      float v=lp.y+vE.z,top=sz.y+vE.z;
      bool glassT=style>.5&&style<1.5, deco=style>1.5;
      float fh=deco?3.3:3.6, cw=glassT?1.6:(deco?2.4:3.);
      float uu=u+500.;
      float fid=floor(v/fh),cid=floor(uu/cw);
      vec2 f=vec2(fract(uu/cw),fract(v/fh));
      float win=glassT?step(.06,f.x)*step(f.x,.94)*step(.07,f.y)*step(f.y,.95):step(.2,f.x)*step(f.x,.8)*step(.26,f.y)*step(f.y,.84);
      float halfU=(abs(n.x)>.5?sz.z:sz.x)*.5;
      if(abs(u)>halfU-.7)win=0.;
      if(v>top-1.1)win=0.;
      float hh=hash3(vec3(cid,fid,seed*13.+face));
      vec3 wall=vC.rgb*(.88+.22*noise(vec2(u,v)*.6));
      if(deco){float led=step(.88,f.y);wall=mix(wall,vec3(.96,.95,.92),led*.9);
        float pil=step(abs(fract(uu/(cw*3.))-.5),.06);wall=mix(wall,vec3(.97,.96,.94),pil*.8);}
      if(v>top-1.1)wall*=.8;
      bool ground=v<4.2;
      if(ground){
        float sx=fract(uu/5.5);
        win=step(.1,v/4.2)*step(v/4.2,.74)*step(.08,sx)*step(sx,.92);
        if(abs(u)>halfU-.7)win=0.;
        float band=step(.78,v/4.2)*step(v/4.2,.93)*step(.1,sx)*step(sx,.9);
        float hs=hash3(vec3(floor(uu/5.5),seed,face));
        vec3 neon=.5+.5*cos(6.2831*(hs+vec3(0.,.33,.67)));
        if(hs>.35){wall=mix(wall,neon*.3,band);em+=neon*band*(.2+1.6*uNight)*step(.55,hs);}
      }
      // distance filtering: fade the window pattern to its average where it would alias
      float fw=max(fwidth(uu/cw),fwidth(v/fh));
      float aa=smoothstep(.3,.8,fw);
      float cover=ground?.6:(glassT?.82:.33);
      float wf=mix(win,cover,aa);
      vec3 glass=glassT?vC.rgb*vec3(.3,.4,.5):vec3(.04,.05,.06);
      if(ground)glass=vec3(.05,.05,.05);
      float litP=.08+.3*uNight;
      float lit=ground?1.:mix(step(hh,litP),litP,aa);
      vec3 wc=mix(vec3(1.,.72,.42),vec3(.72,.86,1.),step(.72,hash3(vec3(fid,cid,seed))));
      float shade2=mix(.5+.5*hash3(vec3(cid,fid,seed+3.)),.75,aa);
      float room=ground?1.:mix((.4+.6*smoothstep(.0,.85,f.y))*(.75+.25*step(.5,fract(f.x*2.+hh*3.))),.7,aa);
      vec3 shopTint=mix(vec3(1.),.6+.4*cos(6.2831*(hh+vec3(0.,.33,.67))),.35);
      vec3 wem=wc*lit*(.015+.5*uNight)*shade2*room*(ground?.55*shopTint*(.6+.4*smoothstep(.0,.7,f.y)):vec3(1.));
      if(!glassT&&!ground)glass=mix(glass,vec3(.5,.48,.45),step(.75,hash3(vec3(cid+.5,fid,seed)))*step(.55,f.y)*.6*(1.-aa));
      alb=mix(wall,glass,wf);
      spec=mix(glassT?.35:.06,.95,wf);gloss=mix(glassT?60.:10.,220.,wf);
      em+=wem*wf;
      ao=.55+.45*smoothstep(0.,3.5,v);
    }
  }else{
    int m=int(vM+.5);
    if(m==0){spec=.65;gloss=140.;}
    else if(m==1){alb=vec3(.02,.025,.03);spec=1.;gloss=300.;}
    else if(m==2){alb=vec3(.025);spec=.05;gloss=8.;}
    else if(m==3){alb=vec3(.9);spec=.8;gloss=200.;em=vec3(1.,.95,.85)*(.15+5.*uNight*vE.z);}
    else if(m==4){alb=vec3(.4,.02,.02);spec=.5;gloss=100.;em=vec3(1.,.04,.02)*(.12+2.2*uNight+4.*vE.w);}
    else if(m==5){alb=vec3(.05);spec=.3;gloss=40.;}
    else if(m==6){float side=step(0.,vL.x);float t=step(.5,fract(uTime*3.+side*.5));alb=vec3(.1);em=mix(vec3(1.,.02,.02),vec3(.05,.25,1.),side)*(.2+t*7.*vC.a);}
    else if(m==7){alb=vec3(.42,.33,.24)*(.75+.35*noise(vL.xy*vec2(5.,1.5)));spec=.02;}
    else if(m==8){alb=vC.rgb*(.7+.4*noise(vL.xz*1.7+vL.y*1.3));spec=.04;gloss=10.;em=alb*uSunColor*.1*max(dot(-n,uSunDir),0.);}
    else if(m==9){alb=vec3(.09,.1,.1);spec=.35;gloss=30.;}
    else if(m==10){alb=vec3(.9);em=vec3(1.,.78,.52)*(.08+4.5*uNight);}
    else if(m==11){alb=vC.rgb;em=vC.rgb*(2.2+1.2*sin(uTime*4.));}
    else if(m==12){alb=mix(vec3(.93,.74,.6),vec3(.33,.2,.13),vE.w);spec=.12;gloss=20.;}
    else if(m==13){alb=vC.rgb;spec=.05;}
    else if(m==14){alb=(.5+.5*cos(6.2831*(vE.z+vec3(0.,.33,.67))))*.32+.05;}
    else if(m==15){alb=vec3(.05,.035,.025)+vE.z*vec3(.35,.25,.12)*step(.7,vE.z);}
    else if(m==16){alb=vec3(.07);}
    else if(m==17){alb=vec3(.55);spec=.7;gloss=80.;}
    if(uKind==2&&vC.a>1.5)em+=vec3(.9,.65,.1)*(.35+.25*sin(uTime*5.)); // highlighted project NPC
  }
  alb=pow(alb,vec3(2.2));
  vec3 col=shade(alb,n,vW,spec,gloss,em,ao);
  o=vec4(fog(col,vW),1.);
}`;

export const VS_PLANE=HEAD+`
layout(location=0) in vec3 aPos; uniform mat4 uVP; out vec3 vW;
void main(){vW=aPos;gl_Position=uVP*vec4(aPos,1.);}`;

export const FS_GROUND=HEAD+COMMON+`
uniform sampler2D uBlocks; uniform float uB; uniform float uN; uniform vec4 uHead[12]; uniform int uHeadN;
in vec3 vW; out vec4 o;
void main(){
  vec2 p=vW.xz;float B=uB,E=uN*B;
  vec3 n=vec3(0,1,0),alb,em=vec3(0);float spec=.04,gloss=10.,wet=uRain*.5;
  vec2 lp=mod(p,B);vec2 d=min(lp,B-lp);
  bool city=p.x>-11.&&p.y>-11.&&p.x<E+11.&&p.y<E+11.;
  vec2 bi=floor(p/B);
  if(!city){
    if(p.x<-11.&&p.y>-200.&&p.y<E+200.){
      float sn=noise(p*.35)*.5+noise(p*2.5)*.25;
      alb=mix(vec3(.88,.78,.6),vec3(.62,.54,.42),smoothstep(-38.,-48.,p.x))*(.88+.18*sn);
      if(p.x>-19.){alb=vec3(.74,.66,.58)*(.9+.12*noise(p*1.5));float pl=step(.93,fract(p.y*.4));alb*=1.-pl*.25;spec=.06;}
    }else if(p.x<-11.){alb=vec3(.8,.72,.56)*(.9+.15*noise(p*.2));}
    else{alb=vec3(.26,.34,.18)*(.7+.45*fbm(p*.06));}
  }else if(d.x<7.||d.y<7.){
    alb=vec3(.085,.085,.09)*(.82+.35*noise(p*1.9))*(.85+.3*fbm(p*.04));spec=.12;gloss=30.;wet=uRain;
    bool inter=d.x<7.&&d.y<7.;
    if(!inter){
      bool vert=d.x<7.;
      float across=vert?(lp.x<B*.5?lp.x:lp.x-B):(lp.y<B*.5?lp.y:lp.y-B);
      float along=vert?p.y:p.x;
      float dAl=vert?d.y:d.x;
      float yl=step(abs(abs(across)-.2),.08);
      float dash=step(abs(abs(across)-3.5),.07)*step(.45,fract(along/7.));
      float edge=step(abs(abs(across)-6.55),.09);
      float cw=(dAl>7.6&&dAl<11.4)?step(.45,fract(across*.9))*step(abs(across),6.3):0.;
      float stl=(dAl>11.6&&dAl<12.1&&across*(vert?1.:-1.)<0.)?step(abs(across),6.3):0.;
      yl*=step(11.6,dAl);dash*=step(12.,dAl);
      float mk=max(max(yl,dash),max(edge,max(cw,stl)));
      vec3 mc=yl>.5?vec3(.9,.66,.12):vec3(.88);
      alb=mix(alb,mc*(.75+.25*noise(p*4.)),mk*(.7+.3*noise(p*.7)));
      // tire wear darkening in lanes
      alb*=1.-.12*smoothstep(1.2,0.,abs(abs(across)-1.75))-.12*smoothstep(1.2,0.,abs(abs(across)-5.25));
    }else{
      // manhole + patch
      float mh=length(lp-vec2(lp.x<B*.5?2.:B-2.,lp.y<B*.5?2.:B-2.));
      alb*=1.-.3*step(mh,.4)+.1*step(mh,.45);
    }
  }else if(d.x<11.||d.y<11.){
    alb=vec3(.55,.53,.5)*(.84+.16*noise(p*.9));
    vec2 t=fract(p/1.6);float g=step(t.x,.035)+step(t.y,.035);alb*=1.-min(g,1.)*.2;
    float curb=min(d.x<11.?d.x:99.,d.y<11.?d.y:99.);
    if(curb<7.4)alb=vec3(.68,.66,.62);
    if(curb>10.7)alb*=.8;
    wet=uRain*.8;
  }else{
    float t=texture(uBlocks,(bi+.5)/uN).r*255.;
    if(t>.5&&t<1.5){
      alb=vec3(.2,.34,.12)*(.65+.55*fbm(p*.22));spec=.02;
      vec2 c=lp-B*.5;float path=min(abs(c.x),abs(c.y));
      float ring=abs(length(c)-9.);
      if(min(path,ring)<1.5)alb=vec3(.72,.66,.54)*(.9+.12*noise(p));
      if(length(c)<4.){alb=vec3(.2,.45,.55);spec=.9;gloss=250.;} // fountain pool
    }else if(t>1.5&&t<2.5){
      alb=vec3(.1,.1,.11)*(.85+.3*noise(p*1.3));spec=.12;
      float st=step(.94,fract(lp.x/3.))*step(abs(fract(lp.y/12.)-.5),.32);alb=mix(alb,vec3(.85),st);
    }else{
      alb=vec3(.62,.6,.56)*(.85+.15*noise(p*.6));vec2 t2=fract(p/2.);alb*=1.-(step(t2.x,.03)+step(t2.y,.03))*.08;
    }
  }
  if(wet>0.){float puddle=smoothstep(.45,.7,fbm(p*.15));alb*=1.-.4*wet;spec=mix(spec,.9,wet*(.5+.5*puddle));gloss=mix(gloss,400.,wet*puddle);}
  alb=pow(alb,vec3(2.2));
  vec3 pool=vec3(0);
  if(city&&uNight>.01){
    float hx=floor((p.x-7.5)/B+.5)*B+7.5,hz=floor((p.y-15.)/30.+.5)*30.+15.;
    float hz2=floor((p.y-7.5)/B+.5)*B+7.5,hx2=floor((p.x-15.)/30.+.5)*30.+15.;
    vec2 a=p-vec2(hx,hz),b=p-vec2(hx2,hz2);
    pool=vec3(1.,.7,.4)*(exp(-dot(a,a)/32.)+exp(-dot(b,b)/32.))*1.4*uNight;
  }
  for(int i=0;i<12;i++){if(i>=uHeadN)break;vec4 h=uHead[i];vec2 rel=p-h.xy;float dist=length(rel);float cone=dot(rel/max(dist,.001),h.zw);
    pool+=vec3(1.,.93,.8)*smoothstep(.8,.95,cone)*exp(-dist*.07)*smoothstep(1.5,5.,dist)*2.5*uNight;}
  vec3 col=shade(alb,n,vW,spec,gloss,em,1.)+alb*pool*(1.+wet*1.5);
  // wet reflection of lights (fake streaks)
  o=vec4(fog(col,vW),1.);
}`;

export const FS_WATER=HEAD+COMMON+`
in vec3 vW; out vec4 o;
void main(){
  vec2 p=vW.xz;float t=uTime;
  float gx=0.,gz=0.;
  vec4 W[4]=vec4[4](vec4(.07,.02,.9,.35),vec4(-.03,.09,1.3,.18),vec4(.13,-.05,1.7,.1),vec4(.04,.15,2.3,.06));
  for(int i=0;i<4;i++){float ph=dot(p,W[i].xy)+t*W[i].z;float a=W[i].w*cos(ph);gx+=a*W[i].x*6.;gz+=a*W[i].y*6.;}
  vec2 nn=vec2(noise(p*.6+t*.4),noise(p*.6-t*.35))-.5;
  vec3 n=normalize(vec3(-gx+nn.x*.35,1.,-gz+nn.y*.35));
  vec3 v=normalize(uCamPos-vW);
  float fr=.02+.98*pow(1.-max(dot(n,v),0.),5.);
  float shore=smoothstep(-90.,-46.,p.x);
  vec3 deep=pow(vec3(.02,.12,.17),vec3(2.2)),shal=pow(vec3(.1,.45,.45),vec3(2.2));
  vec3 base=mix(deep,shal,shore)*(uSkyHor*.9+uSunColor*.25*max(uSunDir.y,0.)+vec3(.02));
  vec3 refl=sky(reflect(-v,n));
  vec3 h=normalize(uSunDir+v);float sp=pow(max(dot(n,h),0.),600.)*25.*uSunVis+pow(max(dot(n,h),0.),60.)*.3*uSunVis;
  vec3 col=mix(base,refl,clamp(fr,0.,1.))+uSunColor*sp;
  float wave=sin(p.y*.06+t*.8)*2.+sin(p.y*.17-t*1.1);
  float foam=smoothstep(-50.,-46.,p.x+wave)*(.5+.5*noise(p*.7+t*.5));
  foam+=smoothstep(.6,.9,noise(p*.4+vec2(t*.3,0.)))*smoothstep(-70.,-50.,p.x)*.3;
  col=mix(col,(uSkyHor*.5+uSunColor*.35)*.9,clamp(foam,0.,1.)*.75);
  o=vec4(fog(col,vW),1.);
}`;

export const VS_FULL=HEAD+`
out vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;

export const FS_SKY=HEAD+COMMON+`
uniform mat4 uInvVP; in vec2 vUv; out vec4 o;
void main(){
  vec4 w=uInvVP*vec4(vUv*2.-1.,1.,1.);vec3 d=normalize(w.xyz/w.w-uCamPos);
  vec3 c=sky(d);
  float sd=dot(d,uSunDisk);c+=smoothstep(.99955,.9998,sd)*vec3(1.,.82,.6)*40.*uSunVis;
  float md=dot(d,-uSunDisk);c+=smoothstep(.99965,.99985,md)*vec3(.85,.9,1.)*4.*uNight;
  if(d.y>0.){
    vec2 sp=d.xz/(d.y+.25)*220.;vec2 cell=floor(sp);float hs=hash(cell);
    c+=vec3(.9,.95,1.)*step(.988,hs)*smoothstep(.45,0.,length(fract(sp)-.5))*uNight*(1.-uRain)*(.6+.4*sin(uTime*3.+hs*50.));
    vec2 cp=d.xz/(d.y+.12)*1.4+vec2(uTime*.003,uTime*.001);
    float cl=smoothstep(.42+(.15-uRain*.25),.85,fbm(cp*1.5)+fbm(cp*4.)*.25);
    float lit=max(dot(d,uSunDisk),0.);
    vec3 cc=mix(uSkyHor*1.05+uSkyTop*.2,uSunColor*.35+uSkyHor*.7,pow(lit,3.));
    cc=mix(cc,vec3(.04,.045,.06),uNight*.8);
    c=mix(c,cc,cl*smoothstep(0.,.12,d.y)*(.75+uRain*.25));
  }
  o=vec4(c,1.);
}`;

export const VS_RAIN=HEAD+`
layout(location=0) in vec2 aQ; layout(location=1) in vec3 iOff;
uniform mat4 uVP; uniform vec3 uCamPos; uniform float uTime; uniform vec3 uRight;
out float vA;
void main(){
  vec3 box=vec3(50.,30.,50.);
  vec3 pos=iOff*box;pos.y-=uTime*22.;pos.x+=uTime*3.;
  pos=mod(pos-uCamPos+box*.5,box)-box*.5+uCamPos;
  vec3 w=pos+uRight*aQ.x*.025+vec3(.12,1.,0.)*aQ.y*.9;
  vA=1.-length(pos-uCamPos)/45.;
  gl_Position=uVP*vec4(w,1.);
}`;
export const FS_RAIN=HEAD+`uniform vec3 uCol; in float vA; out vec4 o;void main(){o=vec4(uCol*max(vA,0.)*.35,1.);}`;

export const FS_BRIGHT=HEAD+`uniform sampler2D uTex;uniform float uThresh;in vec2 vUv;out vec4 o;
void main(){vec2 ts=1./vec2(textureSize(uTex,0));vec3 c=vec3(0);
  for(int i=0;i<4;i++){vec2 off=vec2(i&1,i>>1)*2.-1.;c+=texture(uTex,vUv+off*ts).rgb;}c*=.25;
  float l=dot(c,vec3(.2126,.7152,.0722));o=vec4(c*smoothstep(uThresh,uThresh*2.,l),1.);}`;
export const FS_BLUR=HEAD+`uniform sampler2D uTex;uniform vec2 uDir;in vec2 vUv;out vec4 o;
void main(){vec2 ts=uDir/vec2(textureSize(uTex,0));
  vec3 c=texture(uTex,vUv).rgb*.227;
  c+=(texture(uTex,vUv+ts*1.385).rgb+texture(uTex,vUv-ts*1.385).rgb)*.316;
  c+=(texture(uTex,vUv+ts*3.23).rgb+texture(uTex,vUv-ts*3.23).rgb)*.07;o=vec4(c,1.);}`;
export const FS_COMP=HEAD+`uniform sampler2D uTex;uniform sampler2D uBloom;uniform sampler2D uBloom2;uniform float uExposure;uniform float uTime;uniform float uVig;
in vec2 vUv;out vec4 o;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){
  vec3 c=texture(uTex,vUv).rgb;
  c+=texture(uBloom,vUv).rgb*.3+texture(uBloom2,vUv).rgb*.25;
  c=aces(c*uExposure);
  c=pow(c,vec3(1./2.2));
  float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,1.12);
  c=mix(c,c*c*(3.-2.*c),.25);
  vec2 q=vUv-.5;c*=1.-dot(q,q)*uVig;
  c+=(fract(sin(dot(gl_FragCoord.xy+uTime,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;
  o=vec4(c,1.);
}`;

export const VS_TEX=HEAD+`
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
layout(location=4) in vec4 iPY; layout(location=5) in vec4 iScale; layout(location=6) in vec4 iColor; layout(location=7) in vec4 iExtra;
uniform mat4 uVP;
out vec3 vW; out vec3 vN; out vec2 vUv; flat out vec4 vC; flat out vec4 vE;
void main(){
  vec3 q=aPos*iScale.xyz,n=aNrm/iScale.xyz;
  float c=cos(iPY.w),s=sin(iPY.w);
  q=vec3(q.x*c+q.z*s,q.y,-q.x*s+q.z*c);n=vec3(n.x*c+n.z*s,n.y,-n.x*s+n.z*c);
  vW=q+iPY.xyz;vN=normalize(n);vUv=aUv;vC=iColor;vE=iExtra;
  gl_Position=uVP*vec4(vW,1.);
}`;
export const FS_TEX=HEAD+COMMON+`
uniform sampler2D uTex; uniform vec4 uBase; uniform float uRough; uniform float uMetal;
in vec3 vW; in vec3 vN; in vec2 vUv; flat in vec4 vC; flat in vec4 vE; out vec4 o;
void main(){
  vec4 t=texture(uTex,vUv);
  vec3 alb=pow(t.rgb*uBase.rgb,vec3(2.2))*vC.rgb;
  vec3 n=normalize(vN);
  float spec=mix(.06,.9,uMetal)+(1.-uRough)*.5;float gloss=mix(8.,220.,1.-uRough);
  vec3 col=shade(alb,n,vW,clamp(spec,0.,1.),gloss,vec3(0),1.);
  o=vec4(fog(col,vW),1.);
}`;
