// Duke Forger production pipeline: the stages a real open-world game goes through,
// what each stage needs before the next unlocks, and helpers to measure progress.

const T=(key,label,o={})=>({key,label,type:'text',...o});
const A=(key,label,o={})=>({key,label,type:'textarea',...o});
const S=(key,label,options,o={})=>({key,label,type:'select',options,...o});
const NUM=(key,label,o={})=>({key,label,type:'number',...o});
const B=(key,label,o={})=>({key,label,type:'bool',...o});
const L=(key,label,o={})=>({key,label,type:'list',...o});

// Entity collections that produce real 3D assets (or data rows) for the engine.
export const COLLECTIONS={
  characters:{label:'Character',plural:'Characters',art:'character',fields:[
    T('name','Name',{required:true,placeholder:'Marcus "Ace" Reed'}),
    S('role','Role',['Protagonist','Antagonist','Ally','Mission giver','Rival','Police officer','Civilian'],{required:true}),
    NUM('age','Age',{placeholder:'34'}),
    A('look','Look — face, body, hair',{required:true,placeholder:'Tall, athletic, sharp jaw, short fade haircut, light stubble, scar over left eyebrow'}),
    A('outfit','Outfit',{required:true,placeholder:'Open teal silk shirt over white tee, cream linen trousers, white sneakers, gold chain'}),
    A('personality','Personality',{required:true,placeholder:'Calm under pressure, loyal, dry sense of humor'}),
    A('backstory','Backstory'),
    A('dialogue','Signature lines (one per line)',{placeholder:'"This city never sleeps. Neither do I."'}),
    NUM('height_m','Height (m)',{placeholder:'1.80'})
  ]},
  districts:{label:'District',plural:'Districts',art:null,fields:[
    T('name','Name',{required:true,placeholder:'Ocean Drive'}),
    S('style','Style',['Beachfront art deco','Downtown towers','Nightlife strip','Residential','Industrial docks','Suburbs'],{required:true}),
    A('mood','Mood & details',{required:true,placeholder:'Pastel hotels, neon signs, palm-lined boulevard, beach crowds at sunset'})
  ]},
  landmarks:{label:'Landmark',plural:'Landmarks',art:'prop',fields:[
    T('name','Name',{required:true,placeholder:'The Flamingo Hotel'}),
    S('district','District',[],{required:true,source:'districts'}),
    A('description','What it looks like',{required:true,placeholder:'Six-storey pink art deco hotel with a curved neon flamingo sign and a rooftop pool'})
  ]},
  kit:{label:'World kit prop',plural:'World kit',art:'prop',fields:[
    S('kind','Prop',['Palm tree','Street tree','Street lamp'],{required:true}),
    T('name','Name',{required:true,placeholder:'Coastal palm'}),
    A('description','What it looks like',{required:true,placeholder:'Tall curved coconut palm with a full crown of fronds and a few coconuts'})
  ]},
  vehicles:{label:'Vehicle',plural:'Vehicles',art:'vehicle',fields:[
    T('name','Name',{required:true,placeholder:'Viceroy GT'}),
    S('class','Class',['Sports','Muscle','Sedan','SUV','Truck','Motorbike','Police'],{required:true}),
    A('look','Look',{required:true,placeholder:'Low two-door 1980s sports coupe, white paint with pink and teal pinstripes, pop-up headlights'}),
    NUM('top_speed_kmh','Top speed (km/h)',{placeholder:'220'}),
    S('handling','Handling',['Grippy','Balanced','Drifty']),
    S('spawn','Where it appears',['Traffic','Rare traffic','Player garage','Police only'])
  ]},
  weapons:{label:'Weapon',plural:'Weapons',art:'weapon',fields:[
    T('name','Name',{required:true,placeholder:'M9 Service Pistol'}),
    S('type','Type',['Pistol','SMG','Assault rifle','Shotgun','Sniper rifle','Melee'],{required:true}),
    A('look','Look',{required:true,placeholder:'Matte black semi-automatic pistol with worn grip tape'}),
    NUM('damage','Damage per hit',{placeholder:'25'}),
    NUM('fire_rate_rpm','Fire rate (rounds/min)',{placeholder:'400'}),
    NUM('magazine','Magazine size',{placeholder:'15'}),
    NUM('range_m','Effective range (m)',{placeholder:'50'}),
    NUM('price','Store price ($)',{placeholder:'500'})
  ]},
  missions:{label:'Mission',plural:'Missions',art:null,fields:[
    T('name','Mission name',{required:true,placeholder:'Welcome to Vice Shore'}),
    S('giver','Given by',[],{required:true,source:'characters'}),
    S('objective','Objective',['Drive to location','Eliminate target','Collect item','Escape the police','Deliver vehicle'],{required:true}),
    S('district','Where',[],{required:true,source:'districts'}),
    T('target','Target (person, vehicle or item)',{placeholder:'The red Viceroy GT parked at the docks'}),
    NUM('reward','Cash reward',{required:true,placeholder:'1500'}),
    A('briefing','Briefing (what the giver says)',{required:true,placeholder:'"Grab my car from the docks before Vargas\' crew strips it."'})
  ]}
};

export const STAGES=[
  {id:'vision',title:'Vision',blurb:'Lock the big idea every later decision answers to.',fields:[
    T('title','Game title',{required:true,placeholder:'Vice Shore'}),
    A('logline','Logline',{required:true,placeholder:'A getaway driver fights his way from the docks to the penthouses of a neon coastal city.'}),
    A('setting','Setting & era',{required:true,placeholder:'Fictional Florida-style coastal city, 1986'}),
    S('tone','Tone',['Gritty crime drama','Satirical action comedy','Neon 80s','Modern cinematic','Dark thriller'],{required:true}),
    A('art_direction','Art direction',{required:true,placeholder:'Stylized realism, saturated sunset palette, pastel buildings, glossy cars, film grain',help:'Used in every 3D generation prompt so all assets match.'}),
    L('pillars','Design pillars (3+)',{required:true,min:3,placeholder:'Freedom to drive anywhere'}),
    S('camera','Camera',['Third-person','First-person','Switchable'],{required:true}),
    S('platform','Platform',['Windows PC'],{required:true}),
    T('references','Inspirations',{placeholder:'Vice City, Miami Vice, Drive'})
  ]},
  {id:'story',title:'Story & Script',blurb:'Write the story the missions will tell.',fields:[
    A('premise','Premise',{required:true}),
    A('protagonist_goal','What the protagonist wants',{required:true}),
    A('antagonist_plan','What the antagonist is doing',{required:true}),
    A('act1','Act 1 — setup',{required:true}),
    A('act2','Act 2 — escalation',{required:true}),
    A('act3','Act 3 — climax',{required:true}),
    A('opening_script','Opening scene script',{required:true,min:200,rows:10,help:'Screenplay format: scene heading, action, dialogue. Becomes the intro cutscene subtitles.'}),
    T('themes','Themes')
  ]},
  {id:'characters',title:'Characters',blurb:'Cast your game, then give every character a real, rigged 3D body.',collection:'characters'},
  {id:'world',title:'World & Maps',blurb:'Design the city: its districts, landmarks and atmosphere.',fields:[
    T('city_name','City name',{required:true,placeholder:'Vice Shore'}),
    S('size','Map size',['Small (8×8 blocks)','Medium (12×12 blocks)','Large (16×16 blocks)'],{required:true}),
    S('climate','Climate',['Tropical coast','Desert','Temperate','Rainy metro'],{required:true}),
    NUM('default_time','Start time of day (0–24)',{required:true,placeholder:'17.5'}),
    S('weather','Weather',['Mostly clear','Mixed','Stormy']),
    S('traffic','Traffic density',['Light','Normal','Heavy']),
    S('crowds','Pedestrian density',['Light','Normal','Heavy'])
  ],collections:['districts','landmarks','kit']},
  {id:'vehicles',title:'Vehicles',blurb:'Design the cars and bikes players will drive and steal.',collection:'vehicles'},
  {id:'weapons',title:'Weapons & Combat',blurb:'Define the arsenal and how fights feel.',collection:'weapons',fields:[
    NUM('player_health','Player health',{required:true,placeholder:'100'}),
    S('aim_style','Aiming',['Free aim','Soft lock-on'],{required:true}),
    B('armor','Body armor pickups')
  ]},
  {id:'missions',title:'Missions & Systems',blurb:'Turn the story into playable missions and set the rules of the world.',collection:'missions',fields:[
    B('wanted_enabled','Police wanted system',{required:true}),
    NUM('max_wanted','Max wanted stars (1–5)',{placeholder:'5'}),
    NUM('start_cash','Starting cash',{required:true,placeholder:'500'})
  ]},
  {id:'audio_ui',title:'Audio & UI',blurb:'Menus, HUD and the sound of the city.',fields:[
    T('menu_title','Main menu title',{required:true}),
    A('music_style','Music direction',{required:true,placeholder:'Synthwave and 80s pop radio, tense synth bass during chases'}),
    L('radio_stations','Radio station names',{placeholder:'Flash 86.4'}),
    B('hud_minimap','Minimap',{}),B('hud_wanted','Wanted stars',{}),B('hud_cash','Cash counter',{}),B('subtitles','Subtitles',{})
  ]},
  {id:'build',title:'Build',blurb:'Duke writes the Unreal Engine 5 project and your PC packages a playable game.',fields:[
    S('config','Build type',['Shipping','Development'],{required:true}),
    T('engine_version','Unreal Engine version',{placeholder:'Auto-detect'})
  ]},
  {id:'publish',title:'Publish',blurb:'Ship it: download the build or push it to itch.io.',fields:[
    T('itch_user','itch.io username'),T('itch_game','itch.io game slug'),T('itch_channel','Channel',{placeholder:'windows'})
  ]}
];

export const STAGE_IDS=STAGES.map(s=>s.id);
const has=v=>Array.isArray(v)?v.filter(x=>String(x||'').trim()).length>0:v!==undefined&&v!==null&&String(v).trim()!=='';
const filledField=(f,v)=>{
  if(f.type==='bool')return v===true||v===false;
  if(f.type==='list')return Array.isArray(v)&&v.filter(x=>String(x||'').trim()).length>=(f.min||1);
  if(f.min&&String(v||'').trim().length<f.min)return false;
  return has(v);
};

export function emptyDesign(){
  return {vision:{camera:'Third-person',platform:'Windows PC',pillars:[]},story:{},characters:[],
    world:{size:'Medium (12×12 blocks)',climate:'Tropical coast',default_time:17.5,weather:'Mostly clear',traffic:'Normal',crowds:'Normal'},
    districts:[],landmarks:[],kit:[],vehicles:[],weapons:[],combat:{player_health:100,aim_style:'Free aim',armor:true},
    missions:[],systems:{wanted_enabled:true,max_wanted:5,start_cash:500},
    audio_ui:{hud_minimap:true,hud_wanted:true,hud_cash:true,subtitles:true,radio_stations:[]},
    build:{config:'Shipping'},publish:{itch_channel:'windows'},expert:false};
}
export function ensureDesign(p){
  const d=p.design||(p.design=emptyDesign());const e=emptyDesign();
  for(const k of Object.keys(e))if(d[k]===undefined)d[k]=e[k];
  return d;
}
// Where a stage's flat fields live inside the design object.
export const FIELD_HOME={vision:'vision',story:'story',world:'world',weapons:'combat',missions:'systems',audio_ui:'audio_ui',build:'build',publish:'publish'};

const art=e=>e.art||{};
const conceptOk=e=>!!art(e).approved;
const modelOk=e=>!!art(e).model?.glb||!!art(e).model?.fbx;
const rigOk=e=>!!art(e).rig?.fbx;
const animsOk=e=>['idle','jump','shoot'].every(k=>art(e).anims?.[k]?.fbx);
const entityName=(e,c)=>e.name||`Unnamed ${COLLECTIONS[c].label.toLowerCase()}`;
const missingFields=(e,c)=>COLLECTIONS[c].fields.filter(f=>f.required&&!f.source&&!filledField(f,e[f.key])).map(f=>f.label);

// Checklist for one stage. Each item: {label, done, hint, ref?}
export function stageItems(stage,p){
  const d=ensureDesign(p),items=[];
  const add=(label,done,hint,ref)=>items.push({label,done:!!done,hint,ref});
  const flat=FIELD_HOME[stage.id]?d[FIELD_HOME[stage.id]]:null;
  for(const f of stage.fields||[])if(f.required)add(f.label,filledField(f,flat?.[f.key]),f.help||'',{field:f.key});
  const fieldsOf=(c,min,extra)=>{
    const list=d[c]||[];
    add(`At least ${min} ${COLLECTIONS[c].plural.toLowerCase()}`,list.length>=min,`You have ${list.length}.`);
    for(const e of list){const miss=missingFields(e,c);add(`${entityName(e,c)}: details written`,!miss.length,miss.length?`Missing: ${miss.join(', ')}`:'',{collection:c,id:e.id});extra?.(e);}
  };
  switch(stage.id){
    case 'characters':{
      const list=d.characters||[];
      add('A protagonist',list.some(c=>c.role==='Protagonist'),'Add a character with the Protagonist role.');
      add('An antagonist',list.some(c=>c.role==='Antagonist'),'Every story needs opposition.');
      fieldsOf('characters',3,e=>{
        const n=entityName(e,'characters'),ref={collection:'characters',id:e.id};
        add(`${n}: concept art approved`,conceptOk(e),'Generate concept art and approve the version you like (or upload your own).',ref);
        add(`${n}: 3D model built`,modelOk(e),'Build the 3D model from the approved concept.',ref);
        add(`${n}: rigged with walk & run`,rigOk(e),'Rig the model so it can move.',ref);
        if(e.role==='Protagonist')add(`${n}: idle, jump & shoot animations`,animsOk(e),'Add the protagonist animation set.',ref);
      });
      break;}
    case 'world':
      fieldsOf('districts',3);
      fieldsOf('landmarks',2,e=>{const n=entityName(e,'landmarks'),ref={collection:'landmarks',id:e.id};
        add(`${n}: placed in a district`,(d.districts||[]).some(x=>x.id===e.district),'Choose which district it stands in.',ref);
        add(`${n}: concept approved`,conceptOk(e),'',ref);add(`${n}: 3D model built`,modelOk(e),'',ref);});
      break;
    case 'vehicles':
      fieldsOf('vehicles',3,e=>{const n=entityName(e,'vehicles'),ref={collection:'vehicles',id:e.id};add(`${n}: concept approved`,conceptOk(e),'',ref);add(`${n}: 3D model built`,modelOk(e),'',ref);});
      if(d.systems?.wanted_enabled)add('A police vehicle (for the wanted system)',(d.vehicles||[]).some(v=>v.class==='Police'),'Police chase you in it.');
      break;
    case 'weapons':
      fieldsOf('weapons',2,e=>{const n=entityName(e,'weapons'),ref={collection:'weapons',id:e.id};add(`${n}: concept approved`,conceptOk(e),'',ref);add(`${n}: 3D model built`,modelOk(e),'',ref);});
      break;
    case 'missions':
      fieldsOf('missions',3,e=>{const ref={collection:'missions',id:e.id};
        add(`${entityName(e,'missions')}: giver & location set`,(d.characters||[]).some(c=>c.id===e.giver)&&(d.districts||[]).some(x=>x.id===e.district),'Pick a character who gives it and a district where it happens.',ref);});
      break;
    case 'build':{
      const m=p.agentMachine||{};
      add('Build machine connected',p.agentSeenAt&&Date.now()-Date.parse(p.agentSeenAt)<5*60e3,'Double-click DukeForger.py on your PC (or use a cloud build server).');
      add('Unreal Engine 5 installed on it',(m.engines||[]).length>0,'Install Unreal Engine 5 from the Epic Games Launcher.');
      add('C++ build tools installed on it',!!m.visualStudio,'Install Visual Studio 2022 with "Game development with C++" (free).');
      break;}
    case 'publish':
      add('A successful build',(p.builds||[]).some(b=>b.status==='succeeded'),'Run a build first.');
      break;
  }
  return items;
}

export function pipelineStatus(p){
  ensureDesign(p);
  let open=true;const out=[];
  for(const s of STAGES){
    const items=stageItems(s,p);
    const gated=['build','publish'].includes(s.id)&&!out.every(x=>x.done||['build','publish'].includes(x.id));
    const done=items.length>0&&items.every(i=>i.done)&&!gated&&(s.id!=='publish'||out.find(x=>x.id==='build')?.done);
    const total=items.length,complete=items.filter(i=>i.done).length;
    out.push({id:s.id,title:s.title,unlocked:open||!!p.design.expert,done,progress:total?Math.round(complete/total*100):0,items});
    if(!done)open=false;
  }
  const current=out.find(s=>!s.done)||out.at(-1);
  const next=current.items.find(i=>!i.done);
  const overall=Math.round(out.reduce((a,s)=>a+s.progress,0)/out.length);
  return {stages:out,current:current.id,next:next||null,overall};
}

export function publicSchema(){return {stages:STAGES,collections:COLLECTIONS,fieldHome:FIELD_HOME};}

// ---- prompts for real asset generation ----
export function artPrompt(kind,e,d){
  const style=[d.vision?.art_direction,d.vision?.setting].filter(Boolean).join('. ');
  if(kind==='character')return `Full-body character concept, single person, front view, neutral A-pose, plain light-grey studio background, game-ready design. ${e.look}. Wearing ${e.outfit}. ${style}. Clean silhouette, readable materials, no props in hands.`;
  if(kind==='vehicle')return `Vehicle concept art, three-quarter front view, whole vehicle visible, plain light-grey studio background. ${e.class||''} ${e.look}. ${style}. Original design, no logos or brand badges.`;
  if(kind==='weapon')return `Weapon concept art, side view, whole object visible, plain light-grey background. Fictional ${e.type||''}: ${e.look}. ${style}. Original design, no real brand markings.`;
  return `Game environment prop concept, three-quarter view, whole object visible, plain light-grey background. ${e.name}: ${e.description}. ${style}.`;
}
export const ART_SPEC={ // Meshy generation settings per asset class
  character:{polycount:30000,pose:'a-pose',topology:'quad',height:e=>Number(e.height_m)||1.78},
  vehicle:{polycount:40000,pose:'',topology:'triangle'},
  weapon:{polycount:12000,pose:'',topology:'triangle'},
  prop:{polycount:50000,pose:'',topology:'triangle'}
};
