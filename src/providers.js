// AI provider adapters for the AI Team. Every call returns {text, usage:{input,output}}; cost is computed
// by the caller from the per-agent prices the creator confirms. Models are listed live from each provider.
const T=ms=>AbortSignal.timeout(ms);

export const PROVIDERS={
  anthropic:{name:'Anthropic (Claude)',base:'https://api.anthropic.com/v1',keyUrl:'https://console.anthropic.com/settings/keys',
    billing:'Needs an Anthropic API key from the Claude Console, billed per use. A Claude.ai Pro or Max chat subscription does not include API access.'},
  openai:{name:'OpenAI',base:'https://api.openai.com/v1',keyUrl:'https://platform.openai.com/api-keys',
    billing:'Needs an OpenAI API key from the OpenAI platform, billed per use. A ChatGPT Plus or Pro subscription does not include API access.'},
  xai:{name:'xAI (Grok)',base:'https://api.x.ai/v1',keyUrl:'https://console.x.ai',
    billing:'Needs an xAI API key from the xAI console, billed per use. An X Premium or SuperGrok subscription does not include API access.'},
  llama:{name:'Meta Llama (compatible endpoint)',base:'',keyUrl:'https://llama.developer.meta.com',
    billing:'Any OpenAI-compatible Llama endpoint: Meta\'s Llama API, a hosting service, or your own server (for example Ollama or vLLM). Enter its base URL. Billing depends on the host; a local server has no per-use cost.'}
};

function baseFor(c){
  const b=(c.baseUrl||PROVIDERS[c.provider]?.base||'').replace(/\/$/,'');
  if(!b)throw new Error('This provider needs a base URL');
  if(!/^https?:\/\//.test(b))throw new Error('Base URL must start with http:// or https://');
  return b;
}
async function asJson(r){const t=await r.text();let d;try{d=JSON.parse(t);}catch{d={raw:t.slice(0,300)};}
  if(!r.ok)throw new Error(`${r.status} ${d.error?.message||d.error?.type||d.message||d.raw||'request failed'}`.slice(0,300));return d;}

export async function listModels(c){
  if(c.provider==='anthropic'){
    const d=await asJson(await fetch(`${baseFor(c)}/models?limit=100`,{headers:{'x-api-key':c.apiKey,'anthropic-version':'2023-06-01'},signal:T(20000)}));
    return (d.data||[]).map(m=>m.id);
  }
  const d=await asJson(await fetch(`${baseFor(c)}/models`,{headers:c.apiKey?{authorization:`Bearer ${c.apiKey}`}:{},signal:T(20000)}));
  return (d.data||d.models||[]).map(m=>m.id||m.name).filter(Boolean)
    .filter(id=>c.provider!=='openai'||/^(gpt|o\d|chatgpt)/.test(id)&&!/(audio|realtime|tts|transcribe|image|search|embedding|moderation)/.test(id));
}

export async function complete(c,{system,user,maxTokens=4000,timeoutMs=240000}){
  if(c.provider==='anthropic'){
    const d=await asJson(await fetch(`${baseFor(c)}/messages`,{method:'POST',signal:T(timeoutMs),
      headers:{'content-type':'application/json','x-api-key':c.apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:c.model,max_tokens:maxTokens,system,messages:[{role:'user',content:user}]})}));
    return {text:(d.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''),usage:{input:d.usage?.input_tokens||0,output:d.usage?.output_tokens||0}};
  }
  // OpenAI, xAI and Llama-compatible endpoints share the chat completions format.
  const body={model:c.model,messages:[{role:'system',content:system},{role:'user',content:user}]};
  body[c.provider==='openai'?'max_completion_tokens':'max_tokens']=maxTokens;
  const d=await asJson(await fetch(`${baseFor(c)}/chat/completions`,{method:'POST',signal:T(timeoutMs),
    headers:{'content-type':'application/json',...(c.apiKey?{authorization:`Bearer ${c.apiKey}`}:{})},body:JSON.stringify(body)}));
  return {text:d.choices?.[0]?.message?.content||'',usage:{input:d.usage?.prompt_tokens||0,output:d.usage?.completion_tokens||0}};
}

export async function testConnection(c){
  const t0=Date.now();
  const models=await listModels(c).catch(e=>{throw new Error(`Could not list models: ${e.message}`);});
  const model=c.model&&models.includes(c.model)?c.model:c.model||models[0];
  if(!model)throw new Error('The provider returned no models for this key');
  const r=await complete({...c,model},{system:'Reply with exactly: OK',user:'Connection test',maxTokens:16,timeoutMs:60000});
  return {ok:true,models:models.slice(0,200),model,reply:r.text.trim().slice(0,40),ms:Date.now()-t0};
}

export function parseJson(raw){
  if(!raw)return null;
  const s=String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}
  return null;
}
