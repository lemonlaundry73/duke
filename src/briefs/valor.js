// Prefilled plan for "Valor: One Nation Under God" (the creator's own design documents, condensed into
// Duke's Plan stage). Everything here is fictional: invented administration, factions, people and events.
const V={
  vision:{
    title:'Valor: One Nation Under God',
    logline:'Play as Cole Mercer, a retired Special Forces sergeant in coastal Georgia whose wife and daughter vanish in a federal "security sweep" after a disputed election turns into martial law. Searching for them, he builds a resistance from neighbors, veterans and defecting soldiers, liberating towns sector by sector in a living civil war where every captured checkpoint can be lost again, every bombed bridge stays broken until you rebuild it, and the real question is whether America can survive the way it is put back together.',
    setting:'Alternate present-day United States, starting in fictional southeastern Georgia: a Savannah-style historic port city, a Statesboro-style college town, the rural crossroads of Metter and Sylvania, coastal marshes, pine forests and two-lane highways. Entirely fictional administration, factions and events.',
    tone:'Modern cinematic',
    art_direction:'Grounded military realism in the style of modern AAA shooters: humid Southern light, Spanish moss and live oaks, wet asphalt, sodium streetlights, sun-bleached small towns, worn civilian gear mixed with surplus military kit, original unbranded weapons and vehicles, no real logos.',
    pillars:['Real first-person combat that feels heavy and dangerous','A living civil war: territory, supply and damage persist and can be lost','Civilians matter: protect and rebuild or lose the people you fight for','Grow from one man to a commander without leaving first person','Your choices decide what kind of America is left at the end'],
    camera:'First-person',
    platform:'Windows PC',
    references:'Arma 3, Squad, Ghost Recon Wildlands, Far Cry 5, Battlefield, Mount & Blade, the film Civil War (2024)'
  },
  story:{
    premise:'After a disputed presidential election, a fictional incumbent administration refuses to hand over power. Emergency decrees become martial law, and the country fractures as military commands, states, agencies and armed civilians pick sides.',
    protagonist_goal:'Find his missing wife Dana and daughter Lily, keep his town alive, and in the end restore a constitutional government instead of just another strongman.',
    antagonist_plan:'Director Marcus Vane of the fictional Federal Continuity Directorate (FCD) uses the emergency to detain dissidents, seize infrastructure and make emergency rule permanent, while hiding the Aegis Dossier: invented evidence of blackmail and corruption reaching into the administration.',
    act1:'The Crackdown. FCD units sweep Cole\'s coastal town; his family is taken. He escapes into the marsh with an old rifle, rescues his neighbor\'s son from a detention bus and learns where detainees are processed.',
    act2:'The Resistance. Cole recruits veterans and locals, sets up a hidden headquarters at an abandoned rice mill, captures the Metter checkpoint and must hold it against the first counterattack while keeping food, fuel and power running.',
    act3:'The Fracture. Regional war spreads across Georgia. Army units defect, rival militias exploit the chaos, and Cole finds the official story and the resistance\'s story are both incomplete. A lead points to Dana in a Savannah port facility.',
    act4:'The International Crisis. The Aegis Dossier leaks. Fictional intelligence operatives, financiers and compromised officials fight over the evidence; foreign governments react with sanctions and covert pressure. Cole must decide whom to trust.',
    act5:'The Restoration. With a real army behind him, Cole must take Savannah, free the detainees, and choose: total victory at any cost, a negotiated settlement, or a fragile peace. The ending depends on civilian casualties, alliances and whether the Constitution was protected or abandoned.',
    opening_script:'EXT. MERCER HOUSE - COASTAL GEORGIA - DAWN\n\nFog over the marsh. A pickup idles in the drive. Radio static: "...emergency order fourteen remains in effect..."\n\nCOLE MERCER (48), gray beard, old unit tattoo, carries coffee onto the porch. LILY (12) chases the dog across the yard.\n\nDANA (O.S.)\nThey closed the bridge again.\n\nCOLE\nThen we stay home today.\n\nHelicopter rotors. Three black armored trucks turn onto the road, lights off.\n\nFCD OFFICER (V.O.)\n(loudspeaker)\nResidents will remain inside. This is a continuity security operation.\n\nCole sets the coffee down. Looks at Lily. Looks at the trucks.\n\nCOLE\nDana. Get Lily in the truck. Now.\n\nSMASH CUT TO BLACK.\n\nTITLE: VALOR - ONE NATION UNDER GOD',
    themes:'Family, duty, legitimacy, the cost of victory, what makes a nation worth saving'
  },
  characters:[
    {name:'Cole Mercer',role:'Protagonist',age:48,look:'Weathered face, short graying beard, close-cropped hair, broad shoulders, faded unit tattoo on forearm, tired but sharp eyes',outfit:'Worn ranger-green field jacket over a gray T-shirt, plate carrier with mismatched pouches, jeans, scuffed hiking boots, ball cap',personality:'Quiet, disciplined, protective, slow to trust, dry humor under pressure',backstory:'Twenty years in Special Forces, retired to coastal Georgia to run a boat repair shop. Swore he was done with war.',dialogue:'"I\'m not here to start a war. I\'m here to end one."\n"Nobody gets left in a cage. Nobody."',height_m:1.85},
    {name:'Director Marcus Vane',role:'Antagonist',age:56,look:'Lean, silver hair combed back, clean-shaven, cold gray eyes',outfit:'Black tailored suit, FCD lapel pin, earpiece; tactical vest over the suit in the field',personality:'Calm, articulate, utterly certain he is saving the country',backstory:'Career security official who built the Federal Continuity Directorate and wrote the emergency playbook he now runs.',dialogue:'"Order is not tyranny, Sergeant. It is the only mercy left."',height_m:1.82},
    {name:'Dana Mercer',role:'Ally',age:44,look:'Dark shoulder-length hair, freckles, determined jaw',outfit:'Hospital scrubs under a rain jacket',personality:'Brave, resourceful, compassionate',backstory:'ER nurse taken in the sweep; inside the detention network she becomes a source of intelligence.'},
    {name:'Lily Mercer',role:'Civilian',age:12,look:'Small, auburn ponytail, braces',outfit:'Hoodie, jeans, sneakers',personality:'Curious, stubborn, brave',backstory:'Cole\'s daughter, taken with Dana.'},
    {name:'Ray "Deacon" Holloway',role:'Mission giver',age:61,look:'Heavyset, white beard, reading glasses on a cord',outfit:'Flannel shirt, suspenders, old Vietnam-era boonie hat',personality:'Warm, preacher-like, stubbornly hopeful',backstory:'Retired Army mechanic and church deacon who shelters refugees and becomes the resistance\'s voice and quartermaster.',dialogue:'"Faith and fuel, son. We\'re short on both."'},
    {name:'Captain Ana Reyes',role:'Ally',age:34,look:'Athletic, dark hair in a tight bun, scar on chin',outfit:'Army combat uniform with the flag patch removed, helmet with NVG mount',personality:'By-the-book, fiercely loyal to the Constitution',backstory:'Army officer who refuses an order to fire on civilians and defects with her platoon.'},
    {name:'Colonel Brandt Kessler',role:'Rival',age:50,look:'Shaved head, thick neck, mirrored sunglasses',outfit:'Mixed camo, militia insignia, sidearm on the chest',personality:'Charismatic, ruthless, opportunistic',backstory:'Leads a militia that fights the FCD only to grab territory for itself.'}
  ],
  world:{city_name:'Port Haven, Georgia (fictional)',size:'Large (16×16 blocks)',climate:'Temperate',default_time:6.5,weather:'Mixed',traffic:'Light',crowds:'Light'},
  districts:[
    {name:'Port Haven Historic District',style:'Downtown towers',mood:'Savannah-inspired squares, live oaks with Spanish moss, brick row houses, FCD checkpoints on every square'},
    {name:'Riverfront and Port',style:'Industrial docks',mood:'Container cranes, warehouses, a detention processing center behind razor wire'},
    {name:'Metter Crossroads',style:'Suburbs',mood:'Rural town with a contested highway checkpoint, feed store, gas station, water tower, farm roads'},
    {name:'Sylvania Mill Yards',style:'Industrial docks',mood:'Small-town warehouses and an abandoned rice mill that becomes the resistance headquarters'},
    {name:'Statesboro College Town',style:'Residential',mood:'University-adjacent streets, strip malls, student housing turned refugee shelter'}
  ],
  combat:{player_health:100,aim_style:'Free aim',armor:true},
  weapons:[
    {name:'Halvard R-16 Rifle',type:'Assault rifle',look:'Original unbranded 5.56 carbine: tan polymer furniture, flat-top rail, red-dot sight, worn finish',damage:32,fire_rate_rpm:750,magazine:30,range_m:300,price:1200},
    {name:'Brightwater P9 Pistol',type:'Pistol',look:'Original unbranded 9mm polymer pistol, matte black, chipped grip',damage:24,fire_rate_rpm:400,magazine:15,range_m:40,price:400},
    {name:'Tallow Pump 12',type:'Shotgun',look:'Original unbranded pump shotgun with a wood stock and a duct-taped forend',damage:90,fire_rate_rpm:70,magazine:6,range_m:25,price:450},
    {name:'Marsh Hunter .308',type:'Sniper rifle',look:'Original unbranded bolt-action hunting rifle with a scratched scope and camo sling',damage:110,fire_rate_rpm:40,magazine:5,range_m:800,price:1500}
  ],
  systems:{wanted_enabled:false,max_wanted:1,start_cash:0},
  missions:[
    {name:'The Metter Checkpoint',giver:'Ray "Deacon" Holloway',objective:'Eliminate target',district:'Metter Crossroads',target:'The FCD checkpoint commander and his squad at the highway crossroads',reward:0,briefing:'"They\'re holding fuel trucks and folks from the sweep at the crossroads. Take the checkpoint, Cole, and the whole county breathes again. Then we have to hold it."'}
  ],
  audio_ui:{menu_title:'VALOR: ONE NATION UNDER GOD',music_style:'Somber Southern Americana: slide guitar, low strings and hymn fragments, turning into driving percussion and distorted synths in combat',radio_stations:['Emergency Broadcast 1','Free Georgia Radio','WPHV Gospel'],hud_minimap:true,hud_wanted:false,hud_cash:false,subtitles:true},
  build:{config:'Development',engine_version:'5.8'},
  answers:{
    players:'Single-player',
    length:'About 2 hours for the first release (the Metter vertical slice); the full campaign grows in later updates',
    budget:500,
    hours:30,
    must:['First-person movement: walk, sprint, crouch, prone, vault','Gunplay with aiming, recoil, reloading and limited ammo','Health, injuries, body armor and medkits','Enemy AI that uses cover, flanks and suppresses','One recruitable squad with simple commands (follow, hold, attack)','A capturable checkpoint sector that the enemy counterattacks','Food, fuel and ammo supplies','Save and load that keeps captured territory and damage'],
    nice:['One drivable pickup truck','Repairing a destroyed building or bridge','A strategic map with sector ownership','Civilian schedules and support level','Night vision and suppressors'],
    rules:[
      'WASD moves at 4 m/s; holding Shift sprints at 6.5 m/s and drains 15 stamina per second; at 0 stamina sprinting stops.',
      'C toggles crouch (2.5 m/s, half as audible); Z goes prone (1 m/s, hardest to see).',
      'Right mouse aims down sights: 60% less spread and 30% slower movement.',
      'Each shot adds recoil; releasing the trigger for 0.3 seconds settles it.',
      'R reloads; reloading a non-empty magazine keeps one round in the chamber; magazines are tracked one by one.',
      'The player has 100 health; body armor absorbs 50% of torso damage until its 100 durability runs out.',
      'Below 30 health the screen desaturates and the player bleeds 1 health per second until a medkit (4 seconds) is used.',
      'At 0 health the player is downed; a squadmate within 10 m revives within 20 seconds, otherwise the game reloads the last save.',
      'Enemies spot the player in 1.5 seconds in the open and 4 seconds in cover or darkness; gunfire alerts everyone within 150 m.',
      'Enemies under fire take cover within 2 seconds and return suppressing fire; at 50% losses a squad retreats.',
      'Pressing E on a friendly civilian with 30+ support recruits them into the squad (max 4).',
      'A sector is captured when no enemies remain inside its boundary for 20 seconds; it then needs 2 defenders or it can be retaken.',
      'Ten minutes after capture the enemy counterattacks with twice the original garrison.',
      'Each defender uses 1 food and 1 ammo per in-game hour; at 0 supply morale drops 10% per hour.',
      'Destroyed structures stay destroyed after save and load until repaired with 50 building supplies and 60 seconds of work.'
    ],
    species:['Humans: Americans of every background and age, civilians, soldiers, militia and officials; realistic movement and voices'],
    languages:['English: everywhere, with Southern, coastal Georgian and regional American accents','Spanish: farm workers and some families around Metter and Statesboro'],
    variation:'People vary by age (teens to elderly), build, skin tone, hair and facial hair, and region; clothing ranges from farm work wear and church clothes to scrubs, college hoodies, militia surplus and FCD black tactical gear. Civilians have jobs (mechanic, nurse, farmer, store clerk, pastor), daily schedules and support levels that change with how the player treats them.',
    release_size:'First release: 1 region (Metter and its farmland, about 4 km²), 1 small town, 1 contested checkpoint sector, 10 enterable interiors, 120 distinct NPC looks, 1 story mission and 6 side activities (supply runs, rescues, repairs).',
    m_area:'Metter Crossroads: the town and the highway checkpoint',
    m_enemy:'FCD security troops (riflemen and one squad leader)',
    m_objective:'Capture the checkpoint, free the held civilians and fuel trucks, then hold the sector against the first counterattack',
    m_exit:'Drive the freed fuel truck out on the farm road to the Sylvania mill hideout'
  },
  assets:[
    ['Cole Mercer (player hands and body)','Character','Make','Character Creator 5 + Headshot 3','Owned (made by you with licensed tools)'],
    ['FCD security troops (enemy soldiers)','Character','Buy','Fab: US-Soldiers-Pack AAA-Characters (Soldier-AAA)','Fab Standard License, personal'],
    ['Resistance squadmates and militia','Character','Buy','Fab: US-Soldiers-Pack AAA-Characters, re-dressed','Fab Standard License, personal'],
    ['Civilians of Metter','Character','Make','Character Creator 5 morphs and outfits','Owned (made by you with licensed tools)'],
    ['Rifles, pistol, shotgun, sniper (19-gun set)','Model','Buy','Fab: Ultimate Modular Guns Bundle','Fab Standard License, personal'],
    ['First-person controller, weapons handling and multiplayer base','Other','Buy','Fab: FPS Multiplayer Controller 2 (Stump)','Fab Standard License, personal'],
    ['Enemy AI: patrol, attack, investigate, heal','Other','Buy','Fab: Advanced Enemy AI','Fab Standard License, personal'],
    ['First-person arms and weapon animations','Animation','Buy','Included with FPS Multiplayer Controller 2','Fab Standard License, personal'],
    ['Soldier locomotion, cover and death animations','Animation','Buy','Fab motion pack or Unreal Game Animation Sample','Fab Standard License / Epic content license'],
    ['Small-town Georgia buildings kit','Model','Buy','Fab modular small-town kit','Fab Standard License, personal'],
    ['Checkpoint props: barriers, sandbags, razor wire, floodlights','Model','Buy','Fab military props pack','Fab Standard License, personal'],
    ['Pine forest, live oaks, Spanish moss, marsh grass','Model','Buy','Quixel Megascans on Fab','Fab Standard License (Megascans)'],
    ['Pickup truck and fuel truck (unbranded)','Model','Buy','Fab vehicle pack (unbranded)','Fab Standard License, personal'],
    ['Ground surfaces: asphalt, red clay, wet grass','Surface or texture','Buy','Quixel Megascans on Fab','Fab Standard License (Megascans)'],
    ['Gunshots, reloads, impacts, footsteps','Sound effect','Buy','Fab or Sonniss GDC bundle','Royalty-free license'],
    ['Southern Americana score and combat music','Music','Generate','Suno Pro','Suno Pro commercial license'],
    ['Cole, Deacon and FCD voice lines','Voice','Generate','ElevenLabs','ElevenLabs paid plan commercial license'],
    ['HUD, strategic map and menu art','Other','Make','Made in Duke and Figma','Owned']
  ]
};

const empty=v=>v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);
const nano=()=>Math.random().toString(36).slice(2,10);

// Fills only empty fields and empty lists, so nothing the creator already wrote is overwritten.
export function applyValor(p){
  const d=p.design;
  for(const [k,v] of Object.entries(V.vision))if(empty(d.vision[k])||(k==='camera'||k==='platform'))d.vision[k]=v;
  d.story ||= {};for(const [k,v] of Object.entries(V.story))if(empty(d.story[k]))d.story[k]=v;
  d.world ||= {};for(const [k,v] of Object.entries(V.world))d.world[k]=d.world[k]&&!['size','climate','default_time','weather','traffic','crowds'].includes(k)?d.world[k]:v;
  d.combat={...(d.combat||{}),...V.combat};
  d.systems={...(d.systems||{}),...V.systems};
  d.audio_ui ||= {};for(const [k,v] of Object.entries(V.audio_ui))if(empty(d.audio_ui[k])||typeof v==='boolean')d.audio_ui[k]=v;
  d.build ||= {};for(const [k,v] of Object.entries(V.build))if(empty(d.build[k]))d.build[k]=v;
  const t=new Date().toISOString();
  for(const coll of ['characters','districts','weapons','missions']){
    d[coll] ||= [];const have=new Set(d[coll].map(x=>String(x.name||'').toLowerCase()));
    for(const it of V[coll])if(!have.has(it.name.toLowerCase()))d[coll].push({id:nano(),createdAt:t,...it});
  }
  const a=p.roadmap.answers;for(const [k,v] of Object.entries(V.answers))if(empty(a[k]))a[k]=v;
  const names=new Set(p.roadmap.assets.map(x=>x.name.toLowerCase()));
  for(const [name,kind,action,source,license] of V.assets)if(!names.has(name.toLowerCase()))p.roadmap.assets.push({id:nano(),status:'Planned',name,kind,action,source,license,createdAt:t});
  p.name=V.vision.title;p.updatedAt=t;
}
export const BRIEFS={valor:{title:'Valor: One Nation Under God',apply:applyValor}};
