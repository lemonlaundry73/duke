// Procedural mesh builder. Vertex: position, normal, material id, animation part id.
export class Geo{
  constructor(){this.p=[];this.n=[];this.m=[];this.a=[];}
  get count(){return this.p.length/3;}
  // Append a primitive (arrays of xyz positions / normals) after applying ops in order.
  add(prim,mat=0,ops=[],part=0){
    const P=prim.p,N=prim.n;
    for(let i=0;i<P.length;i+=3){
      let x=P[i],y=P[i+1],z=P[i+2],nx=N[i],ny=N[i+1],nz=N[i+2];
      for(const o of ops){
        if(o[0]==='s'){x*=o[1];y*=o[2];z*=o[3];nx/=o[1];ny/=o[2];nz/=o[3];}
        else if(o[0]==='t'){x+=o[1];y+=o[2];z+=o[3];}
        else{const c=Math.cos(o[1]),s=Math.sin(o[1]);
          if(o[0]==='rx'){[y,z]=[y*c-z*s,y*s+z*c];[ny,nz]=[ny*c-nz*s,ny*s+nz*c];}
          else if(o[0]==='ry'){[x,z]=[x*c+z*s,-x*s+z*c];[nx,nz]=[nx*c+nz*s,-nx*s+nz*c];}
          else if(o[0]==='rz'){[x,y]=[x*c-y*s,x*s+y*c];[nx,ny]=[nx*c-ny*s,nx*s+ny*c];}}
      }
      const l=Math.hypot(nx,ny,nz)||1;
      this.p.push(x,y,z);this.n.push(nx/l,ny/l,nz/l);this.m.push(mat);this.a.push(part);
    }
    return this;
  }
  box(w,h,d,mat,ops=[],part=0){return this.add(BOX,mat,[['s',w,h,d],...ops],part);}
}

function quad(p,n,a,b,c,d,nx,ny,nz){p.push(...a,...b,...c,...a,...c,...d);for(let i=0;i<6;i++)n.push(nx,ny,nz);}
// Unit cube centered at origin.
export const BOX=(()=>{const p=[],n=[],h=.5;
  quad(p,n,[h,-h,-h],[h,h,-h],[h,h,h],[h,-h,h],1,0,0);
  quad(p,n,[-h,-h,h],[-h,h,h],[-h,h,-h],[-h,-h,-h],-1,0,0);
  quad(p,n,[-h,h,-h],[-h,h,h],[h,h,h],[h,h,-h],0,1,0);
  quad(p,n,[-h,-h,h],[-h,-h,-h],[h,-h,-h],[h,-h,h],0,-1,0);
  quad(p,n,[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h],0,0,1);
  quad(p,n,[h,-h,-h],[-h,-h,-h],[-h,h,-h],[h,h,-h],0,0,-1);
  return {p,n};})();
// Unit cube with base at y=0 (for buildings).
export const BASEBOX={p:BOX.p.map((v,i)=>i%3===1?v+.5:v),n:BOX.n};

export function cylinder(rTop,rBot,h,seg=10,caps=true){
  const p=[],n=[];const sl=(rBot-rTop)/h;
  for(let i=0;i<seg;i++){
    const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;
    const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
    const A=[c0*rBot,0,s0*rBot],B=[c1*rBot,0,s1*rBot],C=[c1*rTop,h,s1*rTop],D=[c0*rTop,h,s0*rTop];
    p.push(...A,...C,...B,...A,...D,...C);
    n.push(c0,sl,s0,c1,sl,s1,c1,sl,s1,c0,sl,s0,c0,sl,s0,c1,sl,s1);
    if(caps){p.push(0,h,0,...C,...D);n.push(0,1,0,0,1,0,0,1,0);p.push(0,0,0,...A,...B);n.push(0,-1,0,0,-1,0,0,-1,0);}
  }
  return {p,n};
}
export function sphere(r,seg=10,ring=7){
  const p=[],n=[];
  const pt=(i,j)=>{const t=j/ring*Math.PI,f=i/seg*Math.PI*2;return [Math.sin(t)*Math.cos(f),Math.cos(t),Math.sin(t)*Math.sin(f)];};
  for(let j=0;j<ring;j++)for(let i=0;i<seg;i++){
    const a=pt(i,j),b=pt(i+1,j),c=pt(i+1,j+1),d=pt(i,j+1);
    for(const v of [a,c,b,a,d,c]){p.push(v[0]*r,v[1]*r,v[2]*r);n.push(...v);}
  }
  return {p,n};
}
