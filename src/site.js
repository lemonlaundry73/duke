// Public, server-rendered marketing and learning site: built for search (one page per step,
// per glossary term and per popular topic), fast (no client framework) and honest (no fake claims).
import { load } from './store.js';
import { STEPS, PHASES, stepBySlug, stepPlan } from './roadmap.js';
import { GLOSSARY } from './glossary.js';
import { PLANS, PLAN_ORDER, yearPrice, CREDIT_COST } from './billing.js';

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const base=req=>(process.env.SITE_URL||`${req.headers['x-forwarded-proto']||'http'}://${req.headers['x-forwarded-host']||req.headers.host}`).replace(/\/$/,'');
const cut=(s,n=158)=>{s=String(s).replace(/\s+/g,' ').trim();return s.length<=n?s:s.slice(0,s.lastIndexOf(' ',n-1))+'…';};
const ld=o=>`<script type="application/ld+json">${JSON.stringify(o).replace(/</g,'\\u003c')}</script>`;
const PHASE_OF=n=>PHASES.find(p=>p.n===n);
const KIND_LABEL={auto:'Verified by Duke',proof:'You upload proof',input:'You write it',self:'You confirm it'};

// Link glossary terms inside plain text (first occurrence of each, never inside an existing link).
const NOLINK=new Set(['budget','camera','mix','level','mission','variation','species','district','landmark','requirements','subtitles','crowd','asset']);
const escRe=w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const TERM_INDEX=Object.entries(GLOSSARY).filter(([slug])=>!NOLINK.has(slug)).flatMap(([slug,g])=>[g.term,...g.aka].map(w=>({slug,re:new RegExp(`(^|[^\\w-])(${escRe(esc(w))})(?![\\w-])`,'i')}))).sort((a,b)=>b.re.source.length-a.re.source.length);
export function linkTerms(text,seen=new Set(),max=6){
  let html=esc(text);let n=0;
  for(const {slug,re} of TERM_INDEX){
    if(n>=max||seen.has(slug))continue;
    const parts=html.split(/(<a [^>]*>.*?<\/a>)/);let hit=false;
    for(let i=0;i<parts.length&&!hit;i++){if(parts[i].startsWith('<a '))continue;
      if(re.test(parts[i])){parts[i]=parts[i].replace(re,(m,a,b)=>`${a}<a class="term" href="/glossary/${slug}" title="${esc(GLOSSARY[slug].def)}">${b}</a>`);hit=true;}}
    if(hit){html=parts.join('');seen.add(slug);n++;}
  }
  return html;
}

function page(req,{title,desc,path,body,schema=[],noindex=false,ogType='website'}){
  const url=base(req)+path;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}">
${noindex?'<meta name="robots" content="noindex">':''}
<meta property="og:type" content="${ogType}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:site_name" content="Duke Forge">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23f0bf4c'/%3E%3Ctext x='32' y='45' font-size='38' font-family='Arial' font-weight='900' text-anchor='middle' fill='%23111'%3ED%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/site.css">
${ld({'@context':'https://schema.org','@type':'Organization',name:'Duke Forge',url:base(req)})}
${schema.map(ld).join('')}
</head><body>
<header class="top"><div class="wrap"><a class="logo" href="/">Duke <em>Forge</em></a>
<nav><a href="/guide">The 67 steps</a><a href="/glossary">Glossary</a><a href="/pricing">Pricing</a><a href="/showcase">Showcase</a></nav>
<div class="cta"><a href="/login" class="ghost">Log in</a><a href="/signup" class="btn">Start creating</a></div></div></header>
<main>${body}</main>
<footer><div class="wrap"><div><a class="logo" href="/">Duke <em>Forge</em></a><p>Build the open-world game you dream about, step by step, with AI doing the slow parts.</p></div>
<div><b>Learn</b><a href="/guide">The 67-step guide</a><a href="/glossary">Game dev glossary</a>${TOPICS.slice(0,4).map(t=>`<a href="/learn/${t.slug}">${esc(t.short)}</a>`).join('')}</div>
<div><b>Product</b><a href="/pricing">Pricing</a><a href="/showcase">Showcase</a><a href="/signup">Start free</a><a href="/login">Log in</a></div></div>
<p class="fine wrap">Unreal Engine, Character Creator, Headshot, Blender, Megascans, Suno, ElevenLabs, Convai and other names are trademarks of their owners. Duke Forge is independent and not affiliated with them.</p></footer>
</body></html>`;
}
const crumbs=(req,items)=>({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map(([name,p],i)=>({'@type':'ListItem',position:i+1,name,item:base(req)+p}))});

// ---------------------------------------------------------------- topic landing pages (search intent)
const TOPICS=[
 {slug:'how-to-make-a-game-like-gta',short:'Make a game like GTA',title:'How to make a game like GTA by yourself',
  desc:'A realistic, step-by-step path to an open-world game like GTA as a solo creator: what to build first, which tools to use, and where AI saves months.',
  intro:['GTA is made by hundreds of people over many years. You can still make an open-world crime or adventure game alone, if you make it the way studios do: plan tightly, prove the fun with gray boxes, finish one district to full quality, then grow the world from that standard.','The biggest difference today is AI. Procedural generation fills streets with buildings and props by rules you set, character tools build realistic people from photos, and AI agents can lay out districts in a sandbox copy of your project for you to approve. You still make every creative decision.'],
  steps:[1,3,7,15,21,34,41,45,59,61],
  faq:[['Can one person really make a GTA-style game?','Not at GTA\'s size on the first release. One person can make a smaller open world at a very high visual standard: one finished district, then more grown from it with procedural tools and AI agents.'],['Which engine should I use?','Unreal Engine 5 is the usual choice for realistic open worlds. It includes World Partition for huge maps, PCG for procedural placement, and Mass AI for crowds.']]},
 {slug:'make-yourself-a-game-character',short:'Make yourself a game character',title:'How to make yourself into a realistic game character',
  desc:'Turn your own photos into a realistic, rigged Unreal Engine character with Character Creator 5 and Headshot 3, then fit clothes in Blender.',
  intro:['Headshot 3 builds a 3D head from a single front photo, and Character Creator 5 gives it a high-detail body with 8K skin. Together they produce a character that looks like you and is already rigged for animation.','For a convincing likeness, photograph yourself in soft, even light with a neutral face from the front, both sides and three-quarter, plus full-body photos for proportions. Then refine the face with guide curves, remove the photo lighting with DeLight, and fit clothes made in Blender.'],
  steps:[23,24,25,26,27,29,30,33],
  faq:[['Do I need a 3D scanner?','No. Headshot 3 works from one photo. A scan can be used too, through Mesh Mode.'],['Will animations work on my character?','Yes. Character Creator 5 shares a skeleton with MetaHuman, so animations move between them without retargeting.']]},
 {slug:'character-creator-5-beginner-guide',short:'Character Creator 5 guide',title:'Character Creator 5 for beginners: from first character to Unreal',
  desc:'A plain-language Character Creator 5 guide for beginners: HD bases, morphs, skin, clothing, skin weights, ActorMixer variation and sending characters to Unreal.',
  intro:['Character Creator 5 (CC5) builds realistic, fully rigged people from sliders, presets and photos. Its HD base carries far more mesh detail than earlier versions, and its characters go straight into Unreal Engine with Reallusion\'s free Auto Setup plugin.','Beginners usually get stuck on three things: getting a likeness, fitting custom clothes, and making crowds that do not look cloned. The steps below cover all three, including ActorMixer, which blends up to six characters into new faces and bodies.'],
  steps:[10,25,26,29,33,34,46],
  faq:[['How much does Character Creator 5 cost?','About $299 for the base version or $499 for the Deluxe bundle at the time of writing. Check Reallusion\'s site for current prices.'],['Is Headshot included?','No. Headshot 3 is a separate plugin, about $199 at the time of writing.']]},
 {slug:'headshot-3-photo-to-3d-head',short:'Headshot 3: photo to 3D head',title:'Headshot 3: turn a photo into a realistic 3D head',
  desc:'How to use Headshot 3 to turn one photo into a realistic, rigged 3D head in Character Creator 5: photos, Refine Face, DeLight, texture painting and Mesh Mode.',
  intro:['Headshot 3 uses AI to generate a full 3D head from a single front photo, filling in what the camera could not see. The result is a rigged Character Creator head, ready for facial animation.','The quality of the likeness depends mostly on your photos and on the refine pass afterwards. Soft, even light and a neutral expression matter more than camera resolution.'],
  steps:[23,24,25],
  faq:[['Can I use a phone photo?','Yes. Use soft daylight, no flash, and a neutral expression.'],['What is DeLight?','A Headshot tool that removes the lighting baked into the photo so the skin reacts correctly to in-game lights.']]},
 {slug:'unreal-engine-5-open-world-for-beginners',short:'Unreal Engine 5 open world',title:'Unreal Engine 5 open world for beginners',
  desc:'How beginners build an open world in Unreal Engine 5: World Partition, terrain, PCG scattering, modular towns, Lumen lighting, HLODs and streaming.',
  intro:['An Unreal Engine 5 open world rests on a few systems: World Partition loads only the cells near the player, Landscape or the newer Mesh Terrain shapes the ground, PCG scatters nature and clutter by rules, and HLODs keep distant areas cheap.','Turn World Partition on from day one, block out roads and landmarks before detail, and finish one region to full quality before growing the rest.'],
  steps:[34,35,36,37,38,39,40,42,43,44],
  faq:[['What PC do I need?','Epic recommends a 12-core CPU, 64 GB of memory and an 8 GB graphics card for its City Sample open-world demo. Treat that as the minimum.'],['Do I need to code?','Not to start. Blueprints let you build logic visually, and Duke explains every piece it writes.']]},
 {slug:'pcg-tutorial-unreal-engine',short:'PCG in Unreal Engine',title:'PCG in Unreal Engine: procedural worlds explained simply',
  desc:'What Unreal Engine\'s PCG framework is, how rule-based scattering works, and how AI agents can write PCG graphs that match your references.',
  intro:['PCG (procedural content generation) places trees, rocks, grass, debris and even buildings by rules: density, slope, distance from roads. Change a rule and the whole region updates.','It is production-ready in recent Unreal versions, and it is also how AI agents can build at scale: they write PCG graphs from your rules and curated assets, inside a sandbox copy of your project, and you approve the result.'],
  steps:[12,39,40,44,61],
  faq:[['Will PCG overwrite my hand edits?','Recent versions keep manual edits when a graph regenerates, and you can paint exclusion areas for hand-built spaces.']]},
 {slug:'metahuman-crowds-and-living-npcs',short:'Crowds and living NPCs',title:'Crowds and living NPCs in Unreal Engine 5',
  desc:'How to make open-world crowds where no two people look alike: seed characters, ActorMixer variation, Mass AI, Smart Objects, daily schedules and AI dialogue.',
  intro:['Lifelike crowds start from a small seed cast built by hand: six to ten base characters per species plus a modular wardrobe. Variation tools blend and randomize them within your rules into thousands of distinct people.','Mass AI simulates the crowd; nearby people are fully animated and distant ones become cheaper animated meshes. Smart Objects and State Trees give them daily lives, and AI dialogue lets side characters talk back in many languages, within limits you set.'],
  steps:[6,45,46,47,48,49,50,51,52],
  faq:[['Should the main story use AI dialogue?','No. Keep the main story hand-written; use AI for side characters, small talk and barks.'],['How fast must AI replies be?','Under about 0.8 seconds feels conversational. Longer feels like a stall.']]}
];

// ---------------------------------------------------------------- pages
function home(req){
  const body=`
<section class="hero"><div class="wrap">
  <p class="eyebrow">AAA-STYLE GAME DEVELOPMENT FOR BEGINNERS</p>
  <h1>Build the open-world game<br>you dream about.<br><em>Start building it.</em></h1>
  <p class="lede">Duke Forge walks you through the same 67 steps studios follow, from your first idea to a released game. AI does the slow parts, and each step is checked before the next one opens. You make every creative decision.</p>
  <div class="row"><a class="btn big" href="/signup">Build your first game</a><a class="ghost big" href="/guide">See the 67 steps</a></div>
  <p class="note">Unreal Engine 5 workflow · Your tools, live in Duke · Your original game</p>
  <figure class="panel"><header><span>World / live preview</span><span>01 — Blockout</span></header><img src="/img/world-preview.jpg" alt="The live 3D preview of a creator's world inside Duke Forge" width="1400" height="788" loading="eager"><figcaption>Every district, landmark and character you design shows up in the live preview as you write it.</figcaption></figure>
</div></section>
<section><div class="wrap">
  <p class="eyebrow">Never leave Duke</p>
  <h2>Your tools, live in Duke.<br><em>Unreal, Character Creator, Blender.</em></h2>
  <p class="lede">Install your tools once. Duke opens them, shows them live inside the page, and lets you click and type in them right here. One tap saves what you see as proof for the step you are on.</p>
  <div class="panels2">
    <figure class="panel"><header><span>Duke Link / your tools live</span><span>Unreal Editor</span></header><img src="/img/duke-link.jpg" alt="Duke Link showing an Unreal Engine window live inside Duke Forge" loading="lazy"><figcaption>Open a tool, turn on “Use it here”, and work in it from Duke.</figcaption></figure>
    <figure class="panel"><header><span>Design screen / step by step</span><span>Step 1 of 67</span></header><img src="/img/studio.jpg" alt="The Duke Forge design screen with a step, its gate and the AI director" loading="lazy"><figcaption>Each step explains itself in plain words, drafts with AI, and checks your work.</figcaption></figure>
  </div>
</div></section>
<section class="band"><div class="wrap grid3">
  <div><b>High-definition, not block worlds</b><p>The target is film-lit, crowded, photoreal scenes in Unreal Engine 5, with characters made from your own photos in Character Creator 5 and Headshot 3.</p></div>
  <div><b>AI is your crew</b><p>Duke drafts your design, writes code and explains it. It also generates 3D assets and plans world expansion passes, and you review each one before it goes in.</p></div>
  <div><b>Structure that catches problems</b><p>Every step has a gate. Duke checks your PC, your plugins, your version control and your packaged builds, so problems surface at the step that causes them.</p></div>
</div></section>
<section><div class="wrap">
  <h2>Two ways through the same steps</h2>
  <div class="grid2">
    <div class="card"><p class="eyebrow">BUILD MODE</p><h3>Build your game with a safety net</h3><p>Each step is a gate. Duke checks the requirement before the next step opens: the project packages, the character is rigged, the frame rate holds. Plain-language definitions for every term, one tap away.</p></div>
    <div class="card"><p class="eyebrow">COURSE MODE</p><h3>Learn while you build your own game</h3><p>Every step becomes a lesson: <b>Learn</b> the idea, <b>Watch</b> it done on a sample game, <b>Do</b> it on your game with AI help, then <b>Check</b> it with the same gate. Finishing the course means having a working game.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <h2>The path, phase by phase</h2>
  <ol class="phases">${PHASES.map(ph=>{const st=STEPS.filter(s=>s.phase===ph.n);return `<li><div><b>Phase ${ph.n}: ${esc(ph.title)}</b><span>Steps ${st[0].n}–${st.at(-1).n}</span></div><p>${esc(ph.outcome)}</p><a href="/guide#phase-${ph.n}">See the steps</a></li>`;}).join('')}</ol>
</div></section>
<section class="band"><div class="wrap">
  <h2>What Duke checks for you</h2>
  <div class="grid4">
    <div><b>Verified by Duke</b><p>Your graphics card and memory, Unreal, Visual Studio, Character Creator, Blender and Git installed, plugins enabled, folders and repository set up, builds packaged.</p></div>
    <div><b>Proof you upload</b><p>Screenshots of your blockout, your head next to your photo, extreme poses with no stretching, your lit world by day and night.</p></div>
    <div><b>Answers you write</b><p>Your pitch, testable rules, living-world rules, first mission, asset list with licenses, requirements as numbers.</p></div>
    <div><b>Checks you confirm</b><p>Things no software can judge, like "the enemy's attacks can be seen coming". You tick them honestly.</p></div>
  </div>
  <p class="note">No tool can promise a game ships. The gates mean you find problems early, while they are still cheap to fix.</p>
</div></section>
<section><div class="wrap">
  <h2>Real creator tools, connected</h2>
  <div class="tools">${['Unreal Engine 5.8','Character Creator 5','Headshot 3','Blender','Megascans','Meshy (3D generation)','Suno and ElevenLabs Music','Convai (AI dialogue)','Git LFS','itch.io and Steam'].map(t=>`<span>${esc(t)}</span>`).join('')}</div>
</div></section>
<section><div class="wrap">${pricingCards()}<p class="center"><a href="/pricing">Compare plans</a></p></div></section>
<section><div class="wrap narrow"><h2>Questions</h2>${FAQ_HOME.map(([q,a])=>`<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
<section class="final"><div class="wrap"><h2>Your game starts with one paragraph.</h2><p>Write it today. Duke takes it from there, one step at a time.</p><a class="btn big" href="/signup">Start free</a></div></section>`;
  return page(req,{title:'Duke Forge: build your dream open-world game, step by step, with AI',
    desc:'Make a high-definition open-world game in Unreal Engine 5, even as a beginner. 67 guided steps, AI help at every stage, and checks before each step opens.',path:'/',body,
    schema:[{'@context':'https://schema.org','@type':'SoftwareApplication',name:'Duke Forge',applicationCategory:'DeveloperApplication',operatingSystem:'Web, Windows',
      offers:PLAN_ORDER.map(id=>({'@type':'Offer',name:PLANS[id].name,price:String(PLANS[id].month),priceCurrency:'USD'}))},
      {'@context':'https://schema.org','@type':'FAQPage',mainEntity:FAQ_HOME.map(([q,a])=>({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}}))}]});
}
const FAQ_HOME=[
  ['Do I need to know how to code?','No. Unreal\'s Blueprints let you build logic visually, and Duke writes and explains any code a step needs. You learn as it builds.'],
  ['Can AI make the whole game for me?','AI does the slow parts: drafting, code, 3D generation, layout and variation. You decide what the game is, choose the assets and approve every result. Quality comes from those choices.'],
  ['What PC do I need?','A Windows PC with a dedicated graphics card with at least 8 GB of video memory and 32 GB of memory (64 GB recommended). Duke checks your PC in step 9.'],
  ['What will the tools cost besides Duke Forge?','Unreal Engine and Blender are free. Character Creator 5 Deluxe and Headshot 3 cost about $700 once at the time of writing. Optional services like Suno or Convai run about $10 to $30 a month each.'],
  ['Can I sell my game?','Yes. You own your game. Unreal Engine takes a 5% royalty only after a game earns $1 million. Duke tracks the license of every asset you use so you can ship with confidence.'],
  ['How does Course mode work?','Each of the 67 steps becomes a lesson with Learn, Watch, Do and Check parts, using your own game as the project. Phase quizzes lead to certificates.'],
  ['Can I cancel anytime?','Yes. Plans are monthly or yearly and you can cancel from your account. Your first paid plan starts with a 7-day free trial.']
];
function pricingCards(){
  return `<h2>Plans</h2><div class="plans">${PLAN_ORDER.map(id=>{const p=PLANS[id];return `<div class="plan ${id==='academy'?'pop':''}">${id==='academy'?'<span class="tag">Most complete for beginners</span>':''}<h3>${esc(p.name)}</h3>
    <p class="price"><b>$${p.month}</b>${p.month?'/month':''}</p>${p.month?`<p class="yr">or $${yearPrice(id)}/year (2 months free)</p>`:'<p class="yr">forever</p>'}<p>${esc(p.blurb)}</p>
    <ul>${planBullets(id).map(b=>`<li>${esc(b)}</li>`).join('')}</ul><a class="${id==='free'?'ghost':'btn'}" href="/signup?plan=${id}">${id==='free'?'Start free':'Start 7-day trial'}</a></div>`;}).join('')}</div>`;
}
function planBullets(id){
  const p=PLANS[id];const b=[];
  b.push(id==='free'?'Phase 1: steps 1 to 8':'All 67 steps');
  b.push('Duke, your AI director','Plain-language glossary','Live 3D preview of your world');
  if(p.features.build)b.push(`${p.credits} 3D credits a month`,'Builds on your own PC');
  if(p.features.course)b.push('Course mode lessons and quizzes','Phase certificates');
  if(p.features.expansion)b.push('AI expansion loop with review queue');
  if(p.features.cloud)b.push('Cloud builds');
  b.push(`${p.projects} game${p.projects===1?'':'s'}`);
  return b;
}
function pricing(req){
  const rows=[['Steps',...PLAN_ORDER.map(id=>id==='free'?'1–8':'All 67')],['AI director and drafting',...PLAN_ORDER.map(()=>'Yes')],['3D credits per month',...PLAN_ORDER.map(id=>String(PLANS[id].credits||'—'))],
    ['Builds on your PC',...PLAN_ORDER.map(id=>PLANS[id].features.build?'Yes':'—')],['Course mode, quizzes, certificates',...PLAN_ORDER.map(id=>PLANS[id].features.course?'Yes':'—')],
    ['AI expansion loop',...PLAN_ORDER.map(id=>PLANS[id].features.expansion?'Yes':'—')],['Cloud builds',...PLAN_ORDER.map(id=>PLANS[id].features.cloud?'Yes':'—')],['Games',...PLAN_ORDER.map(id=>String(PLANS[id].projects))]];
  const body=`<section class="hero small"><div class="wrap"><h1>Simple plans. Start free.</h1><p class="lede">Plan your whole game for free. Upgrade when you are ready to build. Your first paid plan includes a 7-day trial.</p></div></section>
<section><div class="wrap">${pricingCards()}</div></section>
<section><div class="wrap"><h2>Compare</h2><div class="tablewrap"><table><thead><tr><th></th>${PLAN_ORDER.map(id=>`<th>${esc(PLANS[id].name)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>i?`<td>${esc(c)}</td>`:`<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="note">Credits pay for 3D generation, which has a real cost per use: concept art ${CREDIT_COST.concept}, a 3D model ${CREDIT_COST.model}, rigging ${CREDIT_COST.rig}, an animation set ${CREDIT_COST.anims}. Failed generations are refunded. Credits reset monthly.</p></div></section>
<section><div class="wrap narrow"><h2>Billing questions</h2>${[['Is there a free trial?','Yes. Your first paid plan starts with 7 days free. Cancel before it ends and you pay nothing.'],['Can I switch plans?','Yes, anytime from your account. Changes are prorated by the payment provider.'],['What happens to my game if I cancel?','Your projects stay. You keep access to Phase 1 on the free plan and can pick up where you left off when you return.'],['Do I own what I make?','Yes. Your game, your characters and your code are yours.']].map(([q,a])=>`<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>`;
  return page(req,{title:'Pricing | Duke Forge',desc:'Duke Forge plans: Free for planning, Creator for building all 67 steps, Academy adds the course and certificates, Studio adds the AI expansion loop and cloud builds.',path:'/pricing',body});
}
function guideIndex(req){
  const body=`<section class="hero small"><div class="wrap"><p class="eyebrow">THE COMPLETE GUIDE</p><h1>How to make an open-world game: 67 steps from idea to release</h1>
<p class="lede">The full production path for a solo creator aiming for AAA-level visuals in Unreal Engine 5, with Character Creator 5, Headshot 3, Blender and AI at every stage. Every step explains its terms in plain words.</p></div></section>
<section><div class="wrap">${PHASES.map(ph=>`<div class="phase" id="phase-${ph.n}"><h2>Phase ${ph.n}: ${esc(ph.title)}</h2><p class="muted">${esc(ph.outcome)}</p>
<ol start="${STEPS.find(s=>s.phase===ph.n).n}" class="steplist">${STEPS.filter(s=>s.phase===ph.n).map(s=>`<li><a href="/guide/${s.slug}">${esc(s.title)}</a><span>${esc(s.role)}</span></li>`).join('')}</ol></div>`).join('')}</div></section>
<section class="final"><div class="wrap"><h2>Build these steps on your own game</h2><p>Duke Forge turns this guide into a workspace with AI help and a check at every step.</p><a class="btn big" href="/signup">Start free</a></div></section>`;
  return page(req,{title:'How to make an open-world game: the complete 67-step guide | Duke Forge',desc:'A plain-language, 67-step guide to making a high-definition open-world game in Unreal Engine 5 as a solo creator, from planning to release.',path:'/guide',body,
    schema:[{'@context':'https://schema.org','@type':'ItemList',itemListElement:STEPS.map(s=>({'@type':'ListItem',position:s.n,url:`${base(req)}/guide/${s.slug}`,name:s.title}))},crumbs(req,[['Home','/'],['Guide','/guide']])]});
}
function stepPage(req,s){
  const ph=PHASE_OF(s.phase);const prev=STEPS[s.n-2],next=STEPS[s.n];const seen=new Set();
  const terms=s.terms.filter(t=>GLOSSARY[t]);
  const body=`<article class="wrap narrow step">
<nav class="crumbs"><a href="/guide">Guide</a> › <a href="/guide#phase-${ph.n}">Phase ${ph.n}: ${esc(ph.title)}</a> › Step ${s.n}</nav>
<p class="eyebrow">STEP ${s.n} OF 67 · YOU ARE THE ${esc(s.role.toUpperCase())}</p>
<h1>${esc(s.title)}</h1>
<p class="lede">${linkTerms(s.plain,seen)}</p>
<h2>How to do it</h2><ol class="how">${s.how.map(h=>`<li>${linkTerms(h,seen,3)}</li>`).join('')}</ol>
<div class="aibox"><b>How AI speeds this up</b><p>${linkTerms(s.ai,seen,3)}</p></div>
<div class="sample"><b>Example from a sample game</b><p>${esc(s.sample)}</p></div>
<h2>Before you move on</h2><p class="muted">In Duke Forge, this step's gate checks:</p>
<ul class="gate">${s.checks.map(c=>{const label=c.t==='input'?(s.inputs.find(f=>f.key===c.key)?.label||c.key):c.label;return `<li><span class="kind ${c.t}">${KIND_LABEL[c.t]}</span>${esc(label)}</li>`;}).join('')}</ul>
${terms.length?`<h2>Words to know</h2><dl class="terms">${terms.map(t=>`<dt><a href="/glossary/${t}">${esc(GLOSSARY[t].term)}</a></dt><dd>${esc(GLOSSARY[t].def)}</dd>`).join('')}</dl>`:''}
<div class="ctaBox"><div><b>Do step ${s.n} on your own game</b><p>${stepPlan(s)==='free'?'Free: Phase 1 is included on every plan.':'Included in Creator, Academy and Studio.'} Duke drafts it with you and checks it before step ${Math.min(67,s.n+1)} opens.</p></div><a class="btn" href="/signup">Start free</a></div>
<nav class="pager">${prev?`<a href="/guide/${prev.slug}">← Step ${prev.n}: ${esc(prev.title)}</a>`:'<span></span>'}${next?`<a href="/guide/${next.slug}">Step ${next.n}: ${esc(next.title)} →</a>`:''}</nav>
</article>`;
  return page(req,{title:`Step ${s.n}: ${s.title} | How to make an open-world game`,desc:cut(`Step ${s.n} of 67: ${s.plain}`),path:`/guide/${s.slug}`,body,ogType:'article',
    schema:[{'@context':'https://schema.org','@type':'HowTo',name:s.title,description:s.plain,step:s.how.map((h,i)=>({'@type':'HowToStep',position:i+1,text:h}))},
      crumbs(req,[['Home','/'],['Guide','/guide'],[`Phase ${ph.n}: ${ph.title}`,`/guide#phase-${ph.n}`],[s.title,`/guide/${s.slug}`]])]});
}
function glossaryIndex(req){
  const list=Object.entries(GLOSSARY).sort((a,b)=>a[1].term.localeCompare(b[1].term));
  const letters=[...new Set(list.map(([,g])=>g.term[0].toUpperCase().replace(/[^A-Z]/,'#')))];
  const body=`<section class="hero small"><div class="wrap"><h1>Game development glossary, in plain words</h1><p class="lede">${list.length} terms you will meet while making a game in Unreal Engine 5, Character Creator and Blender, each explained without jargon.</p>
<p class="letters">${letters.map(l=>`<a href="#l-${l}">${l}</a>`).join('')}</p></div></section>
<section><div class="wrap narrow">${letters.map(l=>`<h2 id="l-${l}">${l}</h2><dl class="terms">${list.filter(([,g])=>(g.term[0].toUpperCase().replace(/[^A-Z]/,'#'))===l).map(([slug,g])=>`<dt><a href="/glossary/${slug}">${esc(g.term)}</a></dt><dd>${esc(g.def)}</dd>`).join('')}</dl>`).join('')}</div></section>`;
  return page(req,{title:'Game development glossary for beginners | Duke Forge',desc:'Plain-language definitions of game development terms: topology, retargeting, LOD, World Partition, PCG, Lumen, skin weights and more.',path:'/glossary',body,
    schema:[{'@context':'https://schema.org','@type':'DefinedTermSet',name:'Duke Forge game development glossary',hasDefinedTerm:list.map(([slug,g])=>({'@type':'DefinedTerm',name:g.term,description:g.def,url:`${base(req)}/glossary/${slug}`}))}]});
}
function termPage(req,slug){
  const g=GLOSSARY[slug];const used=STEPS.filter(s=>s.terms.includes(slug));
  const related=[...new Set(used.flatMap(s=>s.terms))].filter(t=>t!==slug&&GLOSSARY[t]).slice(0,8);
  const body=`<article class="wrap narrow step"><nav class="crumbs"><a href="/glossary">Glossary</a> › ${esc(g.term)}</nav>
<h1>What is ${esc(g.term)}${/[.?!]$/.test(g.term)?'':'?'}</h1><p class="lede">${esc(g.def)}</p>
${g.aka.length?`<p class="muted">Also called: ${g.aka.map(esc).join(', ')}</p>`:''}
${used.length?`<h2>Where you use it</h2><ul class="links">${used.map(s=>`<li><a href="/guide/${s.slug}">Step ${s.n}: ${esc(s.title)}</a></li>`).join('')}</ul>`:''}
${related.length?`<h2>Related terms</h2><p class="chips">${related.map(t=>`<a href="/glossary/${t}">${esc(GLOSSARY[t].term)}</a>`).join('')}</p>`:''}
<div class="ctaBox"><div><b>Learn it by doing it</b><p>Duke Forge explains every term the first time it appears, right inside the step where you use it.</p></div><a class="btn" href="/signup">Start free</a></div></article>`;
  return page(req,{title:`What is ${g.term}? Game development explained | Duke Forge`,desc:cut(`${g.term}: ${g.def}`),path:`/glossary/${slug}`,body,
    schema:[{'@context':'https://schema.org','@type':'DefinedTerm',name:g.term,description:g.def,inDefinedTermSet:`${base(req)}/glossary`},crumbs(req,[['Home','/'],['Glossary','/glossary'],[g.term,`/glossary/${slug}`]])]});
}
function topicPage(req,t){
  const seen=new Set();
  const body=`<article class="wrap narrow step"><p class="eyebrow">GUIDE</p><h1>${esc(t.title)}</h1>${t.intro.map(p=>`<p class="lede">${linkTerms(p,seen,4)}</p>`).join('')}
<h2>The steps</h2><ol class="topicSteps">${t.steps.map(n=>STEPS[n-1]).map(s=>`<li><a href="/guide/${s.slug}"><b>Step ${s.n}: ${esc(s.title)}</b></a><p>${esc(s.plain)}</p></li>`).join('')}</ol>
<h2>Common questions</h2>${t.faq.map(([q,a])=>`<details open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
<div class="ctaBox"><div><b>Follow these steps on your own game</b><p>Duke Forge gives you a workspace for every step, AI help, and a check before the next one opens.</p></div><a class="btn" href="/signup">Start free</a></div></article>`;
  return page(req,{title:`${t.title} | Duke Forge`,desc:t.desc,path:`/learn/${t.slug}`,body,ogType:'article',
    schema:[{'@context':'https://schema.org','@type':'FAQPage',mainEntity:t.faq.map(([q,a])=>({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}}))},crumbs(req,[['Home','/'],[t.short,`/learn/${t.slug}`]])]});
}
async function showcase(req){
  const db=await load();const games=Object.values(db.projects).filter(p=>p.showcase?.on);
  const body=`<section class="hero small"><div class="wrap"><h1>Made with Duke Forge</h1><p class="lede">Games creators are building step by step. Each one shows where it is on the 67-step path.</p></div></section>
<section><div class="wrap">${games.length?`<div class="showgrid">${games.map(p=>{const done=Object.keys(p.roadmap?.completed||{}).length;return `<a class="show" href="/showcase/${esc(p.id)}">${p.showcase.cover?`<img src="${esc(p.showcase.cover)}" alt="${esc(p.design?.vision?.title||p.name)}" loading="lazy">`:'<div class="ph">D</div>'}<b>${esc(p.design?.vision?.title||p.name)}</b><span>Step ${Math.min(67,done+1)} of 67</span></a>`;}).join('')}</div>`:'<p class="muted center">The first games are being built now. Yours could be the first one here.</p>'}</div></section>`;
  return page(req,{title:'Showcase: games made with Duke Forge',desc:'Open-world games creators are building with Duke Forge, step by step, in Unreal Engine 5.',path:'/showcase',body});
}
async function showcaseGame(req,id){
  const db=await load();const p=db.projects[id];if(!p?.showcase?.on)return null;
  const done=new Set(Object.keys(p.roadmap?.completed||{}).map(Number));const t=p.design?.vision?.title||p.name;
  const body=`<article class="wrap narrow step"><nav class="crumbs"><a href="/showcase">Showcase</a> › ${esc(t)}</nav><h1>${esc(t)}</h1>
${p.showcase.cover?`<img class="cover" src="${esc(p.showcase.cover)}" alt="${esc(t)}">`:''}
<p class="lede">${esc(p.showcase.blurb||p.design?.vision?.logline||'')}</p>
<h2>Progress</h2><ul class="phaseProg">${PHASES.map(ph=>{const st=STEPS.filter(s=>s.phase===ph.n);const n=st.filter(s=>done.has(s.n)).length;return `<li><span>Phase ${ph.n}: ${esc(ph.title)}</span><i style="--w:${Math.round(n/st.length*100)}%"></i><em>${n}/${st.length}</em></li>`;}).join('')}</ul>
<div class="ctaBox"><div><b>Build yours</b><p>Start with one paragraph about your game.</p></div><a class="btn" href="/signup">Start free</a></div></article>`;
  return page(req,{title:`${t}: made with Duke Forge`,desc:cut(p.showcase.blurb||p.design?.vision?.logline||`${t}, a game being built with Duke Forge.`),path:`/showcase/${id}`,body});
}
async function certificate(req,id){
  const db=await load();const c=db.certificates?.[id];if(!c)return null;
  const body=`<article class="wrap narrow"><div class="cert"><p class="eyebrow">DUKE FORGE ACADEMY · CERTIFICATE OF COMPLETION</p><h1>${esc(c.name)}</h1>
<p>completed <b>Phase ${c.phase}: ${esc(c.phaseTitle)}</b> (steps ${c.steps[0]}–${c.steps.at(-1)}) of the 67-step open-world production course, building their own game <b>${esc(c.game)}</b>.</p>
<p class="muted">Issued ${new Date(c.issuedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · Certificate ID ${esc(c.id)}</p>
<p class="muted small">Each step was completed through Duke Forge's gates, and the phase quiz was passed.</p></div></article>`;
  return page(req,{title:`${c.name}: Phase ${c.phase} certificate | Duke Forge Academy`,desc:`${c.name} completed Phase ${c.phase} (${c.phaseTitle}) of the Duke Forge open-world production course.`,path:`/certificate/${id}`,body,noindex:true});
}
function notFoundPage(req){
  return page(req,{title:'Page not found | Duke Forge',desc:'This page does not exist.',path:'/404',noindex:true,body:`<section class="hero small"><div class="wrap"><h1>That page is not here.</h1><p class="lede">Try <a href="/guide">the 67-step guide</a>, <a href="/glossary">the glossary</a> or <a href="/">the home page</a>.</p></div></section>`});
}
function sitemap(req){
  const b=base(req);const urls=['/','/pricing','/guide','/glossary','/showcase',...STEPS.map(s=>`/guide/${s.slug}`),...Object.keys(GLOSSARY).map(k=>`/glossary/${k}`),...TOPICS.map(t=>`/learn/${t.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${esc(b+u)}</loc></url>`).join('')}</urlset>`;
}

export async function renderSite(pathname,req){
  const html=body=>({body});
  if(pathname==='/')return html(home(req));
  if(pathname==='/pricing')return html(pricing(req));
  if(pathname==='/guide')return html(guideIndex(req));
  let m;
  if((m=/^\/guide\/([a-z0-9-]+)\/?$/.exec(pathname))){const s=stepBySlug(m[1]);return s?html(stepPage(req,s)):null;}
  if(pathname==='/glossary')return html(glossaryIndex(req));
  if((m=/^\/glossary\/([a-z0-9-]+)\/?$/.exec(pathname)))return GLOSSARY[m[1]]?html(termPage(req,m[1])):null;
  if((m=/^\/learn\/([a-z0-9-]+)\/?$/.exec(pathname))){const t=TOPICS.find(x=>x.slug===m[1]);return t?html(topicPage(req,t)):null;}
  if(pathname==='/showcase')return {...html(await showcase(req)),cache:'public, max-age=60'};
  if((m=/^\/showcase\/([\w-]+)$/.exec(pathname))){const b=await showcaseGame(req,m[1]);return b?html(b):null;}
  if((m=/^\/certificate\/([\w-]+)$/.exec(pathname))){const b=await certificate(req,m[1]);return b?html(b):null;}
  if(pathname==='/sitemap.xml')return {body:sitemap(req),type:'application/xml; charset=utf-8'};
  if(pathname==='/robots.txt')return {body:`User-agent: *\nAllow: /\nDisallow: /studio\nDisallow: /api/\nDisallow: /login\nDisallow: /signup\nDisallow: /certificate/\nSitemap: ${base(req)}/sitemap.xml\n`,type:'text/plain; charset=utf-8'};
  if(pathname==='/__404')return {status:404,body:notFoundPage(req)};
  return null;
}
export { TOPICS };
