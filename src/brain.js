// Reasoning provider: Claude (Anthropic) or OpenAI, returning parsed JSON. Null when no key / failure.
const has=k=>Boolean(process.env[k]);
export const brainName=()=>has('ANTHROPIC_API_KEY')?'Claude':has('OPENAI_API_KEY')?'OpenAI':null;

function parse(raw){
  if(!raw)return null;
  const s=String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}
  return null;
}

export async function llmJson(system,user,{maxTokens=4000}={}){
  const sys=`${system}\nRespond with one valid JSON object only. No markdown, no commentary.`;
  try{
    if(has('ANTHROPIC_API_KEY')){
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(180000),
        headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:process.env.DUKE_CLAUDE_MODEL||'claude-sonnet-5-5',max_tokens:maxTokens,system:sys,messages:[{role:'user',content:user}]})});
      if(r.ok){const d=await r.json();const out=parse((d.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''));if(out)return out;}
      else console.warn('[claude]',r.status,(await r.text().catch(()=>'')).slice(0,300));
    }
    if(has('OPENAI_API_KEY')){
      const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(180000),
        headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
        body:JSON.stringify({model:process.env.OPENAI_REASONING_MODEL||'gpt-5.3-codex',instructions:sys,input:user})});
      if(r.ok){const d=await r.json();let t=typeof d.output_text==='string'?d.output_text:'';
        if(!t)for(const it of d.output||[])for(const c of it.content||[])if(c.type==='output_text')t+=c.text;
        const out=parse(t);if(out)return out;}
      else console.warn('[openai]',r.status,(await r.text().catch(()=>'')).slice(0,300));
    }
  }catch(err){console.warn('[brain] request failed:',err.message);}
  return null;
}
