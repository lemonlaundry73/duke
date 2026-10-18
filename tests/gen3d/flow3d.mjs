// Protocol test of the cast list and the Duke 3D Generator (mock generators, stand-in Blender and editor).
import fs from 'node:fs';import zlib from 'node:zlib';
const T=process.env.T;const st=JSON.parse(fs.readFileSync(T+'/state.json'));const B='http://localhost:3121';
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('FAIL:',m);}};
const A=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{cookie:st.cookie,...(b&&!(b instanceof FormData)?{'content-type':'application/json'}:{})},body:b instanceof FormData?b:b?JSON.stringify(b):undefined});return {s:r.status,d:await r.json().catch(()=>null)};};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function png(w,h){const crc=b=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0;};
  const chunk=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=0;const raw=Buffer.alloc((w+1)*h,200);
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const up=(field,buf,name='a.png')=>{const fd=new FormData();fd.append(field,new Blob([buf],{type:'image/png'}),name);return fd;};

let r=await A('POST','/api/forge/projects',{name:'Valor',starter:'fps'});const fid=r.d.project.id;
for(let i=0;i<60;i++){const p=(await A('GET',`/api/forge/projects/${fid}`)).d.project;if(p.status==='ready')break;await sleep(1000);}
r=await A('GET','/api/forge/gen3d/recipes');ok(r.d.recipes.length>=6&&r.d.rules.length>=6&&r.d.providers.every(p=>p.ready),'recipes, rules, providers ready');
r=await A('POST',`/api/forge/projects/${fid}/cast`,{name:'Cole Mercer',role:'Hero'});ok(r.d.character?.name==='Cole Mercer','add cast');const cid=r.d.character.id;
r=await A('POST',`/api/forge/cast/${cid}/view/front`,up('file',png(512,512)));ok(r.s===400&&/1024/.test(r.d.error),'small photo refused: '+r.d?.error);
for(const v of ['front','back','left','right']){r=await A('POST',`/api/forge/cast/${cid}/view/${v}`,up('file',png(1024,1400)));}
ok(r.d.character.ready&&r.d.character.views.front.w===1024,'four views uploaded');
r=await A('POST',`/api/forge/projects/${fid}/gen3d`,(()=>{const fd=new FormData();fd.append('recipe','weapon');fd.append('name','Rifle');fd.append('view_left',new Blob([png(1024,1024)],{type:'image/png'}),'l.png');return fd;})());
ok(r.s===400&&/Right side/.test(r.d.error),'missing angles refused: '+r.d?.error);
const fd=new FormData();fd.append('recipe','character_npc');fd.append('name','Cole Mercer');fd.append('castId',cid);fd.append('providers','best');
r=await A('POST',`/api/forge/projects/${fid}/gen3d`,fd);ok(r.s===200&&r.d.job.candidates.length===2,'generation started with both providers '+JSON.stringify(r.d).slice(0,200));const gid=r.d.job.id;
let j;for(let i=0;i<120;i++){j=(await A('GET',`/api/forge/gen3d/${gid}`)).d.job;if(['READY','BELOW_AAA','FAILED'].includes(j.state)&&!j.candidates.some(c=>['GENERATING','FINISHING','RIGGING'].includes(c.state)))break;await sleep(1000);}
ok(j.state==='READY','job ready: '+j.state+' '+JSON.stringify(j.candidates.map(c=>[c.provider,c.state,c.error,c.verdict?.fails])));
ok(j.candidates.every(c=>c.verdict?.aaa&&c.finished.some(f=>f.name.startsWith('SK_'))&&c.finished.some(f=>f.name.startsWith('A_'))),'both rigged and AAA-checked');
const fin=j.candidates[0].finished.find(f=>f.name.endsWith('.fbx'));const dl=await fetch(B+fin.url,{headers:{cookie:st.cookie}});ok(dl.status===200,'finished file served');
r=await A('POST',`/api/forge/gen3d/${gid}/approve`,{provider:'rodin'});ok(r.s===200&&r.d.asset&&r.d.job,'approved, import job queued '+JSON.stringify(r.d).slice(0,200));
let ij;for(let i=0;i<60;i++){ij=(await A('GET',`/api/forge/jobs/${r.d.job.id}`)).d.job;if(['READY','BLOCKED'].includes(ij.state))break;await sleep(1000);}
ok(ij.state==='READY','import job READY: '+ij.state+' '+(ij.reason||'')+JSON.stringify(ij.steps.map(s=>[s.kind,s.state,s.error])));
r=await A('GET',`/api/forge/projects/${fid}/cast`);ok(r.d.cast[0].models.length===1,'cast shows the model');
r=await A('GET',`/api/forge/projects/${fid}/assets`);ok(r.d.assets.some(a=>a.type==='character/3d'&&/AAA/.test(a.status)),'asset library entry');
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
