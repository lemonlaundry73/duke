import fs from 'node:fs';const B='http://localhost:3121';let cookie='';
const a=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:b?JSON.stringify(b):undefined});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];return r.json();};
await a('POST','/api/auth/signup',{email:'forge@example.com',password:'longenough1',name:'Forge'});
const s=await a('GET','/api/agent/setup');fs.writeFileSync(process.env.T+'/state.json',JSON.stringify({cookie,token:/--token (\S+)/.exec(s.command)[1]}));console.log('ok');
