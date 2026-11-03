// Stand-in for Ollama on 127.0.0.1 (protocol test only). Answers like a small local model would.
import http from 'node:http';
const PORT=Number(process.env.MOCK_OLLAMA_PORT||11500);
const ok=(res,o)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(o));};
const good=`\`\`\`python
import bpy
bpy.ops.mesh.primitive_cube_add(size=1)
b=bpy.context.object; b.name="Building"; b.scale=(4,3,3)
bpy.ops.mesh.primitive_cube_add(size=1); d=bpy.context.object; d.name="Door"
for i in range(4):
    bpy.ops.mesh.primitive_cube_add(size=1); w=bpy.context.object; w.name="Window_%d"%i
print("made Building Door Window_0..3")
\`\`\``;
const bad="```python\nimport bpy\nraise RuntimeError('boom')\n```";
http.createServer((req,res)=>{let b=[];req.on('data',d=>b.push(d));req.on('end',async()=>{
  const u=req.url;
  if(u==='/api/version')return ok(res,{version:'0.mock'});
  if(u==='/api/tags')return ok(res,{models:[{name:'qwen3.5:9b',size:6600000000,details:{family:'qwen35',parameter_size:'9B',quantization_level:'Q4_K_M'}}]});
  if(u==='/api/ps')return ok(res,{models:[{name:'qwen3.5:9b',size:7e9,size_vram:7e9}]});
  if(u==='/api/show')return ok(res,{capabilities:['completion','vision','tools'],details:{family:'qwen35',parameter_size:'9B',quantization_level:'Q4_K_M'},model_info:{'qwen35.context_length':262144}});
  if(u==='/api/chat'){const q=JSON.parse(Buffer.concat(b));const sys=q.messages[0].content;const all=q.messages.map(m=>m.content||'').join('\n');
    if(/SLOW/.test(all))await new Promise(r=>setTimeout(r,8000));
    if(/Coordinator/.test(sys)){
      if(/NOTESFILE/.test(all))return ok(res,{message:{role:'assistant',content:JSON.stringify({steps:[{role:'developer',title:'Add notes file',check:'notes.md exists'}]})}});
      return ok(res,{message:{role:'assistant',content:JSON.stringify({steps:[{role:'blender',title:'Build a simple building with a door and windows',instructions:'cube body, door, 4 windows',check:'Objects Building, Door and 4 windows exist'}],unsupported:/sculpt/.test(all)?['Sculpting fine detail']:[]})}});}
    if(/Blender operator/.test(sys)){const fails=(all.match(/Blender raised this error/g)||[]).length;
      return ok(res,{message:{role:'assistant',content:/ALWAYSFAIL/.test(all)||(/FAILONCE/.test(all)&&fails<1)?bad:good}});}
    if(/Reviewer/.test(sys))return ok(res,{message:{role:'assistant',content:JSON.stringify({pass:true,observations:[`I see a box-shaped building (image count ${q.messages[1].images?.length})`],problems:[]})}});
    if(/Developer/.test(sys)){const turns=q.messages.filter(m=>m.role==='tool').length;
      if(/DELETE/.test(all)&&turns===0)return ok(res,{message:{role:'assistant',content:'',tool_calls:[{function:{name:'run_command',arguments:{command:'Remove-Item notes.md'}}}]}});
      if(turns===0)return ok(res,{message:{role:'assistant',content:'',tool_calls:[{function:{name:'write_file',arguments:{path:'notes.md',content:'# Notes\nBuilt by Duke Local.\n'}}}]}});
      return ok(res,{message:{role:'assistant',content:'',tool_calls:[{function:{name:'finish',arguments:{summary:'Wrote notes.md'}}}]}});}
  }
  res.writeHead(404);res.end('{}');});}).listen(PORT,'127.0.0.1',()=>console.log('mock ollama',PORT));
