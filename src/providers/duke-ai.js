import { llmJson } from '../brain.js';
import fs from 'node:fs/promises';

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const has = key => Boolean(process.env[key]);

export const PROVIDERS = {
  reasoning:[{id:'claude',label:'Claude',env:'ANTHROPIC_API_KEY',role:'Production director, story, missions and NPC dialogue'},{id:'openai',label:'OpenAI',env:'OPENAI_API_KEY',role:'Alternate reasoning provider'}],
  image:[{id:'meshy-image',label:'Meshy Text to Image',env:'MESHY_API_KEY',role:'Concept art and multi-view turnarounds'}],
  threeD:[
    {id:'meshy',label:'Meshy',env:'MESHY_API_KEY',role:'Image to 3D, PBR textures, auto-rigging and animation'},
    {id:'rodin',label:'Hyper3D Rodin',env:'RODIN_API_KEY',role:'Optional premium geometry tournament route'},
    {id:'tripo',label:'Tripo',env:'TRIPO_API_KEY',role:'Optional alternate geometry/rigging route'}
  ],
  voice:[{id:'elevenlabs',label:'ElevenLabs',env:'ELEVENLABS_API_KEY',role:'Realtime NPC voice'}],
  engine:[{id:'unreal',label:'Unreal Engine 5 build agent',env:null,role:'Runs on your PC: imports assets, builds the map, packages the game'}]
};

export function providerStatus(){
  const groups={};
  for(const [group,list] of Object.entries(PROVIDERS)) groups[group]=list.map(p=>({...p,configured:p.env?has(p.env):true}));
  return {mode:'supreme-router',groups};
}

function inferType(text=''){
  const t=text.toLowerCase();
  if(/character|person|human|npc|soldier|player|quarterback|athlete|officer/.test(t)) return 'character';
  if(/\b(car|cars|truck|suv|van|jeep|tank|vehicle|bike|motorcycle|plane|jet|helicopter|boat|ship|bus|cruiser)\b/.test(t)) return 'vehicle';
  if(/building|house|store|stadium|city|street|world|map|arena|field|room/.test(t)) return 'environment';
  if(/gun|rifle|weapon|sword|pistol/.test(t)) return 'weapon';
  if(/animal|creature|monster|dragon|horse/.test(t)) return 'creature';
  return 'prop';
}

function extractOutputText(d){
  if(typeof d?.output_text==='string') return d.output_text;
  for(const item of d?.output||[]) for(const c of item?.content||[]) if(c?.type==='output_text' && c.text) return c.text;
  return '';
}

async function openAIJson(system,user){ return llmJson(system,user); }

export async function planDream(prompt){
  const live=await openAIJson(
    'You are Duke Forger, an elite game director and technical architect. Design original games only. Output an object with title, genre, pillars, systems, target, worldPlan, gameplayLoops, productionRisks, camera, playerFantasy, contentPlan, aiNpcPlan and performanceTargets.',
    prompt
  );
  if(live) return live;
  const p=prompt.toLowerCase();
  const genre=/football|basketball|sports|ncaa/.test(p)?'Sports':/shooter|fps|battlefield|call of duty/.test(p)?'FPS':/cop|police|simulator/.test(p)?'Open-world simulator':/western|horse|red dead/.test(p)?'Open-world western':'Open-world action';
  return {title:localTitle(prompt),genre,pillars:['Creator-controlled systems','Living AI NPCs','High-fidelity world','Playable-first generation'],systems:['traffic','weather','economy','police','vehicles','persistentWorld','enterableInteriors'],target:'Unreal Engine high-fidelity export',worldPlan:{streaming:'World Partition',generation:'PCG + authored hero locations'},gameplayLoops:['explore','interact','progress'],productionRisks:['content scale','animation coverage','performance budgets'],camera:'Creator controlled',playerFantasy:'Creator defined',contentPlan:'Procedural breadth + authored hero content',aiNpcPlan:'Persistent identity, memory, schedules and bounded autonomy',performanceTargets:{desktop:'60 FPS target'}};
}

export async function concept(prompt,type='auto'){
  const detected=type==='auto'?inferType(prompt):type;
  return {detected,provider:has('OPENAI_API_KEY')?'brain-live':'local-plan',variants:[1,2,3,4].map(i=>({id:`v${i}`,name:`${detected} direction ${i}`,prompt:`${prompt}. Production-ready ${detected} concept direction ${i}; original design; readable silhouette; physically plausible construction; suitable for 3D reconstruction and game production.`}))};
}

export async function assetPlan(name,mime,notes=''){
  const detected=inferType(`${name} ${notes}`);
  const map={
    character:['reference analysis','multi-view completion','high-detail mesh','retopology','UV + PBR','skeleton','facial rig','animation set','cloth/hair setup','collision capsule','LODs','engine validation'],
    vehicle:['reference analysis','high-detail mesh','hard-surface cleanup','separate moving parts','wheel/suspension pivots','PBR','collision','vehicle physics','damage zones','interior/cockpit','LODs','engine validation'],
    environment:['reference analysis','geometry reconstruction','PBR materials','collision','doors/interactions','navmesh','lighting hints','interiors policy','HLOD/LODs','streaming cells','engine validation'],
    weapon:['mesh cleanup','PBR','moving parts','grip sockets','muzzle socket','collision','weapon logic metadata','first/third-person animations','LODs','engine validation'],
    creature:['mesh','retopology','PBR','skeleton','rig','locomotion','combat animations','collision','AI metadata','LODs','engine validation'],
    prop:['mesh','UV + PBR','collision','LODs','engine validation']
  };
  return {detected,steps:map[detected]||map.prop,qualityTarget:'supreme',recommendedProvider:/^image\//.test(mime)?'Meshy 7.1 4K':'Native asset validation'};
}

async function meshyRequest(url,options={}){
  const r=await fetch(url,{...options,headers:{Authorization:`Bearer ${process.env.MESHY_API_KEY}`,...options.headers}});
  const text=await r.text();
  let data; try{data=JSON.parse(text)}catch{data={message:text}}
  if(!r.ok) throw new Error(data?.message||data?.task_error?.message||`Meshy request failed (${r.status})`);
  return data;
}

async function pollMeshy(url,{timeoutMs=18*60*1000}={}){
  const start=Date.now();
  while(Date.now()-start<timeoutMs){
    const task=await meshyRequest(url);
    const status=String(task.status||'').toUpperCase();
    if(status==='SUCCEEDED') return task;
    if(['FAILED','CANCELED','CANCELLED'].includes(status)) throw new Error(task.task_error?.message||`3D generation ${status.toLowerCase()}`);
    await sleep(5000);
  }
  throw new Error('3D generation timed out. The remote task may still be running.');
}

export async function forgeUploadedAsset(asset){
  const ext=(asset.name||'').split('.').pop().toLowerCase();
  if(['glb','gltf','fbx','obj'].includes(ext)){
    return {provider:'native-upload',notes:'Existing 3D asset accepted. Duke generated engine validation metadata and preserved the creator source.',modelUrls:{source:`/uploads/${asset.publicName||asset.fileName||''}`}};
  }
  if(has('MESHY_API_KEY') && /^image\/(png|jpeg|jpg)/i.test(asset.mime||'')){
    const bytes=await fs.readFile(asset.filePath);
    const dataUri=`data:${asset.mime};base64,${bytes.toString('base64')}`;
    const body={image_url:dataUri,ai_model:'meshy-7.1',geometry_resolution:'4k',enable_pbr:true,should_remesh:false,should_texture:true,target_formats:['glb','fbx']};
    if(asset.type==='character') body.pose_mode='a-pose';
    const created=await meshyRequest('https://api.meshy.ai/openapi/v1/image-to-3d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const task=await pollMeshy(`https://api.meshy.ai/openapi/v1/image-to-3d/${created.result}`);
    return {provider:'meshy-7.1',taskId:task.id||created.result,notes:'Premium Meshy image-to-3D generation completed.',modelUrls:task.model_urls||{},thumbnailUrl:task.thumbnail_url||null,progress:task.progress??100};
  }
  return {provider:'local',notes:has('MESHY_API_KEY')?'This source format cannot be reconstructed through the image pipeline; Duke preserved the production plan.':'Add MESHY_API_KEY to activate live premium image-to-3D. The asset plan and validation remain usable.',modelUrls:{}};
}

export async function forgeText3D(prompt,type='prop'){
  if(!has('MESHY_API_KEY')) return {provider:'local',notes:'Add MESHY_API_KEY to generate real text-to-3D.',modelUrls:{}};
  const previewBody={mode:'preview',prompt:prompt.slice(0,800),ai_model:'meshy-7.1',geometry_resolution:'4k',should_remesh:false,target_formats:['glb','fbx']};
  if(type==='character') previewBody.pose_mode='a-pose';
  const created=await meshyRequest('https://api.meshy.ai/openapi/v2/text-to-3d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(previewBody)});
  const preview=await pollMeshy(`https://api.meshy.ai/openapi/v2/text-to-3d/${created.result}`);
  const refinedCreated=await meshyRequest('https://api.meshy.ai/openapi/v2/text-to-3d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'refine',preview_task_id:preview.id||created.result,enable_pbr:true,target_formats:['glb','fbx'],auto_size:true})});
  const refined=await pollMeshy(`https://api.meshy.ai/openapi/v2/text-to-3d/${refinedCreated.result}`);
  return {provider:'meshy-7.1',taskId:refined.id||refinedCreated.result,notes:'Premium text-to-3D preview and PBR refinement completed.',modelUrls:refined.model_urls||{},thumbnailUrl:refined.thumbnail_url||null};
}

export async function npcReply(npc,message,context={}){
  const live=await openAIJson(`You are ${npc.name}, a persistent game NPC. Role: ${npc.role}. Bio: ${npc.bio}. Autonomy: ${npc.autonomy}. Context: ${JSON.stringify(context).slice(0,6000)}. Memories: ${JSON.stringify((npc.memory||[]).slice(-10)).slice(0,6000)}. Return {"text":"...","memory":{"summary":"...","importance":1-10},"relationshipDelta":-5..5}. Stay in character and preserve continuity.`,message);
  if(live?.text) return live;
  return {text:`${npc.name}: I heard you. I’ll remember that.`,memory:{summary:message.slice(0,120),importance:Math.min(10,Math.max(2,Math.ceil(message.length/25)))},relationshipDelta:0};
}
