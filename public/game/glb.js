// Minimal glTF 2.0 binary (.glb) loader for static textured meshes (Meshy output, Blender exports).
const COMP={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const SIZE={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

function mat4FromNode(n){
  if(n.matrix)return Float64Array.from(n.matrix);
  const [x,y,z,w]=n.rotation||[0,0,0,1],[sx,sy,sz]=n.scale||[1,1,1],[tx,ty,tz]=n.translation||[0,0,0];
  const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
  return Float64Array.from([(1-2*(yy+zz))*sx,2*(xy+wz)*sx,2*(xz-wy)*sx,0,2*(xy-wz)*sy,(1-2*(xx+zz))*sy,2*(yz+wx)*sy,0,2*(xz+wy)*sz,2*(yz-wx)*sz,(1-2*(xx+yy))*sz,0,tx,ty,tz,1]);
}
function mul(a,b){const r=new Float64Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];r[i*4+j]=s;}return r;}

export async function loadGLB(url){
  const buf=await (await fetch(url)).arrayBuffer();
  const dv=new DataView(buf);
  if(dv.getUint32(0,true)!==0x46546C67)throw new Error('Not a .glb file');
  let off=12,json=null,bin=null;
  while(off<buf.byteLength){const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true);
    if(type===0x4E4F534A)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,off+8,len)));
    else if(type===0x004E4942)bin=buf.slice(off+8,off+8+len);
    off+=8+len;}
  if(!json)throw new Error('GLB has no JSON chunk');
  const read=i=>{
    const a=json.accessors[i],bv=json.bufferViews[a.bufferView],C=COMP[a.componentType],n=SIZE[a.type];
    const start=(bv.byteOffset||0)+(a.byteOffset||0),stride=bv.byteStride||0,el=n*C.BYTES_PER_ELEMENT;
    if(!stride||stride===el)return {data:new C(bin,start,a.count*n),n,normalized:a.normalized,type:a.componentType};
    const out=new C(a.count*n),src=new DataView(bin);
    for(let k=0;k<a.count;k++)for(let c=0;c<n;c++){const o=start+k*stride+c*C.BYTES_PER_ELEMENT;
      out[k*n+c]=C===Float32Array?src.getFloat32(o,true):C===Uint16Array?src.getUint16(o,true):C===Uint32Array?src.getUint32(o,true):src.getUint8(o);}
    return {data:out,n,normalized:a.normalized,type:a.componentType};
  };
  const images={};
  const imageFor=async idx=>{
    if(idx==null)return null;if(images[idx])return images[idx];
    const img=json.images[json.textures[idx].source];
    let blob;
    if(img.bufferView!=null){const bv=json.bufferViews[img.bufferView];blob=new Blob([new Uint8Array(bin,bv.byteOffset||0,bv.byteLength)],{type:img.mimeType||'image/png'});}
    else blob=await (await fetch(new URL(img.uri,new URL(url,location.href)))).blob();
    return images[idx]=await createImageBitmap(blob,{colorSpaceConversion:'none'});
  };
  const P=[],Nn=[],UV=[],I=[],groups=[];let vbase=0;
  const visit=async(ni,parent)=>{
    const node=json.nodes[ni],m=mul(parent,mat4FromNode(node));
    if(node.mesh!=null)for(const prim of json.meshes[node.mesh].primitives){
      if((prim.mode??4)!==4||prim.attributes.POSITION==null)continue;
      const pos=read(prim.attributes.POSITION),nrm=prim.attributes.NORMAL!=null?read(prim.attributes.NORMAL):null,uv=prim.attributes.TEXCOORD_0!=null?read(prim.attributes.TEXCOORD_0):null;
      const cnt=pos.data.length/3;
      for(let k=0;k<cnt;k++){const x=pos.data[k*3],y=pos.data[k*3+1],z=pos.data[k*3+2];
        P.push(m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]);
        if(nrm){const a=nrm.data[k*3],b=nrm.data[k*3+1],c=nrm.data[k*3+2];let nx=m[0]*a+m[4]*b+m[8]*c,ny=m[1]*a+m[5]*b+m[9]*c,nz=m[2]*a+m[6]*b+m[10]*c;const l=Math.hypot(nx,ny,nz)||1;Nn.push(nx/l,ny/l,nz/l);}else Nn.push(0,1,0);
        if(uv){let u=uv.data[k*2],v=uv.data[k*2+1];if(uv.normalized){const mx=uv.type===5121?255:65535;u/=mx;v/=mx;}UV.push(u,v);}else UV.push(0,0);}
      const start=I.length;
      if(prim.indices!=null){const ix=read(prim.indices).data;for(let k=0;k<ix.length;k++)I.push(ix[k]+vbase);}else for(let k=0;k<cnt;k++)I.push(vbase+k);
      const mat=json.materials?.[prim.material]?.pbrMetallicRoughness||{};
      groups.push({start,count:I.length-start,color:mat.baseColorFactor||[1,1,1,1],image:await imageFor(mat.baseColorTexture?.index),
        rough:mat.roughnessFactor??.6,metal:mat.metallicFactor??0});
      vbase+=cnt;
    }
    for(const c of node.children||[])await visit(c,m);
  };
  const scene=json.scenes?.[json.scene||0]||{nodes:json.nodes.map((_,i)=>i)};
  const I4=Float64Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  for(const n of scene.nodes)await visit(n,I4);
  if(!P.length)throw new Error('GLB contains no triangle meshes');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let k=0;k<P.length;k+=3)for(let c=0;c<3;c++){min[c]=Math.min(min[c],P[k+c]);max[c]=Math.max(max[c],P[k+c]);}
  // recentre: x/z centred, base on y=0
  const cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2;
  for(let k=0;k<P.length;k+=3){P[k]-=cx;P[k+1]-=min[1];P[k+2]-=cz;}
  const size=[max[0]-min[0],max[1]-min[1],max[2]-min[2]];
  return {p:new Float32Array(P),n:new Float32Array(Nn),uv:new Float32Array(UV),index:new Uint32Array(I),groups,size,tris:I.length/3};
}
