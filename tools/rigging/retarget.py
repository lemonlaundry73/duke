# Motion-capture retargeting onto the Duke skeleton. Executed inside anims.py (same namespace: ao, P, REST, K, FPS, STATS,
# CFG, ROLE, SABER, BELT_REST, back_gun_matrix ...) after the procedural clips exist.
# Sources: assets/animations/source (PROVENANCE.json, library.json)
#   Universal Animation Library (Quaternius, CC0): UE-mannequin bone names, one move per clip
#   Mixamo takes ('mixamorig:' bones) and HumanIK takes ('Character1_' bones): long performances, cut into moves at pauses
# Method: each source bone's world rotation relative to a reference pose is applied to the Duke bone's rest rotation.
# The reference pose is the source rest pose with each bone swung (minimal rotation) to point where the matching Duke rest
# bone points, so T-pose sources land on the A-posed Duke rest. Hip height is scaled by leg length; travel goes on the
# root bone (Unreal root motion); loops are made in place.
import bpy, os, json, math
import numpy as np
from mathutils import Vector as V, Matrix as M, Quaternion as Q

REPO = os.path.abspath(os.path.join(sys.argv[-2], '..', '..'))
ASRC = os.path.join(REPO, 'assets', 'animations', 'source')
DUKE_FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')

def bone_map(names):
    out = {}
    low = {n.lower(): n for n in names}
    if 'pelvis' in low and 'spine_01' in low:                      # UE mannequin naming (UAL)
        return {n: n.lower() for n in names if n.lower() in P and not n.lower().startswith(('ik_', 'root'))}
    pre = next((n[:-4] for n in names if n.endswith('Hips')), None)
    if pre is None: return out
    table = {'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine1': 'spine_02', 'Spine2': 'spine_03', 'Neck': 'neck_01', 'Head': 'head'}
    for s, sd in (('Left', 'l'), ('Right', 'r')):
        table.update({f'{s}Shoulder': f'clavicle_{sd}', f'{s}Arm': f'upperarm_{sd}', f'{s}ForeArm': f'lowerarm_{sd}', f'{s}Hand': f'hand_{sd}',
                      f'{s}UpLeg': f'thigh_{sd}', f'{s}Leg': f'calf_{sd}', f'{s}Foot': f'foot_{sd}', f'{s}ToeBase': f'ball_{sd}'})
        for f_, d_ in (('Thumb', 'thumb'), ('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
            for i in (1, 2, 3): table[f'{s}Hand{f_}{i}'] = f'{d_}_0{i}_{sd}'
    for n in names:
        k = n[len(pre):]
        if k in table and table[k] in P: out[n] = table[k]
    if pre + 'Spine3' in names:   # HumanIK with four spine joints: the top one drives spine_03
        out = {k: v for k, v in out.items() if v != 'spine_03'}; out[pre + 'Spine3'] = 'spine_03'
    return out

DR = {b: REST[b].copy() for b in REST}
DUKE_CHILD = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'head',
              'clavicle_l': 'upperarm_l', 'upperarm_l': 'lowerarm_l', 'lowerarm_l': 'hand_l', 'hand_l': 'middle_01_l',
              'clavicle_r': 'upperarm_r', 'upperarm_r': 'lowerarm_r', 'lowerarm_r': 'hand_r', 'hand_r': 'middle_01_r'}
for sd in 'lr':
    DUKE_CHILD.update({f'thigh_{sd}': f'calf_{sd}', f'calf_{sd}': f'foot_{sd}', f'foot_{sd}': f'ball_{sd}'})
    for f_ in DUKE_FINGERS: DUKE_CHILD[f'{f_}_01_{sd}'] = f'{f_}_02_{sd}'; DUKE_CHILD[f'{f_}_02_{sd}'] = f'{f_}_03_{sd}'
def duke_dir(b):
    c = DUKE_CHILD.get(b)
    if c and c in DR: return (DR[c].translation - DR[b].translation).normalized()
    return (DR[b].to_3x3() @ V((0, 1, 0))).normalized()
DUKE_ORDER = [pb.name for pb in ao.pose.bones]
PARENT = {pb.name: (pb.parent.name if pb.parent else None) for pb in ao.pose.bones}
LEG_LEN = (DR['thigh_l'].translation - DR['calf_l'].translation).length + (DR['calf_l'].translation - DR['foot_l'].translation).length
LOWER = {'pelvis', 'spine_01', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'}

class Source:
    """one imported source file; sampled in its own scene so the Duke character is not evaluated while sampling"""
    def __init__(self, path):
        before_o = set(bpy.data.objects); before_a = set(bpy.data.actions)
        main = bpy.context.scene
        fps0 = main.render.fps; main.render.fps = FPS            # importers place keys at the scene's frame rate
        if path.lower().endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
        else: bpy.ops.import_scene.gltf(filepath=path)
        self.fps = main.render.fps / main.render.fps_base      # the FBX importer may switch to the file's own rate (HumanIK: 100)
        main.render.fps = fps0; main.render.fps_base = 1.0
        self.objs = [o for o in bpy.data.objects if o not in before_o]
        # move the take into its own scene: sampling it then never evaluates the Duke character
        self.scene = bpy.data.scenes.new('retarget_src'); self.scene.render.fps = FPS
        for o in self.objs:
            for c in list(o.users_collection): c.objects.unlink(o)
            self.scene.collection.objects.link(o)
        self.arm = next(o for o in self.objs if o.type == 'ARMATURE')
        self.actions = {a.name: a for a in bpy.data.actions if a not in before_a}
        self.map = bone_map([b.name for b in self.arm.data.bones]); self.inv = {v: k for k, v in self.map.items()}
        self.hips = self.inv['pelvis']
        self.arm.animation_data_create(); self.arm.animation_data.action = None
        for tr in list(self.arm.animation_data.nla_tracks): self.arm.animation_data.nla_tracks.remove(tr)   # glTF puts every clip on NLA tracks
        with bpy.context.temp_override(scene=self.scene, view_layer=self.scene.view_layers[0]):
            bpy.context.evaluated_depsgraph_get(); self.scene.frame_set(0)
        mw = self.arm.matrix_world
        rest = {b.name: (mw @ b.matrix_local) for b in self.arm.data.bones}
        self.ref = {}
        for sb, db in self.map.items():
            dc = DUKE_CHILD.get(db); scb = self.inv.get(dc) if dc else None
            d = (rest[scb].translation - rest[sb].translation) if scb else (rest[sb].to_3x3() @ V((0, 1, 0)))
            self.ref[sb] = d.normalized().rotation_difference(duke_dir(db)) @ rest[sb].to_quaternion()
        th, ca, fo = (self.inv.get(k) for k in ('thigh_l', 'calf_l', 'foot_l'))
        sl = (rest[th].translation - rest[ca].translation).length + (rest[ca].translation - rest[fo].translation).length
        self.scale = LEG_LEN / max(sl, 1e-4)
        self.rest_hips_z = rest[self.hips].translation.z
    def take(self, action):
        self.arm.animation_data.action = action; r = action.frame_range; return int(r[0]), int(r[1])
    def sample(self, f):
        # the take's scene is not the context scene: evaluate it under an override (otherwise the pose never updates)
        with bpy.context.temp_override(scene=self.scene, view_layer=self.scene.view_layers[0]):
            self.scene.frame_set(int(f), subframe=float(f - int(f))); bpy.context.evaluated_depsgraph_get().update()
        mw = self.arm.matrix_world
        return {sb: (mw @ self.arm.pose.bones[sb].matrix) for sb in self.map}
    def close(self):
        for o in self.objs: bpy.data.objects.remove(o, do_unlink=True)
        for a in self.actions.values(): bpy.data.actions.remove(a)
        bpy.data.scenes.remove(self.scene)

def frame_poses(src, frames):
    """sample source frames -> per frame: Duke armature-space rotations, pelvis position (character frame, start at origin)"""
    s0 = src.sample(frames[0])
    o = s0[src.hips].translation.copy()
    th_l, th_r = src.inv.get('thigh_l'), src.inv.get('thigh_r')
    side = s0[th_l].translation - s0[th_r].translation; side.z = 0; side.normalize()    # performer's left
    yaw = math.atan2(side.y, side.x)                                                      # Duke: left = +X
    Rz = M.Rotation(-yaw, 4, 'Z'); T0 = M.Translation(V((-o.x, -o.y, 0)))
    out = []
    for f in frames:
        sm = src.sample(f); rot = {}
        for sb, db in src.map.items():
            w = Rz @ T0 @ sm[sb]
            rot[db] = (w.to_quaternion() @ src.ref[sb].inverted()) @ DR[db].to_quaternion()
        hp = (Rz @ T0 @ sm[src.hips]).translation
        out.append((rot, V((hp.x * src.scale, hp.y * src.scale, hp.z * src.scale))))
    return out

def solve(rot, pel, trav, yaw=0.0):
    """armature-space rotations + pelvis position -> pose-bone basis matrices (parents first) and world matrices"""
    root_w = M.Translation(trav) @ M.Rotation(yaw, 4, 'Z') @ DR['root']
    world = {'root': root_w}; basis = {'root': DR['root'].inverted() @ root_w}
    for b in DUKE_ORDER:
        if b == 'root': continue
        par = PARENT[b]
        pw = world[par] if par else M.Identity(4)
        rr = (DR[par].inverted() @ DR[b]) if par else DR[b]
        base = pw @ rr
        if b in rot:
            W = rot[b].to_matrix().to_4x4(); W.translation = (V((pel.x, pel.y, pel.z)) if b == 'pelvis' else base.translation)
            world[b] = W; basis[b] = base.inverted() @ W
        else:
            world[b] = base
    return basis, world

def write_action(name, frames_basis, loop, speed, notes, ik_on=(), weapon=None):
    """frames_basis: list of (basis dict, world dict) -> new action, written straight into f-curves"""
    if name in bpy.data.actions: bpy.data.actions.remove(bpy.data.actions[name])
    act = bpy.data.actions.new(name); act.use_fake_user = True; n = len(frames_basis)
    def curve(path, idx, vals, grp):
        fc = act.fcurves.new(path, index=idx, action_group=grp)
        fc.keyframe_points.add(len(vals)); co = np.empty(2 * len(vals)); co[0::2] = np.arange(len(vals)); co[1::2] = vals
        fc.keyframe_points.foreach_set('co', co)
        fc.keyframe_points.foreach_set('interpolation', [1] * len(vals))   # LINEAR: every frame is keyed
        fc.update()
    bones = set()
    for bs, _ in frames_basis: bones.update(bs.keys())
    for b in bones:
        qs = np.array([list(frames_basis[i][0][b].to_quaternion()) if b in frames_basis[i][0] else [1, 0, 0, 0] for i in range(n)])
        for i in range(1, n):
            if np.dot(qs[i], qs[i - 1]) < 0: qs[i] = -qs[i]
        for k in range(4): curve(f'pose.bones["{b}"].rotation_quaternion', k, qs[:, k], b)
        if b in ('pelvis', 'root', 'weapon_r', 'ctrl_gun', 'ctrl_hand_l', 'ctrl_hand_r', 'ctrl_foot_l', 'ctrl_foot_r'):
            ls = np.array([list(frames_basis[i][0][b].translation) if b in frames_basis[i][0] else [0, 0, 0] for i in range(n)])
            for k in range(3): curve(f'pose.bones["{b}"].location', k, ls[:, k], b)
    for b in K.LIMB_CONSTRAINT_BONES:
        on = any(b.endswith(s) and b.startswith(p) for p in ik_on for s in ('_l', '_r')) if ik_on else False
        for c in P[b].constraints:
            curve(f'pose.bones["{b}"].constraints["{c.name}"].influence', 0, np.ones(n) if on else np.zeros(n), b)
    if 'blade' in P:
        bl = weapon.get('blade', 0.0) if weapon else 0.0
        s_ = max(0.001, bl); xz = 0.25 + 0.75 * min(1.0, s_ * 5)
        for k, v in ((0, xz), (1, s_), (2, xz)): curve('pose.bones["blade"].scale', k, np.full(n, v), 'blade')
    act.frame_range = (0, n - 1); act.use_frame_range = True
    act['loop'] = loop; act['speed_cm_s'] = speed * 100; act['notes'] = notes; act['dir'] = (0, -1); act['lhand_on'] = 0; act['mocap'] = True
    STATS[name] = dict(frames=n - 1, seconds=round((n - 1) / FPS, 3), loop=loop, speed_m_s=round(speed, 3), max_hand_gap_cm=0.0,
                       max_foot_gap_cm=0.0, planted_foot_slip_cm_s=0, notes=notes)
    return act

def weapon_basis(world, mode):
    """lightsaber on the belt (Jedi) / blaster slung on the back (troopers) while the hands are busy"""
    if mode == 'belt': want = world['pelvis'] @ DR['pelvis'].inverted() @ BELT_REST
    else: want = world['spine_03'] @ DR['spine_03'].inverted() @ back_gun_matrix()
    base = world['hand_r'] @ (DR['hand_r'].inverted() @ DR['weapon_r'])
    return base.inverted() @ want

def bake(src, action, f0, f1, name, loop=False, in_place=False, notes='', weapon_mode=None, hybrid=None, yaw_root=False):
    """bake source frames f0..f1 onto the Duke skeleton. hybrid: name of a procedural clip whose upper body (arms on the
    rifle, chest, head) is kept while the legs, hips and lower spine come from the capture"""
    src.take(action)
    frames = list(np.arange(f0, f1 + 1e-6, src.fps / FPS))   # one Duke frame (1/30 s) per sample, at the source's rate
    fp = frame_poses(src, frames)
    p0 = fp[0][1].copy(); p1 = fp[-1][1]; n = len(fp); dur = max((n - 1) / FPS, 1e-3)
    drift = V((p1.x - p0.x, p1.y - p0.y, 0.0))
    out = []; feet = []
    for i, (rot, pel) in enumerate(fp):
        u = i / max(n - 1, 1)
        if in_place: trav = V((0, 0, 0)); pelw = V((DR['pelvis'].translation.x + pel.x - p0.x - drift.x * u, DR['pelvis'].translation.y + pel.y - p0.y - drift.y * u, pel.z))
        else: trav = V((pel.x - p0.x, pel.y - p0.y, 0.0)); pelw = V((DR['pelvis'].translation.x + pel.x - p0.x, DR['pelvis'].translation.y + pel.y - p0.y, pel.z))
        if hybrid: rot = {k: v for k, v in rot.items() if k in LOWER}
        if yaw_root:
            # turn in place: the heading goes on the root (Unreal root motion turns the actor, the body follows)
            rel = rot['pelvis'] @ DR['pelvis'].to_quaternion().inverted(); vx = rel @ V((1, 0, 0)); yaw = math.atan2(vx.y, vx.x)
            basis, world = solve(rot, pelw, trav, yaw)
        else:
            basis, world = solve(rot, pelw, trav)
        if weapon_mode: basis['weapon_r'] = weapon_basis(world, weapon_mode)
        feet.append((world['foot_l'].translation.copy(), world['foot_r'].translation.copy()))
        out.append((basis, world))
    # speed: how fast the planted foot moves under the body (in-place loops) or the root travel (takes)
    if in_place:
        sp = []
        for i in range(1, n):
            k = 0 if feet[i][0].z < feet[i][1].z else 1
            d = feet[i][k] - feet[i - 1][k]; sp.append(math.hypot(d.x, d.y) * FPS)
        speed = float(np.median(sp)) if sp else 0.0
    else: speed = drift.length / dur
    if hybrid and hybrid in bpy.data.actions:
        # keep the procedural upper body: copy its curves (time-warped to the capture length), then lay the capture's
        # lower body over it (legs FK, arms still IK on the rifle)
        pa = bpy.data.actions[hybrid]; pa.name = hybrid + '__proc'; pn = pa.frame_range[1]
        act = write_action(name, out, loop, speed, notes, ik_on=('lowerarm', 'hand'))
        have = {(fc.data_path, fc.array_index) for fc in act.fcurves}
        for fc in pa.fcurves:
            key_ = (fc.data_path, fc.array_index)
            bn = fc.data_path.split('"')[1] if '"' in fc.data_path else ''
            if bn in LOWER or bn in ('root',) or key_ in have and not fc.data_path.startswith('pose.bones["ctrl'): continue
            if 'constraints' in fc.data_path: continue
            nf = act.fcurves.new(fc.data_path, index=fc.array_index, action_group=bn or 'misc')
            vals = [fc.evaluate(i * pn / max(n - 1, 1)) for i in range(n)]
            nf.keyframe_points.add(n); co = np.empty(2 * n); co[0::2] = np.arange(n); co[1::2] = vals; nf.keyframe_points.foreach_set('co', co); nf.update()
        act['lhand_on'] = pa.get('lhand_on', 1)
        bpy.data.actions.remove(pa)
        return act, speed
    return write_action(name, out, loop, speed, notes, weapon={'blade': 0.0} if weapon_mode else None), speed

def segments(src, action, min_still=1.0, min_len=0.5, step=None):
    """moves within a long take: runs of motion separated by >= min_still seconds of stillness (source frames)"""
    f0, f1 = src.take(action); hp = []; qs = []
    step = max(1, int(round(2 * src.fps / FPS)))          # ~1/15 s
    sfps = src.fps
    for f in range(f0, f1 + 1, step):
        sm = src.sample(f); m = sm[src.hips]; hp.append(m.translation.copy()); qs.append(m.to_quaternion())
        # hands too: a performer standing still while gesturing is not still
        hp[-1] = (hp[-1], sm[src.inv['hand_l']].translation.copy(), sm[src.inv['hand_r']].translation.copy())
    e = []
    for i in range(1, len(hp)):
        v = sum((hp[i][k] - hp[i - 1][k]).length for k in range(3)) * sfps / step + 0.3 * qs[i].rotation_difference(qs[i - 1]).angle * sfps / step
        e.append(v)
    still = [x < 0.25 for x in e]; segs = []; i = 0; need = int(min_still * sfps / step)
    while i < len(still):
        if not still[i]:
            j = i; q = 0
            while j < len(still) and q < need: q = q + 1 if still[j] else 0; j += 1
            a_ = f0 + max(0, i - 3) * step; b_ = min(f1, f0 + (j - q + 3) * step)
            if (b_ - a_) / sfps >= min_len: segs.append((a_, b_))
            i = j
        else: i += 1
    return segs or [(f0, f1)]

def trim_tpose(src, action, f0, f1):
    """mocap takes start (and often end) with the performer's calibration T-pose: arms straight out sideways. Trim it
    plus a short settle after it."""
    src.take(action); step = max(1, int(round(src.fps / 10)))
    def is_t(f):
        sm = src.sample(f); ok = 0
        for sd in 'lr':
            u, h = src.inv.get(f'upperarm_{sd}'), src.inv.get(f'hand_{sd}')
            if not u or not h: return False
            d = sm[h].translation - sm[u].translation
            if d.length > 1e-4 and abs(d.normalized().z) < 0.3: ok += 1    # arm close to horizontal
        return ok == 2
    a_, b_ = f0, f1
    while a_ < b_ and is_t(a_): a_ += step
    if a_ > f0: a_ = min(b_, a_ + int(0.6 * src.fps))
    while b_ > a_ and is_t(b_): b_ -= step
    if b_ < f1: b_ = max(a_, b_ - int(0.6 * src.fps))
    return a_, b_

# ======================= what each character gets =======================
LIBJ = json.load(open(os.path.join(ASRC, 'library.json')))
TROOPER = ROLE != 'jedi'
made = []
def lib_path(rel): return os.path.join(ASRC, rel)
# 1) Universal Animation Library: replacements and new everyday moves
# loop speeds: the root-motion copy of the library records how far each loop travels (the in-place loops cannot)
RM_SPEED = {}
if LIBJ['ual'].get('file_rm'):
    rm = Source(lib_path(LIBJ['ual']['file_rm']))
    for c in LIBJ['ual']['clips']:
        a = rm.actions.get(c['src'])
        if a is None or not c.get('loop'): continue
        f0, f1 = rm.take(a); s0 = rm.sample(f0); s1 = rm.sample(f1)
        d = s1[rm.hips].translation - s0[rm.hips].translation
        RM_SPEED[c['name']] = math.hypot(d.x, d.y) * rm.scale / max((f1 - f0) / FPS, 1e-3)
    rm.close()
    print('loop speeds from root motion (m/s):', {k: round(v, 2) for k, v in RM_SPEED.items() if v > 0.05})
ual = Source(lib_path(LIBJ['ual']['file']))
for c in LIBJ['ual']['clips']:
    if c.get('jedi_only') and TROOPER: continue
    a = ual.actions.get(c['src'])
    if a is None: print('UAL missing', c['src']); continue
    f0, f1 = ual.take(a)
    hyb = c['name'] if (TROOPER and c.get('hybrid_trooper')) else None
    wm = None if hyb else (c.get('weapon') or ('belt' if not TROOPER else 'back'))
    if c.get('weapon_jedi') and not TROOPER: wm = c['weapon_jedi']
    act, sp = bake(ual, a, f0, f1, c['name'], loop=c.get('loop', False), in_place=c.get('in_place', c.get('loop', False)),
                   notes=c['notes'] + ' (Universal Animation Library, retargeted)', weapon_mode=None if wm == 'hand' else wm, hybrid=hyb)
    if c['name'] in RM_SPEED:
        sp = RM_SPEED[c['name']]; act['speed_cm_s'] = sp * 100; STATS[c['name']]['speed_m_s'] = round(sp, 3)
    made.append((c['name'], round(sp, 2)))
# jump: start + one airborne loop + land, chained into the one 'jump' clip
ja = [ual.actions.get(n) for n in ('Jump_Start', 'Jump_Loop', 'Jump_Land')]
if all(ja):
    parts = []
    for a, (lo, hi) in zip(ja, ((None, None), (0, 12), (None, None))):
        f0, f1 = ual.take(a); f1 = f1 if hi is None else min(f1, f0 + hi)
        parts.append((a, f0, f1))
    seq = []
    for a, f0, f1 in parts:
        ual.take(a); seq += [(a, f) for f in range(f0, f1 + 1)]
    # bake frame by frame across the three actions
    fp = []
    for a, f in seq: ual.take(a); fp.append(frame_poses(ual, [f])[0])
    out = []
    pz0 = fp[0][1]
    for rot, pel in fp:
        if TROOPER: rot = {k: v for k, v in rot.items() if k in LOWER}
        basis, world = solve(rot, V((DR['pelvis'].translation.x + pel.x - pz0.x, DR['pelvis'].translation.y + pel.y - pz0.y, pel.z)), V((0, 0, 0)))
        if not TROOPER: basis['weapon_r'] = weapon_basis(world, 'belt')
        out.append((basis, world))
    proc = None
    if TROOPER and 'jump' in bpy.data.actions: proc = bpy.data.actions['jump']; proc.name = 'jump__proc'
    act = write_action('jump', out, False, 0.0, 'Jump: take-off, airborne, landing (Universal Animation Library, retargeted).',
                       ik_on=('lowerarm', 'hand') if TROOPER else (), weapon=None if TROOPER else {'blade': 0.0})
    if proc:
        n_ = len(out); pn = proc.frame_range[1]; have = {(fc.data_path, fc.array_index) for fc in act.fcurves}
        for fc in proc.fcurves:
            bn = fc.data_path.split('"')[1] if '"' in fc.data_path else ''
            if bn in LOWER or bn == 'root' or 'constraints' in fc.data_path or ((fc.data_path, fc.array_index) in have and not bn.startswith('ctrl')): continue
            nf = act.fcurves.new(fc.data_path, index=fc.array_index, action_group=bn or 'misc')
            vals = [fc.evaluate(i * pn / max(n_ - 1, 1)) for i in range(n_)]
            nf.keyframe_points.add(n_); co = np.empty(2 * n_); co[0::2] = np.arange(n_); co[1::2] = vals; nf.keyframe_points.foreach_set('co', co); nf.update()
        bpy.data.actions.remove(proc)
    made.append(('jump', 0.0))
ual.close()
# 2) the other takes: cut into moves; Jedi-only takes skipped for the troopers
_only=set(filter(None,os.environ.get('RETARGET_TAKES','').split(',')))
for t in LIBJ['takes']:
    if t.get('jedi_only') and TROOPER: continue
    if os.environ.get('RETARGET_TAKES') is not None and t['name'] not in _only: continue
    src = Source(lib_path(t['file']))
    a = next((x for x in src.actions.values() if x.name.endswith('Base_Layer') and ('Reference' in x.name or 'Hips' in x.name or len(src.actions) == 1)), None) or max(src.actions.values(), key=lambda x: x.frame_range[1])
    if t.get('kind') == 'turns':
        for i, (f0, f1) in enumerate(segments(src, a)):
            src.take(a); s0 = src.sample(f0); s1 = src.sample(f1)
            def yaw_of(sm):
                d = sm[src.inv['thigh_l']].translation - sm[src.inv['thigh_r']].translation; return math.degrees(math.atan2(d.y, d.x))
            dy = (yaw_of(s1) - yaw_of(s0) + 540) % 360 - 180
            nm = ('turn_l' if dy > 0 else 'turn_r') + ('180' if abs(dy) > 135 else '90')
            if nm in [m[0] for m in made]: nm += f'_{i + 1:02d}'
            hyb = nm if (TROOPER and nm in bpy.data.actions) else None
            act, sp = bake(src, a, f0, f1, nm, notes=f'Turn on the spot ({dy:+.0f} deg; heading on the root bone), from {t["file"]}', hybrid=hyb, yaw_root=True,
                           weapon_mode=None if hyb else ('belt' if not TROOPER else 'back'))
            act['turn_deg'] = dy; made.append((nm, round(dy)))
    else:
        fa, fb = trim_tpose(src, a, *src.take(a))
        segs = [(max(x, fa), min(y, fb)) for x, y in (segments(src, a) if t.get('split', True) else [(fa, fb)])]
        segs = [sg for sg in segs if (sg[1] - sg[0]) / src.fps >= 0.5]
        for i, (f0, f1) in enumerate(segs):
            nm = t['name'] + (f'_{i + 1:02d}' if len(segs) > 1 else '')
            wm = t.get('weapon_jedi' if not TROOPER else 'weapon', 'hand' if t.get('armed') else ('belt' if not TROOPER else 'back'))
            act, sp = bake(src, a, f0, f1, nm, notes=f'{t["notes"]} (from {t["file"]}, frames {f0}-{f1})', weapon_mode=None if wm == 'hand' else wm)
            act['library'] = True
            if not TROOPER and wm == 'hand' and t.get('saber_lit'):
                for fc in act.fcurves:
                    if fc.data_path == 'pose.bones["blade"].scale':
                        for kp in fc.keyframe_points: kp.co.y = 1.0
            made.append((nm, round((f1 - f0) / src.fps, 1)))
    src.close()
bpy.context.view_layer.objects.active = ao; ao.select_set(True)
print('RETARGET', len(made), made)

# 3) Jedi finishing pass on the lightsaber captures (Jedi only):
#    - the right hand closes on the hilt (the captures have open fingers; the hilt is bound to the hand)
#    - the ignite take lights the blade only once the hilt leaves the belt
#    - single strikes are cut from the long fight takes (blade-tip speed peaks) as game clips saber_strike_NN:
#      strike frame at 0.45 s, root travel kept (Motion Warping in Unreal), turned so each strike goes forward (-Y)
#    - takes flagged "game" in library.json stop being library-only (QA passes + web export + Unreal combat)
if not TROOPER:
    def _fist(side='r', amt=1.0, idx_amt=1.0, thumb=0.6):
        sg = 1 if side == 'r' else -1; out = {}
        for f in ('index', 'middle', 'ring', 'pinky'):
            a_ = idx_amt if f == 'index' else amt
            for i, base in ((1, 55), (2, 70), (3, 45)): out[f'{f}_0{i}_{side}'] = Q(V((0, 0, 1)), math.radians(sg * base * a_))
        for i, base in ((1, 15), (2, 25), (3, 25)): out[f'thumb_0{i}_{side}'] = Q(V((0, 0, 1)), math.radians(base * thumb))
        return out
    FIST = _fist()
    def set_const_rot(act, bone, q):
        for k in range(4):
            fc = act.fcurves.find(f'pose.bones["{bone}"].rotation_quaternion', index=k)
            if fc is None: fc = act.fcurves.new(f'pose.bones["{bone}"].rotation_quaternion', index=k, action_group=bone)
            n_ = max(2, int(act.frame_range[1]) + 1)
            fc.keyframe_points.clear(); fc.keyframe_points.add(n_)
            co_ = np.empty(2 * n_); co_[0::2] = np.arange(n_); co_[1::2] = q[k]; fc.keyframe_points.foreach_set('co', co_); fc.update()
    def evaluate(act, fn):
        ao.animation_data.action = act; out = []
        for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1):
            bpy.context.scene.frame_set(f); bpy.context.view_layer.update(); out.append(fn())
        return out
    TAKES = {t['name']: t for t in LIBJ['takes']}
    def take_of(name):
        base = name.rsplit('_', 1)[0] if name.rsplit('_', 1)[-1].isdigit() else name
        return TAKES.get(name) or TAKES.get(base)
    UAL_HAND = {c['name'] for c in LIBJ['ual']['clips'] if c.get('weapon_jedi') == 'hand'}
    armed = [a for a in bpy.data.actions if a.get('mocap') and ((take_of(a.name) or {}).get('armed') and (take_of(a.name) or {}).get('jedi_only') or a.name in UAL_HAND)]
    for a in armed:
        for b, q in FIST.items(): set_const_rot(a, b, q)
    print('saber grip on', len(armed), 'captures')
    # ignition: dark until the right hand first rises 18 cm above the hips, then on over 3 frames
    for a in [a for a in bpy.data.actions if (take_of(a.name) or {}).get('ignite') == 'raise']:
        rel = evaluate(a, lambda: (ao.matrix_world @ P['hand_r'].head).z - (ao.matrix_world @ P['pelvis'].head).z)
        on = next((i for i, r in enumerate(rel) if r > 0.18), None)
        fc = a.fcurves.find('pose.bones["blade"].scale', index=1)
        if fc and on is not None:
            for kp in fc.keyframe_points:
                i = int(kp.co.x); kp.co.y = max(0.001, min(1.0, (i - on + 1) / 3.0))
            for k in (0, 2):
                fx_ = a.fcurves.find('pose.bones["blade"].scale', index=k)
                if fx_:
                    for kp in fx_.keyframe_points:
                        i = int(kp.co.x); s_ = max(0.001, min(1.0, (i - on + 1) / 3.0)); kp.co.y = 0.25 + 0.75 * min(1.0, s_ * 5)
        print('ignite', a.name, 'blade on at frame', on)
    # strikes
    def tip_world():
        wb = P['weapon_r']; m = ao.matrix_world @ wb.matrix
        return np.array((m @ V((0, 0, 0)))[:]), np.array((ao.matrix_world @ P['blade'].tail)[:]) if 'blade' in P else None
    def facing_yaw():
        m = ao.matrix_world @ P['pelvis'].matrix; d = m.to_3x3() @ (DR['pelvis'].to_3x3().inverted() @ V((0, -1, 0)))
        return math.atan2(d.x, -d.y)
    strikes = []
    for a in [a for a in bpy.data.actions if (take_of(a.name) or {}).get('strikes')]:
        tips = evaluate(a, lambda: np.array((ao.matrix_world @ P['blade'].tail)[:]))
        tips = np.array(tips); sp = np.r_[0, np.linalg.norm(np.diff(tips, axis=0), axis=1) * FPS]
        sp = np.convolve(sp, np.ones(3) / 3, 'same'); n_ = len(sp)
        peaks = [i for i in range(2, n_ - 2) if sp[i] > 5.0 and sp[i] == sp[max(0, i - 9):i + 10].max()]
        keep = []
        for pk in sorted(peaks, key=lambda i: -sp[i]):
            if all(abs(pk - q) > 18 for q in keep): keep.append(pk)
        for pk in sorted(keep):
            f0, f1 = pk - 14, pk + 16
            if f0 < 0 or f1 > n_ - 1: continue
            strikes.append((a, f0, f1, pk, float(sp[pk])))
    strikes = sorted(strikes, key=lambda s: -s[4])[:14]
    strikes.sort(key=lambda s: (s[0].name, s[1]))
    for k_, (a, f0, f1, pk, spd) in enumerate(strikes, start=1):
        nm = f'saber_strike_{k_:02d}'
        ao.animation_data.action = a; bpy.context.scene.frame_set(pk); bpy.context.view_layer.update(); yaw = facing_yaw()
        Ry = Q(V((0, 0, 1)), -yaw)
        bpy.context.scene.frame_set(f0); bpy.context.view_layer.update()
        new = a.copy(); new.name = nm; new.use_fake_user = True
        for fc in new.fcurves:
            pts = [(kp.co.x, kp.co.y) for kp in fc.keyframe_points if f0 <= kp.co.x <= f1]
            fc.keyframe_points.clear(); fc.keyframe_points.add(len(pts))
            co_ = np.empty(2 * len(pts)); co_[0::2] = [p[0] - f0 for p in pts]; co_[1::2] = [p[1] for p in pts]
            fc.keyframe_points.foreach_set('co', co_); fc.update()
        # root: travel from the start of the strike, turned so the strike points forward (in world space, then back to the bone's basis)
        L = [new.fcurves.find('pose.bones["root"].location', index=i) for i in range(3)]
        Rq = [new.fcurves.find('pose.bones["root"].rotation_quaternion', index=i) for i in range(4)]
        if all(L) and all(Rq):
            nk = min(len(L[0].keyframe_points), len(Rq[0].keyframe_points)); Dr = DR['root']; Dri = Dr.inverted(); Rz = M.Rotation(-yaw, 4, 'Z')
            def basis_at(j): return M.Translation(V([L[i].keyframe_points[j].co.y for i in range(3)])) @ Q([Rq[i].keyframe_points[j].co.y for i in range(4)]).to_matrix().to_4x4()
            w0 = (Dr @ basis_at(0)).translation.copy(); w0.z = 0
            for j in range(nk):
                wm = Rz @ M.Translation(-w0) @ Dr @ basis_at(j); bm_ = Dri @ wm
                t_, q_ = bm_.to_translation(), bm_.to_quaternion()
                for i in range(3): L[i].keyframe_points[j].co.y = t_[i]
                for i in range(4): Rq[i].keyframe_points[j].co.y = q_[i]
        for fc in new.fcurves: fc.update()
        new.frame_range = (0, f1 - f0); new.use_frame_range = True
        new['library'] = False; new['loop'] = False; new['strike_time'] = (pk - f0) / FPS; new['mocap'] = True
        new['notes'] = f'Lightsaber strike from your capture {a.name} (frames {f0}-{f1}), blade-tip peak {spd:.1f} m/s at {(pk - f0) / FPS:.2f} s'
        STATS[nm] = dict(frames=f1 - f0, seconds=round((f1 - f0) / FPS, 3), loop=False, speed_m_s=0, max_hand_gap_cm=0.0, max_foot_gap_cm=0.0,
                         planted_foot_slip_cm_s=0, notes=new['notes'])
    print('STRIKES', len(strikes), [(f'saber_strike_{k:02d}', s[0].name, s[1], round(s[4], 1)) for k, s in enumerate(strikes, start=1)])
    for a in bpy.data.actions:
        t_ = take_of(a.name)
        if t_ and t_.get('game') and a.get('library'): a['library'] = False
    ao.animation_data.action = None
