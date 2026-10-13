// Protocol test of Duke Forger V1 against the stand-in engine harness (not the acceptance test).
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
const T=process.env.T;const st=JSON.parse(fs.readFileSync(T+'/state.json'));const B='http://localhost:3121';
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('FAIL:',m);}};
const A=async(m,u,b,raw)=>{const r=await fetch(B+u,{method:m,headers:{cookie:st.cookie,...(b&&!(b instanceof FormData)?{'content-type':'application/json'}:{})},body:b instanceof FormData?b:b?JSON.stringify(b):undefined});
  if(raw)return r;return {s:r.status,d:await r.json().catch(()=>null)};};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitJob(jid,ms=90000){const t0=Date.now();for(;;){const j=(await A('GET',`/api/forge/jobs/${jid}`)).d.job;if(['READY','BLOCKED','STOPPED'].includes(j.state))return j;if(Date.now()-t0>ms)return j;await sleep(500);}}
function png(){const crc=b=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0;};
  const chunk=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(2,0);ih.writeUInt32BE(2,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(Buffer.alloc(14))),chunk('IEND',Buffer.alloc(0))]);}

// 1. create project
let r=await A('POST','/api/forge/projects',{name:'Galactic Game!'});ok(r.s===200&&r.d.project.name==='GalacticGame','create project '+JSON.stringify(r.d).slice(0,200));
const fid=r.d.project.id;let j=await waitJob(r.d.job.id);
ok(j.state==='READY','project job READY: '+j.state+' '+(j.reason||'')+' '+JSON.stringify(j.steps.map(s=>[s.kind,s.state,s.error])));
let p=(await A('GET',`/api/forge/projects/${fid}`)).d;ok(p.project.status==='ready'&&p.project.root&&p.project.uproject.endsWith('GalacticGame.uproject'),'project ready with root');
const root=p.project.root;const up=JSON.parse(fs.readFileSync(p.project.uproject,'utf8'));
ok(up.EngineAssociation==='5.8'&&up.Plugins.some(x=>x.Name==='DukeForger')&&up.Plugins.some(x=>x.Name==='PixelStreaming2'&&x.TargetAllowList[0]==='Editor'),'uproject engine + plugins');
ok(fs.existsSync(path.join(root,'Plugins/DukeForger/Content/Python/duke_forger_bridge.py'))&&fs.existsSync(path.join(root,'Source/GalacticGame/GalacticGame.Build.cs')),'plugin and source installed');
ok(fs.readFileSync(path.join(root,'Source/GalacticGame.Target.cs'),'utf8').includes('class GalacticGameTarget'),'names replaced');
ok(!!j.commit?.sha,'initial commit recorded');

// 2. File Vault / Source / History
r=await A('GET',`/api/forge/projects/${fid}/tree`);ok(r.d.live&&r.d.files.some(f=>f.p==='GalacticGame.uproject')&&r.d.files.some(f=>f.p.startsWith('Plugins/DukeForger/'))&&!r.d.files.some(f=>f.p.startsWith('.git/')),'vault tree');
r=await A('GET',`/api/forge/projects/${fid}/file?path=Config/DefaultGame.ini`);ok(r.d.text?.includes('ProjectName=GalacticGame')&&r.d.editable,'read text file');
r=await A('POST',`/api/forge/projects/${fid}/file`,{path:'Config/DefaultGame.ini',content:r.d.text.replace('CompanyName=Duke Forger','CompanyName=Lemon Studios')});ok(r.d?.diff?.includes('+CompanyName=Lemon Studios'),'save shows diff');
r=await A('POST',`/api/forge/projects/${fid}/commit`,{message:'Set company name',paths:['Config/DefaultGame.ini']});ok(r.d?.sha&&r.d.summary.startsWith('Committed'),'commit edit');const editSha=r.d.sha;
r=await A('GET',`/api/forge/projects/${fid}/history`);ok(r.d.commits[0].message==='Set company name','history');
r=await A('GET',`/api/forge/projects/${fid}/diff?rev=${editSha}`);ok(r.d.diff.includes('-CompanyName=Duke Forger')&&r.d.diff.includes('+CompanyName=Lemon Studios'),'commit diff');
r=await A('POST',`/api/forge/projects/${fid}/rollback`,{rev:editSha});ok(r.s===200,'rollback');
ok(fs.readFileSync(path.join(root,'Config/DefaultGame.ini'),'utf8').includes('CompanyName=Duke Forger'),'rollback restored file');
ok((await A('GET',`/api/forge/projects/${fid}/file?path=../../etc/passwd`)).s===400,'path escape blocked');
ok((await A('POST',`/api/forge/projects/${fid}/file`,{path:'Content/x.uasset',content:'x'})).s===400,'binary edit blocked');

// 3. acceptance test 1 flow
r=await A('POST',`/api/forge/projects/${fid}/jobs`,{kind:'actor_test'});j=await waitJob(r.d.job.id);
ok(j.state==='READY'&&j.tests[0]?.passed&&j.evidence.some(e=>e.type==='screenshot'),'actor test READY with evidence: '+j.state+' '+(j.reason||''));
const ev=await A('GET',j.evidence[0].url,null,true);ok(ev.status===200&&ev.headers.get('content-type')==='image/png','evidence served');

// 4. agent test: room with door, repair loop
r=await A('POST',`/api/forge/projects/${fid}/jobs`,{kind:'command',prompt:'Create a room with a floor, four walls, two lights, a player start, a red cube, and a door that opens when the player approaches.'});
ok(r.d.job.plan?.spec?.walls===4&&r.d.job.plan.spec.lights===2&&r.d.job.plan.spec.cube.color==='red'&&r.d.job.plan.spec.door.opensOnApproach,'interpreted: '+JSON.stringify(r.d.job.plan?.spec));
j=await waitJob(r.d.job.id);
ok(j.state==='READY'&&j.repairs===1,'room job READY after 1 repair: '+j.state+' repairs='+j.repairs+' '+(j.reason||''));
ok(fs.readFileSync(path.join(root,'Source/GalacticGame/DukeDoor.h'),'utf8').includes('TriggerDistance = 450.f'),'repair edited the door code');
ok(j.tests.some(t=>!t.passed)&&j.tests.at(-1).passed,'failing then passing test recorded');
ok(fs.readFileSync(path.join(root,'Config/DefaultEngine.ini'),'utf8').includes('GameDefaultMap=/Game/Maps/DukeRoom.DukeRoom'),'default map set');
ok(fs.readFileSync(path.join(root,'Config/DefaultGame.ini'),'utf8').includes('+MapsToCook=(FilePath="/Game/Maps/DukeRoom")'),'room cooked');
r=await A('GET',`/api/forge/projects/${fid}/history`);ok(r.d.commits[0].message.startsWith('Duke Forger: Create a room'),'room committed');

// 5. compile failure without a model -> BLOCKED with the compiler error
await A('POST',`/api/forge/projects/${fid}/file`,{path:'Source/GalacticGame/GalacticGame.cpp',content:'SYNTAX_ERROR\n'});
r=await A('POST',`/api/forge/projects/${fid}/jobs`,{kind:'compile'});j=await waitJob(r.d.job.id);
ok(j.state==='BLOCKED'&&/C2065/.test(j.reason),'compile error blocks with message: '+j.state+' '+j.reason);
r=await A('POST',`/api/forge/projects/${fid}/rollback`,{rev:'0000000'});ok(r.s===400,'bad rev rejected');
await A('POST',`/api/forge/projects/${fid}/file`,{path:'Source/GalacticGame/GalacticGame.cpp',content:'// Game module created by Duke Forger.\n#include "Modules/ModuleManager.h"\n\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, GalacticGame, "GalacticGame");\n'});

// 6. unknown command without a model
r=await A('POST',`/api/forge/projects/${fid}/jobs`,{kind:'command',prompt:'Build the next planet.'});ok(r.d.job.state==='BLOCKED'&&/AI model/.test(r.d.job.reason),'unknown command blocked honestly');

// 7. build
r=await A('POST',`/api/forge/projects/${fid}/jobs`,{kind:'build'});j=await waitJob(r.d.job.id);
ok(j.state==='READY'&&j.build,'build READY: '+j.state+' '+(j.reason||''));
p=(await A('GET',`/api/forge/projects/${fid}`)).d;ok(p.builds.length===1&&p.builds[0].number===1,'build listed');
const dl=await A('GET',p.builds[0].url,null,true);const buf=Buffer.from(await dl.arrayBuffer());ok(dl.status===200&&buf.subarray(0,2).toString()==='PK','build download is a zip');
ok(j.evidence.some(e=>e.type==='log'),'build log stored');

// 8. Concept Studio
let fd=new FormData();fd.append('name','Rebel Armor');fd.append('category','character');fd.append('note','Original');fd.append('file',new Blob([png()],{type:'image/png'}),'a.png');
r=await A('POST',`/api/forge/projects/${fid}/concepts`,fd);ok(r.s===200&&r.d.concept.revisions.length===1,'concept created');const cid=r.d.concept.id;
fd=new FormData();fd.append('note','Visor blue');fd.append('source','Concept Studio adjust');fd.append('parent','1');fd.append('file',new Blob([png()],{type:'image/png'}),'b.png');
r=await A('POST',`/api/forge/concepts/${cid}/revisions`,fd);ok(r.d.concept.revisions.length===2&&r.d.concept.revisions[1].parent===1,'variation added');
r=await A('POST',`/api/forge/concepts/${cid}/review`,{n:2,decision:'approve'});ok(r.d.concept.approved===2&&r.d.concept.revisions[0].status==='review'&&r.d.asset?.revision===2,'approved, original kept, asset registered');
ok((await A('GET',`/api/forge/concepts/${cid}/r/1`,null,true)).status===200,'original still served');
r=await A('GET',`/api/forge/projects/${fid}/assets`);ok(r.d.assets.length===1&&r.d.assets[0].type==='concept/character'&&r.d.assets[0].status==='approved concept (2D)','asset library');
r=await A('GET',`/api/forge/projects/${fid}/tree`);ok(r.d.extra.some(x=>x.p.includes('Concepts/Rebel Armor/r2 (approved)'))&&r.d.extra.some(x=>x.p.startsWith('@Duke/Builds/')),'vault shows concepts and builds');

// 9. auth
const other=await fetch(B+`/api/forge/projects/${fid}`);ok(other.status===401,'needs login');
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
