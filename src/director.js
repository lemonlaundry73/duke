// Duke Director: drafts stage content, proposes entities and coaches the creator.
import { STAGES, COLLECTIONS, FIELD_HOME, ensureDesign, pipelineStatus } from './pipeline.js';
import { llmJson, brainName } from './brain.js';

const SYSTEM=`You are Duke, a veteran open-world game director (AAA crime/action games) coaching a first-time creator.
You write original content only: no real brands, no real people, no copyrighted characters or places.
Keep the creator's own ideas; fill gaps so everything is consistent with their vision. Be concrete and production-ready.`;

function brief(d){
  const v=d.vision||{},s=d.story||{};
  const people=(d.characters||[]).map(c=>`${c.name} (${c.role}): ${c.look||''} ${c.outfit||''}`).join('\n');
  const places=(d.districts||[]).map(x=>`${x.name} — ${x.style}: ${x.mood||''}`).join('\n');
  return `GAME: ${v.title||'(untitled)'}\nLogline: ${v.logline||''}\nSetting: ${v.setting||''}\nTone: ${v.tone||''}\nArt direction: ${v.art_direction||''}\nPillars: ${(v.pillars||[]).join('; ')}\n`+
    `Story premise: ${s.premise||''}\nActs: ${s.act1||''} | ${s.act2||''} | ${s.act3||''}\nCharacters:\n${people||'(none)'}\nDistricts:\n${places||'(none)'}\nCity: ${d.world?.city_name||''}`;
}
const fieldSpec=fields=>fields.map(f=>`- "${f.key}": ${f.label}${f.type==='select'&&f.options?.length?` (one of: ${f.options.join(' | ')})`:''}${f.type==='list'?' (array of strings)':''}${f.type==='number'?' (number)':''}${f.type==='bool'?' (boolean)':''}`).join('\n');

// ---------- drafting ----------
export async function draftStage(stageId,p){
  const d=ensureDesign(p),stage=STAGES.find(s=>s.id===stageId);
  if(!stage?.fields)return {};
  const home=d[FIELD_HOME[stageId]]||{};
  const fields=stage.fields.filter(f=>!f.source);
  const live=await llmJson(SYSTEM,`${brief(d)}\n\nDraft the "${stage.title}" stage. Current values (keep any that are filled in, improve nothing the creator wrote): ${JSON.stringify(home)}\nReturn JSON with these keys:\n${fieldSpec(fields)}`);
  const out=live&&typeof live==='object'?live:localStage(stageId,d);
  const clean={};
  for(const f of fields){if(out[f.key]===undefined)continue;let v=out[f.key];
    if(f.type==='select'&&f.options?.length&&!f.options.includes(v))continue;
    if(f.type==='number')v=Number(v);if(f.type==='list'&&!Array.isArray(v))v=String(v).split(/\n|;/).map(x=>x.trim()).filter(Boolean);
    if(f.type==='bool')v=!!v;
    clean[f.key]=v;}
  return {values:clean,source:live?brainName():'Duke templates'};
}

export async function draftEntities(collection,p,count=1,hint=''){
  const d=ensureDesign(p),c=COLLECTIONS[collection];
  const existing=(d[collection]||[]).map(e=>e.name).filter(Boolean);
  const fields=c.fields;
  const refs=`Character ids: ${JSON.stringify((d.characters||[]).map(x=>({id:x.id,name:x.name})))}\nDistrict ids: ${JSON.stringify((d.districts||[]).map(x=>({id:x.id,name:x.name})))}`;
  const live=await llmJson(SYSTEM,`${brief(d)}\n${refs}\n\nPropose ${count} new ${c.plural.toLowerCase()} that the game needs next (already have: ${existing.join(', ')||'none'}). ${hint}\nFor fields that reference characters or districts use the id. Return {"items":[...]} where each item has keys:\n${fieldSpec(fields)}`);
  let items=Array.isArray(live?.items)?live.items:localEntities(collection,d,count);
  items=items.slice(0,count).map(it=>{const o={};for(const f of fields){let v=it[f.key];if(v===undefined)continue;
    if(f.source){const pool=d[f.source]||[];const hit=pool.find(x=>x.id===v)||pool.find(x=>String(x.name).toLowerCase()===String(v).toLowerCase());v=hit?.id;if(!v)continue;}
    else if(f.type==='select'&&!f.options.includes(v))continue;
    if(f.type==='number')v=Number(v);o[f.key]=v;}return o;});
  return {items,source:live?brainName():'Duke templates'};
}

export async function ask(p,question){
  const d=ensureDesign(p),st=pipelineStatus(p);
  const cur=st.stages.find(s=>s.id===st.current);
  const todo=cur.items.filter(i=>!i.done).slice(0,6).map(i=>`- ${i.label}${i.hint?` (${i.hint})`:''}`).join('\n');
  const live=await llmJson(SYSTEM,`${brief(d)}\nCurrent stage: ${cur.title}. Still needed:\n${todo||'(nothing — stage complete)'}\n\nCreator asks: "${question}"\nAnswer as their director in 2-6 short sentences: practical, encouraging, specific to their game. Return {"answer":"..."}`,{maxTokens:900});
  if(live?.answer)return {answer:String(live.answer),source:brainName()};
  return {answer:localAnswer(question,cur,st),source:'Duke templates'};
}

export function coach(p){
  const st=pipelineStatus(p);const cur=st.stages.find(s=>s.id===st.current);
  if(st.stages.every(s=>s.done))return {message:'Everything is in place. Your game is built — publish it or keep polishing.',stage:cur.id,items:[]};
  const open=cur.items.filter(i=>!i.done);
  const first=open[0];
  const label=first?.label.includes(': ')?`${first.label.split(': ')[1]} for ${first.label.split(': ')[0]}`:first?.label;
  const message=first?`Next up: ${label}. ${first.hint||''} (${open.length} item${open.length===1?'':'s'} left in ${cur.title})`.replace(/\s+/g,' ').trim():`${cur.title} is complete.`;
  return {message,stage:cur.id,remaining:open.length,items:open.slice(0,8)};
}

// ---------- local fallbacks (no AI key) ----------
function localStage(id,d){
  const t=d.vision?.title||'Vice Shore',city=d.world?.city_name||t;
  const L={
    vision:{title:t,logline:`A getaway driver with nothing left to lose climbs from the docks to the penthouses of ${city}, one job at a time.`,
      setting:'A fictional sun-drenched coastal city in 1986: art deco beachfront, glass towers, smugglers in the harbor.',tone:'Neon 80s',
      art_direction:'Stylized realism, saturated sunset palette, pastel art deco buildings, glossy cars, neon at night, light film grain',
      pillars:['Drive anywhere, steal anything','Every mission is a set piece','A city that lives without you','Your choices change who controls the streets'],camera:'Third-person',platform:'Windows PC',references:'80s crime films, open-world driving games'},
    story:{premise:`After a job goes wrong, a driver owes a deadly debt to the man who runs ${city}'s docks. To survive he builds his own crew and takes the city back block by block.`,
      protagonist_goal:'Pay off the debt, protect his sister, and end up owning the town instead of running from it.',
      antagonist_plan:'The dock boss is buying up the beachfront with smuggled money and using the police to clear out anyone in the way.',
      act1:'The botched heist. Ace loses the money, meets his first ally, and takes small driving jobs to survive.',
      act2:'Ace builds a crew, hits the boss\'s shipments, and the police turn against him. A betrayal costs him his safehouse.',
      act3:'A storm-night assault on the boss\'s tower and a final chase along the beachfront to the harbor.',
      opening_script:`EXT. ${city.toUpperCase()} DOCKS - NIGHT\n\nRain hammers shipping containers. A white coupe idles with its lights off. ACE (34) drums the wheel.\n\nACE\n(into radio)\nTwo minutes. Then I'm gone.\n\nA DOOR BANGS. Gunfire flashes between the containers. LUIS (30s) sprints out clutching a duffel bag, bleeding.\n\nLUIS\nDrive! They knew we were coming!\n\nAce floors it. Headlights explode in the mirror: POLICE CRUISERS.\n\nACE\nSomebody sold us out.\n\nCUT TO BLACK.`,
      themes:'Loyalty, ambition, the price of the dream'},
    world:{city_name:city,size:'Medium (12×12 blocks)',climate:'Tropical coast',default_time:17.5,weather:'Mostly clear',traffic:'Normal',crowds:'Normal'},
    weapons:{player_health:100,aim_style:'Free aim',armor:true},
    missions:{wanted_enabled:true,max_wanted:5,start_cash:500},
    audio_ui:{menu_title:t.toUpperCase(),music_style:'Synthwave and 80s pop on the radio; tense synth bass and drums during chases and shootouts',radio_stations:['Flash 86.4','Wave Radio','Night Drive FM'],hud_minimap:true,hud_wanted:true,hud_cash:true,subtitles:true},
    build:{config:'Shipping'},publish:{itch_channel:'windows'}
  };
  return L[id]||{};
}
const POOL={
  characters:[
    {name:'Marcus "Ace" Reed',role:'Protagonist',age:34,look:'Tall athletic man, sharp jaw, short fade haircut, light stubble, small scar above left eyebrow',outfit:'Open teal silk shirt over a white tee, cream linen trousers, white sneakers, thin gold chain',personality:'Calm under pressure, loyal, dry humor',height_m:1.83,backstory:'Former stock-car prodigy turned getaway driver after his father\'s debts caught up with the family.',dialogue:'"Two minutes. Then I\'m gone."\n"This city never sleeps. Neither do I."'},
    {name:'Victor Vargas',role:'Antagonist',age:52,look:'Heavy-set man, slicked-back silver hair, thick mustache, tanned skin',outfit:'White three-piece suit, black open-collar shirt, gold rings, tinted aviator glasses',personality:'Charming in public, ruthless in private, never raises his voice',height_m:1.78,backstory:'Runs the docks and half the police department.',dialogue:'"In this town, everything has a price. Even you."'},
    {name:'Lena Cruz',role:'Ally',age:29,look:'Slim woman, long dark curly hair in a high ponytail, bright hazel eyes',outfit:'Cropped denim jacket, black tank top, high-waisted jeans, red sneakers, mechanic\'s gloves',personality:'Quick-witted, fearless, the best mechanic in the city',height_m:1.68,backstory:'Runs a chop shop under the freeway.',dialogue:'"You break it, I fix it. You crash it, you pay."'},
    {name:'Detective Ray Holloway',role:'Rival',age:45,look:'Wiry man, tired eyes, receding sandy hair, five o\'clock shadow',outfit:'Wrinkled tan trench coat, loosened tie, badge on belt, scuffed loafers',personality:'Obsessive, incorruptible, always one step behind',height_m:1.8,backstory:'The only cop Vargas can\'t buy.',dialogue:'"I don\'t want you, Reed. I want who you work for."'},
    {name:'Mama Rosa',role:'Mission giver',age:61,look:'Short round woman, grey hair in a bun, warm smile, reading glasses on a chain',outfit:'Floral sundress, white apron, comfortable sandals',personality:'Sweet, sharp, knows every secret in the neighborhood',height_m:1.55,backstory:'Owns the diner everyone in the underworld eats at.',dialogue:'"Eat first. Then we talk business."'}
  ],
  districts:[
    {name:'Ocean Drive',style:'Beachfront art deco',mood:'Pastel hotels, neon signs, palm-lined boulevard, beach crowds and roller skaters at sunset'},
    {name:'Downtown',style:'Downtown towers',mood:'Glass skyscrapers, banks and corporate plazas, busy traffic, cold blue reflections'},
    {name:'Neon Row',style:'Nightlife strip',mood:'Clubs, bars and arcades; everything glows after dark; street racers gather here'},
    {name:'Harbor Docks',style:'Industrial docks',mood:'Shipping containers, cranes, warehouses, smugglers\' boats, rusted chain-link fences'},
    {name:'Palm Heights',style:'Residential',mood:'Quiet streets of pastel houses, swimming pools and corner shops'}
  ],
  landmarks:[
    {name:'The Flamingo Hotel',description:'Six-storey pink art deco hotel with a curved neon flamingo sign and a rooftop pool',districtStyle:'Beachfront art deco'},
    {name:'Vargas Tower',description:'Black glass skyscraper with a gold crown and a helipad on top',districtStyle:'Downtown towers'},
    {name:'Club Paradise',description:'Two-storey nightclub with a glowing purple palm tree sign and a velvet-rope entrance',districtStyle:'Nightlife strip'},
    {name:'Harbor Crane No. 7',description:'Huge rusted red gantry crane over the water with a control cabin',districtStyle:'Industrial docks'}
  ],
  kit:[
    {kind:'Palm tree',name:'Coastal palm',description:'Tall gently curved coconut palm, ringed grey-brown trunk, full crown of long green fronds, a few coconuts'},
    {kind:'Street lamp',name:'Boulevard lamp',description:'Classic tall black metal street lamp with a single curved arm and a flat rectangular light head'},
    {kind:'Street tree',name:'Shade tree',description:'Broad leafy deciduous street tree with a straight trunk and a round dense canopy'}
  ],
  vehicles:[
    {name:'Viceroy GT',class:'Sports',look:'Low two-door 1980s sports coupe, white paint, pink and teal pinstripes, pop-up headlights',top_speed_kmh:240,handling:'Drifty',spawn:'Rare traffic'},
    {name:'Bayside Cruiser',class:'Sedan',look:'Boxy four-door 80s family sedan, faded powder-blue paint, chrome bumpers',top_speed_kmh:170,handling:'Balanced',spawn:'Traffic'},
    {name:'Shore Patrol Interceptor',class:'Police',look:'Black and white police sedan with a red and blue roof light bar and push bar',top_speed_kmh:210,handling:'Grippy',spawn:'Police only'},
    {name:'Stallion 450',class:'Muscle',look:'Long muscle car, deep red paint, black hood scoop, wide rear tires',top_speed_kmh:225,handling:'Drifty',spawn:'Traffic'},
    {name:'Dune Rover',class:'SUV',look:'Boxy off-road SUV, sand-colored paint, roof rack, spare tire on the back',top_speed_kmh:160,handling:'Grippy',spawn:'Traffic'}
  ],
  weapons:[
    {name:'Service Pistol',type:'Pistol',look:'Compact matte black semi-automatic pistol with worn grip',damage:25,fire_rate_rpm:400,magazine:15,range_m:45,price:400},
    {name:'Stinger SMG',type:'SMG',look:'Compact submachine gun with a folding wire stock and a long curved magazine',damage:18,fire_rate_rpm:850,magazine:32,range_m:35,price:1500},
    {name:'Riot Shotgun',type:'Shotgun',look:'Pump-action shotgun with a black synthetic stock and pistol grip',damage:70,fire_rate_rpm:70,magazine:6,range_m:18,price:1200},
    {name:'Harbor Carbine',type:'Assault rifle',look:'Rugged assault carbine with a wooden handguard and a red-dot sight',damage:30,fire_rate_rpm:650,magazine:30,range_m:90,price:3500}
  ],
  missions:[
    {name:'Wheelman',objective:'Drive to location',reward:800,giver:'Ally',district:'Industrial docks',target:'The safehouse garage',briefing:'"Get the car out of the docks before Vargas\' boys find it. Bring it to my shop."'},
    {name:'Special Delivery',objective:'Deliver vehicle',reward:1500,giver:'Mission giver',district:'Nightlife strip',target:'A white Viceroy GT',briefing:'"A friend needs a car delivered to Neon Row. Don\'t scratch it, honey."'},
    {name:'Heat Wave',objective:'Escape the police',reward:2000,giver:'Ally',district:'Downtown towers',target:'Lose a 3-star wanted level',briefing:'"Holloway\'s got every cruiser in town looking for you. Lose them."'},
    {name:'Paid in Full',objective:'Eliminate target',reward:5000,giver:'Mission giver',district:'Beachfront art deco',target:'Vargas\' bagman at the Flamingo Hotel',briefing:'"The man who sold you out is drinking at the Flamingo. Finish it."'}
  ]
};
let uid=0;
function localEntities(c,d,count){
  const have=new Set((d[c]||[]).map(e=>e.name));
  const out=[];
  for(const it of POOL[c]||[]){if(out.length>=count)break;if(have.has(it.name))continue;const o={...it};
    if(c==='landmarks'){const dist=(d.districts||[]).find(x=>x.style===it.districtStyle)||(d.districts||[])[out.length%Math.max(1,(d.districts||[]).length)];if(dist)o.district=dist.id;delete o.districtStyle;}
    if(c==='missions'){const g=(d.characters||[]).find(x=>x.role===it.giver)||(d.characters||[]).find(x=>x.role!=='Protagonist');if(g)o.giver=g.id;else delete o.giver;
      const ds=(d.districts||[]).find(x=>x.style===it.district)||(d.districts||[])[0];if(ds)o.district=ds.id;else delete o.district;}
    out.push(o);}
  while(out.length<count){uid++;out.push({name:`New ${COLLECTIONS[c].label} ${uid}`});}
  return out;
}
function localAnswer(q,cur,st){
  const open=cur.items.filter(i=>!i.done);
  const ql=q.toLowerCase();
  if(/what.*next|next step|stuck|what do i do/.test(ql))return open.length?`You're on ${cur.title}. Next up: ${open[0].label}. ${open[0].hint||''} After that, ${open.length-1} more item${open.length-1===1?'':'s'} unlock the next stage.`:`${cur.title} is done — move on to the next stage.`;
  if(/meshy|3d|model/.test(ql))return 'Every asset goes concept → approve → 3D model. Approving a concept first means the 3D model matches what you pictured. Characters also get rigged, which gives them walk and run cycles automatically.';
  if(/unreal|build|engine|pc/.test(ql))return 'When every stage is complete, Duke writes a full Unreal Engine 5 project. The Duke agent on your PC imports your models, builds the city map and packages a playable Windows game. You need Unreal Engine 5 and Visual Studio 2022 with the C++ game workload installed.';
  return `Good question. Focus on ${cur.title} for now — ${open.length?`${open.length} item${open.length===1?'':'s'} left, starting with "${open[0].label}"`:'it\'s complete'}. Use "Draft with Duke" to get a strong starting point, then make it yours.`;
}

// ---------- roadmap steps ----------
const STEP_SYSTEM=`${SYSTEM}
You are guiding a solo creator through a 67-step production roadmap for a high-end Unreal Engine 5 open-world game
(Character Creator 5 + Headshot 3 + Blender for characters, PCG and AI agents for the world). Explain any jargon in plain words.`;
function roadmapBrief(p){
  const a=p.roadmap?.answers||{};
  return `${brief(ensureDesign(p))}\nFirst mission: ${[a.m_area,a.m_enemy,a.m_objective,a.m_exit].filter(Boolean).join(' / ')||'(not set)'}\nSpecies: ${(a.species||[]).join('; ')||'(not set)'}\nLanguages: ${(a.languages||[]).join('; ')||'(not set)'}\nRules: ${(a.rules||[]).slice(0,12).join('; ')||'(not set)'}`;
}
function cleanValue(f,v){
  if(v===undefined||v===null)return undefined;
  if(f.type==='list'){const arr=Array.isArray(v)?v:String(v).split('\n');return arr.map(x=>String(x).trim()).filter(Boolean).slice(0,40);}
  if(f.type==='number'){const n=Number(v);return Number.isFinite(n)?n:undefined;}
  if(f.type==='select')return f.options.includes(v)?v:undefined;
  return String(v);
}
function localInputs(step,p){
  const d=ensureDesign(p),v=d.vision||{},a=p.roadmap?.answers||{};
  const hero=(d.characters||[]).find(c=>c.role==='Protagonist')?.name||'the hero';
  const L={
    players:'Single-player',length:'About 4 to 6 hours',budget:900,hours:15,
    must:['Third-person melee and ranged combat','One fully finished region','A first mission with a clear win and loss','Save and load'],
    nice:['Mounts or vehicles','Crafting','Photo mode'],
    rules:['Left-click attacks; three hits chain into a combo','Press dodge to move quickly sideways and spend 20 stamina','Stamina refills 15 per second after 1 second without spending it','The player has 100 health; health potions restore 40','Enemies notice the player within 12 m in view, or 6 m by sound','At 0 health the player respawns at the last checkpoint','Completing the objective unlocks the exit','Sprinting spends 8 stamina per second'],
    species:['Humans: varied ages and builds, walk upright, speak Common'],languages:['Common: everywhere'],
    variation:'People vary by age (18 to 80), build (slim to heavy), skin tone, hair, clothing by job and wealth, and daily schedule by job: workers leave at dawn, markets fill at noon, taverns at night.',
    release_size:'3 regions, 40 enterable interiors, 1,500 distinct NPC looks, 2 species, 2 languages, 30 side activities',
    m_area:d.districts?.[0]?.name||'A small fortified outpost',m_enemy:'Outpost guard',m_objective:'Recover the stolen artifact',m_exit:'The back gate',
    project_path:'',playtest_issues:[],playtest_fixes:[],seeds:(a.species||['Human']).map(s=>`${String(s).split(':')[0]}: 8`),
    dialogue_plan:`Main story characters (${hero} and the cast) use hand-written lines. Shopkeepers, guards and townspeople use live AI for small talk, limited to their job, their district and rumors the writer approves; they never reveal story secrets or break character.`,
    ai_cost:0.3
  };
  const out={};for(const f of step.inputs){if(L[f.key]!==undefined&&L[f.key]!==''&&!(Array.isArray(L[f.key])&&!L[f.key].length))out[f.key]=L[f.key];}
  return out;
}
export async function draftStep(step,p){
  const fields=step.inputs.filter(f=>f.key!=='project_path');
  if(!fields.length)return {values:{},source:'none'};
  const cur=p.roadmap?.answers||{};
  const live=await llmJson(STEP_SYSTEM,`${roadmapBrief(p)}\n\nStep ${step.n}: ${step.title}. ${step.plain}\nHow: ${step.how.join(' ')}\nCurrent answers (keep anything filled in): ${JSON.stringify(Object.fromEntries(fields.map(f=>[f.key,cur[f.key]])))}\nDraft the answers for this creator's game. Return JSON with keys:\n${fieldSpec(fields)}`);
  const src=live&&typeof live==='object'?live:localInputs(step,p);
  const values={};for(const f of fields){const v=cleanValue(f,src[f.key]);if(v!==undefined)values[f.key]=v;}
  return {values,source:live?brainName():'Duke templates'};
}
export async function askStep(p,step,question){
  const live=await llmJson(STEP_SYSTEM,`${roadmapBrief(p)}\n\nThe creator is on step ${step.n}: ${step.title} (role: ${step.role}). ${step.plain}\nHow: ${step.how.join(' ')}\n\nThey ask: "${question}"\nAnswer in 2-6 short sentences, in plain words, specific to their game and this step. Return {"answer":"..."}`,{maxTokens:900});
  if(live?.answer)return {answer:String(live.answer),source:brainName()};
  return {answer:`On step ${step.n} you are the ${step.role.toLowerCase()}. ${step.how[0]} ${step.ai} If you are stuck, do the smallest version first, then check the gate list on the right: it shows exactly what is still missing.`,source:'Duke templates'};
}
export async function planPass(p,req){
  const d=ensureDesign(p);
  const kits=(d.kit||[]).map(k=>k.name).join(', ')||'your approved kits';
  const gap=Number(req.target)-Number(req.current||0);
  const live=await llmJson(STEP_SYSTEM,`${roadmapBrief(p)}\nApproved kits: ${kits}\n\nPlan ONE expansion pass that closes part of this gap: ${req.label} ${req.current||0}/${req.target}. The pass is built by an AI agent in Unreal 5.8's Sandbox from the creator's approved kits and rules, then auto-checked and reviewed. Return {"title":"...","size":number (how many to add this pass, realistic),"plan":"4-6 short sentences: what gets built, from which kits and rules, where, and what the reviewer should look at"}`,{maxTokens:900});
  if(live?.plan)return {title:String(live.title||`Add ${req.label.toLowerCase()}`).slice(0,120),size:Math.max(1,Math.min(gap,Number(live.size)||Math.ceil(gap/4))),plan:String(live.plan).slice(0,2000),source:brainName()};
  const size=Math.max(1,Math.ceil(gap/4));
  return {title:`Add ${size} ${req.label.toLowerCase()}`,size,source:'Duke templates',
    plan:`Build ${size} more ${req.label.toLowerCase()} from ${kits}, following your step 6 living-world rules and the district styles you wrote. Work in the Sandbox copy only. Match the lighting and density of your vertical slice screenshots. Keep the frame rate at or above your target. Review the before and after screenshots side by side with your slice before approving.`};
}
