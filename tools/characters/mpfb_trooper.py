# Duke Forger character creator: an armoured trooper built from scratch on the MakeHuman / MPFB base human (CC0 data:
# base mesh, macro morph targets, joint cubes, default-rig skin weights). Only the MPFB *data* files are read; no MPFB
# code is run. Output: a pre-rigged source GLB for tools/rigging/run.sh ("joints": "source"): one mesh, one 2K PBR
# material set, and a skeleton whose joints sit exactly where MakeHuman puts them, posed in the Duke A-pose.
#
# Steps: morph the base human (macro targets: gender, age, muscle, weight, height, proportions) -> body only (helpers
# dropped) -> joints from the joint cubes -> arms re-posed into the trooper A-pose with MakeHuman's own skin weights ->
# armour modelled on the body (plates as offset shells with thickness and bevels, belt, pouches, boots, gloves,
# helmet with visor, back pack) -> one UV atlas, colours/roughness/metal and grime baked to 2K -> GLB.
#
# usage: python -I mpfb_trooper.py <mpfb data dir> <out.glb> [recipe.json]
import bpy, bmesh, sys, os, json, gzip, math, numpy as np
from mathutils import Vector as V, Matrix as M

if sys.argv[-1].endswith('.json'):   # optional recipe as the last arg
    DATA, OUT, RECIPE = sys.argv[-3], sys.argv[-2], json.load(open(sys.argv[-1]))
else:
    DATA, OUT, RECIPE = sys.argv[-2], sys.argv[-1], {}
R = dict(gender=1.0, age=0.5, muscle=0.7, weight=0.5, height=0.75, proportions=1.0, race={'caucasian': 1 / 3, 'african': 1 / 3, 'asian': 1 / 3},
         height_m=1.83, tex=2048,
         colors=dict(armor=(0.60, 0.53, 0.40), suit=(0.16, 0.18, 0.13), black=(0.035, 0.035, 0.035), leather=(0.22, 0.15, 0.09),
                     visor=(0.015, 0.02, 0.025), metal=(0.35, 0.36, 0.37), skin=(0.55, 0.38, 0.30)))
R.update(RECIPE)

# ---------------- base mesh (OBJ: y-up decimetres -> Blender z-up metres, facing -Y, left = +X) ----------------
def to_b(a): a = np.asarray(a, float); return np.stack([a[..., 0], -a[..., 2], a[..., 1]], -1) * 0.1
vs, vts, faces, fuv = [], [], [], []
for line in open(os.path.join(DATA, '3dobjs', 'base.obj')):
    if line.startswith('v '): vs.append([float(t) for t in line.split()[1:4]])
    elif line.startswith('vt '): vts.append([float(t) for t in line.split()[1:3]])
    elif line.startswith('f '):
        ids = [p.split('/') for p in line.split()[1:]]
        faces.append([int(p[0]) - 1 for p in ids]); fuv.append([int(p[1]) - 1 if len(p) > 1 and p[1] else 0 for p in ids])
co = to_b(vs); vts = np.array(vts)
print('base mesh', len(co), 'verts', len(faces), 'faces')

def load_target(rel):
    off = np.zeros_like(co)
    with gzip.open(os.path.join(DATA, 'targets', rel), 'rt') as f:
        for line in f:
            if not line.strip() or line[0] == '#': continue
            p = line.split(); off[int(p[0])] = to_b([float(p[1]), float(p[2]), float(p[3])])
    return off
# macro blend, MakeHuman rules: each macro variable splits into two neighbouring target names with linear weights
def split(val, lo_name, mid_name, hi_name):
    if val < 0.5: return {lo_name: 1 - val * 2, mid_name: val * 2}
    return {mid_name: 1 - (val - 0.5) * 2, hi_name: (val - 0.5) * 2}
G = {'male': R['gender'], 'female': 1 - R['gender']}
A = {'young': 1.0} if abs(R['age'] - 0.5) < 1e-3 else (split(R['age'], 'child', 'young', 'old'))
MU = split(R['muscle'], 'minmuscle', 'averagemuscle', 'maxmuscle')
WE = split(R['weight'], 'minweight', 'averageweight', 'maxweight')
total = np.zeros_like(co); used = []
def add(rel, w):
    global total
    if w <= 1e-4: return
    p = os.path.join(DATA, 'targets', rel)
    if not os.path.exists(p): print('missing target', rel); return
    total = total + load_target(rel) * w; used.append((rel, round(w, 3)))
for g, gw in G.items():
    for a, aw in A.items():
        for race, rw in R['race'].items(): add(f'macrodetails/{race}-{g}-{a}.target.gz', gw * aw * rw)
        for m, mw in MU.items():
            for wt, ww in WE.items():
                base = gw * aw * mw * ww
                add(f'macrodetails/universal-{g}-{a}-{m}-{wt}.target.gz', base)
                hw = (R['height'] - 0.5) * 2
                if abs(hw) > 1e-3: add(f'macrodetails/height/{g}-{a}-{m}-{wt}-{"maxheight" if hw > 0 else "minheight"}.target.gz', base * abs(hw))
                pw = (R['proportions'] - 0.5) * 2
                if abs(pw) > 1e-3: add(f'macrodetails/proportions/{g}-{a}-{m}-{wt}-{"idealproportions" if pw > 0 else "uncommonproportions"}.target.gz', base * abs(pw))
co = co + total
print('targets', len(used))

# ---------------- vertex groups, joints ----------------
VG = json.load(open(os.path.join(DATA, 'mesh_metadata', 'basemesh_vertex_groups.json')))
def grp(name): return np.concatenate([np.arange(a, b + 1) for a, b in VG[name]])
RIG = json.load(open(os.path.join(DATA, 'rigs', 'standard', 'rig.game_engine.json')))
def place(spec):
    if spec['strategy'] == 'CUBE': return co[grp(spec['cube_name'])].mean(0)
    return co[spec['vertex_indices']].mean(0)
JH = {b: place(d['head']) for b, d in RIG.items()}; JT = {b: place(d['tail']) for b, d in RIG.items()}

# ---------------- arms into the Duke trooper A-pose, with MakeHuman's own skin weights ----------------
WD = json.load(open(os.path.join(DATA, 'rigs', 'standard', 'weights.default.json')))['weights']
def wsum(pred):
    w = np.zeros(len(co))
    for b, lst in WD.items():
        if pred(b):
            for vi, ww in lst: w[vi] += ww
    return np.clip(w, 0, 1)
TRO = {'upperarm': np.array([0.100, 0.022, -0.250]), 'lowerarm': np.array([0.059, -0.090, -0.235])}
def rot_between(a, b): return np.array(V(a).normalized().rotation_difference(V(b).normalized()).to_matrix())
for sd, sg, mh in (('l', 1, '.L'), ('r', -1, '.R')):
    arm_w = wsum(lambda b: b.endswith(mh) and any(b.startswith(k) for k in ('upperarm', 'lowerarm', 'wrist', 'metacarpal', 'finger')))
    fore_w = wsum(lambda b: b.endswith(mh) and any(b.startswith(k) for k in ('lowerarm', 'wrist', 'metacarpal', 'finger')))
    sh, el, wr = JH[f'upperarm_{sd}'], JH[f'lowerarm_{sd}'], JH[f'hand_{sd}']
    R1 = rot_between(el - sh, TRO['upperarm'] * [sg, 1, 1])
    R2 = rot_between(wr - el, R1.T @ (TRO['lowerarm'] * [sg, 1, 1]))
    p = co - el; co = co + ((R2 @ p.T).T + el - co) * fore_w[:, None]
    p = co - sh; co = co + ((R1 @ p.T).T + sh - co) * arm_w[:, None]
    for J in (JH, JT):
        for b in list(J):
            if not b.endswith('_' + sd) or b.startswith(('clavicle', 'thigh', 'calf', 'foot', 'ball')): continue
            q = J[b]
            if not b.startswith('upperarm'): q = R2 @ (q - el) + el
            J[b] = R1 @ (q - sh) + sh

# ---------------- body mesh (helpers and joint cubes dropped), scaled so the finished trooper is height_m ----------------
body = np.zeros(len(co), bool); body[grp('body')] = True
keep_f = [i for i, f in enumerate(faces) if body[f].all()]
used_v = np.unique(np.concatenate([faces[i] for i in keep_f])); remap = -np.ones(len(co), int); remap[used_v] = np.arange(len(used_v))
bco = co[used_v]
z0 = bco[:, 2].min(); s = (R['height_m'] - 0.03) / (bco[:, 2].max() - z0)   # the helmet adds ~3 cm on top
def X(p): p = np.array(p, float); return np.stack([p[..., 0] * s, p[..., 1] * s, (p[..., 2] - z0) * s], -1)
bco = X(bco); JH = {k: X(v) for k, v in JH.items()}; JT = {k: X(v) for k, v in JT.items()}
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('body'); me.from_pydata(bco.tolist(), [], [[remap[v] for v in faces[i]] for i in keep_f])
uvl = me.uv_layers.new(name='UVMap')
uvs = np.array([vts[fuv[i][k]] for i in keep_f for k in range(len(faces[i]))]); uvl.data.foreach_set('uv', uvs.ravel())
body_o = bpy.data.objects.new('body', me); bpy.context.collection.objects.link(body_o)
print('body', len(me.vertices), 'verts, height', round(float(bco[:, 2].max()), 3))

# ---------------- materials (flat PBR; baked into one atlas at the end) ----------------
def mat(name, col, rough, metal=0.0, noise=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if noise > 0:   # subtle grime and wear, baked into the base colour
        tc = nt.nodes.new('ShaderNodeTexCoord'); n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 28; n1.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (*[c * (1 - noise) for c in col], 1); ramp.color_ramp.elements[1].color = (*[min(1, c * (1 + noise * 0.5)) for c in col], 1)
        nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*col, 1)
    return m
C = R['colors']
MATS = {'suit': mat('suit', C['suit'], 0.85, 0, 0.25), 'armor': mat('armor', C['armor'], 0.5, 0, 0.18), 'black': mat('black', C['black'], 0.6),
        'leather': mat('leather', C['leather'], 0.7, 0, 0.3), 'visor': mat('visor', C['visor'], 0.12, 0.4), 'metal': mat('metal', C['metal'], 0.35, 0.9),
        'skin': mat('skin', C['skin'], 0.6)}
for k in ('suit', 'black', 'skin'): me.materials.append(MATS[k])

# ---------------- regions on the body ----------------
bm0 = bmesh.new(); bm0.from_mesh(me); bm0.faces.ensure_lookup_table(); bm0.verts.ensure_lookup_table()
FC = np.array([f.calc_center_median()[:] for f in bm0.faces]); FN = np.array([f.normal[:] for f in bm0.faces])
VC = np.array([v.co[:] for v in bm0.verts]); VN = np.array([v.normal[:] for v in bm0.verts])
_ev = np.array([[e.verts[0].index, e.verts[1].index] for e in bm0.edges]); _deg = np.bincount(_ev.ravel(), minlength=len(VC))[:, None]
def vsmooth(a, it):
    for _ in range(it):
        acc = np.zeros_like(a); np.add.at(acc, _ev[:, 0], a[_ev[:, 1]]); np.add.at(acc, _ev[:, 1], a[_ev[:, 0]]); a = 0.5 * a + 0.5 * acc / np.maximum(_deg, 1)
    return a
_raw = VN.copy(); VN = vsmooth(VN, 12); _nl = np.linalg.norm(VN, axis=1, keepdims=True)
VN = np.where(_nl > 0.2, VN / np.maximum(_nl, 1e-6), _raw)   # cavities (mouth, eye sockets, between toes) cancel out: keep their own normal
fx, fy, fz = FC[:, 0], FC[:, 1], FC[:, 2]
TOECAP = {}
for _sd in 'lr':
    _an, _ball = JH[f'foot_{_sd}'], JH[f'ball_{_sd}']
    _foot = (VC[:, 2] < _an[2] + 0.02) & (np.sign(VC[:, 0]) == (1 if _sd == 'l' else -1))
    _toe = _foot & (VC[:, 1] < _ball[1] + 0.015)
    tip = VC[_toe][:, 1].min(); _c = np.array([_ball[0], (_ball[1] + tip) / 2, 0.025])
    VC[_toe] = _c + (VC[_toe] - _c) * [0.8, 0.85, 0.7]       # tuck the toes in under the cap
    for _i in np.where(_toe)[0]: bm0.verts[_i].co = V(VC[_i])
    xs = VC[_foot & (VC[:, 1] < _ball[1] + 0.03)][:, 0]
    TOECAP[_sd] = (_c, np.array([(xs.max() - xs.min()) / 2 + 0.014, (_ball[1] + 0.03 - tip) / 2 + 0.014, 0.042]))
bm0.to_mesh(me)
def seg_t(P, a, b):
    ab = b - a; t = ((P - a) @ ab) / (ab @ ab); d = np.linalg.norm(P - (a + np.clip(t, 0, 1)[:, None] * ab), axis=1); return t, d
J = JH
# body materials: hands -> gloves (black), head -> skin (hidden by the helmet), rest -> fatigues
hand_f = np.zeros(len(FC), bool)
for sd in 'lr':
    t, d = seg_t(FC, J[f'hand_{sd}'], J[f'middle_01_{sd}'] + (J[f'middle_01_{sd}'] - J[f'hand_{sd}']) * 1.4)
    hand_f |= (t > -0.25) & (d < 0.07) & (np.sign(fx) == (1 if sd == 'l' else -1))
head_f = fz > J['neck_01'][2] + 0.05
for i, f in enumerate(bm0.faces): f.material_index = 1 if hand_f[i] else (2 if head_f[i] else 0)
bm0.to_mesh(me)

# ---------------- armour pieces: offset shells of body regions ----------------
PIECES = []
def outward(a, b):
    """faces facing away from the axis a->b (drops cavities: mouth, eye sockets, between the toes)"""
    t = np.clip(((FC - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1); r = FC - (a + t[:, None] * (b - a))
    return np.einsum('ij,ij->i', FN, r) > 0.0
def shell(mask, name, m, off, thick, smooth=2, bevel=0.003, edge_smooth=6):
    """faces of the body under `mask` -> separate object pushed out along the vertex normals, smoothed, thickened, bevelled"""
    idx = np.where(mask)[0]
    if len(idx) < 4: print('skip', name); return None
    bm = bmesh.new(); vmap = {}; NRM = {}; ORG = {}
    for i in idx:
        f = bm0.faces[i]; vv = []
        for v in f.verts:
            if v.index not in vmap:
                o_ = off(v.co) if callable(off) else off
                vmap[v.index] = bm.verts.new(V(VC[v.index]) + V(VN[v.index]) * o_)
            vv.append(vmap[v.index]); NRM[vmap[v.index]] = V(VN[v.index]); ORG[vmap[v.index]] = vmap[v.index].co.copy()
        try: bm.faces.new(vv)
        except ValueError: pass
    # drop slivers: faces hanging on by one edge make ragged borders
    for _ in range(2):
        lone = [f for f in bm.faces if sum(1 for e in f.edges if e.is_boundary) >= 3]
        bmesh.ops.delete(bm, geom=lone, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bad = [v for v in bm.verts if not all(math.isfinite(c) for c in v.co)]
    if bad: print('non-finite verts', name, len(bad)); bmesh.ops.delete(bm, geom=bad, context='VERTS')
    for _ in range(smooth): bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # smoothing shrinks a shell back into the body: keep the tangential smoothing, cancel the inward part
    for v in bm.verts:
        if v in NRM:
            dn = (v.co - ORG[v]).dot(NRM[v])
            if dn < 0: v.co -= NRM[v] * dn
    # straighten the plate borders: smooth boundary vertices along the border only
    for _ in range(edge_smooth):
        new = {}
        for v in bm.verts:
            if not v.is_boundary: continue
            nb = [e.other_vert(v).co for e in v.link_edges if e.is_boundary]
            if len(nb) == 2: new[v] = v.co * 0.5 + (nb[0] + nb[1]) * 0.25
        for v, c in new.items(): v.co = c
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mm = bpy.data.meshes.new(name); bm.to_mesh(mm); o = bpy.data.objects.new(name, mm); bpy.context.collection.objects.link(o)
    mm.materials.append(MATS[m])
    so = o.modifiers.new('thick', 'SOLIDIFY'); so.thickness = thick; so.offset = 1.0; so.use_even_offset = False; so.use_quality_normals = True
    if bevel > 0:
        bv = o.modifiers.new('bevel', 'BEVEL'); bv.width = bevel; bv.segments = 2; bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(40)
    PIECES.append(o); return o
def box(name, m, center, size, rot=(0, 0, 0), bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot); o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.data.materials.append(MATS[m])
    bv = o.modifiers.new('bevel', 'BEVEL'); bv.width = bevel; bv.segments = 3
    PIECES.append(o); return o
side = lambda sd: (1 if sd == 'l' else -1)
P, S1, S2, S3, N_ = J['pelvis'], J['spine_02'], J['spine_03'], J['neck_01'], J['neck_01']
SHL, SHR = J['upperarm_l'], J['upperarm_r']
inside_shoulders = np.abs(fx) < abs(SHL[0]) - 0.04
# chest and back plates (side gap where the normals face sideways); collar line just under the neck
chest_z = (fz > S1[2] - 0.02) & (fz < N_[2] - 0.035)
shell(chest_z & inside_shoulders & (FN[:, 1] < -0.35) & (np.abs(FN[:, 0]) < 0.75), 'chest_plate', 'armor', 0.02, 0.007, smooth=14)
shell(chest_z & inside_shoulders & (FN[:, 1] > 0.35) & (np.abs(FN[:, 0]) < 0.75), 'back_plate', 'armor', 0.02, 0.007, smooth=14)
# abdomen plate, front, a band below the chest
shell((fz > P[2] + 0.11) & (fz < S1[2] - 0.035) & (FN[:, 1] < -0.3) & (np.abs(fx) < 0.12), 'ab_plate', 'armor', 0.012, 0.005, smooth=3)
# belt ring
belt = shell((fz > P[2] + 0.025) & (fz < P[2] + 0.085) & (np.abs(fx) < 0.25), 'belt', 'leather', 0.012, 0.006, smooth=2, bevel=0.002)
# pouches on the belt (front left/right, back), canteen on the right hip
for i, (x_, yy) in enumerate(((0.07, -1), (-0.07, -1), (0.12, -0.6), (-0.12, -0.6), (0.0, 1))):
    m_ = (np.abs(fx - x_) < 0.03) & (np.abs(fz - (P[2] + 0.055)) < 0.03) & (np.sign(fy) == yy / abs(yy))
    if m_.any():
        c = FC[m_].mean(0); n = FN[m_].mean(0); n /= np.linalg.norm(n)
        box(f'pouch_{i}', 'leather', c + n * 0.035, (0.05, 0.04, 0.055) if abs(n[1]) > abs(n[0]) else (0.04, 0.05, 0.055), rot=(0, 0, math.atan2(n[0], -n[1])), bevel=0.008)
# shoulder pauldrons, forearm bracers, gloves' cuffs
for sd in 'lr':
    sg = side(sd); sh, el, wr = J[f'upperarm_{sd}'], J[f'lowerarm_{sd}'], J[f'hand_{sd}']
    t, d = seg_t(FC, sh, el); out = (FC - sh) @ (np.array([sg, 0, 0.6]) / np.linalg.norm([1, 0, 0.6]))
    shell((t > -0.15) & (t < 0.42) & (d < 0.08) & (out > -0.01) & (np.sign(fx) == sg), f'pauldron_{sd}', 'armor', 0.022, 0.006, smooth=10)
    t, d = seg_t(FC, el, wr)
    shell((t > 0.22) & (t < 0.86) & (d < 0.07) & (np.sign(fx) == sg), f'bracer_{sd}', 'armor', 0.012, 0.005, smooth=6)
    # legs: thigh plate (front/outer), knee pad, shin guard, boots
    hip, kn, an, ball = J[f'thigh_{sd}'], J[f'calf_{sd}'], J[f'foot_{sd}'], J[f'ball_{sd}']
    t, d = seg_t(FC, hip, kn); front_out = FN @ (np.array([sg * 0.6, -1, 0]) / np.linalg.norm([0.6, 1, 0]))
    shell((t > 0.18) & (t < 0.72) & (d < 0.12) & (front_out > 0.25) & (np.sign(fx) == sg), f'thigh_plate_{sd}', 'armor', 0.014, 0.005, smooth=8)
    dk = np.linalg.norm(FC - (kn + np.array([0, -0.03, 0])), axis=1)
    shell((dk < 0.075) & (FN[:, 1] < -0.2) & (np.sign(fx) == sg), f'knee_pad_{sd}', 'black', 0.018, 0.008, smooth=4)
    t, d = seg_t(FC, kn, an)
    shell((t > 0.18) & (t < 0.62) & (d < 0.09) & (FN[:, 1] < -0.15) & (np.sign(fx) == sg), f'shin_guard_{sd}', 'armor', 0.013, 0.005, smooth=8)
    shell((((t > 0.62) & (d < 0.1)) | ((fz < an[2] + 0.04) & (fy > ball[1] + 0.0) & outward(an + np.array([0, 0, -0.05]), ball + np.array([0, -0.06, 0])))) & (np.sign(fx) == sg) & (fz < kn[2] - 0.12), f'boot_{sd}', 'black', 0.011, 0.006, smooth=10, bevel=0.0)
    # toe cap: a rounded box over the forefoot, flat sole
    c_, r_ = TOECAP[sd]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0); tc = bpy.context.object; tc.name = f'toe_cap_{sd}'
    tb = bmesh.new(); tb.from_mesh(tc.data)
    for v in tb.verts:
        q = np.array(v.co[:]); q = np.sign(q) * np.abs(q) ** 0.7   # squarer than an ellipsoid
        v.co = V(c_ + q * r_); v.co.z = max(v.co.z, 0.0)
    tb.to_mesh(tc.data); tb.free(); tc.data.materials.append(MATS['black']); bpy.ops.object.shade_smooth(); PIECES.append(tc)
# collar ring around the neck base
shell((fz > N_[2] - 0.045) & (fz < N_[2] + 0.005) & (np.abs(fx) < 0.09), 'collar', 'suit', 0.012, 0.008, smooth=3, bevel=0.002)
# helmet: an ellipsoid fitted around the head (ears included), open below the jaw, with a recessed black visor band
HD = J['head']; NK = J['neck_01']
hv = VC[(VC[:, 2] > NK[2] + 0.045)]
hmin, hmax = hv.min(0), hv.max(0); hc = (hmin + hmax) / 2; hr = (hmax - hmin) / 2 + np.array([0.028, 0.03, 0.026])
hc[2] += 0.012
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.0, location=(0, 0, 0)); hel = bpy.context.object; hel.name = 'helmet'
hb = bmesh.new(); hb.from_mesh(hel.data)
for v in hb.verts: v.co = V((v.co.x * hr[0] + hc[0], v.co.y * hr[1] + hc[1], v.co.z * hr[2] + hc[2]))
jaw_z = NK[2] + 0.06
cut = [f for f in hb.faces if f.calc_center_median().z < jaw_z + (-0.07 if f.calc_center_median().y < hc[1] - hr[1] * 0.3 else -0.005)]
bmesh.ops.delete(hb, geom=cut, context='FACES')
bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context='VERTS')
eye_z = HD[2] + 0.035
for f in hb.faces:
    c = f.calc_center_median()
    if c.y < hc[1] - hr[1] * 0.55 and abs(c.z - eye_z) < 0.03 and abs(c.x - hc[0]) < hr[0] * 0.8: f.material_index = 1
for v in hb.verts:   # recess the visor band a few millimetres
    if any(f.material_index == 1 for f in v.link_faces) and all(f.material_index == 1 for f in v.link_faces): v.co.y += 0.004
hb.to_mesh(hel.data); hb.free()
hel.data.materials.append(MATS['armor']); hel.data.materials.append(MATS['visor'])
so = hel.modifiers.new('thick', 'SOLIDIFY'); so.thickness = 0.007; so.offset = -1.0; so.use_quality_normals = True
bpy.ops.object.shade_smooth(); PIECES.append(hel)
top = float(hc[2] + hr[2])
# (no antenna: the pipeline scales the source by its bounding box, so nothing may stick out above the helmet)
# back pack (radio) between the shoulder blades
bc = FC[(np.abs(fx) < 0.05) & (np.abs(fz - (S2[2] - 0.04)) < 0.04) & (FN[:, 1] > 0.5)].mean(0)
box('pack', 'armor', bc + np.array([0, 0.075, 0]), (0.24, 0.08, 0.26), bevel=0.012)
box('pack_strap_l', 'leather', bc + np.array([0.075, 0.025, 0.12]), (0.035, 0.03, 0.05), bevel=0.004)
box('pack_strap_r', 'leather', bc + np.array([-0.075, 0.025, 0.12]), (0.035, 0.03, 0.05), bevel=0.004)

# ---------------- one mesh, one UV atlas, bake to 2K ----------------
for o in PIECES:
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    for mdf in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=mdf.name)
    if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    _c = np.array([v.co[:] for v in o.data.vertices]); _e = np.array([e.vertices[:] for e in o.data.edges])
    _L = np.linalg.norm(_c[_e[:, 0]] - _c[_e[:, 1]], axis=1) if len(_e) else np.zeros(1)
    if _L.max() > 0.06: print('LONG EDGES', o.name, int((_L > 0.06).sum()), round(float(_L.max()), 3))
bpy.ops.object.select_all(action='DESELECT')
for o in PIECES + [body_o]: o.select_set(True)
bpy.context.view_layer.objects.active = body_o; bpy.ops.object.join(); tro = bpy.context.object; tro.name = 'trooper'
bpy.ops.object.shade_smooth()
atlas = tro.data.uv_layers.new(name='Atlas'); tro.data.uv_layers.active = atlas
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')
print('trooper', len(tro.data.vertices), 'verts', len(tro.data.polygons), 'faces')
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 4; sc.cycles.device = 'CPU'
TX = R['tex']
def bake(kind, img_name, colorspace='sRGB', setup=None):
    img = bpy.data.images.new(img_name, TX, TX, alpha=False); img.colorspace_settings.name = colorspace
    nodes = []
    for m in tro.data.materials:
        nd = m.node_tree.nodes.new('ShaderNodeTexImage'); nd.image = img; m.node_tree.nodes.active = nd; nodes.append((m, nd))
    if setup: setup()
    bpy.ops.object.select_all(action='DESELECT'); tro.select_set(True); bpy.context.view_layer.objects.active = tro
    sc.render.bake.margin = 6; sc.render.bake.use_selected_to_active = False
    if kind == 'DIFFUSE': sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
    bpy.ops.object.bake(type=kind, uv_layer='Atlas')
    for m, nd in nodes: m.node_tree.nodes.remove(nd)
    return img
base = bake('DIFFUSE', 'T_Trooper_BaseColor')
rough = bake('ROUGHNESS', 'T_Trooper_Rough', 'Non-Color')
# metallic: bake it as emission (temporarily route the metallic value to an emission shader)
saved = []
def metal_setup():
    for m in tro.data.materials:
        nt = m.node_tree; b = nt.nodes['Principled BSDF']; out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        em = nt.nodes.new('ShaderNodeEmission'); v = b.inputs['Metallic'].default_value; em.inputs['Color'].default_value = (v, v, v, 1)
        old = out.inputs['Surface'].links[0].from_socket; nt.links.new(em.outputs['Emission'], out.inputs['Surface']); saved.append((nt, em, old, out))
metal = bake('EMIT', 'T_Trooper_Metal', 'Non-Color', metal_setup)
for nt, em, old, out in saved: nt.links.new(old, out.inputs['Surface']); nt.nodes.remove(em)
# ORM: R = AO (1), G = roughness, B = metallic
rp = np.array(rough.pixels[:]).reshape(-1, 4); mp = np.array(metal.pixels[:]).reshape(-1, 4)
orm = bpy.data.images.new('T_Trooper_ORM', TX, TX, alpha=False); orm.colorspace_settings.name = 'Non-Color'
o_ = np.ones_like(rp); o_[:, 1] = rp[:, 0]; o_[:, 2] = mp[:, 0]; orm.pixels.foreach_set(o_.astype(np.float32).ravel())
for img in (base, orm): img.pack()
# single game material
gm = bpy.data.materials.new('M_Trooper'); gm.use_nodes = True; nt = gm.node_tree; b = nt.nodes['Principled BSDF']
tb = nt.nodes.new('ShaderNodeTexImage'); tb.image = base; nt.links.new(tb.outputs['Color'], b.inputs['Base Color'])
to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm; sp = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(to.outputs['Color'], sp.inputs['Color']); nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
tro.data.materials.clear(); tro.data.materials.append(gm)
tro.data.uv_layers.remove(tro.data.uv_layers['UVMap']); tro.data.uv_layers.active = tro.data.uv_layers['Atlas']; tro.data.uv_layers['Atlas'].name = 'UVMap'

# ---------------- skeleton with the joint names the pipeline reads (Tripo-style), exact MakeHuman joints ----------------
NAMES = {'Pelvis': 'pelvis', 'Waist': 'spine_01', 'Spine01': 'spine_02', 'Spine02': 'spine_03', 'NeckTwist01': 'neck_01', 'Head': 'head'}
for sd, T in (('l', 'L'), ('r', 'R')):
    NAMES.update({f'{T}_Clavicle': f'clavicle_{sd}', f'{T}_Upperarm': f'upperarm_{sd}', f'{T}_Forearm': f'lowerarm_{sd}', f'{T}_Hand': f'hand_{sd}',
                  f'{T}_Thigh': f'thigh_{sd}', f'{T}_Calf': f'calf_{sd}', f'{T}_Foot': f'foot_{sd}', f'{T}_ToeBase': f'ball_{sd}'})
    for ours, mh in (('Thumb', 'thumb'), ('Index', 'index'), ('Mid', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
        for i in (1, 2, 3): NAMES[f'{T}_{ours}{i}'] = f'{mh}_0{i}_{sd}'
ad = bpy.data.armatures.new('rig'); ao = bpy.data.objects.new('rig', ad); bpy.context.collection.objects.link(ao)
bpy.context.view_layer.objects.active = ao; bpy.ops.object.mode_set(mode='EDIT')
for ours, mh in NAMES.items():
    eb = ad.edit_bones.new(ours); eb.head = V(JH[mh]); eb.tail = V(JT[mh]) if np.linalg.norm(JT[mh] - JH[mh]) > 1e-3 else V(JH[mh]) + V((0, 0, 0.02))
bpy.ops.object.mode_set(mode='OBJECT')
# raw frame of a pre-rigged source: face +X, left at +Y (prep turns it to face -Y)
Rz = M.Rotation(math.pi / 2, 4, 'Z')
tro.data.transform(Rz); ao.matrix_world = Rz @ ao.matrix_world
bpy.ops.object.select_all(action='DESELECT'); ao.select_set(True); bpy.context.view_layer.objects.active = ao; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.context.scene.objects if o not in (tro, ao)]: bpy.data.objects.remove(o)
# bind the mesh to the skeleton (everything on Pelvis) so the GLB carries a real armature; the pipeline discards this skin
vg = tro.vertex_groups.new(name='Pelvis'); vg.add(list(range(len(tro.data.vertices))), 1.0, 'REPLACE')
tro.parent = ao; am = tro.modifiers.new('rig', 'ARMATURE'); am.object = ao
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='AUTO', export_skins=True, export_animations=False)
json.dump({'recipe': {k: v for k, v in R.items() if k != 'colors'}, 'colors': R['colors'], 'targets': used, 'joints': len(NAMES),
           'verts': len(tro.data.vertices), 'faces': len(tro.data.polygons)}, open(os.path.splitext(OUT)[0] + '.recipe.json', 'w'), indent=1)
print('wrote', OUT)
