const { chromium } = require('playwright'); const fs=require('fs'), path=require('path');
const [out, tdir, ...pages] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'] }); const logs=[];
  for (const pg of pages) {
    const [file, ...clicks] = pg.split(':');
    const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
    await p.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => { const u=new URL(r.request().url()); r.fulfill({ body: fs.readFileSync(path.join(tdir, u.pathname.replace('/npm/three@0.160.0','node_modules/three'))), contentType: 'application/javascript' }); });
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    p.on('console', m => { if (m.type()==='error') logs.push(file+' error: '+m.text()); }); p.on('pageerror', e => logs.push(file+' pageerror: ' + e.message));
    await p.goto('http://127.0.0.1:8768/' + file); await p.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 300000 });
    let i=0;
    for (const c of clicks) { const [sel, wait] = c.split('@'); if (sel) await p.click(sel); await p.waitForTimeout(+(wait||2500)); const clip = await p.evaluate(()=>document.body.innerText.match(/clip: \S+/)?.[0]); console.log(file, sel, clip); await p.screenshot({ path: `${out}/${file.replace('.html','')}_${i++}.png` }); }
    await p.close();
  }
  console.log(logs.join('\n') || 'no console errors'); await b.close(); })();
