// Local model runtime: Ollama on this PC only. No cloud models, no fallback to any paid API.
// Every request is logged (time, endpoint, model, role, duration) so "local only" can be checked.
import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, isLoopback } from './guard.js';

export function ollamaBase(){
  const raw=process.env.OLLAMA_URL||(process.env.OLLAMA_HOST?(/^https?:/.test(process.env.OLLAMA_HOST)?process.env.OLLAMA_HOST:`http://${process.env.OLLAMA_HOST}`):'http://127.0.0.1:11434');
  const u=new URL(raw);
  if(!isLoopback(u.hostname))throw new Error(`Ollama must run on this PC (127.0.0.1). ${u.hostname} is not allowed.`);
  if(u.hostname==='0.0.0.0')throw new Error('Ollama must listen on 127.0.0.1, not 0.0.0.0.');
  return `${u.protocol}//${u.host}`;
}
const logFile=()=>{fs.mkdirSync(LOG_DIR,{recursive:true});return path.join(LOG_DIR,'model-requests.jsonl');};
function logReq(e){try{fs.appendFileSync(logFile(),JSON.stringify({at:new Date().toISOString(),...e})+'\n');}catch{}}
// A model is "cloud" if Ollama says it runs remotely (":cloud" names, remote_host/remote_model in /api/show).
export const isCloudModel=(name,show)=>/(:|-)cloud\b/i.test(String(name||''))||!!(show&&(show.remote_host||show.remote_model));

async function call(p,body,{signal,timeoutMs=600000,role='system'}={}){
  const url=ollamaBase()+p;const t0=Date.now();
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),timeoutMs);
  signal?.addEventListener('abort',()=>ctl.abort(),{once:true});
  try{
    const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:ctl.signal});
    const text=await r.text();let d;try{d=JSON.parse(text);}catch{d={error:text.slice(0,300)};}
    if(p==='/api/chat')logReq({endpoint:url,model:body?.model,role,ms:Date.now()-t0,ok:r.ok,images:(body?.messages||[]).reduce((n,m)=>n+(m.images?.length||0),0),tools:(body?.tools||[]).length,prompt_tokens:d.prompt_eval_count||null,output_tokens:d.eval_count||null,error:r.ok?null:d.error||null});
    if(!r.ok)throw new Error(`Ollama ${r.status}: ${d.error||'request failed'}`);
    return d;
  }catch(e){if(p==='/api/chat'&&e.name==='AbortError')logReq({endpoint:url,model:body?.model,role,ms:Date.now()-t0,ok:false,error:'stopped'});throw e.name==='AbortError'?new Error(signal?.aborted?'Stopped':'The model took too long to answer'):e;}
  finally{clearTimeout(t);}
}

export async function status(){
  try{
    const base=ollamaBase();const [ver,tags,ps]=await Promise.all([call('/api/version'),call('/api/tags'),call('/api/ps').catch(()=>({models:[]}))]);
    return {running:true,base,version:ver.version,models:(tags.models||[]).map(m=>({name:m.name,size:m.size,family:m.details?.family,params:m.details?.parameter_size,quant:m.details?.quantization_level,cloud:isCloudModel(m.name,m)||!m.size})),
      loaded:(ps.models||[]).map(m=>({name:m.name,size:m.size,vram:m.size_vram,until:m.expires_at}))};
  }catch(e){return {running:false,error:e.message};}
}
// What the installed model can really do, from Ollama itself.
export async function inspectModel(name){
  const s=await call('/api/show',{model:name});
  const caps=s.capabilities||[];
  return {name,capabilities:caps,vision:caps.includes('vision'),tools:caps.includes('tools'),cloud:isCloudModel(name,s),
    family:s.details?.family,params:s.details?.parameter_size,quant:s.details?.quantization_level,context:Object.entries(s.model_info||{}).find(([k])=>/context_length$/.test(k))?.[1]||null};
}
export async function chat({model,messages,tools,format,options,signal,role,think=false,timeoutMs}){
  const d=await call('/api/chat',{model,messages,stream:false,think,...(tools?.length?{tools}:{}),...(format?{format}:{}),options,keep_alive:'20m'},{signal,role,timeoutMs});
  return d.message||{role:'assistant',content:''};
}
export async function pull(name){return call('/api/pull',{model:name,stream:false},{timeoutMs:6*3600e3});}
