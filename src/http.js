// Minimal zero-dependency HTTP toolkit: routing, JSON bodies, multipart uploads, static files.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.ps1':'text/plain; charset=utf-8', '.py':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp',
  '.ico':'image/x-icon', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.zip':'application/zip',
  '.txt':'text/plain; charset=utf-8'
};

export class HttpError extends Error { constructor(status,message){ super(message); this.status=status; } }

export function id(len=10){
  const abc='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
  const b=randomBytes(len); let s=''; for(const x of b) s+=abc[x&63]; return s;
}

export function readBody(req,limit){
  return new Promise((resolve,reject)=>{
    const chunks=[]; let size=0;
    req.on('data',c=>{ size+=c.length; if(size>limit){ reject(new HttpError(413,'Request too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}

export async function readJson(req,limit=12*1024*1024){
  const buf=await readBody(req,limit);
  if(!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400,'Invalid JSON body'); }
}

// Parses multipart/form-data. Files are written to `dir` with random names (multer-compatible shape).
export async function readMultipart(req,{dir,limit,maxFiles=20}){
  const m=/boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type']||'');
  if(!m) throw new HttpError(400,'Expected multipart/form-data');
  const boundary=Buffer.from('--'+(m[1]||m[2]));
  const buf=await readBody(req,limit);
  const files=[], fields={};
  let pos=buf.indexOf(boundary);
  while(pos!==-1){
    let start=pos+boundary.length;
    if(buf[start]===45 && buf[start+1]===45) break; // closing "--"
    start+=2; // CRLF
    const headEnd=buf.indexOf('\r\n\r\n',start);
    if(headEnd===-1) break;
    const head=buf.slice(start,headEnd).toString('utf8');
    const next=buf.indexOf(boundary,headEnd+4);
    if(next===-1) break;
    const data=buf.slice(headEnd+4,next-2);
    const name=/name="([^"]*)"/i.exec(head)?.[1];
    const filename=/filename="([^"]*)"/i.exec(head)?.[1];
    const type=/content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim()||'application/octet-stream';
    if(filename!==undefined && filename!==''){
      if(files.length>=maxFiles) throw new HttpError(400,`Too many files (max ${maxFiles})`);
      const ext=path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g,'').slice(0,8);
      const stored=id(24)+ext;
      const filePath=path.join(dir,stored);
      await fsp.writeFile(filePath,data);
      files.push({fieldname:name,originalname:path.basename(filename),mimetype:type,size:data.length,path:filePath,filename:stored});
    } else if(name){ fields[name]=data.toString('utf8'); }
    pos=next;
  }
  return {files,fields};
}

export function send(res,status,body,headers={}){
  if(res.headersSent) return;
  if(Buffer.isBuffer(body)||typeof body==='string'){ res.writeHead(status,headers); res.end(body); return; }
  const out=JSON.stringify(body);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(out),...headers});
  res.end(out);
}

// Serves files from `root` for a URL path, refusing anything that escapes the root.
export async function serveStatic(req,res,root,urlPath,{index='index.html'}={}){
  let rel;
  try { rel=decodeURIComponent(urlPath); } catch { return false; }
  if(rel.includes('\0')) return false;
  const abs=path.resolve(root,'.'+path.posix.normalize('/'+rel));
  if(abs!==root && !abs.startsWith(root+path.sep)) return false;
  let file=abs, st;
  try { st=await fsp.stat(file); if(st.isDirectory()){ file=path.join(file,index); st=await fsp.stat(file); } } catch { return false; }
  if(!st.isFile()) return false;
  const type=MIME[path.extname(file).toLowerCase()]||'application/octet-stream';
  res.writeHead(200,{'content-type':type,'content-length':st.size,'cache-control':type.startsWith('text/html')?'no-cache':'public, max-age=300'});
  if(req.method==='HEAD'){ res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

export class Router {
  constructor(){ this.routes=[]; }
  add(method,pattern,handler){
    const keys=[];
    const re=new RegExp('^'+pattern.replace(/\/:([A-Za-z]+)/g,(_,k)=>{keys.push(k);return '/([^/]+)';})+'/?$');
    this.routes.push({method,re,keys,handler});
  }
  get(p,h){this.add('GET',p,h)} post(p,h){this.add('POST',p,h)} patch(p,h){this.add('PATCH',p,h)} del(p,h){this.add('DELETE',p,h)}
  match(method,pathname){
    let pathOnly=false;
    for(const r of this.routes){
      const m=r.re.exec(pathname); if(!m) continue;
      if(r.method!==method && !(method==='HEAD'&&r.method==='GET')){ pathOnly=true; continue; }
      const params={}; r.keys.forEach((k,i)=>{ try{params[k]=decodeURIComponent(m[i+1])}catch{params[k]=m[i+1]} });
      return {handler:r.handler,params};
    }
    return pathOnly?{methodNotAllowed:true}:null;
  }
}
