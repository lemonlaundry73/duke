# Physics ragdoll for every death (Bullet rigid bodies, the same approach as Battlefront / Call of Duty).
# Each death clip keeps its authored hit reaction; at the clip's "limp" moment the body becomes a ragdoll:
#   - 15 solid bodies (pelvis, abdomen, chest, head, upper/lower arms, hands, thighs, calves, feet) sized from the
#     trooper's own mesh (capsules / boxes / sphere), with realistic masses,
#   - joints with human limits (knees and elbows bend one way only, spine/neck/hips/shoulders limited),
#   - self-collision between non-adjacent parts (knees can touch, never pass through each other),
#   - a solid floor (the body rests on top of it; it never props itself up on nothing),
#   - the blaster and any severed pieces are rigid bodies in the same world (they collide with the body and floor),
#   - momentum carries over from the animation (a blast throw, a run) into the ragdoll.
# The simulation is baked back onto the skeleton (and onto weapon_r / cut_a / cut_b), so Unreal and the web play it as-is.
import bpy, bmesh, sys, json, math
import numpy as np
from mathutils import Vector as V, Matrix as M, Quaternion as Q
w = sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend')
sc = bpy.context.scene; FPS = sc.render.fps
ao = bpy.data.objects['Armature']; P = ao.pose.bones; T = bpy.data.objects['SK_Trooper']; G = bpy.data.objects['SK_Trooper_Blaster']
CUTS = {c['clip']: c for c in json.load(open(f'{w}/cuts.json'))}
CV = {c['clip']: c for c in json.load(open(f'{w}/cut_variants.json'))}
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'

# limp moment per death (seconds into the clip) and when the blaster leaves the hands
LIMP = {'die': 0.30, 'die_back': 0.10, 'die_headshot': 0.05, 'die_run': 0.10,
        'saber_death_arm': 0.75, 'saber_death_leg': 0.12, 'saber_death_head': 0.30, 'saber_death_half': 0.10, 'saber_death_diagonal': 0.30,
        'death_explosion': 0.05, 'death_explosion_arm': 0.05, 'death_explosion_leg': 0.05, 'death_explosion_armleg': 0.05}
RELEASE = {'saber_death_arm': 0.07, 'saber_death_diagonal': 0.07, 'death_explosion': 0.0, 'death_explosion_arm': 0.0, 'death_explosion_leg': 0.0, 'death_explosion_armleg': 0.0}
SETTLE = 3.7   # seconds of simulation after going limp

# ---------------- body layout ----------------
BODIES = [  # name, bone, parent body, shape, mass kg, merged bones for sizing
    ('pelvis', 'pelvis', None, 'BOX', 13.0, ['pelvis']),
    ('abdomen', 'spine_01', 'pelvis', 'BOX', 9.0, ['spine_01', 'spine_02']),
    ('chest', 'spine_03', 'abdomen', 'BOX', 19.0, ['spine_03', 'clavicle_l', 'clavicle_r', 'neck_01']),
    ('head', 'head', 'chest', 'SPHERE', 6.0, ['head']),
    ('upperarm_l', 'upperarm_l', 'chest', 'CAPSULE', 3.0, ['upperarm_l']), ('upperarm_r', 'upperarm_r', 'chest', 'CAPSULE', 3.0, ['upperarm_r']),
    ('lowerarm_l', 'lowerarm_l', 'upperarm_l', 'CAPSULE', 2.0, ['lowerarm_l']), ('lowerarm_r', 'lowerarm_r', 'upperarm_r', 'CAPSULE', 2.0, ['lowerarm_r']),
    ('hand_l', 'hand_l', 'lowerarm_l', 'BOX', 0.7, ['hand_l', 'thumb', 'index', 'middle', 'ring', 'pinky']),
    ('hand_r', 'hand_r', 'lowerarm_r', 'BOX', 0.7, ['hand_r', 'thumb', 'index', 'middle', 'ring', 'pinky']),
    ('thigh_l', 'thigh_l', 'pelvis', 'CAPSULE', 9.5, ['thigh_l']), ('thigh_r', 'thigh_r', 'pelvis', 'CAPSULE', 9.5, ['thigh_r']),
    ('calf_l', 'calf_l', 'thigh_l', 'CAPSULE', 4.5, ['calf_l']), ('calf_r', 'calf_r', 'thigh_r', 'CAPSULE', 4.5, ['calf_r']),
    ('foot_l', 'foot_l', 'calf_l', 'BOX', 1.3, ['foot_l', 'ball_l']), ('foot_r', 'foot_r', 'calf_r', 'BOX', 1.3, ['foot_r', 'ball_r']),
]
# joint limits (degrees) in the child bone's rest frame: x = flex/extend, y = twist, z = side bend
LIMITS = {   # Bullet measures flexion about the bone's X axis as positive (verified with RD_KNEETEST: a bent knee settles, it does not snap)
    'abdomen': ((-40, 25), (-25, 25), (-20, 20)), 'chest': ((-40, 25), (-25, 25), (-20, 20)),
    'head': ((-60, 45), (-60, 60), (-35, 35)),
    'upperarm_l': ((-170, 70), (-80, 80), (-90, 90)), 'upperarm_r': ((-170, 70), (-80, 80), (-90, 90)),
    'lowerarm_l': ((-145, 5), (-70, 70), (-3, 3)), 'lowerarm_r': ((-145, 5), (-70, 70), (-3, 3)),
    'hand_l': ((-70, 70), (-20, 20), (-30, 30)), 'hand_r': ((-70, 70), (-20, 20), (-30, 30)),
    'thigh_l': ((-120, 25), (-35, 35), (-40, 40)), 'thigh_r': ((-120, 25), (-35, 35), (-40, 40)),
    'calf_l': ((-3, 150), (-8, 8), (-4, 4)), 'calf_r': ((-3, 150), (-8, 8), (-4, 4)),
    'foot_l': ((-45, 35), (-15, 15), (-20, 20)), 'foot_r': ((-45, 35), (-15, 15), (-20, 20)),
}
BREST = {pb.name: pb.bone.matrix_local.copy() for pb in P}

# ---------------- size every body from the trooper's mesh ----------------
me = T.data; n = len(me.vertices)
co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(n, 3)
gn = {g.index: g.name for g in T.vertex_groups}
top = np.array([gn[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in me.vertices])
def verts_for(merge):
    m = np.zeros(n, bool)
    for b in merge:
        m |= np.array([t == b or (t.startswith(b + '_') and t.endswith(('_l', '_r'))) for t in top]) if b in ('thumb', 'index', 'middle', 'ring', 'pinky') else (top == b)
    return co[m]
def in_frame(pts, mat):
    inv = np.array(mat.inverted()); h = np.c_[pts, np.ones(len(pts))]; return (h @ inv.T)[:, :3]

col = bpy.data.collections.new('Ragdoll'); sc.collection.children.link(col)
def new_obj(name, mesh):
    o = bpy.data.objects.new(name, mesh); col.objects.link(o); o.rotation_mode = 'QUATERNION'; return o
def box_mesh(name, dims):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = V((v.co.x * dims[0], v.co.y * dims[1], v.co.z * dims[2]))
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free(); return m
def capsule_mesh(name, r, h):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r, depth=h)
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free(); return m
def sphere_mesh(name, r):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free(); return m

BODY = {}   # name -> dict(obj, bone, rest(O_rest), offset(inv(O_rest)@B_rest))
for name, bone, parent, shape, mass, merge in BODIES:
    B = BREST[bone]; pts = verts_for(merge)
    if name.startswith('foot'):   # feet: a level box with its sole on the floor (a box along the sloping foot bone pokes into the ground)
        B = M.Translation(B.translation)
    loc = in_frame(pts, B)
    if shape == 'CAPSULE':
        L = ao.data.bones[bone].length
        d = np.linalg.norm(loc[:, [0, 2]], axis=1); r = float(np.percentile(d, 90)) if len(d) else 0.05
        h = L + r * 0.6
        O = B @ M.Translation((0, L * 0.5, 0)) @ M.Rotation(math.radians(-90), 4, 'X')   # capsule axis (Z) along the bone (Y)
        mesh = capsule_mesh('rd_' + name, r, h)
    elif shape == 'SPHERE':
        c = loc.mean(0); r = float(np.percentile(np.linalg.norm(loc - c, axis=1), 95))
        O = B @ M.Translation(V(c)); mesh = sphere_mesh('rd_' + name, r)
    else:
        lo = np.percentile(loc, 3, axis=0); hi = np.percentile(loc, 97, axis=0); c = (lo + hi) / 2; dims = np.maximum(hi - lo, 0.04)
        O = B @ M.Translation(V(c)); mesh = box_mesh('rd_' + name, dims)
    o = new_obj('RD_' + name, mesh); o.matrix_world = O
    BODY[name] = dict(obj=o, bone=bone, parent=parent, shape=shape, mass=mass, rest=O.copy(), offset=O.inverted() @ BREST[bone])

def seg(bname):
    bb = ao.data.bones[bname]; return np.array(bb.head_local), np.array(bb.tail_local)
def segdist(a0, a1, b0, b1):
    best = 1e9
    for t in np.linspace(0, 1, 11):
        p = a0 + (a1 - a0) * t; ab = b1 - b0; u = np.clip(np.dot(p - b0, ab) / np.dot(ab, ab), 0, 1); best = min(best, np.linalg.norm(p - (b0 + ab * u)))
    return best
caps = [k for k in BODY if BODY[k]['shape'] == 'CAPSULE']
adj = {(k, BODY[k]['parent']) for k in BODY} | {(BODY[k]['parent'], k) for k in BODY}
for i, a_ in enumerate(caps):
    for b_ in caps[i + 1:]:
        if (a_, b_) in adj: continue
        ra = BODY[a_]['obj'].dimensions.x / 2; rb_ = BODY[b_]['obj'].dimensions.x / 2
        gap = segdist(*seg(BODY[a_]['bone']), *seg(BODY[b_]['bone'])) - ra - rb_ - 0.01
        if gap < 0:
            k = max(0.5, (ra + rb_ + gap) / (ra + rb_))
            for nme, r in ((a_, ra), (b_, rb_)):
                o = BODY[nme]['obj']; L = ao.data.bones[BODY[nme]['bone']].length
                o.data = capsule_mesh('rd_' + nme, r * k, L + r * k * 0.6)
            print('shrunk', a_, b_, 'by', round(1 - k, 3))
# any non-adjacent pair that already overlaps in the rest pose would explode apart: give that pair its own no-collision joint
def overlaps(a_, b_):
    A = BODY[a_]['obj']; B_ = BODY[b_]['obj']
    pa = [A.matrix_world @ V(c) for c in A.bound_box]; pb = [B_.matrix_world @ V(c) for c in B_.bound_box]
    return all(min(p[i] for p in pa) < max(p[i] for p in pb) - 0.005 and min(p[i] for p in pb) < max(p[i] for p in pa) - 0.005 for i in range(3))
REST_OVERLAP = []
names_ = list(BODY)
for i, a_ in enumerate(names_):
    for b_ in names_[i + 1:]:
        if (a_, b_) in adj or (b_, a_) in adj: continue
        if overlaps(a_, b_) and not (BODY[a_]['shape'] == 'CAPSULE' and BODY[b_]['shape'] == 'CAPSULE'): REST_OVERLAP.append((a_, b_))
print('rest-overlap pairs excluded from collision', REST_OVERLAP)
bpy.ops.rigidbody.world_add(); RW = sc.rigidbody_world
RW.collection = col if RW.collection is None else RW.collection
RW.solver_iterations = 40; RW.substeps_per_frame = 15; RW.use_split_impulse = True
for b in BODY.values():
    o = b['obj']
    for x in sc.objects: x.select_set(False)
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.rigidbody.object_add(type='ACTIVE')
    rb = o.rigid_body; rb.collision_shape = b['shape']; rb.mass = b['mass']; rb.friction = 0.85; rb.restitution = 0.05
    rb.linear_damping = 0.15; rb.angular_damping = 0.6; rb.use_margin = True; rb.collision_margin = 0.004
# floor
floor = new_obj('RD_floor', box_mesh('rd_floor', (600, 600, 1))); floor.location = (0, 0, -0.5)
for x in sc.objects: x.select_set(False)
bpy.context.view_layer.objects.active = floor; floor.select_set(True); bpy.ops.rigidbody.object_add(type='PASSIVE')
floor.rigid_body.collision_shape = 'BOX'; floor.rigid_body.friction = 0.9; floor.rigid_body.restitution = 0.05
floor.rigid_body.collision_collections = [i in (0, 1) for i in range(20)]
# joints
JOINT = {}
for name, bone, parent, shape, mass, merge in BODIES:
    if not parent: continue
    e = bpy.data.objects.new('RJ_' + name, None); col.objects.link(e)
    e.matrix_world = M.Translation(BREST[bone].translation) @ BREST[bone].to_3x3().to_4x4()
    for x in sc.objects: x.select_set(False)
    bpy.context.view_layer.objects.active = e; e.select_set(True); bpy.ops.rigidbody.constraint_add(type='GENERIC')
    c = e.rigid_body_constraint; c.object1 = BODY[parent]['obj']; c.object2 = BODY[name]['obj']; c.disable_collisions = True
    for ax in 'xyz':
        setattr(c, f'use_limit_lin_{ax}', True); setattr(c, f'limit_lin_{ax}_lower', 0.0); setattr(c, f'limit_lin_{ax}_upper', 0.0)
    for ax, (lo, hi) in zip('xyz', LIMITS[name]):
        setattr(c, f'use_limit_ang_{ax}', True); setattr(c, f'limit_ang_{ax}_lower', math.radians(lo)); setattr(c, f'limit_ang_{ax}_upper', math.radians(hi))
    JOINT[name] = e
for a_, b_ in REST_OVERLAP:
    e = bpy.data.objects.new(f'RX_{a_}_{b_}', None); col.objects.link(e)
    for x in sc.objects: x.select_set(False)
    bpy.context.view_layer.objects.active = e; e.select_set(True); bpy.ops.rigidbody.constraint_add(type='GENERIC')
    c = e.rigid_body_constraint; c.object1 = BODY[a_]['obj']; c.object2 = BODY[b_]['obj']; c.disable_collisions = True
    for ax in 'xyz':
        setattr(c, f'use_limit_lin_{ax}', False); setattr(c, f'use_limit_ang_{ax}', False)

# blaster body: a box around the gun in the weapon_r frame
gco = np.array([v.co[:] for v in G.data.vertices]); WREST = BREST['weapon_r']
gl = in_frame(gco, WREST); glo = np.percentile(gl, 1, axis=0); ghi = np.percentile(gl, 99, axis=0); gc = (glo + ghi) / 2
GUN_OFF = M.Translation(V(gc))
dirs_ = np.random.default_rng(1).normal(size=(300, 3)); dirs_ /= np.linalg.norm(dirs_, axis=1)[:, None]
gext = gl[np.unique(np.argmax(gl @ dirs_.T, axis=0))] - gc      # outermost points: the hull wraps the whole blaster
gm_ = bpy.data.meshes.new('rd_gun'); gm_.from_pydata([tuple(p) for p in gext], [], [])
gun = new_obj('RD_gun', gm_); gun.matrix_world = WREST @ GUN_OFF
for x in sc.objects: x.select_set(False)
bpy.context.view_layer.objects.active = gun; gun.select_set(True); bpy.ops.rigidbody.object_add(type='ACTIVE')
gun.rigid_body.collision_shape = 'CONVEX_HULL'; gun.rigid_body.use_margin = True; gun.rigid_body.collision_margin = 0.004; gun.rigid_body.mass = 3.5; gun.rigid_body.friction = 0.7; gun.rigid_body.restitution = 0.15
gun.rigid_body.linear_damping = 0.1; gun.rigid_body.angular_damping = 0.3
gun.rigid_body.collision_collections = [i == 1 for i in range(20)]

SEVER = {'upperarm_r': ['upperarm_r', 'lowerarm_r', 'hand_r'], 'upperarm_l': ['upperarm_l', 'lowerarm_l', 'hand_l'],
         'thigh_l': ['thigh_l', 'calf_l', 'foot_l'], 'thigh_r': ['thigh_r', 'calf_r', 'foot_r']}
def severed_bodies(clip):
    c = CUTS.get(clip)
    if not c: return set()
    out = set()
    for pc in c['pieces']:
        if pc.get('region') in SEVER: out |= set(SEVER[pc['region']])
        elif pc.get('anchor') == 'head': out.add('head')
        elif pc.get('plane') == 'waist': out |= {'pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'}
        elif pc.get('plane') == 'diagonal': out |= {'chest', 'head', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'}
    return out

def piece_body(objname, idx):
    src = bpy.data.objects[objname]; pts = np.array([v.co[:] for v in src.data.vertices]); c0 = pts.mean(0)
    step = max(1, len(pts) // 2500); sub = pts[::step]
    dirs = np.random.default_rng(0).normal(size=(300, 3)); dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    ext = pts[np.unique(np.argmax(pts @ dirs.T, axis=0))]          # outermost vertex in 300 directions: the hull wraps the real piece
    sub = np.vstack([sub, ext]) - c0
    m = bpy.data.meshes.new('rd_piece'); m.from_pydata([tuple(p) for p in sub], [], []); o = new_obj(f'RD_piece_{idx}', m)
    o.matrix_world = M.Translation(V(c0))
    for x in sc.objects: x.select_set(False)
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.rigidbody.object_add(type='ACTIVE')
    rb = o.rigid_body; rb.collision_shape = 'CONVEX_HULL'; rb.mass = 2.0 + 30.0 * len(pts) / n; rb.friction = 0.85; rb.restitution = 0.05
    rb.linear_damping = 0.15; rb.angular_damping = 0.5; rb.use_margin = True; rb.collision_margin = 0.004
    rb.collision_collections = [i == 1 for i in range(20)]
    return o, M.Translation(V(c0))

PRE = 3   # sim frames before clip frame 0: bodies in the rest pose so joint limits are anatomical
def simulate(clip):
    act = bpy.data.actions[clip]; ao.animation_data.action = act
    N0 = int(act.frame_range[1]); limpF = round(LIMP[clip] * FPS); relF = round(RELEASE.get(clip, LIMP[clip]) * FPS)
    N = max(N0, limpF + round(SETTLE * FPS))
    sev = severed_bodies(clip)
    for jn, e in JOINT.items():
        par = BODY[jn]['parent']; e.rigid_body_constraint.enabled = not (jn in sev or par in sev)
    # 1) sample the authored animation (clip frames 0..N0; hold the last pose beyond it)
    track = {}; wtrack = []; cut_tracks = {'cut_a': [], 'cut_b': []}
    for f in range(0, N0 + 1):
        sc.frame_set(f); bpy.context.view_layer.update()
        track[f] = {b: (P[BODY[b]['bone']].matrix @ BODY[b]['offset'].inverted()) for b in BODY}
        wtrack.append(P['weapon_r'].matrix @ GUN_OFF)
        for cb in cut_tracks: cut_tracks[cb].append(P[cb].matrix.copy())
    # 2) key the bodies: rest pose for the pre-roll, then kinematic along the animation until limp, then dynamic
    objs = [BODY[b]['obj'] for b in BODY] + [gun]
    for o in objs:
        o.animation_data_clear(); o.rigid_body.kinematic = True
    pieces = []; piece_hand = {}
    cv = CV.get(clip)
    if cv:
        for i, pn in enumerate(cv['pieces']):
            po, poff = piece_body(pn, i); pieces.append((po, poff, 'cut_a' if i == 0 else 'cut_b'))
    cutF = cv['frame'] if cv else None
    def key(o, mat, s):
        o.matrix_world = mat; o.keyframe_insert('location', frame=s); o.keyframe_insert('rotation_quaternion', frame=s)
    for s in range(0, PRE):
        for b in BODY: key(BODY[b]['obj'], BODY[b]['rest'], s)
        key(gun, WREST @ GUN_OFF, s)
    # the ragdoll must not start inside the floor: lift the hand-over pose just clear of it
    def body_low(mats):
        low = 1e9
        for b in BODY:
            if b in sev: continue
            o = BODY[b]['obj']; m = mats[b]
            for corner in o.bound_box: low = min(low, (m @ V(corner)).z)
        return low
    lift = max(0.0, 0.006 - body_low(track[limpF]))
    # ...and every joint must start inside its limits: widen a limit just enough to contain the hand-over pose
    for jn, e in JOINT.items():
        par = BODY[jn]['parent']
        if jn in sev or par in sev: continue
        Cw = BREST[BODY[jn]['bone']].to_3x3().to_4x4()
        Fp = BODY[par]['rest'].inverted() @ Cw; Fc = BODY[jn]['rest'].inverted() @ Cw
        A = track[limpF][par] @ Fp; Bm = track[limpF][jn] @ Fc
        eul = [-x for x in (A.inverted() @ Bm).to_euler('XYZ')]; c = e.rigid_body_constraint   # Bullet's sign convention
        for ax, val in zip('xyz', eul):
            lo, hi = math.radians(LIMITS[jn]['xyz'.index(ax)][0]), math.radians(LIMITS[jn]['xyz'.index(ax)][1])
            setattr(c, f'limit_ang_{ax}_lower', min(lo, val - math.radians(4))); setattr(c, f'limit_ang_{ax}_upper', max(hi, val + math.radians(4)))
    for f in range(0, min(N0, max(limpF, relF, (cutF or 0) + 2)) + 1):
        s = f + PRE
        if f <= limpF:
            up = M.Translation((0, 0, lift * max(0.0, 1 - (limpF - f) / 4.0)))
            for b in BODY: key(BODY[b]['obj'], up @ track[f][b], s)
        if f <= relF: key(gun, wtrack[f], s)
    for b in BODY:
        o = BODY[b]['obj']; dyn = b not in sev
        o.rigid_body.kinematic = True; o.rigid_body.keyframe_insert('kinematic', frame=limpF + PRE)
        o.rigid_body.kinematic = not dyn; o.rigid_body.keyframe_insert('kinematic', frame=limpF + PRE + 1)
        # severed parts are replaced by their piece: move them out of everyone's way
        o.rigid_body.collision_collections = [i == (19 if not dyn else 0) for i in range(20)]
        if not dyn: o.matrix_world = M.Translation((0, 0, -50)); o.keyframe_insert('location', frame=limpF + PRE + 1)
    gun.rigid_body.kinematic = True; gun.rigid_body.keyframe_insert('kinematic', frame=relF + PRE)
    gun.rigid_body.kinematic = False; gun.rigid_body.keyframe_insert('kinematic', frame=relF + PRE + 1)
    for po, poff, cb in pieces:
        po.rigid_body.kinematic = True
        mo = next((pc['motion'] for pc in CUTS[clip]['pieces']), {})
        handF = cutF + 2 + round((mo.get('delay', 0) + (0.25 * mo.get('dur', 0) if mo.get('kind') in ('topple', 'slide') else 0)) * FPS)
        handF = min(handF, N0)
        hull = [V(v.co) for v in po.data.vertices]
        for f in range(0, handF + 1):
            m = cut_tracks[cb][min(f, N0)] @ poff
            low = min((m @ p_).z for p_ in hull)
            if low < 0.002: m = M.Translation((0, 0, 0.002 - low)) @ m      # the scripted part of the motion stays on the floor too
            key(po, m, f + PRE)
        po.rigid_body.keyframe_insert('kinematic', frame=handF + PRE)
        po.rigid_body.kinematic = False; po.rigid_body.keyframe_insert('kinematic', frame=handF + 1 + PRE)
        piece_hand[cb] = handF
    # 3) run the simulation
    RW.point_cache.frame_start = 0; RW.point_cache.frame_end = N + PRE; sc.frame_start = 0; sc.frame_end = N + PRE
    ao.animation_data.action = None
    try: bpy.ops.ptcache.free_bake_all()
    except Exception: pass
    RW.enabled = False; RW.enabled = True
    out = {}
    for s in range(0, N + PRE + 1):
        sc.frame_set(s)
        if s - PRE >= 0:
            out[s - PRE] = ({b: BODY[b]['obj'].matrix_world.copy() for b in BODY}, gun.matrix_world.copy(), [(po.matrix_world.copy(), poff, cb) for po, poff, cb in pieces])
    if DEBUG:
        for f in range(limpF, min(N, limpF + 8)):
            sp = sorted(((out[f + 1][0][b].translation - out[f][0][b].translation).length * FPS, b) for b in BODY if b not in sev)[-3:]
            print('  dbg f', f, [(b, round(v, 2)) for v, b in sp], 'pelvis z', round(out[f][0]['pelvis'].translation.z, 3))
    # 4) bake onto the skeleton: simulated bodies drive their bones from the limp frame on
    ao.animation_data.action = act
    order = [b for b, *_ in BODIES]
    for f in range(0, N + 1):
        sc.frame_set(min(f, N0)); bpy.context.view_layer.update()
        bodies, gm, pcs = out[f]
        if f > limpF:
            for bn in ('lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'):
                for c in P[bn].constraints: c.influence = 0.0
            for b in order:
                if b in sev:
                    anc = BODY[b]['parent']
                    while anc in sev: anc = BODY[anc]['parent']
                    if anc is None: anc = next((k for k in order if BODY[k]['parent'] == b and k not in sev), None)
                    if anc is None: continue
                    bpy.context.view_layer.update()
                    P[BODY[b]['bone']].matrix = bodies[anc] @ BODY[anc]['rest'].inverted() @ BREST[BODY[b]['bone']]
                    continue
                bpy.context.view_layer.update(); P[BODY[b]['bone']].matrix = bodies[b] @ BODY[b]['offset']
            # relaxed fingers on a limp body
            for pb in P:
                if pb.name.split('_')[0] in ('thumb', 'index', 'middle', 'ring', 'pinky'):
                    pb.rotation_quaternion = pb.rotation_quaternion.slerp(Q(), 0.6)
        if f > relF:
            bpy.context.view_layer.update(); P['weapon_r'].matrix = gm @ GUN_OFF.inverted()
        if cutF is not None:
            for pmat, poff, cb in pcs:
                if f > cutF:
                    bpy.context.view_layer.update(); P[cb].matrix = pmat @ poff.inverted()
        if f > min(limpF, relF, cutF if cutF is not None else 10**6) or f > N0:
            for pb in P:
                pb.keyframe_insert('location', frame=f, group=pb.name); pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
            for bn in ('lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'):
                for c in P[bn].constraints: c.keyframe_insert('influence', frame=f, group=bn)
    act.frame_range = (0, N)
    # ground pass: the real skinned mesh never goes below the floor -> lift the body (not the free pieces / blaster) where needed
    body_mesh = [T]
    if cv: body_mesh_cut = [bpy.data.objects[cv['remainder']]]
    need = {}
    for f in range(min(limpF, relF), N + 1):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
        ms = body_mesh_cut if (cv and f >= cv['frame']) else body_mesh
        low = 1e9
        for o in ms:
            em = o.evaluated_get(dg).to_mesh(); nn = len(em.vertices); cc = np.empty(nn * 3); em.vertices.foreach_get('co', cc)
            low = min(low, float(cc.reshape(nn, 3)[:, 2].min())); o.evaluated_get(dg).to_mesh_clear()
        need[f] = max(0.0, 0.002 - low)
    fs = sorted(need); vals = [need[f] for f in fs]
    sm = [max(vals[max(0, i - 2):i + 3]) for i in range(len(vals))]
    sm = [max(sum(sm[max(0, i - 2):i + 3]) / len(sm[max(0, i - 2):i + 3]), v) for i, v in enumerate(vals)]
    for f, dz in zip(fs, sm):
        if dz <= 1e-4: continue
        sc.frame_set(f); bpy.context.view_layer.update()
        keep = {b: P[b].matrix.copy() for b in ('weapon_r', 'cut_a', 'cut_b')}
        P['pelvis'].matrix = M.Translation((0, 0, dz)) @ P['pelvis'].matrix; bpy.context.view_layer.update()
        for b, m in keep.items():
            if (b == 'weapon_r' and f > relF) or (b != 'weapon_r' and cv and f > cv['frame']): P[b].matrix = m; bpy.context.view_layer.update()
        for b in ['pelvis', 'weapon_r', 'cut_a', 'cut_b']:
            P[b].keyframe_insert('location', frame=f, group=b); P[b].keyframe_insert('rotation_quaternion', frame=f, group=b)
    print(clip, 'ground pass: max lift cm', round(max(sm) * 100, 1))
    # the blaster rests on the floor too (contact jitter can leave it a centimetre low)
    for f in range(relF + 1, N + 1):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
        em = G.evaluated_get(dg).to_mesh(); nn = len(em.vertices); cc = np.empty(nn * 3); em.vertices.foreach_get('co', cc)
        lowg = float(cc.reshape(nn, 3)[:, 2].min()); G.evaluated_get(dg).to_mesh_clear()
        if lowg < 0.002:
            P['weapon_r'].matrix = M.Translation((0, 0, 0.002 - lowg)) @ P['weapon_r'].matrix; bpy.context.view_layer.update()
            P['weapon_r'].keyframe_insert('location', frame=f, group='weapon_r'); P['weapon_r'].keyframe_insert('rotation_quaternion', frame=f, group='weapon_r')
    for po, _, _ in pieces: bpy.data.objects.remove(po)
    # settle report: body speeds over the last 0.3 s
    lastp = out[N][0]; prevp = out[N - 9][0]
    v = max((lastp[b].translation - prevp[b].translation).length / 0.3 for b in BODY if b not in sev)
    low = min(lastp[b].translation.z for b in BODY if b not in sev)
    print(clip, 'lift cm', round(lift * 100, 1), 'limp at', limpF, 'frames', N, 'max body speed at end m/s', round(v, 3), 'lowest body centre z', round(low, 3))
    return dict(clip=clip, limp_frame=limpF, frames=N, settled_speed=round(v, 3))

import os
if os.environ.get('RD_KNEETEST'):
    # thigh_l fixed (kinematic, rest), calf_l dynamic starting with the knee flexed 60 deg the anatomical way
    for b in BODY.values(): b['obj'].rigid_body.collision_collections = [k == 19 for k in range(20)]
    for jn, e in JOINT.items(): e.rigid_body_constraint.enabled = jn == 'calf_l'
    th = BODY['thigh_l']['obj']; ca = BODY['calf_l']['obj']
    for b in BODY.values():
        b['obj'].animation_data_clear(); b['obj'].rigid_body.kinematic = True; b['obj'].matrix_world = b['rest']
    knee = BREST['calf_l'].translation
    flex = M.Translation(knee) @ M.Rotation(math.radians(60), 4, 'X') @ M.Translation(-knee)   # world +X rotation: calf swings back (+Y)? check
    tail_rest = BREST['calf_l'] @ V((0, ao.data.bones['calf_l'].length, 0)); tail_new = flex @ tail_rest
    print('kneetest: rotation moves ankle from y', round(tail_rest.y, 3), 'to', round(tail_new.y, 3), '(+y = backward = anatomical knee flexion)')
    for s_ in range(0, 3):
        for o, m in ((th, BODY['thigh_l']['rest']), (ca, BODY['calf_l']['rest'] if s_ < 2 else flex @ BODY['calf_l']['rest'])):
            o.matrix_world = m; o.keyframe_insert('location', frame=s_); o.keyframe_insert('rotation_quaternion', frame=s_)
    ca.rigid_body.kinematic = True; ca.rigid_body.keyframe_insert('kinematic', frame=3); ca.rigid_body.kinematic = False; ca.rigid_body.keyframe_insert('kinematic', frame=4)
    RW.point_cache.frame_start = 0; RW.point_cache.frame_end = 40; sc.frame_end = 40; ao.animation_data.action = None
    for s_ in range(0, 30):
        sc.frame_set(s_)
        if s_ in (3, 5, 8, 15, 29):
            rel = (BODY['thigh_l']['rest'].inverted() @ BODY['calf_l']['rest']).inverted() @ (th.matrix_world.inverted() @ ca.matrix_world)
            ang = math.degrees((th.matrix_world.to_3x3().inverted() @ ca.matrix_world.to_3x3()).to_quaternion().rotation_difference((BODY['thigh_l']['rest'].to_3x3().inverted() @ BODY['calf_l']['rest'].to_3x3()).to_quaternion()).angle)
            print('kneetest frame', s_, 'knee bend deg', round(ang, 1))
    raise SystemExit
ONLY = os.environ.get('RD_ONLY')
if os.environ.get('RD_NOSELF'):
    for i, b in enumerate(BODY.values()): b['obj'].rigid_body.collision_collections = [k in (0,) for k in range(20)] if False else [k == 0 for k in range(20)]
    for i, b in enumerate(BODY.values()): b['obj'].rigid_body.collision_collections = [k == 2 + (i % 17) or k == 0 and False for k in range(20)]
    floor.rigid_body.collision_collections = [True] * 20
DEBUG = os.environ.get('RD_DEBUG')
REPORT = [simulate(c) for c in LIMP if c in bpy.data.actions and (not ONLY or c == ONLY)]
# remove the physics scaffolding before saving (the motion is baked into the actions)
for o in list(col.objects): bpy.data.objects.remove(o)
bpy.data.collections.remove(col)
bpy.ops.rigidbody.world_remove()
ao.animation_data.action = None
json.dump(REPORT, open(f'{w}/ragdoll_report.json', 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/anim.blend')
print('RAGDOLL', len(REPORT))
