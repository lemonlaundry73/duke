# Duke Forger character creator: the Jedi from the user's character sheet (assets/characters/jedi/Source/reference/
# character_sheet.png), built from scratch in Blender on the MakeHuman / MPFB base human (CC0 data only; no MPFB code).
#
#   body      MakeHuman base mesh shaped with its macro targets (male, athletic, mostly African), eyeballs kept
#   face      his face projected from the sheet's front close-up onto the head (skin tone sampled from the photo)
#   hair      short curly hair and a full beard: displaced shells on the scalp and jaw
#   clothing  dark-brown inner tunic with a wrap front and long sleeves, black leather tabard (sleeveless, open front,
#             long front/back panels), tunic skirt, wide sash + brown leather belt with buckle and pouches, dark pants,
#             knee-high brown boots with straps and buckles, leather gloves, strapped forearm bracers
#   output    one mesh, one 4K PBR set (BaseColor, ORM, Normal), skeleton with the exact MakeHuman joints in the Duke
#             A-pose, as a pre-rigged source GLB for tools/rigging/run.sh ("joints": "source")
#
# usage: python -I mpfb_jedi.py <mpfb data dir> <face_front.png> <out.glb> [recipe.json]
import bpy, bmesh, sys, os, json, gzip, math, numpy as np
from mathutils import Vector as V, Matrix as M

args = [a for a in sys.argv if not a.startswith('-')]
if args[-1].endswith('.json'): DATA, FACE, OUT, RECIPE = args[-4], args[-3], args[-2], json.load(open(args[-1]))
else: DATA, FACE, OUT, RECIPE = args[-3], args[-2], args[-1], {}
R = dict(gender=1.0, age=0.52, muscle=0.62, weight=0.48, height=0.62, proportions=1.0,
         race={'african': 0.8, 'caucasian': 0.1, 'asian': 0.1}, height_m=1.83, tex=4096,
         # front close-up landmarks (pixels from the top-left of the crop): eye centres, mouth centre
         face_px=dict(eye_r=(51, 82), eye_l=(102, 82), mouth=(77, 150)))
R.update(RECIPE)

# ---------------- base mesh (OBJ: y-up decimetres -> z-up metres, facing -Y, left = +X) ----------------
def to_b(a): a = np.asarray(a, float); return np.stack([a[..., 0], -a[..., 2], a[..., 1]], -1) * 0.1
vs, vts, faces, fuv = [], [], [], []
for line in open(os.path.join(DATA, '3dobjs', 'base.obj')):
    if line.startswith('v '): vs.append([float(t) for t in line.split()[1:4]])
    elif line.startswith('vt '): vts.append([float(t) for t in line.split()[1:3]])
    elif line.startswith('f '):
        ids = [p.split('/') for p in line.split()[1:]]
        faces.append([int(p[0]) - 1 for p in ids]); fuv.append([int(p[1]) - 1 if len(p) > 1 and p[1] else 0 for p in ids])
co = to_b(vs); vts = np.array(vts)
def load_target(rel):
    off = np.zeros_like(co)
    with gzip.open(os.path.join(DATA, 'targets', rel), 'rt') as f:
        for line in f:
            if not line.strip() or line[0] == '#': continue
            p = line.split(); off[int(p[0])] = to_b([float(p[1]), float(p[2]), float(p[3])])
    return off
def split(val, lo, mid, hi):
    if val < 0.5: return {lo: 1 - val * 2, mid: val * 2}
    return {mid: 1 - (val - 0.5) * 2, hi: (val - 0.5) * 2}
G = {'male': R['gender'], 'female': 1 - R['gender']}
A = split(R['age'], 'child', 'young', 'old') if abs(R['age'] - 0.5) > 1e-3 else {'young': 1.0}
A = {k: v for k, v in A.items() if v > 1e-4}
MU = split(R['muscle'], 'minmuscle', 'averagemuscle', 'maxmuscle'); WE = split(R['weight'], 'minweight', 'averageweight', 'maxweight')
total = np.zeros_like(co); used = []
def add(rel, w):
    global total
    if w <= 1e-4 or not os.path.exists(os.path.join(DATA, 'targets', rel)): return
    total = total + load_target(rel) * w; used.append((rel, round(w, 3)))
for g, gw in G.items():
    for a, aw in A.items():
        for race, rw in R['race'].items(): add(f'macrodetails/{race}-{g}-{a}.target.gz', gw * aw * rw)
        for m, mw in MU.items():
            for wt, ww in WE.items():
                base = gw * aw * mw * ww; add(f'macrodetails/universal-{g}-{a}-{m}-{wt}.target.gz', base)
                hw = (R['height'] - 0.5) * 2
                if abs(hw) > 1e-3: add(f'macrodetails/height/{g}-{a}-{m}-{wt}-{"maxheight" if hw > 0 else "minheight"}.target.gz', base * abs(hw))
                pw = (R['proportions'] - 0.5) * 2
                if abs(pw) > 1e-3: add(f'macrodetails/proportions/{g}-{a}-{m}-{wt}-{"idealproportions" if pw > 0 else "uncommonproportions"}.target.gz', base * abs(pw))
co = co + total
VG = json.load(open(os.path.join(DATA, 'mesh_metadata', 'basemesh_vertex_groups.json')))
def grp(name): return np.concatenate([np.arange(a, b + 1) for a, b in VG[name]])
RIG = json.load(open(os.path.join(DATA, 'rigs', 'standard', 'rig.game_engine.json')))
def place(spec): return co[grp(spec['cube_name'])].mean(0) if spec['strategy'] == 'CUBE' else co[spec['vertex_indices']].mean(0)
JH = {b: place(d['head']) for b, d in RIG.items()}; JT = {b: place(d['tail']) for b, d in RIG.items()}
EYE = {'l': co[grp('joint-l-eye')].mean(0), 'r': co[grp('joint-r-eye')].mean(0)}; MOUTH = co[grp('joint-mouth')].mean(0)
# arms into the Duke A-pose with MakeHuman's own skin weights
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
    arm_w = wsum(lambda b: b.endswith(mh) and b.startswith(('upperarm', 'lowerarm', 'wrist', 'metacarpal', 'finger')))
    fore_w = wsum(lambda b: b.endswith(mh) and b.startswith(('lowerarm', 'wrist', 'metacarpal', 'finger')))
    sh, el, wr = JH[f'upperarm_{sd}'], JH[f'lowerarm_{sd}'], JH[f'hand_{sd}']
    R1 = rot_between(el - sh, TRO['upperarm'] * [sg, 1, 1]); R2 = rot_between(wr - el, R1.T @ (TRO['lowerarm'] * [sg, 1, 1]))
    p = co - el; co = co + ((R2 @ p.T).T + el - co) * fore_w[:, None]
    p = co - sh; co = co + ((R1 @ p.T).T + sh - co) * arm_w[:, None]
    for J_ in (JH, JT):
        for b in list(J_):
            if not b.endswith('_' + sd) or b.startswith(('clavicle', 'thigh', 'calf', 'foot', 'ball')): continue
            q = J_[b]
            if not b.startswith('upperarm'): q = R2 @ (q - el) + el
            J_[b] = R1 @ (q - sh) + sh

# ---------------- body + eyeballs, scaled ----------------
keep = np.zeros(len(co), bool)
for gname in ('body', 'helper-l-eye', 'helper-r-eye'): keep[grp(gname)] = True
EYEV = np.zeros(len(co), bool); EYEV[grp('helper-l-eye')] = True; EYEV[grp('helper-r-eye')] = True
HAIRV = np.zeros(len(co), bool); HAIRV[grp('helper-hair')] = True
keep_f = [i for i, f in enumerate(faces) if keep[f].all()]
body_only = np.zeros(len(co), bool); body_only[grp('body')] = True
z0 = co[body_only][:, 2].min(); s = (R['height_m'] - 0.022) / (co[body_only][:, 2].max() - z0)   # the hair adds ~2 cm
def X(p): p = np.array(p, float); return np.stack([p[..., 0] * s, p[..., 1] * s, (p[..., 2] - z0) * s], -1)
coS = X(co); JH = {k: X(v) for k, v in JH.items()}; JT = {k: X(v) for k, v in JT.items()}
EYE = {k: X(v) for k, v in EYE.items()}; MOUTH = X(MOUTH)
used_v = np.unique(np.concatenate([faces[i] for i in keep_f])); remap = -np.ones(len(co), int); remap[used_v] = np.arange(len(used_v))
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('body'); me.from_pydata(coS[used_v].tolist(), [], [[remap[v] for v in faces[i]] for i in keep_f])
uvl = me.uv_layers.new(name='UVMap'); uvl.data.foreach_set('uv', np.array([vts[fuv[i][k]] for i in keep_f for k in range(len(faces[i]))]).ravel())
body_o = bpy.data.objects.new('body', me); bpy.context.collection.objects.link(body_o)
is_eye_v = EYEV[used_v]
HAIR_CAP = coS[HAIRV]      # MakeHuman's fitted hair helper: the outer limit of the hair volume
print('body', len(me.vertices), 'height', round(float(coS[body_only][:, 2].max()), 3), 'targets', len(used))

# ---------------- face photo, skin tone ----------------
face_img = bpy.data.images.load(FACE); FW, FH = face_img.size
fpx = np.array(face_img.pixels[:], np.float32).reshape(FH, FW, 4)
def photo(x, y): return fpx[FH - 1 - int(y), int(x), :3]
cheek = np.median(np.array([photo(x, y) for x in list(range(30, 46)) + list(range(108, 124)) for y in range(96, 116)] + [photo(x, y) for x in range(62, 92) for y in range(40, 52)]), 0)
cheek = cheek.mean() + (cheek - cheek.mean()) * 0.75   # slightly desaturated so the projection blends into the rest of the head
skin_lin = tuple(float(c) ** 2.2 for c in cheek)    # 8-bit PNG pixels come back sRGB-encoded
print('skin tone (linear)', np.round(cheek, 3))

# ---------------- materials (procedural, baked into one atlas) ----------------
def mat(name, col, rough, metal=0.0, bump=0.0, bump_scale=200.0, var=0.12, wrinkle=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 18; n1.inputs['Detail'].default_value = 5; nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (*[c * (1 - var) for c in col], 1); ramp.color_ramp.elements[1].color = (*[min(1, c * (1 + var)) for c in col], 1)
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = rough * 0.85; mr.inputs['To Max'].default_value = min(1, rough * 1.15)
    nt.links.new(n1.outputs['Fac'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = metal
    if bump > 0:
        n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = bump_scale; n2.inputs['Detail'].default_value = 8; nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
        bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump; bp.inputs['Distance'].default_value = 0.002
        h = n2.outputs['Fac']
        if wrinkle > 0:   # leather creases: stretched voronoi edges on top of the grain
            vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = 22; nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
            mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MULTIPLY_ADD'; mx.inputs[1].default_value = wrinkle; nt.links.new(vo.outputs['Distance'], mx.inputs[0]); nt.links.new(n2.outputs['Fac'], mx.inputs[2]); h = mx.outputs['Value']
        nt.links.new(h, bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m
L = lambda c: tuple((x / 255.0) ** 2.2 for x in c)    # sRGB picks from the sheet -> linear
MATS = {
    'skin': mat('skin', skin_lin, 0.5, 0, 0.06, 900, 0.06),
    'tunic': mat('tunic', L((62, 44, 34)), 0.88, 0, 0.12, 700, 0.10),
    'under': mat('under', L((52, 37, 29)), 0.9, 0, 0.1, 700, 0.08),
    'tabard': mat('tabard', L((28, 22, 19)), 0.42, 0, 0.1, 380, 0.07, wrinkle=0.35),
    'leather': mat('leather', L((70, 44, 30)), 0.5, 0, 0.12, 380, 0.09, wrinkle=0.35),
    'boots': mat('boots', L((58, 38, 27)), 0.42, 0, 0.12, 380, 0.1, wrinkle=0.45),
    'pants': mat('pants', L((38, 30, 26)), 0.85, 0, 0.1, 700, 0.08),
    'gloves': mat('gloves', L((40, 28, 22)), 0.48, 0, 0.1, 420, 0.08, wrinkle=0.3),
    'metal': mat('metal', L((175, 175, 178)), 0.28, 1.0, 0.02, 300, 0.05),
    'hair': mat('hair', L((14, 12, 11)), 0.55, 0, 0.6, 160, 0.25),
    'face': None, 'eye': None}
# the face: front photo projected (UV layer 'proj'), blended into the sampled skin tone where the head turns away
def face_mat(name, fallback=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'proj'
    ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = face_img; ti.extension = 'EXTEND'; nt.links.new(uv.outputs['UV'], ti.inputs['Vector'])
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'projw'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['A'].default_value = (*(fallback or skin_lin), 1)
    nt.links.new(at.outputs['Fac'], mix.inputs['Factor']); nt.links.new(ti.outputs['Color'], mix.inputs['B']); nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = {'face': 0.45, 'eye': 0.15, 'beard': 0.85}.get(name, 0.5)
    if name == 'beard':   # hair fibres: fine anisotropic-looking bump and a little colour variation
        tc = nt.nodes.new('ShaderNodeTexCoord'); wv = nt.nodes.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 900; wv.inputs['Distortion'].default_value = 25
        nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
        n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 1400; nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
        mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MULTIPLY'; nt.links.new(wv.outputs['Fac'], mx.inputs[0]); nt.links.new(n2.outputs['Fac'], mx.inputs[1])
        bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.001
        nt.links.new(mx.outputs['Value'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
        dk = nt.nodes.new('ShaderNodeMix'); dk.data_type = 'RGBA'; dk.blend_type = 'MULTIPLY'; dk.inputs['Factor'].default_value = 0.35
        nt.links.new(mix.outputs['Result'], dk.inputs['A']); nt.links.new(n2.outputs['Fac'], dk.inputs['B']); nt.links.new(dk.outputs['Result'], b.inputs['Base Color'])
    return m
MATS['face'] = face_mat('face'); MATS['eye'] = face_mat('eye')
MATS['beard'] = face_mat('beard', fallback=L((20, 16, 14)))   # the photo's beard in front, his hair colour where the jaw turns away

# ---------------- regions on the body ----------------
bm0 = bmesh.new(); bm0.from_mesh(me); bm0.faces.ensure_lookup_table(); bm0.verts.ensure_lookup_table()
FC = np.array([f.calc_center_median()[:] for f in bm0.faces]); FN = np.array([f.normal[:] for f in bm0.faces])
VC = np.array([v.co[:] for v in bm0.verts]); VN = np.array([v.normal[:] for v in bm0.verts])
_ev = np.array([[e.verts[0].index, e.verts[1].index] for e in bm0.edges]); _deg = np.bincount(_ev.ravel(), minlength=len(VC))[:, None]
def vsmooth(a, it):
    for _ in range(it):
        acc = np.zeros_like(a); np.add.at(acc, _ev[:, 0], a[_ev[:, 1]]); np.add.at(acc, _ev[:, 1], a[_ev[:, 0]]); a = 0.5 * a + 0.5 * acc / np.maximum(_deg, 1)
    return a
_raw = VN.copy(); VN = vsmooth(VN, 12); _nl = np.linalg.norm(VN, axis=1, keepdims=True); VN = np.where(_nl > 0.2, VN / np.maximum(_nl, 1e-6), _raw)
FEYE = np.array([is_eye_v[[v.index for v in f.verts]].all() for f in bm0.faces])
fx, fy, fz = FC[:, 0], FC[:, 1], FC[:, 2]
def seg_t(P, a, b):
    ab = b - a; t = ((P - a) @ ab) / (ab @ ab); d = np.linalg.norm(P - (a + np.clip(t, 0, 1)[:, None] * ab), axis=1); return t, d
def outward(a, b):
    t = np.clip(((FC - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1); r = FC - (a + t[:, None] * (b - a)); return np.einsum('ij,ij->i', FN, r) > 0.0
J = JH; side = lambda sd: (1 if sd == 'l' else -1)
P, S1, S2, S3, NK, HD = J['pelvis'], J['spine_01'], J['spine_02'], J['spine_03'], J['neck_01'], J['head']
EYE_Z = (EYE['l'][2] + EYE['r'][2]) / 2
hand_f = np.zeros(len(FC), bool)
for sd in 'lr':
    t, d = seg_t(FC, J[f'hand_{sd}'], J[f'middle_01_{sd}'] + (J[f'middle_01_{sd}'] - J[f'hand_{sd}']) * 1.4)
    hand_f |= (t > -0.15) & (d < 0.07) & (np.sign(fx) == side(sd))
head_f = (fz > NK[2] + 0.02) & ~FEYE
# body materials: eyes (photo), face/head skin (photo + tone), gloves on the hands, skin elsewhere (hidden by clothes)
for k in ('skin', 'gloves', 'face', 'eye'): me.materials.append(MATS[k])
print('hand faces', int(hand_f.sum()), 'head faces', int(head_f.sum()), 'eye faces', int(FEYE.sum()))
for i, f in enumerate(bm0.faces): f.material_index = 3 if FEYE[i] else (2 if head_f[i] else (1 if hand_f[i] else 0))
bm0.to_mesh(me)
# ---------------- clothing pieces: offset shells of body regions, lofted panels ----------------
PIECES = []
def shell(mask, name, m, off, thick, smooth=2, bevel=0.002, edge_smooth=6, disp=None):
    idx = np.where(mask)[0]
    if len(idx) < 4: print('skip', name); return None
    bm = bmesh.new(); vmap = {}; NRM = {}; ORG = {}
    for i in idx:
        f = bm0.faces[i]; vv = []
        for v in f.verts:
            if v.index not in vmap:
                o_ = off(v.co) if callable(off) else off
                nv = bm.verts.new(V(VC[v.index]) + V(VN[v.index]) * o_); vmap[v.index] = nv; NRM[nv] = V(VN[v.index]); ORG[nv] = nv.co.copy()
            vv.append(vmap[v.index])
        try: bm.faces.new(vv)
        except ValueError: pass
    for _ in range(2):
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if sum(1 for e in f.edges if e.is_boundary) >= 3], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for _ in range(smooth): bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in bm.verts:   # smoothing must not sink the shell into the body
        if v in NRM:
            dn = (v.co - ORG[v]).dot(NRM[v])
            if dn < 0: v.co -= NRM[v] * dn
    for _ in range(edge_smooth):
        new = {}
        for v in bm.verts:
            if not v.is_boundary: continue
            nb = [e.other_vert(v).co for e in v.link_edges if e.is_boundary]
            if len(nb) == 2: new[v] = v.co * 0.5 + (nb[0] + nb[1]) * 0.25
        for v, c in new.items(): v.co = c
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mm = bpy.data.meshes.new(name); bm.to_mesh(mm); o = bpy.data.objects.new(name, mm); bpy.context.collection.objects.link(o); mm.materials.append(MATS[m])
    if disp:   # curls: subdivide, then push along the normals with a voronoi texture
        sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = disp.get('sub', 1); sub.render_levels = sub.levels
        tx = bpy.data.textures.new(name + '_tx', 'VORONOI'); tx.noise_scale = disp['scale']; tx.distance_metric = 'DISTANCE'
        dm = o.modifiers.new('disp', 'DISPLACE'); dm.texture = tx; dm.strength = disp['strength']; dm.mid_level = 0.5; dm.texture_coords = 'OBJECT' if False else 'LOCAL'
    if thick > 0:
        so = o.modifiers.new('thick', 'SOLIDIFY'); so.thickness = thick; so.offset = 1.0; so.use_even_offset = False; so.use_quality_normals = True
    if bevel > 0:
        bv = o.modifiers.new('bevel', 'BEVEL'); bv.width = bevel; bv.segments = 2; bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(40)
    PIECES.append(o); return o
def box(name, m, center, size, rot=(0, 0, 0), bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot); o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.data.materials.append(MATS[m])
    if bevel: bv = o.modifiers.new('bevel', 'BEVEL'); bv.width = bevel; bv.segments = 3
    PIECES.append(o); return o
ARMV = np.zeros(len(VC), bool)
for _sd in 'lr':
    for _a, _b in (('upperarm', 'lowerarm'), ('lowerarm', 'hand'), ('hand', 'middle_01')):
        _p, _q = J[f'{_a}_{_sd}'], (J[f'{_b}_{_sd}'] + (J[f'{_b}_{_sd}'] - J[f'{_a}_{_sd}']) * (1.3 if _b == 'middle_01' else 0.0))
        _ab = _q - _p; _t = np.clip(((VC - _p) @ _ab) / (_ab @ _ab), 0, 1); ARMV |= np.linalg.norm(VC - (_p + _t[:, None] * _ab), axis=1) < 0.085
def ring_profile(zc, band=0.012, n=72, cx=0.0, cy=None, sel=None):
    """outer radius of the body around (cx, cy) at height zc, per angle (0 = front -Y, counter-clockwise from above)"""
    cy = P[1] if cy is None else cy
    m = (np.abs(VC[:, 2] - zc) < band) & ~ARMV & ~is_eye_v & (sel if sel is not None else True)
    q = VC[m]; ang = np.arctan2(q[:, 0] - cx, -(q[:, 1] - cy)); rad = np.hypot(q[:, 0] - cx, q[:, 1] - cy)
    out = np.zeros(n)
    for i in range(n):
        a0 = -math.pi + 2 * math.pi * i / n; d = np.abs((ang - a0 + math.pi) % (2 * math.pi) - math.pi)
        out[i] = rad[d < math.pi / n * 1.6].max() if (d < math.pi / n * 1.6).any() else np.nan
    good = ~np.isnan(out); out[~good] = np.interp(np.where(~good)[0], np.where(good)[0], out[good], period=n)
    return out
def loft(name, m, z_top, z_bot, off_top, flare, gaps=(), rows=14, thick=0.004, n=72, gap_rows_from=0.0, sway=0.0):
    """a hanging panel skirt: rings from the body's waist profile, flaring to the hem; gaps = (centre angle deg, half width deg)"""
    rt = ring_profile(z_top, n=n) + off_top
    bm = bmesh.new(); grid = []
    for r_ in range(rows + 1):
        u = r_ / rows; z = z_top + (z_bot - z_top) * u
        prof = ring_profile(z, n=n, sel=(VC[:, 2] < z_top + 0.02)) if u < 0.35 else None
        row = []
        for i in range(n):
            a = -math.pi + 2 * math.pi * i / n
            rad = rt[i] + flare * u ** 1.3
            if prof is not None: rad = max(rad, prof[i] + off_top * 0.8)
            dy = sway * u * u   # the back hangs a little behind
            row.append(bm.verts.new((P[0] + rad * math.sin(a), P[1] - rad * math.cos(a) + (dy if abs(a) > math.pi / 2 else 0), z)))
        grid.append(row)
    def in_gap(i, r_):
        a = math.degrees(-math.pi + 2 * math.pi * (i + 0.5) / n)
        return any(abs((a - c + 180) % 360 - 180) < w for c, w in gaps) and r_ / rows >= gap_rows_from
    for r_ in range(rows):
        for i in range(n):
            if in_gap(i, r_): continue
            j = (i + 1) % n; bm.faces.new((grid[r_][i], grid[r_][j], grid[r_ + 1][j], grid[r_ + 1][i]))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mm = bpy.data.meshes.new(name); bm.to_mesh(mm); o = bpy.data.objects.new(name, mm); bpy.context.collection.objects.link(o); mm.materials.append(MATS[m])
    so = o.modifiers.new('thick', 'SOLIDIFY'); so.thickness = thick; so.offset = -1.0
    sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = 1
    PIECES.append(o); return o

SHX = abs(J['upperarm_l'][0])
belt_z = P[2] + 0.075
# pants: hips and legs down into the boots
leg_f = np.zeros(len(FC), bool)
for sd in 'lr':
    t, d = seg_t(FC, J[f'thigh_{sd}'], J[f'foot_{sd}']); leg_f |= (t > -0.1) & (t < 1.0) & (d < 0.14) & (np.sign(fx) == side(sd))
PANTS_BOT = J['calf_l'][2] - 0.02   # boots start ~6 cm above the knee joint: the pants end inside them
shell(((fz < belt_z) & (fz > PANTS_BOT) & (np.abs(fx) < 0.3) & ~hand_f) | (leg_f & (fz > PANTS_BOT) & (fz < belt_z)), 'pants', 'pants', 0.006, 0.003, smooth=4, bevel=0)
# inner tunic: torso + long sleeves to the wrist; the wrap front shows a darker under-layer in a V
arm_f = np.zeros(len(FC), bool)
for sd in 'lr':
    t, d = seg_t(FC, J[f'upperarm_{sd}'], J[f'hand_{sd}']); arm_f |= (t > -0.05) & (t < 0.97) & (d < 0.1) & (np.sign(fx) == side(sd))
torso_f = (fz > P[2] - 0.02) & (fz < NK[2] + 0.01) & (np.abs(fx) < SHX + 0.03) & ~arm_f & ~hand_f
V_f = (FN[:, 1] < -0.2) & (np.abs(fx) < 0.006 + 0.2 * np.clip(fz - (S2[2] - 0.02), 0, 1)) & (fz > S2[2] - 0.02)
_open_w = 0.045 + 0.2 * np.clip(fz - belt_z, 0, 1)
_tab_core = (fz > belt_z + 0.02) & (fz < NK[2] - 0.02) & (np.abs(fx) < SHX - 0.08) & ~arm_f & ~hand_f & ~((FN[:, 1] < -0.05) & (np.abs(fx) < _open_w + 0.07))
_tab_core &= (FN[:, 1] > 0.2) | (np.abs(FN[:, 0]) > 0.75)   # only the back and the sides: the front keeps its tunic under the tabard edges
tun = shell((torso_f | arm_f) & ~V_f & ~_tab_core, 'tunic', 'tunic', 0.009, 0.004, smooth=6, bevel=0)
V_wide = ((FN[:, 1] < -0.15) | ((fz > S3[2] - 0.02) & (FN[:, 1] < 0.25))) & (np.abs(fx) < 0.006 + 0.2 * np.clip(fz - (S2[2] - 0.02), 0, 1) + 0.03) & (fz > S2[2] - 0.05)
shell(V_wide & (fz < NK[2] + 0.012), 'undershirt', 'under', 0.006, 0.002, smooth=4, bevel=0, edge_smooth=0)   # runs under the lapels: no gap
# wrap lapels: a raised band along both edges of the V
Vband = ((FN[:, 1] < -0.2) | ((fz > S3[2] - 0.02) & (FN[:, 1] < 0.25))) & ~V_f & (np.abs(fx) < 0.006 + 0.2 * np.clip(fz - (S2[2] - 0.02), 0, 1) + 0.034) & (fz > S2[2] - 0.05) & (fz < NK[2] + 0.015)
shell(Vband, 'lapels', 'tunic', 0.014, 0.004, smooth=4, bevel=0.002)
# tabard: black leather over the shoulders, sleeveless, open front (wider at the chest), long front and back panels
open_front = (FN[:, 1] < -0.1) & (np.abs(fx) < 0.045 + 0.2 * np.clip(fz - belt_z, 0, 1))
tab_up = (fz > belt_z - 0.02) & (fz < NK[2] + 0.015) & (np.abs(fx) < SHX + 0.035) & ~arm_f & ~hand_f & ~open_front
shell(tab_up | ((np.abs(fx) < SHX + 0.05) & (fz > S3[2]) & (fz < NK[2] + 0.015) & (FN[:, 2] > 0.3) & ~open_front), 'tabard', 'tabard', 0.02, 0.005, smooth=8, bevel=0.003)
kn_z = J['calf_l'][2]
loft('tabard_panels', 'tabard', belt_z - 0.01, kn_z + 0.03, 0.05, 0.07, gaps=((0, 16), (90, 9), (-90, 9)), thick=0.005, sway=0.02)
loft('tunic_skirt', 'tunic', belt_z - 0.005, kn_z + 0.09, 0.026, 0.04, gaps=((0, 4),), gap_rows_from=0.45, thick=0.004)
# sash and belt
shell((fz > belt_z - 0.045) & (fz < belt_z + 0.05) & (np.abs(fx) < 0.3) & ~arm_f & ~hand_f, 'sash', 'tunic', 0.036, 0.005, smooth=3, bevel=0.002)
belt = shell((fz > belt_z - 0.022) & (fz < belt_z + 0.022) & (np.abs(fx) < 0.3) & ~arm_f & ~hand_f, 'belt', 'leather', 0.046, 0.006, smooth=3, bevel=0.002)
def on_body(x_, z_, facing):   # a point on the outer body surface at (x, z) on the front (-1) or back (+1)
    m_ = (np.abs(fx - x_) < 0.025) & (np.abs(fz - z_) < 0.02) & (np.sign(fy - P[1]) == facing)
    return (FC[m_].mean(0), FN[m_].mean(0) / max(1e-6, np.linalg.norm(FN[m_].mean(0)))) if m_.any() else (None, None)
c, n = on_body(0.0, belt_z, -1)
if c is not None:
    box('buckle', 'metal', c + n * 0.055, (0.07, 0.012, 0.045), bevel=0.006)
    box('buckle_plate', 'leather', c + n * 0.06, (0.05, 0.008, 0.03), bevel=0.003)
for i, (x_, f_) in enumerate(((0.095, -1), (-0.095, -1), (0.16, -1), (-0.16, -1), (0.09, 1), (-0.09, 1))):
    c, n = on_body(x_, belt_z, f_)
    if c is not None: box(f'pouch_{i}', 'leather', c + n * 0.068, (0.045, 0.035, 0.055), rot=(0, 0, math.atan2(n[0], -n[1])), bevel=0.007)
# gloves' cuffs and strapped bracers over the sleeves
for sd in 'lr':
    sg = side(sd); el, wr = J[f'lowerarm_{sd}'], J[f'hand_{sd}']
    t, d = seg_t(FC, el, wr)
    shell((t > 0.92) & (t < 1.08) & (d < 0.07) & (np.sign(fx) == sg), f'glove_cuff_{sd}', 'gloves', 0.014, 0.004, smooth=3, bevel=0.002)
    shell((t > 0.38) & (t < 0.9) & (d < 0.07) & (np.sign(fx) == sg), f'bracer_{sd}', 'leather', 0.02, 0.005, smooth=4, bevel=0.002)
    for k, tt in enumerate((0.48, 0.64, 0.8)):
        shell((t > tt - 0.03) & (t < tt + 0.03) & (d < 0.07) & (np.sign(fx) == sg), f'bracer_strap_{sd}{k}', 'gloves', 0.027, 0.003, smooth=2, bevel=0.001, edge_smooth=3)
        pc = el + (wr - el) * tt; out = np.array([sg, 0.0, 0.0])
        m_ = (np.abs(t - tt) < 0.04) & (d < 0.07) & (np.sign(fx) == sg) & (FN @ out > 0.5)
        if m_.any(): cc = FC[m_].mean(0); box(f'bracer_buckle_{sd}{k}', 'metal', cc + out * 0.03, (0.006, 0.02, 0.016), bevel=0.002)
# boots: knee-high, strapped, with toe caps
TOE = {}
for sd in 'lr':
    an, ball = J[f'foot_{sd}'], J[f'ball_{sd}']
    foot = (VC[:, 2] < an[2] + 0.02) & (np.sign(VC[:, 0]) == side(sd)); toe = foot & (VC[:, 1] < ball[1] + 0.015)
    tip = VC[toe][:, 1].min(); c_ = np.array([ball[0], (ball[1] + tip) / 2, 0.026])
    VC[toe] = c_ + (VC[toe] - c_) * [0.8, 0.85, 0.7]
    for i_ in np.where(toe)[0]: bm0.verts[i_].co = V(VC[i_])
    xs = VC[foot & (VC[:, 1] < ball[1] + 0.03)][:, 0]
    TOE[sd] = (c_, np.array([(xs.max() - xs.min()) / 2 + 0.016, (ball[1] + 0.03 - tip) / 2 + 0.018, 0.045]))
bm0.to_mesh(me)
for sd in 'lr':
    sg = side(sd); kn, an, ball = J[f'calf_{sd}'], J[f'foot_{sd}'], J[f'ball_{sd}']
    t, d = seg_t(FC, kn, an)
    boot = ((t > -0.05) & (d < 0.11) | ((fz < an[2] + 0.045) & (fy > ball[1]) & outward(an + np.array([0, 0, -0.05]), ball + np.array([0, -0.06, 0])))) & (np.sign(fx) == sg) & (fz < kn[2] + 0.06)
    shell(boot, f'boot_{sd}', 'boots', 0.016, 0.006, smooth=8, bevel=0)
    shell((t > -0.06) & (t < 0.05) & (d < 0.12) & (np.sign(fx) == sg), f'boot_cuff_{sd}', 'boots', 0.024, 0.006, smooth=4, bevel=0.002)   # rolled top
    for k, tt in enumerate((0.18, 0.36, 0.54, 0.72)):
        shell((t > tt - 0.022) & (t < tt + 0.022) & (d < 0.11) & (np.sign(fx) == sg), f'boot_strap_{sd}{k}', 'gloves', 0.026, 0.004, smooth=2, bevel=0.001, edge_smooth=3)
        m_ = (np.abs(t - tt) < 0.03) & (d < 0.11) & (np.sign(fx) == sg) & (FN @ np.array([sg, 0, 0]) > 0.5)
        if m_.any(): cc = FC[m_].mean(0); box(f'boot_buckle_{sd}{k}', 'metal', cc + np.array([sg, 0, 0]) * 0.025, (0.006, 0.022, 0.018), bevel=0.002)
    c_, r_ = TOE[sd]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0); tc = bpy.context.object; tc.name = f'toe_cap_{sd}'
    tb = bmesh.new(); tb.from_mesh(tc.data)
    for v in tb.verts:
        q = np.array(v.co[:]); q = np.sign(q) * np.abs(q) ** 0.7; v.co = V(c_ + q * r_); v.co.z = max(v.co.z, 0.0)
    tb.to_mesh(tc.data); tb.free(); tc.data.materials.append(MATS['boots']); PIECES.append(tc)
    # sole
    box(f'sole_{sd}', 'gloves', (c_[0], (c_[1] + J[f'foot_{sd}'][1]) / 2 - 0.01, 0.008), (r_[0] * 2 + 0.01, abs(J[f'foot_{sd}'][1] - c_[1]) + r_[1] + 0.05, 0.016), bevel=0.004)
# hair (short, curly) on the scalp up to MakeHuman's hair helper, and a full beard
ear_top = EYE_Z + 0.012
scalp = head_f & outward(NK, HD + (HD - NK) * 3) & (
    ((fz > EYE_Z + 0.05) & (fy > HD[1] - 0.075)) |                       # crown and front hairline
    ((fz > ear_top) & (np.abs(fx) > 0.05) & (fy > HD[1] - 0.05)) |        # temples above the ears
    ((fy > HD[1] + 0.005) & (fz > NK[2] + 0.07)))                         # back of the head down to the nape
ears = (np.abs(fx) > 0.065) & (np.abs(fy - HD[1] - 0.005) < 0.03) & (fz < ear_top + 0.012) & (fz > EYE_Z - 0.05)
scalp &= ~ears
def hair_off(c):
    top = max(0.0, min(1.0, (c.z - (EYE_Z + 0.02)) / 0.08)); front = max(0.0, min(1.0, (HD[1] + 0.02 - c.y) / 0.08))
    return 0.006 + 0.022 * top * (0.6 + 0.4 * front)          # ~6 mm on the sides, up to ~2.8 cm on top
shell(scalp, 'hair', 'hair', hair_off, 0.0, smooth=6, bevel=0, edge_smooth=10, disp=dict(scale=0.0065, strength=0.007, sub=2))
sideburn = head_f & ~ears & (np.abs(fx) > 0.055) & (fz <= ear_top + 0.005) & (fz > EYE_Z - 0.045) & (fy < HD[1] + 0.0) & (fy > HD[1] - 0.06) & outward(NK, HD + (HD - NK) * 3)
mouth_w, mouth_h = 0.026, 0.011
lips = (np.abs(fx - MOUTH[0]) < mouth_w) & (np.abs(fz - MOUTH[2]) < mouth_h)
top_line = EYE_Z - 0.032 - 0.25 * np.clip(0.07 - np.abs(fx), 0, 1)    # cheek line, lower toward the nose
beard = head_f & (fz < top_line) & (fz > MOUTH[2] - 0.075) & ~lips & outward(NK, HD + (HD - NK) * 3) & ~((fy > HD[1] + 0.035))
beard |= head_f & (fz > NK[2] + 0.045) & (fz <= MOUTH[2] - 0.05) & (FN[:, 2] < -0.2) & (np.abs(fx) < 0.06)    # under the chin
shell(beard, 'beard', 'beard', 0.0025, 0.0, smooth=3, bevel=0, edge_smooth=6, disp=dict(scale=0.0025, strength=0.0008, sub=1))

# ---------------- face photo projection (after the last edit of the body mesh) ----------------
def apply_projection(o, vco_all=None, vn_all=None):
    """orthographic front projection of the face photo, fitted to the eyes and mouth: UV layer 'proj' + weight 'projw'"""
    mm = o.data
    vco_all = np.array([v.co[:] for v in mm.vertices]) if vco_all is None else vco_all
    if vn_all is None:
        mm.update(); vn_all = np.array([v.normal[:] for v in mm.vertices])
    fp = R['face_px']; k_px = (fp['eye_l'][0] - fp['eye_r'][0]) / (EYE['l'][0] - EYE['r'][0])
    cx_px = (fp['eye_l'][0] + fp['eye_r'][0]) / 2; cx_w = (EYE['l'][0] + EYE['r'][0]) / 2
    kz_px = k_px   # a straight-on photo: the same scale both ways
    if 'UVMap' not in mm.uv_layers: mm.uv_layers.new(name='UVMap')   # joining matches UV maps by position: UVMap first, proj second
    if 'proj' in mm.uv_layers: mm.uv_layers.remove(mm.uv_layers['proj'])
    pj = mm.uv_layers.new(name='proj')
    lv = np.empty(len(mm.loops), np.int32); mm.loops.foreach_get('vertex_index', lv); vco = vco_all[lv]
    u_px = cx_px + (vco[:, 0] - cx_w) * k_px; v_px = fp['eye_l'][1] - (vco[:, 2] - EYE_Z) * kz_px
    pj.data.foreach_set('uv', np.stack([u_px / FW, 1 - v_px / FH], 1).astype(np.float32).ravel())
    front = np.clip((-vn_all[:, 1] - 0.35) / 0.4, 0, 1) * np.clip((vco_all[:, 2] - (NK[2] + 0.03)) / 0.03, 0, 1)
    inside = (np.abs(vco_all[:, 0] - cx_w) * k_px < FW * 0.42)
    if 'projw' in mm.color_attributes: mm.color_attributes.remove(mm.color_attributes['projw'])
    pw = mm.color_attributes.new('projw', 'FLOAT_COLOR', 'POINT')
    pw.data.foreach_set('color', np.repeat(np.where(inside, front, 0.0)[:, None], 4, 1).astype(np.float32).ravel())
apply_projection(body_o, VC, VN)
# body skin under the clothing is never seen: drop it (a separately weighted layer underneath pokes through in motion)
_covered = (torso_f | arm_f | leg_f | ((fz < belt_z) & (np.abs(fx) < 0.3))) & ~hand_f & ~head_f & ~FEYE & (fz < NK[2] + 0.005)
_feet = (fz < J['calf_l'][2]) & ~hand_f
_bm = bmesh.new(); _bm.from_mesh(body_o.data); _bm.faces.ensure_lookup_table()
_kill = [_bm.faces[i] for i in np.where(_covered | _feet)[0]]
bmesh.ops.delete(_bm, geom=_kill, context='FACES_ONLY')
bmesh.ops.delete(_bm, geom=[v for v in _bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.delete(_bm, geom=[e for e in _bm.edges if not e.link_faces], context='EDGES')
_bm.to_mesh(body_o.data); _bm.free()
print('hidden body faces removed', len(_kill))
for _o in PIECES:
    if _o.name == 'beard':
        bpy.context.view_layer.objects.active = _o
        for _m in list(_o.modifiers): _o.select_set(True); bpy.ops.object.modifier_apply(modifier=_m.name)
        apply_projection(_o)
# ---------------- one mesh, one atlas, 4K bake ----------------
for o in PIECES:
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    for mdf in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=mdf.name)
    if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    if 'proj' not in o.data.uv_layers: o.data.uv_layers.new(name='proj')
    if 'projw' not in o.data.color_attributes: o.data.color_attributes.new('projw', 'FLOAT_COLOR', 'POINT')
bpy.ops.object.select_all(action='DESELECT')
for o in PIECES + [body_o]: o.select_set(True)
bpy.context.view_layer.objects.active = body_o; bpy.ops.object.join(); ch = bpy.context.object; ch.name = 'jedi'
bpy.ops.object.shade_smooth()
atlas = ch.data.uv_layers.new(name='Atlas'); ch.data.uv_layers.active = atlas
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')
print('jedi', len(ch.data.vertices), 'verts', len(ch.data.polygons), 'faces')
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 2; sc.cycles.device = 'CPU'
TX = R['tex']
def bake(kind, img_name, colorspace='sRGB', setup=None):
    img = bpy.data.images.new(img_name, TX, TX, alpha=False); img.colorspace_settings.name = colorspace
    nodes = []
    for m in ch.data.materials:
        nd = m.node_tree.nodes.new('ShaderNodeTexImage'); nd.image = img; m.node_tree.nodes.active = nd; nodes.append((m, nd))
    if setup: setup()
    bpy.ops.object.select_all(action='DESELECT'); ch.select_set(True); bpy.context.view_layer.objects.active = ch
    sc.render.bake.margin = 8; sc.render.bake.use_selected_to_active = False
    if kind == 'DIFFUSE': sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
    if kind == 'NORMAL': sc.render.bake.normal_space = 'TANGENT'
    bpy.ops.object.bake(type=kind, uv_layer='Atlas')
    for m, nd in nodes: m.node_tree.nodes.remove(nd)
    return img
base = bake('DIFFUSE', 'T_Jedi_BaseColor')
rough = bake('ROUGHNESS', 'T_Jedi_Rough', 'Non-Color')
nrm = bake('NORMAL', 'T_Jedi_Normal', 'Non-Color')
saved = []
def metal_setup():
    for m in ch.data.materials:
        nt = m.node_tree; b = nt.nodes['Principled BSDF']; out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        em = nt.nodes.new('ShaderNodeEmission'); v = b.inputs['Metallic'].default_value; em.inputs['Color'].default_value = (v, v, v, 1)
        old = out.inputs['Surface'].links[0].from_socket; nt.links.new(em.outputs['Emission'], out.inputs['Surface']); saved.append((nt, em, old, out))
metal = bake('EMIT', 'T_Jedi_Metal', 'Non-Color', metal_setup)
for nt, em, old, out in saved: nt.links.new(old, out.inputs['Surface']); nt.nodes.remove(em)
rp = np.array(rough.pixels[:], np.float32).reshape(-1, 4); mp = np.array(metal.pixels[:], np.float32).reshape(-1, 4)
orm = bpy.data.images.new('T_Jedi_ORM', TX, TX, alpha=False); orm.colorspace_settings.name = 'Non-Color'
o_ = np.ones_like(rp); o_[:, 1] = rp[:, 0]; o_[:, 2] = mp[:, 0]; orm.pixels.foreach_set(o_.astype(np.float32).ravel())
for img in (base, orm, nrm): img.pack()
gm = bpy.data.materials.new('M_Jedi'); gm.use_nodes = True; nt = gm.node_tree; b = nt.nodes['Principled BSDF']
tb_ = nt.nodes.new('ShaderNodeTexImage'); tb_.image = base; nt.links.new(tb_.outputs['Color'], b.inputs['Base Color'])
to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm; sp = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(to.outputs['Color'], sp.inputs['Color']); nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm; nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'Atlas'
nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
ch.data.materials.clear(); ch.data.materials.append(gm)
for nm_ in [u.name for u in ch.data.uv_layers if u.name != 'Atlas']: ch.data.uv_layers.remove(ch.data.uv_layers[nm_])
ch.data.uv_layers['Atlas'].name = 'UVMap'
if 'projw' in ch.data.color_attributes: ch.data.color_attributes.remove(ch.data.color_attributes['projw'])

# ---------------- skeleton (pipeline joint names, exact MakeHuman joints), raw frame, export ----------------
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
Rz = M.Rotation(math.pi / 2, 4, 'Z'); ch.data.transform(Rz); ao.matrix_world = Rz @ ao.matrix_world
bpy.ops.object.select_all(action='DESELECT'); ao.select_set(True); bpy.context.view_layer.objects.active = ao; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.context.scene.objects if o not in (ch, ao)]: bpy.data.objects.remove(o)
vg = ch.vertex_groups.new(name='Pelvis'); vg.add(list(range(len(ch.data.vertices))), 1.0, 'REPLACE')
ch.parent = ao; am = ch.modifiers.new('rig', 'ARMATURE'); am.object = ao
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='AUTO', export_skins=True, export_animations=False)
json.dump({'recipe': {k: v for k, v in R.items()}, 'targets': used, 'joints': len(NAMES), 'verts': len(ch.data.vertices), 'faces': len(ch.data.polygons),
           'heights': {'belt': float(belt_z), 'knee': float(kn_z), 'tabard_hem': float(kn_z + 0.03), 'skirt_hem': float(kn_z + 0.09)}},
          open(os.path.splitext(OUT)[0] + '.recipe.json', 'w'), indent=1)
print('wrote', OUT)
