// WebGL2 renderer: HDR + MSAA scene, sun/moon shadow map, sky, bloom, ACES tonemapping.
import * as S from './shaders.js';
import { m4, perspective, ortho, lookAt, mul, invert } from './math.js';

const INST_FLOATS=16;

export class Renderer{
  constructor(canvas,{shadowSize=2048,maxScale=1.5}={}){
    const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,depth:true,powerPreference:'high-performance',preserveDrawingBuffer:false});
    if(!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl=gl;this.canvas=canvas;this.maxScale=maxScale;this.scale=1;
    this.hdr=!!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.samples=Math.min(4,gl.getParameter(gl.MAX_SAMPLES)||0);
    this.progs={
      lit:this.program(S.VS_LIT,S.FS_LIT), depth:this.program(S.VS_LIT,S.FS_DEPTH),
      ground:this.program(S.VS_PLANE,S.FS_GROUND), water:this.program(S.VS_PLANE,S.FS_WATER),
      sky:this.program(S.VS_FULL,S.FS_SKY), tex:this.program(S.VS_TEX,S.FS_TEX), rain:this.program(S.VS_RAIN,S.FS_RAIN),
      bright:this.program(S.VS_FULL,S.FS_BRIGHT), blur:this.program(S.VS_FULL,S.FS_BLUR), comp:this.program(S.VS_FULL,S.FS_COMP)
    };
    this.emptyVao=gl.createVertexArray();
    // shadow map
    this.shadowSize=shadowSize;
    this.shadowTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,shadowSize,shadowSize,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
    this.shadowFb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.shadowTex,0);
    gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    this.view=m4();this.proj=m4();this.vp=m4();this.invVp=m4();this.shadowMat=m4();
    this.w=0;this.h=0;
    // rain
    const q=new Float32Array([-1,0,1,0,1,1,-1,0,1,1,-1,1]);
    const off=new Float32Array(3*1800);for(let i=0;i<off.length;i++)off[i]=Math.random();
    this.rainVao=gl.createVertexArray();gl.bindVertexArray(this.rainVao);
    this.buf(q,0,2);const ob=this.buf(off,1,3);gl.vertexAttribDivisor(1,1);gl.bindVertexArray(null);
    this.rainCount=1800;
  }
  program(vs,fs){
    const gl=this.gl,p=gl.createProgram();
    for(const [type,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
      const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(sh);console.error(src.split('\n').map((l,i)=>`${i+1}: ${l}`).join('\n'));throw new Error('Shader compile failed: '+log);}
      gl.attachShader(p,sh);
    }
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Program link failed: '+gl.getProgramInfoLog(p));
    p.loc={};return p;
  }
  u(p,name){return name in p.loc?p.loc[name]:(p.loc[name]=this.gl.getUniformLocation(p,name));}
  buf(data,loc,size,usage){
    const gl=this.gl,b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,usage||gl.STATIC_DRAW);
    if(loc!=null){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}return b;
  }
  mesh(geo,capacity=1){
    const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    this.buf(new Float32Array(geo.p),0,3);this.buf(new Float32Array(geo.n),1,3);
    this.buf(new Float32Array(geo.m),2,1);this.buf(new Float32Array(geo.a),3,1);
    const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);
    gl.bufferData(gl.ARRAY_BUFFER,capacity*INST_FLOATS*4,gl.DYNAMIC_DRAW);
    for(let i=0;i<4;i++){gl.enableVertexAttribArray(4+i);gl.vertexAttribPointer(4+i,4,gl.FLOAT,false,INST_FLOATS*4,i*16);gl.vertexAttribDivisor(4+i,1);}
    gl.bindVertexArray(null);
    return {vao,ib,count:geo.count,capacity,n:0,data:new Float32Array(capacity*INST_FLOATS)};
  }
  // Textured mesh from loadGLB(); one draw per material group.
  texMesh(model,capacity=1){
    const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    this.buf(model.p,0,3);this.buf(model.n,1,3);this.buf(model.uv,2,2);
    const eb=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,eb);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,model.index,gl.STATIC_DRAW);
    const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);gl.bufferData(gl.ARRAY_BUFFER,capacity*INST_FLOATS*4,gl.DYNAMIC_DRAW);
    for(let i=0;i<4;i++){gl.enableVertexAttribArray(4+i);gl.vertexAttribPointer(4+i,4,gl.FLOAT,false,INST_FLOATS*4,i*16);gl.vertexAttribDivisor(4+i,1);}
    gl.bindVertexArray(null);
    const groups=model.groups.map(g=>{let t=null;
      if(g.image){t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,g.image);gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        const af=gl.getExtension('EXT_texture_filter_anisotropic');if(af)gl.texParameterf(gl.TEXTURE_2D,af.TEXTURE_MAX_ANISOTROPY_EXT,8);}
      return {...g,tex:t};});
    return {vao,ib,indexed:true,count:model.index.length,groups,capacity,n:0,data:new Float32Array(capacity*INST_FLOATS)};
  }
  get white(){if(!this._white){const gl=this.gl;this._white=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this._white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));}return this._white;}
  upload(mesh,n){
    const gl=this.gl;mesh.n=n;
    if(n>mesh.capacity){mesh.capacity=n;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.ib);gl.bufferData(gl.ARRAY_BUFFER,mesh.data,gl.DYNAMIC_DRAW);return;}
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.ib);gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.data,0,n*INST_FLOATS);
  }
  plane(x0,z0,x1,z1,y=0){
    const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    this.buf(new Float32Array([x0,y,z0,x1,y,z0,x1,y,z1,x0,y,z0,x1,y,z1,x0,y,z1]),0,3);gl.bindVertexArray(null);
    return {vao,count:6};
  }
  dataTexture(bytes,w,h){
    const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,w,h,0,gl.RED,gl.UNSIGNED_BYTE,bytes);
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
    return t;
  }
  colorTex(w,h){
    const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    if(this.hdr)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);
    else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    return {t,fb,w,h};
  }
  resize(){
    const gl=this.gl,c=this.canvas;
    const dpr=Math.min(window.devicePixelRatio||1,this.maxScale)*this.scale;
    const w=Math.max(2,Math.floor((c.clientWidth||2)*dpr)),h=Math.max(2,Math.floor((c.clientHeight||2)*dpr));
    if(w===this.w&&h===this.h)return;
    this.w=c.width=w;this.h=c.height=h;
    if(this.msFb){gl.deleteFramebuffer(this.msFb);gl.deleteRenderbuffer(this.msColor);gl.deleteRenderbuffer(this.msDepth);}
    for(const t of [this.scene,this.b1,this.b2,this.b3,this.b4])if(t){gl.deleteTexture(t.t);gl.deleteFramebuffer(t.fb);}
    const fmt=this.hdr?gl.RGBA16F:gl.RGBA8;
    this.msFb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.msFb);
    this.msColor=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,this.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER,this.samples,fmt,w,h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,this.msColor);
    this.msDepth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,this.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER,this.samples,gl.DEPTH_COMPONENT24,w,h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.msDepth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE&&this.samples){this.samples=0;this.w=0;return this.resize();}
    this.scene=this.colorTex(w,h);
    const hw=Math.max(1,w>>2),hh=Math.max(1,h>>2);
    this.b1=this.colorTex(hw,hh);this.b2=this.colorTex(hw,hh);
    this.b3=this.colorTex(Math.max(1,w>>4),Math.max(1,h>>4));this.b4=this.colorTex(Math.max(1,w>>4),Math.max(1,h>>4));
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  setEnv(p,env){
    const gl=this.gl,u=n=>this.u(p,n);
    gl.uniform3fv(u('uCamPos'),env.eye);gl.uniform3fv(u('uSunDir'),env.lightDir);gl.uniform3fv(u('uSunColor'),env.lightColor);
    gl.uniform3fv(u('uSkyTop'),env.skyTop);gl.uniform3fv(u('uSkyHor'),env.skyHor);gl.uniform3fv(u('uSunDisk'),env.sunDir);
    gl.uniform1f(u('uSunVis'),env.sunVis);gl.uniform1f(u('uNight'),env.night);gl.uniform1f(u('uRain'),env.rain);
    gl.uniform1f(u('uTime'),env.time);gl.uniform1f(u('uFog'),env.fog);
    gl.uniformMatrix4fv(u('uShadowMat'),false,this.shadowMat);gl.uniform1f(u('uShadowOn'),env.shadows?1:0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.shadowTex);gl.uniform1i(u('uShadow'),0);
  }
  drawMeshes(p,list,vp,shadow){
    const gl=this.gl;
    gl.uniformMatrix4fv(this.u(p,'uVP'),false,vp);
    for(const it of list){
      if(!it.mesh.n||(shadow&&it.noShadow))continue;
      if(it.mesh.indexed){if(!shadow)continue;gl.uniform1i(this.u(p,'uKind'),0);gl.bindVertexArray(it.mesh.vao);gl.drawElementsInstanced(gl.TRIANGLES,it.mesh.count,gl.UNSIGNED_INT,0,it.mesh.n);continue;}
      gl.uniform1i(this.u(p,'uKind'),it.kind||0);
      gl.bindVertexArray(it.mesh.vao);gl.drawArraysInstanced(gl.TRIANGLES,0,it.mesh.count,it.mesh.n);
    }
  }
  fullscreen(p,target,w,h){const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(0,0,w,h);gl.useProgram(p);gl.bindVertexArray(this.emptyVao);return p;}
  tex(p,name,t,unit){const gl=this.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.uniform1i(this.u(p,name),unit);}

  render(sc){
    const gl=this.gl;this.resize();
    const env=sc.env,{w,h}=this;
    perspective(this.proj,sc.fov,w/h,.3,4500);lookAt(this.view,env.eye,sc.target,[0,1,0]);
    mul(this.vp,this.proj,this.view);invert(this.invVp,this.vp);
    gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.BLEND);
    // shadow pass
    env.shadows=env.lightDir[1]>.04&&!window.__noShadow;
    if(env.shadows){
      const R=sc.shadowRadius||150,ts=R*2/this.shadowSize;
      const c=[Math.round(sc.shadowCenter[0]/ts)*ts,0,Math.round(sc.shadowCenter[2]/ts)*ts];
      const L=env.lightDir,eye=[c[0]+L[0]*500,L[1]*500,c[2]+L[2]*500];
      const lv=lookAt(m4(),eye,c,Math.abs(L[1])>.99?[0,0,1]:[0,1,0]);
      mul(this.shadowMat,ortho(m4(),-R,R,-R,R,1,1100),lv);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFb);gl.viewport(0,0,this.shadowSize,this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(2,4);
      gl.useProgram(this.progs.depth);this.drawMeshes(this.progs.depth,sc.meshes,this.shadowMat,true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    // main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.msFb);gl.viewport(0,0,w,h);
    gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    // sky
    let p=this.progs.sky;gl.useProgram(p);this.setEnv(p,env);gl.uniformMatrix4fv(this.u(p,'uInvVP'),false,this.invVp);
    gl.depthMask(false);gl.disable(gl.DEPTH_TEST);gl.bindVertexArray(this.emptyVao);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
    // ground
    if(sc.ground){p=this.progs.ground;gl.useProgram(p);this.setEnv(p,env);gl.uniformMatrix4fv(this.u(p,'uVP'),false,this.vp);
      this.tex(p,'uBlocks',sc.ground.blocks,1);gl.uniform1f(this.u(p,'uB'),sc.ground.B);gl.uniform1f(this.u(p,'uN'),sc.ground.N);
      const heads=sc.heads||[];const hv=new Float32Array(48);heads.slice(0,12).forEach((hd,i)=>hv.set(hd,i*4));
      gl.uniform4fv(this.u(p,'uHead'),hv);gl.uniform1i(this.u(p,'uHeadN'),Math.min(12,heads.length));
      for(const pl of sc.ground.planes){gl.bindVertexArray(pl.vao);gl.drawArrays(gl.TRIANGLES,0,pl.count);}}
    if(sc.water){p=this.progs.water;gl.useProgram(p);this.setEnv(p,env);gl.uniformMatrix4fv(this.u(p,'uVP'),false,this.vp);
      gl.bindVertexArray(sc.water.vao);gl.drawArrays(gl.TRIANGLES,0,sc.water.count);}
    // objects
    p=this.progs.lit;gl.useProgram(p);this.setEnv(p,env);this.drawMeshes(p,sc.meshes,this.vp,false);
    const tm=sc.meshes.filter(it=>it.mesh.indexed&&it.mesh.n);
    if(tm.length){p=this.progs.tex;gl.useProgram(p);this.setEnv(p,env);gl.uniformMatrix4fv(this.u(p,'uVP'),false,this.vp);
      for(const it of tm){gl.bindVertexArray(it.mesh.vao);
        for(const g of it.mesh.groups){this.tex(p,'uTex',g.tex||this.white,1);gl.uniform4fv(this.u(p,'uBase'),g.color);gl.uniform1f(this.u(p,'uRough'),g.rough);gl.uniform1f(this.u(p,'uMetal'),g.metal);
          gl.drawElementsInstanced(gl.TRIANGLES,g.count,gl.UNSIGNED_INT,g.start*4,it.mesh.n);}}}
    // rain
    if(env.rain>.02){
      p=this.progs.rain;gl.useProgram(p);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.depthMask(false);
      gl.uniformMatrix4fv(this.u(p,'uVP'),false,this.vp);gl.uniform3fv(this.u(p,'uCamPos'),env.eye);gl.uniform1f(this.u(p,'uTime'),env.time);
      const r=[this.view[0],this.view[4],this.view[8]];gl.uniform3fv(this.u(p,'uRight'),r);
      gl.uniform3fv(this.u(p,'uCol'),env.skyHor.map(x=>(x*.8+.15)*env.rain));
      gl.bindVertexArray(this.rainVao);gl.drawArraysInstanced(gl.TRIANGLES,0,6,Math.floor(this.rainCount*env.rain));
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
    // resolve
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.msFb);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.scene.fb);
    gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    gl.disable(gl.DEPTH_TEST);
    // bloom
    const {b1,b2,b3,b4}=this;
    p=this.fullscreen(this.progs.bright,b1.fb,b1.w,b1.h);this.tex(p,'uTex',this.scene.t,0);gl.uniform1f(this.u(p,'uThresh'),this.hdr?1.6:.8);gl.drawArrays(gl.TRIANGLES,0,3);
    const blur=(src,dst,dir)=>{const q=this.fullscreen(this.progs.blur,dst.fb,dst.w,dst.h);this.tex(q,'uTex',src.t,0);gl.uniform2fv(this.u(q,'uDir'),dir);gl.drawArrays(gl.TRIANGLES,0,3);};
    blur(b1,b2,[1,0]);blur(b2,b1,[0,1]);blur(b1,b2,[2,0]);blur(b2,b1,[0,2]);
    blur(b1,b3,[1,0]);blur(b3,b4,[0,1]);blur(b4,b3,[2,0]);blur(b3,b4,[0,2]);
    p=this.fullscreen(this.progs.comp,null,w,h);
    this.tex(p,'uTex',this.scene.t,0);this.tex(p,'uBloom',b1.t,1);this.tex(p,'uBloom2',b4.t,2);
    gl.uniform1f(this.u(p,'uExposure'),env.exposure);gl.uniform1f(this.u(p,'uTime'),env.time);gl.uniform1f(this.u(p,'uVig'),sc.vignette??.9);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.enable(gl.DEPTH_TEST);gl.bindVertexArray(null);
  }
  destroy(){this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
export { INST_FLOATS };
