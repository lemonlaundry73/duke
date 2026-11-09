# Jedi clip set, executed inside anims.py (same namespace: apply/key/new/finish/hold/walkcycle/runcycle/fk_clip/...).
# The lightsaber rests on the belt (right hip, emitter up). draw_saber takes it from the belt and ignites the blade,
# holster_saber switches it off and hangs it back on the belt. Saber combat uses the two-handed guard ('aim').
# Gun frame for the saber: Z = blade (emitter), Y = knuckle side of the grip; matrices are in the torso-at-rest frame.

# ---------------- relaxed hands (saber on the belt) ----------------
HANG = {s: REST[f'hand_{s}'].copy() for s in 'lr'}
for s, sg in (('l', 1), ('r', -1)):
    HANG[s].translation = REST[f'hand_{s}'].translation + V((-sg * 0.02, -0.01, 0.0))
def hang_rel(s, dy=0.0, dz=0.0, dx=0.0, pitch=0.0):
    m = (M.Rotation(R(pitch), 4, 'X') @ HANG[s].to_3x3().to_4x4()); m.translation = HANG[s].translation + V((dx, dy, dz)); return m
HOLSTERED = dict(stance('ready'), holster=1.0, blade=0.0, curlR=0.35, idxR=0.25, curlL=0.35,
                 handL_rel=hang_rel('l'), handR_rel=hang_rel('r'), handL_k=0.0, handR_k=0.0)
FE_STAND = {'l': foot_mat('l', (0.0, -0.03, 0), yaw=6), 'r': foot_mat('r', (0.0, 0.02, 0), yaw=-8)}

def sway(t, secs):
    ph = 2 * math.pi * t / secs; return math.sin(ph), math.cos(ph)
# idle: breathing, a slow weight shift, hands hanging relaxed
def idle_keys(secs):
    ks = []
    for i in range(int(secs * 10) + 1):
        t = i / 10; a, b = sway(t, secs); br = math.sin(2 * math.pi * t / (secs / 1.0))
        d = dict(HOLSTERED); d['s2p'] += 1.0 * br; d['s3p'] += 0.8 * br; d['px'] = 0.012 * a; d['pr'] = -1.5 * a; d['s2r'] = 1.0 * a
        d['hy'] = 4 * math.sin(2 * math.pi * t / secs * 0.5); d['handL_rel'] = hang_rel('l', dy=0.006 * b, dz=0.004 * br); d['handR_rel'] = hang_rel('r', dy=-0.006 * b, dz=0.004 * br)
        ks.append((t, d))
    return ks
hold('idle', 4.0, idle_keys(4.0), feetfn=lambda t: FE_STAND, notes='Jedi idle: lightsaber on the belt (right hip), hands relaxed, breathing, slow weight shift. Loop.')
hold('patrol_look', 6.0, [(0, HOLSTERED), (1.0, dict(HOLSTERED, s2y=12, s3y=10, ny=14, hy=16)), (2.2, dict(HOLSTERED, s2y=12, s3y=10, ny=14, hy=16)),
     (3.4, dict(HOLSTERED, s2y=-12, s3y=-10, ny=-14, hy=-18)), (4.6, dict(HOLSTERED, s2y=-12, s3y=-10, ny=-14, hy=-18)), (6.0, HOLSTERED)],
     feetfn=lambda t: FE_STAND, notes='Looks around, saber on the belt. Loop.')

# ---------------- locomotion with free arm swing ----------------
def swing(amp, lift, bend, lag=0.05, inward=0.03):
    def ex(p, d):
        d.update(holster=1.0, blade=0.0, curlR=0.4, idxR=0.3, curlL=0.4, handL_k=0.0, handR_k=0.0)
        c = math.cos(2 * math.pi * (p - lag))   # +1: right arm forward (left leg forward at p=0)
        for s, sg, k in (('r', -1, c), ('l', 1, -c)):
            fwd = max(0.0, k)
            d[f'hand{s.upper()}_rel'] = hang_rel(s, dy=-amp * k, dz=lift * (1 - math.cos(math.pi * fwd)) / 2 + bend * fwd, dx=-sg * inward * fwd, pitch=-18 * fwd * (bend > 0.05) )
    return ex
walkcycle('walk', 1.08, 1.3, (0, -1), 'ready', s=0.61, lift=0.16, bob=0.021, cycles=2, lean=3.0, scan=8, gun=0.0, heelrise=42, reach=0.982, hipyaw=7, hiplist=5, body=1.3,
          extra=swing(0.11, 0.03, 0.02), notes='Jedi walk: saber on the belt, natural arm swing opposite the legs, heel-to-toe roll, spring-driven trunk. 1.3 m/s.')
walkcycle('walk_limp', 1.25, 0.9, (0, -1), 'ready', s=0.62, lift=0.09, reach=0.975, bob=0.012, cycles=1, lean=4, gun=0.0, injured='r', extra=swing(0.05, 0.01, 0.0),
          notes='Injured (right foot): limping walk, saber on the belt. 0.9 m/s.')
def pump(amp, base_dz, up):
    def ex(p, d):
        d.update(holster=1.0, blade=0.0, curlR=0.85, idxR=0.8, curlL=0.85, handL_k=0.0, handR_k=0.0)
        c = math.cos(2 * math.pi * (p - 0.04))
        for s, sg, k in (('r', -1, c), ('l', 1, -c)):
            pos = HANG[s].translation + V((-sg * 0.05, -amp * k - 0.05, base_dz + up * max(0.0, k)))
            d[f'hand{s.upper()}_rel'] = hand_orient(s, (0, -1, -0.35 + 0.5 * max(0.0, k)), (-sg, 0, 0), tuple(pos))
    return ex
runcycle('run', 0.70, 4.2, 0.30, 'ready', {}, bias=0.12, heel=0.30, bob=0.035, lean=10, strike='mid', yawamp=8, listamp=4, gun=0.0, cape=0, extra=pump(0.17, 0.16, 0.10),
         notes='Jedi run: arms bent and pumping, saber on the belt, midfoot landing, flight phase. 4.2 m/s.')
runcycle('sprint', 0.62, 6.2, 0.24, 'ready', {}, bias=0.06, heel=0.44, bob=0.04, lean=18, strike='fore', yawamp=10, listamp=5, gun=0.0, cape=0, extra=pump(0.24, 0.18, 0.16),
         notes='Jedi sprint: strong arm drive, saber on the belt, forefoot landing. 6.2 m/s.')

# ---------------- draw / holster ----------------
GUARD = K.gun_matrix(GUN['aim']['gpos'], GUN['aim']['gyaw'], GUN['aim']['gpitch'], GUN['aim']['groll'])
AIMB = stance('aim')
def belt_rest_now():
    """the belt hilt matrix expressed in the torso-at-rest frame for the current pose"""
    bpy.context.view_layer.update(); CH_ = P['spine_03'].matrix @ REST['spine_03'].inverted()
    return CH_.inverted() @ belt_world()
def body_mix(a, b, u):
    out = dict(a)
    for k_, v_ in b.items():
        va = a.get(k_)
        if isinstance(v_, (int, float)) and isinstance(va, (int, float)): out[k_] = va + (v_ - va) * u
    return out
def draw_like(name, dur, reverse, notes):
    new(name, lhand_on=0); N = round(dur * FPS)
    for f in range(N + 1):
        t = f / FPS; u = t / dur
        if reverse: u = 1 - u
        # u: 0 = on the belt, hands free ... 1 = guard, blade lit
        reach = ss(u / 0.25)                  # right hand goes to the hilt
        lift = ss((u - 0.25) / 0.45)          # hilt travels belt -> guard
        lh = ss((u - 0.62) / 0.22)            # left hand joins the grip
        ign = ss((u - 0.70) / 0.14)           # blade ignites
        d = body_mix(HOLSTERED, AIMB, lift)
        d.update(blade=ign, holster=1.0 if lift <= 0.0 else 0.0, curlR=0.35 + 0.65 * reach, idxR=0.25 + 0.75 * reach, curlL=0.35 + 0.65 * lh)
        d['handR_rel'] = hang_rel('r'); d['handR_k'] = reach
        if CFG.get('saber_hands', 2) == 1 and AIMB.get('handL_rel') is not None:   # one-handed: the left hand goes to its balance pose
            d['handL_rel'] = mat_lerp(hang_rel('l'), AIMB['handL_rel'], lift); d['handL_k'] = 0.0
        else:
            d['handL_rel'] = hang_rel('l'); d['handL_k'] = lh
        apply(dict(d, gmat=None), FE_STAND)          # pose the body first (belt follows the pelvis)
        B = belt_rest_now()
        G = mat_lerp(B, GUARD, lift)
        G.translation += V((0.0, -0.06, 0.05)) * math.sin(math.pi * lift)   # arc out and up
        d['gmat'] = G if lift >= 0.999 else G
        d['no_clamp'] = lift < 0.5
        fe = {s: mat_lerp(FE_STAND[s], FE_AIM[s], lift) for s in 'lr'}
        apply(d, fe); key(f)
    finish(name, N, False, 0, notes)
draw_like('draw_saber', 1.3, False, 'Takes the lightsaber from the belt (right hip), brings it up, ignites the blade (0.9-1.1 s) and settles into the two-handed guard.')
draw_like('holster_saber', 1.3, True, 'Switches the blade off, lowers the hilt and hangs it back on the belt (right hip), hands relaxed.')
# 'aim' (inherited from the trooper set) is the guard idle: the saber stance replaces the rifle stance

# ---------------- saber combat ----------------
def bdir(deg_pitch, deg_yaw, deg_roll=0.0):
    """blade direction from guard-like angles: pitch tilts forward (+), yaw turns left (+), roll tilts to the character's left (+)"""
    v = V((0, 0, 1)); v = M.Rotation(R(deg_pitch), 3, 'X') @ v   # +pitch: blade tips toward -Y (forward); v = M.Rotation(R(deg_roll), 3, 'Y') @ v; v = M.Rotation(R(deg_yaw), 3, 'Z') @ v
    return tuple(v)
def saber_clip(name, dur, keys, notes, feet_keys=None, loop=False):
    """keys: [(t, pos, blade_dir, knuckle_hint, body_dict)] - hilt path interpolated smoothly, orientation slerped"""
    new(name, lhand_on=1); N = round(dur * FPS)
    if CFG.get('saber_hands', 2) == 1:
        # one-handed form: swing paths toward the sword side and a little forward, so the forearm stays off the chest
        sx, sy = CFG.get('saber_path_shift', [-0.08, -0.04])
        keys = [(k[0], k[1] if k[1] is GP else (k[1][0] + sx, k[1][1] + sy, k[1][2]), k[2], k[3], k[4]) for k in keys]
    mats = [(k[0], gmat(k[1], k[2], k[3]), k[4]) for k in keys]
    for f in range(N + 1):
        t = f / FPS
        i = max(j for j in range(len(mats)) if mats[j][0] <= t + 1e-9) if t >= mats[0][0] else 0
        j = min(i + 1, len(mats) - 1); t0, A, ba = mats[i]; t1, B, bb = mats[j]
        u = ss((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
        G = mat_lerp(A, B, u)
        # swings arc out away from the body between keys (a straight line between two poses would cut across the belly)
        mid = G.translation.copy(); away = V((mid.x, mid.y - 0.06, 0.0))
        if away.length > 1e-4: G.translation = mid + away.normalized() * 0.09 * math.sin(math.pi * u) * (1.0 if t1 > t0 else 0.0)
        d = body_mix(dict(AIMB, **ba), dict(AIMB, **bb), u)
        d['gmat'] = G
        fe = FE_AIM
        if feet_keys:
            fk = env(t, feet_keys)
            fe = {'l': foot_mat('l', (0.02 + fk.get('lx', 0), -0.12 + fk.get('ly', 0), 0), yaw=8 + fk.get('lyaw', 0)),
                  'r': foot_mat('r', (-0.04 + fk.get('rx', 0), 0.12 + fk.get('ry', 0), 0), yaw=-25 + fk.get('ryaw', 0), pitch=fk.get('rp', 0), pivot='ball')}
        apply(d, fe); key(f)
    finish(name, N, loop, 0, notes)
GP = GUN['aim']['gpos']; GB = bdir(-GUN['aim']['gpitch'], GUN['aim']['gyaw']); KN = (0, -1, 0)
# 1: forehand diagonal slash - wind up over the right shoulder, cut down across to the left hip
saber_clip('saber_attack_1', 0.95, [
    (0.00, GP, GB, KN, {}),
    (0.24, (-0.20, -0.16, 1.40), bdir(-25, -30, -25), (0.3, -0.6, 0.6), dict(s2y=-14, s3y=-10, pyw=4, pz=-0.04)),
    (0.42, (-0.02, -0.42, 1.20), bdir(85, 25, 20), (0.6, -0.2, 0.5), dict(s2y=10, s3y=8, pyw=20, pz=-0.09, s2p=8)),
    (0.56, (0.00, -0.46, 0.92), bdir(125, 60, 45), (0.4, 0.2, -0.6), dict(s2y=16, s3y=10, pyw=24, pz=-0.10, s2p=12)),   # follow-through down in front of the left knee (arm extended, off the body)
    (0.72, (-0.08, -0.48, 1.12), bdir(60, 20, 20), (0.2, -0.6, 0.4), dict(s2y=8, s3y=6, pyw=14, pz=-0.08, s2p=6)),     # recovers out in front, not back across the belly
    (0.95, GP, GB, KN, {})],
    'Forehand diagonal slash: wind-up over the right shoulder, cuts down and across, finishing low in front, back to guard. Strike at 0.42 s.',
    feet_keys=[(0, {}), (0.3, {'ly': -0.10}), (0.5, {'ly': -0.22, 'ry': -0.06}), (0.95, {})])
# 2: backhand rising slash - low left to high right
saber_clip('saber_attack_2', 0.9, [
    (0.00, GP, GB, KN, {}),
    (0.22, (-0.24, -0.34, 0.98), bdir(135, -40, -30), (-0.3, -0.4, -0.8), dict(s2y=-10, s3y=-6, pyw=2, pz=-0.08)),   # blade low behind on the sword side
    (0.40, (-0.08, -0.46, 1.24), bdir(60, 20, 35), (0.4, -0.4, 0.6), dict(s2y=4, s3y=4, pyw=12, pz=-0.06, s2p=5)),
    (0.55, (0.02, -0.40, 1.48), bdir(-15, 40, 50), (0.5, 0.1, 0.5), dict(s2y=10, s3y=8, pyw=14, pz=-0.04)),
    (0.90, GP, GB, KN, {})],
    'Rising slash (one-handed): from low on the sword side up and across to high on the left. Strike at 0.40 s.',
    feet_keys=[(0, {}), (0.35, {'ly': -0.12, 'lx': 0.04}), (0.9, {})])
# 3: overhead strike - raise the blade above and behind the head, chop straight down in front
saber_clip('saber_attack_3', 1.05, [
    (0.00, GP, GB, KN, {}),
    (0.30, (-0.04, -0.08, 1.62), bdir(-40, 0), (0, -0.4, 0.9), dict(s2p=-6, s3p=-6, hp=-6, pz=-0.02)),
    (0.48, (-0.03, -0.44, 1.30), bdir(80, 0), (0, 0.3, 0.9), dict(s2p=6, s3p=4, hp=6, pz=-0.10, pp=5)),
    (0.60, (-0.03, -0.50, 1.00), bdir(115, 0), (0, 0.6, 0.6), dict(s2p=8, s3p=4, hp=8, pz=-0.14, pp=6)),   # finishes out in front
    (1.05, GP, GB, KN, {})],
    'Overhead strike: raises the blade above the head and chops straight down in front with a lunge. Strike at 0.50 s.',
    feet_keys=[(0, {}), (0.35, {'ly': -0.05}), (0.55, {'ly': -0.30, 'ry': -0.10, 'rp': 15}), (1.05, {})])
# thrust: draw back to the right hip, stab forward
saber_clip('saber_thrust', 0.8, [
    (0.00, GP, GB, KN, {}),
    (0.22, (-0.14, -0.10, 1.10), bdir(88, 0), (0, 0, -1), dict(s2y=-12, pyw=0, pz=-0.06)),
    (0.38, (-0.04, -0.58, 1.20), bdir(90, 4), (0, 0, -1), dict(s2y=6, pyw=16, pz=-0.12, s2p=8)),
    (0.80, GP, GB, KN, {})],
    'Thrust: pulls the hilt back to the right hip and stabs straight forward with a lunge. Hit at 0.38 s.',
    feet_keys=[(0, {}), (0.38, {'ly': -0.28, 'ry': -0.08, 'rp': 18}), (0.8, {})])
# blocks: high (blade horizontal above the head), left and right (blade upright beside the body)
for nm, pos, bd, hint, body in (('saber_block_high', (-0.03, -0.28, 1.58), bdir(90, -80), (0, -0.3, -1), dict(hp=-4, s3p=-4)),
                                ('saber_block_l', (0.04, -0.42, 1.26), bdir(5, 0, 12), (0, -1, 0), dict(s2y=14, s3y=10, pyw=10)),
                                ('saber_block_r', (-0.18, -0.30, 1.22), bdir(5, 0, -14), (0, -1, 0), dict(s2y=-14, s3y=-10, pyw=6))):
    saber_clip(nm, 0.7, [(0.0, GP, GB, KN, {}), (0.14, pos, bd, hint, body), (0.42, pos, bd, hint, body), (0.70, GP, GB, KN, {})],
               f'Lightsaber block ({nm.split("_")[-1]}): snaps into the block at 0.14 s, holds, back to guard.')
# bolt deflections: quick flick that meets a bolt at chest height and bats it away
for nm, pos, bd, hint, body in (('saber_deflect_l', (0.08, -0.40, 1.30), bdir(30, 35, 30), (0.5, -0.8, 0), dict(s2y=12, s3y=8, pyw=8)),
                                ('saber_deflect_r', (-0.16, -0.40, 1.30), bdir(30, -35, -30), (-0.5, -0.8, 0), dict(s2y=-12, s3y=-8, pyw=6)),
                                ('saber_deflect_high', (-0.04, -0.36, 1.50), bdir(10, 0, 30), (0, -1, 0), dict(s3p=-4, hp=-4))):
    saber_clip(nm, 0.45, [(0.0, GP, GB, KN, {}), (0.10, pos, bd, hint, body), (0.20, pos, bd, hint, body), (0.45, GP, GB, KN, {})],
               f'Blaster-bolt deflection ({nm.split("_")[-1]}): the blade meets the bolt at 0.10 s and bats it away, back to guard.')

# ---------------- the Force ----------------
def force_clip(name, dur, tl, notes):
    new(name, lhand_on=0); N = round(dur * FPS)
    for f in range(N + 1):
        t = f / FPS; d, fe = tl(t); apply(d, fe); key(f)
    finish(name, N, False, 0, notes)
ONEH = dict(AIMB, gmat=K.gun_matrix((-0.27, -0.22, 1.08), 10, -110, -10))   # saber held low in the right hand
def push_tl(t):
    reach = ss((t - 0.25) / 0.15) * (1 - ss((t - 0.85) / 0.35)); wind = ss(t / 0.25) * (1 - ss((t - 0.30) / 0.1))
    d = dict(ONEH, handL_k=0.0, curlL=0.05 * reach + 0.3 * (1 - reach), fingL=(0.05, 0.05, 0.08, 0.1, 0.2) if reach > 0.05 else None)
    pw = V((0.30, -0.14 + 0.04 * wind, 1.28)).lerp(V((0.14, -0.62, 1.42)), reach)   # starts out from the chest
    d['handL_rel'] = hand_orient('l', (0.05, -0.25 * reach, 1), (-0.15, -1, 0.1), tuple(pw))
    d.update(s2y=10 * reach - 8 * wind, s3y=8 * reach - 6 * wind, pyw=8 * reach, s2p=4 + 6 * reach - 4 * wind, pz=-0.04 - 0.05 * reach, hp=4)
    fe = {'l': foot_mat('l', (0.02, -0.12 - 0.14 * reach, 0), yaw=8), 'r': foot_mat('r', (-0.04, 0.12, 0), yaw=-25)}
    return d, fe
force_clip('force_push', 1.3, push_tl, 'Force push: draws the left hand back, then thrusts the open palm forward (peak 0.40 s), saber low in the right hand.')
def pull_tl(t):
    out_ = ss(t / 0.3); grab = ss((t - 0.4) / 0.12); back = ss((t - 0.5) / 0.35) * (1 - ss((t - 1.05) / 0.3))
    d = dict(ONEH, handL_k=0.0)
    pw = V((0.30, -0.14, 1.25)).lerp(V((0.16, -0.60, 1.40)), out_).lerp(V((0.28, -0.24, 1.32)), back)
    if t > 1.05: pw = pw.lerp(V((0.30, -0.14, 1.25)), ss((t - 1.05) / 0.3))
    d['handL_rel'] = hand_orient('l', (0.05, -0.4, 1), (-0.1, -1, 0.1), tuple(pw))
    d['fingL'] = (0.1 + 0.85 * grab, 0.1 + 0.85 * grab, 0.12 + 0.85 * grab, 0.15 + 0.8 * grab, 0.2 + 0.6 * grab)
    d.update(s2y=6 * out_ - 10 * back, s3y=5 * out_ - 6 * back, s2p=4 + 4 * out_ - 6 * back, pz=-0.04 - 0.03 * out_, hp=4)
    fe = {'l': foot_mat('l', (0.02, -0.12 - 0.08 * out_ + 0.06 * back, 0), yaw=8), 'r': foot_mat('r', (-0.04, 0.12, 0), yaw=-25)}
    return d, fe
force_clip('force_pull', 1.4, pull_tl, 'Force pull: reaches out with the left hand, closes the fist on the target (0.45 s) and pulls it in.')

# run with the blade lit: saber trailing low in the right hand, the left arm pumping
def saber_run_extra(p, d):
    d.update(holster=0.0, blade=1.0, curlL=0.85, handL_k=0.0)
    c = math.cos(2 * math.pi * (p - 0.04)); k = -c
    pos = HANG['l'].translation + V((-0.05, -0.17 * k - 0.05, 0.16 + 0.10 * max(0.0, k)))
    d['handL_rel'] = hand_orient('l', (0, -1, -0.35 + 0.5 * max(0.0, k)), (-1, 0, 0), tuple(pos))
runcycle('saber_run', 0.70, 4.2, 0.30, 'sprint', {}, bias=0.12, heel=0.30, bob=0.035, lean=12, strike='mid', yawamp=7, listamp=4, gun=0.6, cape=0, extra=saber_run_extra,
         notes='Run with the lightsaber lit, blade trailing low in the right hand, left arm pumping. 4.2 m/s.')
