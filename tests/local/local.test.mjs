// Duke Local protocol test: security, the four agent roles, checkpoints, stop and failure handling.
// Uses a stand-in Ollama and a stand-in Blender; the real model and Blender are tested on the Shadow PC.
import fs from 'node:fs';import path from 'node:path';
const D=process.env.D;const B='http://127.0.0.1:4310';
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('FAIL:',m);}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cookie='',csrf='';
const A=async(m,u,b,h={})=>{const r=await fetch(B+u,{method:m,redirect:'manual',headers:{cookie,...(b&&!(b instanceof FormData)?{'content-type':'application/json'}:{}),...(m!=='GET'?{'x-duke-csrf':csrf,origin:B}:{}),...h},body:b instanceof FormData?b:b?JSON.stringify(b):undefined});
  return {s:r.status,h:r.headers,d:await r.json().catch(()=>null)};};
const raw=(host,extra={})=>new Promise(res=>{import('node:http').then(({default:http})=>{const q=http.request({host:'127.0.0.1',port:4310,path:'/api/health',method:'GET',headers:{host,...extra}},r=>{r.resume();res(r.statusCode);});q.end();});});

// security
ok(await raw('127.0.0.1:4310')===200,'own host accepted');
ok(await raw('evil.example:4310')===421,'foreign Host header refused (DNS rebinding)');
ok((await A('POST','/api/auth/login',{email:'x',password:'y'},{origin:'https://evil.example'})).s===403,'foreign Origin refused');
ok((await A('GET','/api/local/status')).s===401,'status needs login');
const code=fs.readFileSync(path.join(D,'local','login-code.txt'),'utf8');
let r=await A('GET','/local/login?code=wrong');ok(r.s===403,'bad login code refused');
r=await fetch(B+'/local/login?code='+code,{redirect:'manual'});ok(r.status===302&&/SameSite=Strict/.test(r.headers.get('set-cookie')),'one-time login sets a Strict cookie');
cookie=r.headers.get('set-cookie').split(';')[0];
ok((await fetch(B+'/local/login?code='+code,{redirect:'manual'})).status===403,'login code works only once');
const sec=JSON.parse(fs.readFileSync(path.join(D,'local','secret.json'))).secret;
ok((await A('POST','/api/local/login-code',{}, {'x-duke-local-secret':'nope'})).s===403,'launcher secret checked');
ok((await A('POST','/api/local/login-code',{}, {'x-duke-local-secret':sec})).d?.code?.length>20,'launcher can get a new code');
csrf=(await A('GET','/api/local/session')).d.csrf;
r=await fetch(B+'/api/local/settings',{method:'POST',headers:{cookie,'content-type':'application/json',origin:B},body:'{}'});ok(r.status===403,'privileged call without CSRF header refused');

// status shows measured values and the local model
r=await A('GET','/api/local/status');ok(r.d.ollama.running&&r.d.model.vision&&r.d.model.tools&&r.d.ollama.base==='http://127.0.0.1:11500','local model inspected (vision+tools from Ollama)');
ok(r.d.hardware.ramTotalGB>0&&r.d.hardware.disk,'hardware measured');ok(r.d.verified===false,'not marked verified before any local request');
// sample project
r=await A('POST','/api/local/sample');ok(r.d.settings.projectRoot&&fs.existsSync(r.d.settings.scene),'sample project with a scene');const root=r.d.settings.projectRoot;
const task=async(text)=>{const fd=new FormData();fd.append('request',text);return (await A('POST','/api/local/tasks',fd)).d.task.id;};
const wait=async(id,states=['DONE','FAILED','STOPPED','NEEDS_APPROVAL'],ms=60000)=>{const t0=Date.now();for(;;){const t=(await A('GET','/api/local/tasks/'+id)).d.task;if(states.includes(t.state)||Date.now()-t0>ms)return t;await sleep(500);}};
await A('POST','/api/local/start');

// 1. full workflow
let id=await task('Create a simple building with a door and windows, save the scene and render a preview.');
let t=await wait(id);
ok(t.state==='DONE','building task DONE: '+t.state+' '+(t.error||''));
ok(t.steps.map(s=>s.role).join(',')==='blender,reviewer','plan: blender then reviewer');
ok(t.checkpoint?.kind==='git','checkpoint before changes ('+t.checkpoint?.kind+')');
ok(t.previews.before&&t.previews.after,'before/after previews');
ok(t.outputs.length===1&&/main_v001\.blend$/.test(t.outputs[0].file),'saved as a new version '+JSON.stringify(t.outputs));
ok(t.verify.some(v=>v.reopened&&v.objects===6),'scene reopens with 6 objects '+JSON.stringify(t.verify));
ok(t.steps[1].result.pass===true&&t.steps[1].result.images===1,'reviewer looked at the real render');
r=await A('GET','/api/local/logs');ok(r.d.modelRequests.length>=3&&r.d.modelRequests.every(x=>x.endpoint.startsWith('http://127.0.0.1:11500/'))&&r.d.modelRequests.some(x=>x.images===1),'every model request went to 127.0.0.1');
r=await A('GET','/api/local/status');ok(r.d.verified===true,'"local inference" verified after a real local request');
const prev=await fetch(B+`/api/local/tasks/${id}/file/after.png`,{headers:{cookie}});ok(prev.status===200&&prev.headers.get('content-type')==='image/png','preview served');
// 2. failure handling: one failure then fixed; always failing stops after two repairs
let id2=await task('FAILONCE building');t=await wait(id2);ok(t.state==='DONE'&&t.steps[0].fixes.length===1,'repaired after one failure');
let id3=await task('ALWAYSFAIL building');t=await wait(id3);ok(t.state==='FAILED'&&t.steps[0].fixes.length===3&&/2 repair attempts/.test(t.error),'stops after 2 repairs: '+t.state+' fixes='+t.steps[0].fixes.length+' '+t.error);
// 3. stop
let id4=await task('SLOW building');await sleep(1500);r=await A('POST','/api/local/stop');t=await wait(id4);ok(t.state==='STOPPED','stopped: '+t.state);
ok(r.d.stillRunning.length===0,'nothing left running');
await A('POST','/api/local/start');
// 4. developer + approval for a risky command
let id5=await task('NOTESFILE: add a notes file');t=await wait(id5);ok(t.state==='DONE'&&fs.existsSync(path.join(root,'notes.md')),'developer wrote notes.md: '+t.state+' '+(t.error||''));
let id6=await task('NOTESFILE DELETE the notes');t=await wait(id6);ok(t.state==='NEEDS_APPROVAL'&&/command/.test(t.pending.action),'risky command waits for approval');
await A('POST',`/api/local/tasks/${id6}/approve`,{decision:'deny'});t=await wait(id6,['STOPPED']);ok(t.state==='STOPPED'&&fs.existsSync(path.join(root,'notes.md')),'declined: nothing deleted');
// 5. restore the first checkpoint
r=await A('POST',`/api/local/tasks/${id}/restore`);ok(r.s===200&&!fs.existsSync(path.join(root,'scenes','main_v001.blend'))&&!fs.existsSync(path.join(root,'notes.md'))&&r.d.movedToTrash>=2,'restore moved newer files to .duke/trash '+JSON.stringify(r.d));
ok(fs.existsSync(path.join(root,'scenes','main.blend')),'original scene kept');
// 6. path safety
r=await A('POST','/api/local/settings',{projectRoot:'/definitely/not/here'});ok(r.s===400,'missing project folder refused');
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
