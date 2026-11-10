# Builds the preview site: index.html (Empire trooper), ally.html (Alliance trooper, blue bolts), jedi.html (Jedi),
# battle.html (Empire squad), plus base64 GLBs and wavs.   usage: build_pages.py <site out dir>
import json, os, sys, base64, shutil, re
SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
D = sys.argv[1]; os.makedirs(D, exist_ok=True)
A = '/home/user/duke/assets/characters'
def stats_of(qa):
    a = json.load(open(qa + '/anim_stats.json')); st = json.load(open(qa + '/stretch.json')) if os.path.exists(qa + '/stretch.json') else {}
    return {k: dict(f=v['frames'], sec=v['seconds'], loop=v['loop'], spd=v['speed_m_s'], hand=v['max_hand_gap_cm'], foot=v['max_foot_gap_cm'],
                    slip=v['planted_foot_slip_cm_s'], str=st.get(k, {}).get('stretched_edges', 0), notes=v['notes']) for k, v in a.items()}
def cuts_of(qa):
    return [dict(clip=c['clip'], time=c['time'], remainder=c['remainder'], pieces=c['pieces']) for c in json.load(open(qa + '/cut_variants.json'))]
head0 = open(SITE + '/index3.head.html').read().replace('64 bones: UE mannequin names, 5-finger hands, weapon and muzzle bones, 2 free bones for severed parts', '65 bones: UE mannequin names, 5-finger hands, weapon, muzzle and prop bones, 2 free bones for severed parts')
js0 = open(SITE + '/index3.js.html').read()
# the user's sound effects (assets/audio/game): every page knows all of them
js0 = js0.replace("const SOUNDS = ['S_Blaster_Fire_01', 'S_Blaster_Fire_02', 'S_Blaster_Fire_03', 'S_Blaster_Impact', 'S_Explosion', 'S_Saber_Hum', 'S_Saber_Swing', 'S_Saber_Hit'];",
  "const SOUNDS = ['S_Blaster_Fire_01', 'S_Blaster_Fire_02', 'S_Blaster_Fire_03', 'S_AllyRifle_Fire_01', 'S_AllyRifle_Fire_02', 'S_AllyRifle_Fire_03', 'S_Blaster_Impact', 'S_Explosion', 'S_Saber_Hum', 'S_Saber_Swing', 'S_Saber_Swing_01', 'S_Saber_Swing_02', 'S_Saber_Swing_03', 'S_Saber_Hit', 'S_Saber_On', 'S_Saber_Off', 'S_Saber_Clash', 'S_Saber_Clash_Short'];")
assert 'S_Saber_Clash_Short' in js0
js0 = js0.replace("if (on && !hum) { hum = play('S_Saber_Hum', 0.25); if (hum) hum.s.loop = true; }", "if (on && !hum) { hum = play('S_Saber_Hum', 0.3); if (hum) hum.s.loop = true; }")
GAMEAUDIO = '/home/user/duke/assets/audio/game'
NAV = '<nav style="position:absolute;top:12px;right:12px;z-index:5;display:flex;gap:6px;font:500 11px/1 system-ui;letter-spacing:.06em;text-transform:uppercase"><a href="index.html" style="color:#ddd;background:#1b1d1fcc;padding:7px 9px;text-decoration:none;border:1px solid #444">Empire trooper</a><a href="ally.html" style="color:#ddd;background:#1b1d1fcc;padding:7px 9px;text-decoration:none;border:1px solid #444">Alliance trooper</a><a href="jedi.html" style="color:#ddd;background:#1b1d1fcc;padding:7px 9px;text-decoration:none;border:1px solid #444">Jedi</a></nav>'
def with_nav(h):
    i = h.find('<canvas id="view"')
    return h[:i] + NAV + h[i:] if i >= 0 else h
def page(head, js, out):
    open(f'{D}/{out}', 'w').write(head + js)
    open(f'{D}/wrap_{out}', 'w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + head + js + '</body></html>')
def glb(src, name):
    open(f'{D}/{name}', 'w').write(base64.b64encode(open(src, 'rb').read()).decode())
# ---------- Empire trooper ----------
st = stats_of(A + '/clone_trooper/QA'); cv = cuts_of(A + '/clone_trooper/QA')
page(with_nav(head0), js0.replace('__STATS__', json.dumps(st)).replace('__CUTS__', json.dumps(cv)), 'index.html')
glb(A + '/clone_trooper/Web/trooper_web.glb', 'trooper.glb.b64.txt')
for f in os.listdir(A + '/clone_trooper/Audio'): shutil.copy(A + '/clone_trooper/Audio/' + f, D)
for f in os.listdir(GAMEAUDIO):
    if f.endswith('.wav'): shutil.copy(GAMEAUDIO + '/' + f, D)
b = open(SITE + '/battle.tpl.html').read().replace('__STATS__', json.dumps(st)).replace('__DRAG__', json.dumps(json.load(open(A + '/clone_trooper/QA/drag_pair.json'))))
open(f'{D}/battle.html', 'w').write(b)
# ---------- Alliance trooper: same page, ally model, blue bolts ----------
if os.path.exists(A + '/ally_trooper/QA/anim_stats.json'):
    st = stats_of(A + '/ally_trooper/QA'); cv = cuts_of(A + '/ally_trooper/QA')
    h = with_nav(head0).replace('<h1>Blaster Trooper</h1>', '<h1>Alliance Trooper</h1>').replace('with the Empire blaster', 'with the Alliance assault rifle (blue bolts)')
    h = h.replace('<title>Blaster Trooper</title>', '<title>Alliance Trooper</title>')
    h = h.replace('Your Phase II clone trooper with the Empire blaster, rigged and animated.', 'Your Alliance field trooper, built from scratch with the Duke character creator (MakeHuman CC0 body, original armour), rigged on the shared skeleton with every animation.')
    h = h.replace('85k tris trooper + 20k tris blaster, 4K textures', '30k tris trooper + rifle, 2K PBR textures').replace('0.63 m Empire carbine on <code>weapon_r</code>', '0.68 m Alliance assault rifle on <code>weapon_r</code>').replace('<dt>Blaster</dt>', '<dt>Rifle</dt>')
    j = js0.replace('__STATS__', json.dumps(st)).replace('__CUTS__', json.dumps(cv)).replace("fetch('trooper.glb.b64.txt')", "fetch('ally.glb.b64.txt')")
    j = j.replace('new THREE.Color(4.0, 0.5, 0.4)', 'new THREE.Color(0.7, 1.6, 4.5)').replace('new THREE.Color(1.6, 0.06, 0.04)', 'new THREE.Color(0.06, 0.35, 1.8)')
    j = j.replace("play('S_Blaster_Fire_0' + (1 + Math.floor(Math.random() * 3)), 0.45, 0.94 + Math.random() * 0.12);", "play('S_AllyRifle_Fire_0' + (1 + Math.floor(Math.random() * 3)), 0.45, 0.96 + Math.random() * 0.08);")
    j = j.replace('new THREE.PointLight(0xff3020, 0, 4, 2)', 'new THREE.PointLight(0x3080ff, 0, 4, 2)').replace("color = 0xff3020, dist = 4", "color = 0x3080ff, dist = 4").replace("flash(b.g.position, 12, 0.1, 0xff6a3a)", "flash(b.g.position, 12, 0.1, 0x5aa0ff)")
    page(h, j, 'ally.html'); glb(A + '/ally_trooper/Web/trooper_web.glb', 'ally.glb.b64.txt')
# ---------- Jedi ----------
if os.path.exists(A + '/jedi/QA/anim_stats.json'):
    st = stats_of(A + '/jedi/QA'); cv = cuts_of(A + '/jedi/QA')
    h = with_nav(head0)
    h = h.replace('<title>Blaster Trooper</title>', '<title>Jedi</title>').replace('<h1>Blaster Trooper</h1>', '<h1>Jedi</h1>')
    h = re.sub(r'(<h1>Jedi</h1>\s*<p[^>]*>)(.*?)(</p>)', r'\1Your Jedi, rigged on the same skeleton and physics as the troopers. The lightsaber hangs on his belt (right hip): he draws it, ignites the blue blade, fights one-handed, deflects bolts and uses the Force, then switches it off and hangs it back on the belt.\3', h, count=1, flags=re.S)
    h = h.replace('<dt>Blaster</dt><dd>0.63 m Empire carbine on <code>weapon_r</code>, bolts spawn at <code>muzzle</code></dd>', '<dt>Lightsaber</dt><dd>Hilt on <code>weapon_r</code>, 0.95 m blue blade on its own <code>blade</code> bone (ignition = bone scale). Rests on the belt, right hip. Hilt: your Meshy hilt (0.28 m, 14k tris, 2K textures)</dd>')
    h = h.replace('85k tris trooper + 20k tris blaster, 4K textures', '85k tris Jedi + hilt and blade, 4K textures')
    h = h.replace('<dd>65 bones:', '<dd>66 bones (65 + blade):')
    h = h.replace('<button id="bRoll">Roll &amp; fire</button>', '<button id="bDraw">Draw saber</button><button id="bCombo">Attack combo</button><button id="bBlock">Block</button>')
    h = h.replace('<button id="bCombat" class="fire" aria-pressed="false">Combat</button>', '<button id="bCombat" class="fire" aria-pressed="false">Deflect bolts</button>')
    h = h.replace('<button id="bSneak">Tiptoe sneak</button>', '<button id="bSneak">Tiptoe sneak</button><button id="bPush">Force push</button><button id="bPull">Force pull</button>')
    h = re.sub(r'<p class="note">.*?</p>', '<p class="note"><b>Draw saber</b> takes the hilt from his belt and ignites the blade (press again to switch it off and hang it back). <b>Attack combo</b> chains six strikes cut from your lightsaber motion capture. <b>Deflect bolts</b> sends a drone that fires at him: he bats the bolts away, some straight back. <b>Force push</b> (your Force Slam capture) throws the crates, <b>Force pull</b> (your Force Raise capture) yanks one to him. <b>Shoot him</b>, <b>Thermal detonator</b> and <b>Lightsaber</b> use the same deaths and ragdoll as the troopers. Drag to orbit, scroll to zoom. Turn sound on first.</p>', h, count=1, flags=re.S)
    j = js0.replace('__STATS__', json.dumps(st)).replace('__CUTS__', json.dumps(cv)).replace("fetch('trooper.glb.b64.txt')", "fetch('jedi.glb.b64.txt')")
    j = j.replace("'Unpacking trooper…'", "'Unpacking Jedi…'")
    j = j.replace("`${gltf.animations.length}: patrol, walks, run, sprint, roll, kneel, climb, mantle, combat, saber hits, 5 saber endings, 4 blasts, 4 deaths, melee, signals, head looks, neck roll, counting, beckon, tiptoe`",
                  "`${gltf.animations.length}: draw/holster, guard, 4 attacks, 3 blocks, 3 deflects, Force push and pull, walk and run with arm swing, deaths, saber hits, blasts, climb, gestures`")
    # blade glow light on the blade bone
    j = j.replace("muzzle = T.getObjectByName('muzzle'); rootBone = T.getObjectByName('root');",
                  "muzzle = T.getObjectByName('muzzle'); rootBone = T.getObjectByName('root'); bladeBone = T.getObjectByName('blade');\n  for (const [n, a] of Object.entries(actions)) if (n.startsWith('saber_strike_') || n.startsWith('sw_')) for (const tr of a.getClip().tracks) if (tr.name === 'root.position') { const v = tr.values; for (let k = 0; k < v.length; k += 3) { v[k] = v[0]; v[k + 1] = v[1]; } }\n  if (bladeBone) { bladeLight = new THREE.PointLight(0x2a6bff, 0, 3.5, 2); bladeLight.position.y = 0.45; bladeBone.add(bladeLight); }\n  T.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && m.name && m.name.startsWith('M_SaberBlade_Glow')) { m.blending = THREE.AdditiveBlending; m.depthWrite = false; m.transparent = true; m.toneMapped = false; } else if (m && m.name && m.name.startsWith('M_SaberBlade_Core')) { m.toneMapped = false; } });")
    j = j.replace("let T = null, mixer, actions = {}, current = null, muzzle, rootBone;", "let T = null, mixer, actions = {}, current = null, muzzle, rootBone, bladeBone = null, bladeLight = null, drawn = false;")
    j = j.replace("  if (mixer) { mixer.update(dt); updateCut(); }", "  if (mixer) { mixer.update(dt); updateCut(); }\n  if (bladeBone && bladeLight) { const s = bladeBone.scale.y; bladeLight.intensity = s > 0.05 ? 3.5 * s * (0.9 + 0.1 * Math.sin(now * 40)) : 0; humOn(s > 0.5 && !dead); }\n  jediTick(dt, now);")
    j = j.replace("$('ammo').textContent = `power cell ${Math.max(0, ammo)}/24`;", "$('ammo').textContent = drawn ? 'saber: lit' : 'saber: on the belt';")
    # combat mode -> deflect mode (the drone shoots at him)
    a = j.index("    } else if (mode === 'combat') {"); b_ = j.index("    } else if (mode === 'limp' && current === actions.walk_limp) {")
    j = j[:a] + """    } else if (mode === 'combat') {
      droneT += dt; const r = 6.0; drone.position.set(Math.cos(droneT * 0.3) * r, 1.5 + Math.sin(droneT * 1.3) * 0.3, Math.sin(droneT * 0.3) * r + 1);
      drone.rotation.y += dt * 2; drone.children[1].material.color.setRGB(droneHit > now ? 2.5 : 0.6, droneHit > now ? 0.3 : 1.4, droneHit > now ? 0.2 : 2.2);
      if (drawn && !busy(now)) turnTo(drone.position, dt, 5);
      if (drawn && now > nextShot && !busy(now)) { const from = drone.position.clone(); const aim = trooper.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.1 + Math.random() * 0.5, 0)).sub(from).normalize(); enemyBolt(from, aim); nextShot = now + 0.9 + Math.random() * 1.1; }
""" + j[b_:]
    j = j.replace("  if (m === 'combat') { setState('ALERT'); alertUntil = clock.elapsedTime + 1.0; play_('signal_halt', { loop: false, rate: 1.4 }); }",
                  "  if (m === 'combat') { setState('GUARD'); nextShot = clock.elapsedTime + 2.0; ensureDrawn(() => {}); }")
    j = j.replace("  if (m === 'patrol') { setState('PATROL'); play_('walk'); }", "  if (m === 'patrol') { setState('PATROL'); if (drawn) { drawn = false; play('S_Saber_Off', 0.5); play_('holster_saber', { loop: false, fade: 0.2 }); onFinish = () => { if (mode === 'patrol') play_('walk', { fade: 0.3 }); }; } else play_('walk'); }")
    # bolts that hit him are deflected while the blade is lit
    j = j.replace("    if (drone.visible && b.g.position.distanceTo(drone.position) < 0.32) { hit = true; droneHit = now + 0.12; }",
                  "    if (drone.visible && b.g.position.distanceTo(drone.position) < 0.32) { hit = true; droneHit = now + 0.12; }\n    if (b.enemy && !dead && b.g.position.distanceTo(trooper.position.clone().setY(b.g.position.y)) < 0.55 && b.g.position.y < 2.0) { if (drawn) { deflect(b); continue; } hit = true; }")
    j = j.replace("// ---------- trooper ----------", """// ---------- Jedi ----------
let busyUntil = 0; const busy = now => now < busyUntil;
function enemyBolt(from, dir) { fireBolt(from, dir); const b = bolts[bolts.length - 1]; b.enemy = true; b.speed = 22; }
function deflect(b) {
  const side = new THREE.Vector3().subVectors(b.g.position, trooper.position).dot(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)));
  const clip = b.g.position.y > 1.65 ? 'saber_deflect_high' : side > 0 ? 'saber_deflect_l' : 'saber_deflect_r';
  current = null; play_(clip, { loop: false, fade: 0.05, rate: 1.4 }); onFinish = () => { if (drawn) { current = null; play_('aim', { fade: 0.15 }); } };
  const p = b.g.position.clone(); sparks(p, 40, 2.2, new THREE.Color(0.8, 1.6, 3.2)); flash(p, 14, 0.08, 0x6ab0ff); play('S_Saber_Clash_Short', 0.5, 1.0 + Math.random() * 0.1);
  b.enemy = false; b.life = 1.6;
  b.dir = Math.random() < 0.6 ? drone.position.clone().sub(p).normalize() : new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
  b.g.lookAt(p.clone().add(b.dir)); b.speed = 30;
}
function ensureDrawn(then) {
  if (drawn) { current = null; play_('aim', { fade: 0.2 }); then(); return; }
  drawn = true; busyUntil = clock.elapsedTime + 1.3; const myd = seq; setTimeout(() => { if (myd === seq) play('S_Saber_On', 0.55); }, 900);
  current = null; play_('draw_saber', { loop: false, fade: 0.2 }); onFinish = () => { current = null; play_('aim', { fade: 0.12 }); then(); };
}
const crates = [];
function addCrates(n, dist) {
  for (const c of crates) props.remove(c.m); crates.length = 0;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x5c564c, roughness: 0.8, metalness: 0.2 }));
    const a = (i - (n - 1) / 2) * 0.5; m.position.copy(trooper.position).add(new THREE.Vector3(Math.sin(yaw + a) * dist, 0.25, Math.cos(yaw + a) * dist)); m.castShadow = true; props.add(m);
    crates.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), fly: false, pull: false });
  }
}
function jediTick(dt, now) {
  for (const c of crates) {
    if (c.pull) { const hand = trooper.position.clone().add(new THREE.Vector3(Math.sin(yaw) * 0.7, 1.2, Math.cos(yaw) * 0.7)); c.m.position.lerp(hand, Math.min(1, dt * 4)); c.m.rotation.y += dt * 3; if (c.m.position.distanceTo(hand) < 0.1) { c.pull = false; c.fly = true; c.v.set(0, 0, 0); } continue; }
    if (!c.fly) continue;
    c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.spin.x * dt; c.m.rotation.z += c.spin.z * dt;
    if (c.m.position.y < 0.25) { c.m.position.y = 0.25; c.v.multiplyScalar(0.35); c.v.y = Math.abs(c.v.y) * 0.3; c.spin.multiplyScalar(0.5); if (c.v.length() < 0.2) c.fly = false; }
  }
}
// ---------- trooper ----------""")
    # buttons: draw/holster, combo, block, force push/pull
    j = j.replace("$('bRoll').onclick = () => {", """$('bDraw').onclick = () => {
  if (!T || dead) return; resetAll(true); mode = 'scripted'; drone.visible = false;
  if (drawn) { drawn = false; setState('HOLSTER'); current = null; play('S_Saber_Off', 0.5); play_('holster_saber', { loop: false, fade: 0.15 }); onFinish = () => { current = null; play_('idle', { fade: 0.3 }); }; $('bDraw').textContent = 'Draw saber'; }
  else { setState('GUARD'); ensureDrawn(() => {}); $('bDraw').textContent = 'Holster saber'; }
};
$('bCombo').onclick = () => {
  if (!T || dead) return; resetAll(true); mode = 'scripted'; drone.visible = false; const my = seq; setState('ATTACK');
  const MOC = ['saber_strike_01', 'saber_strike_02', 'saber_strike_03', 'saber_strike_04', 'saber_strike_05', 'saber_strike_06'].filter(n => actions[n]);
  const seqc = MOC.length >= 3 ? MOC : ['saber_attack_1', 'saber_attack_2', 'saber_attack_3', 'saber_thrust']; let i = 0;
  const next = () => { if (my !== seq) return; if (i >= seqc.length) { current = null; play_('aim', { fade: 0.2 }); setState('GUARD'); return; }
    const c = seqc[i++]; current = null; play_(c, { loop: false, fade: 0.08 }); const strike = c.startsWith('saber_strike_') ? 14 / 30 : { saber_attack_1: 0.42, saber_attack_2: 0.40, saber_attack_3: 0.50, saber_thrust: 0.38 }[c];
    const mys = seq; setTimeout(() => { if (mys === seq) play('S_Saber_Swing_0' + (1 + Math.floor(Math.random() * 3)), 0.6); }, Math.max(0, strike - 0.16) * 1000); onFinish = next; };
  ensureDrawn(next);
};
$('bBlock').onclick = () => {
  if (!T || dead) return; resetAll(true); mode = 'scripted'; drone.visible = false; const my = seq; setState('BLOCK');
  const seqb = ['saber_block_high', 'saber_block_l', 'saber_block_r']; let i = 0;
  const next = () => { if (my !== seq) return; if (i >= seqb.length) { current = null; play_('aim', { fade: 0.2 }); setState('GUARD'); return; }
    current = null; play_(seqb[i++], { loop: false, fade: 0.08 }); play('S_Saber_Swing_02', 0.35, 1.2); setTimeout(() => { if (my === seq) { play('S_Saber_Clash_Short', 0.5); } }, 140); onFinish = next; };
  ensureDrawn(next);
};
function forceMove(kind) {
  if (!T || dead) return; resetAll(true); mode = 'scripted'; drone.visible = false; const my = seq; setState(kind === 'force_push' ? 'PUSH' : 'PULL');
  addCrates(kind === 'force_push' ? 3 : 1, kind === 'force_push' ? 2.2 : 5.5);
  ensureDrawn(() => {
    const cap = kind === 'force_push' ? 'sw_force_slam_01' : 'sw_force_raise_01'; const clip = actions[cap] ? cap : kind;
    current = null; play_(clip, { loop: false, fade: 0.1 });
    const rel = clip === kind ? (kind === 'force_push' ? 400 : 450) : actions[clip].getClip().duration * 450;   // the capture's release, ~45% in
    setTimeout(() => { if (my !== seq) return; play('S_Explosion', 0.25, 1.8);
      for (const c of crates) { if (kind === 'force_push') { const d = c.m.position.clone().sub(trooper.position).setY(0).normalize(); c.v.copy(d.multiplyScalar(9)).add(new THREE.Vector3(0, 3.5, 0)); c.spin.set(Math.random() * 8, 0, Math.random() * 8); c.fly = true; } else c.pull = true; }
      const rp = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.8, 1.6), transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      rp.position.copy(trooper.position).add(new THREE.Vector3(Math.sin(yaw) * 0.8, 1.35, Math.cos(yaw) * 0.8)); rp.rotation.y = yaw; scene.add(rp); fx.push({ kind: 'ring', obj: rp, t: 0, ttl: 0.5 });
    }, rel);
    onFinish = () => { if (my === seq) { current = null; play_('aim', { fade: 0.2 }); setState('GUARD'); } };
  });
}
$('bPush').onclick = () => forceMove('force_push');
$('bPull').onclick = () => forceMove('force_pull');
const _unusedRoll = () => {""")
    # dying switches the blade off and drops nothing extra; deaths keep the hilt physics baked in the clips
    j = j.replace("function resetAll(keepPos = false) {", "function resetAll(keepPos = false) {\n  if (typeof crates !== 'undefined') { for (const c of crates) props.remove(c.m); crates.length = 0; }")
    j = j.replace("$('bRevive').onclick = () => { resetAll(false); setMode('patrol'); };", "$('bRevive').onclick = () => { resetAll(false); drawn = false; $('bDraw').textContent = 'Draw saber'; setMode('patrol'); };")
    page(h, j, 'jedi.html'); glb(A + '/jedi/Web/trooper_web.glb', 'jedi.glb.b64.txt')
print('site', sorted(os.listdir(D)))
