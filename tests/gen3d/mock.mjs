// Stand-in for the Rodin and Meshy APIs (protocol test only).
import http from 'node:http';
const PORT=Number(process.env.MOCK_PORT||3190);const B=`http://localhost:${PORT}`;
const glb=Buffer.from('glTF-fake-model');let n=0;const tasks={};
http.createServer((req,res)=>{let body=[];req.on('data',d=>body.push(d));req.on('end',()=>{
  const j=(o,s=200)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(o));};
  const u=req.url;
  if(u==='/rodin/rodin'){const id='r'+(++n);tasks[id]=0;return j({uuid:id,jobs:{subscription_key:id,uuids:[id]}});}
  if(u==='/rodin/status'){const k=JSON.parse(Buffer.concat(body)).subscription_key;tasks[k]++;return j({jobs:[{uuid:k,status:tasks[k]>1?'Done':'Generating'}]});}
  if(u==='/rodin/download')return j({list:[{name:'base_basic_pbr.glb',url:B+'/file/model.glb'},{name:'texture_diffuse.png',url:B+'/file/t.png'}]});
  if(u==='/meshy/openapi/v1/multi-image-to-3d'&&req.method==='POST'){const id='m'+(++n);tasks[id]=0;return j({result:id});}
  if(u.startsWith('/meshy/openapi/v1/multi-image-to-3d/')){const id=u.split('/').pop();tasks[id]++;return j({id,status:tasks[id]>1?'SUCCEEDED':'IN_PROGRESS',progress:50,model_urls:{glb:B+'/file/model.glb',fbx:B+'/file/model.fbx'},texture_urls:[{base_color:B+'/file/t.png'}],thumbnail_urls:{front:B+'/file/t.png'}});}
  if(u==='/meshy/openapi/v1/rigging'){const id='g'+(++n);tasks[id]=0;return j({result:id});}
  if(u.startsWith('/meshy/openapi/v1/rigging/')){const id=u.split('/').pop();tasks[id]++;return j({id,status:tasks[id]>1?'SUCCEEDED':'IN_PROGRESS',result:{rigged_character_fbx_url:B+'/file/rig.fbx',rigged_character_glb_url:B+'/file/rig.glb',basic_animations:{walking:{walking_fbx_url:B+'/file/walk.fbx'},running:{running_fbx_url:B+'/file/run.fbx'}}}});}
  if(u.startsWith('/file/')){res.writeHead(200);return res.end(glb);}
  j({error:'no route '+u},404);});}).listen(PORT,()=>console.log('mock on',PORT));
