# Dismemberment variants (lightsaber endings, explosion limb loss).
# For every ending listed in cuts.json (written by anims.py) this script:
#   1. poses the trooper at the instant of the cut,
#   2. slices the real mesh with the cut plane (limited to the limb for limb cuts),
#   3. splits it into the remaining body and the severed piece(s), capping both cut faces
#      (glowing cauterized cap for a saber, charred cap for a blast),
#   4. keeps the remaining body skinned (in rest space, weights interpolated across the cut),
#   5. binds each piece rigidly to a free bone (cut_a / cut_b) in its pose at the cut,
#   6. simulates the piece (gravity, bounce, friction / topple / slide down the cut) and keys that bone in the clip.
# The game shows SK_Trooper until the cut time, then swaps to SK_Trooper_Cut_<clip> (same skeleton).
import bpy, bmesh, sys, json, math
from mathutils import Vector as V, Matrix as M, Quaternion as Q, Euler as E
w = sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend')
sc = bpy.context.scene; FPS = sc.render.fps
ao = bpy.data.objects['Armature']; P = ao.pose.bones; T = bpy.data.objects['SK_Trooper']
CUTS = json.load(open(f'{w}/cuts.json'))
for cn in ('cut_a', 'cut_b'):
    if cn not in T.vertex_groups: T.vertex_groups.new(name=cn)
GROUPS = [g.name for g in T.vertex_groups]; GIDX = {n: i for i, n in enumerate(GROUPS)}
CHILDREN = {}
for b in ao.data.bones:
    if b.parent: CHILDREN.setdefault(b.parent.name, []).append(b.name)
def subtree(n):
    out = [n]; st = [n]
    while st:
        for c in CHILDREN.get(st.pop(), []): out.append(c); st.append(c)
    return set(out)

def cap_material(style):
    name = 'MI_CutCap_Saber' if style == 'saber' else 'MI_CutCap_Blast'
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    if style == 'saber':   # cauterized: dark crust, glowing molten rim
        b.inputs['Base Color'].default_value = (0.06, 0.025, 0.015, 1); b.inputs['Roughness'].default_value = 0.6
        b.inputs['Emission Color'].default_value = (1.0, 0.28, 0.05, 1); b.inputs['Emission Strength'].default_value = 3.0
    else:                  # blast: charred, faint embers
        b.inputs['Base Color'].default_value = (0.04, 0.03, 0.025, 1); b.inputs['Roughness'].default_value = 0.9
        b.inputs['Emission Color'].default_value = (0.9, 0.2, 0.05, 1); b.inputs['Emission Strength'].default_value = 0.6
    return m

def posed_coords():
    dg = bpy.context.evaluated_depsgraph_get(); em = T.evaluated_get(dg).to_mesh()
    out = [v.co.copy() for v in em.vertices]; T.evaluated_get(dg).to_mesh_clear(); return out

def plane_for(piece):
    if 'bone' in piece:
        pb = P[piece['bone']]; h, t = pb.head.copy(), pb.tail.copy()
        n = (t - h).normalized(); return h + (t - h) * piece['at'], n, 1.0
    if piece['plane'] == 'waist':
        h1, h2 = P['spine_01'].head.copy(), P['spine_02'].head.copy()
        n = (h2 - h1).normalized(); return h1 + (h2 - h1) * 0.85, n, (-1.0 if piece['side'] == 'below' else 1.0)
    if piece['plane'] == 'diagonal':
        mt = P['spine_02'].matrix; up = (mt.to_3x3() @ V((0, 1, 0))).normalized(); lat = (mt.to_3x3() @ V((1, 0, 0))).normalized()
        n = (0.78 * up - 0.62 * lat).normalized(); return P['spine_02'].head.copy() + up * 0.04, n, 1.0
    raise ValueError(piece)

def build_variant(cut):
    clip = cut['clip']; F = round(cut['t'] * FPS)
    ao.animation_data.action = bpy.data.actions[clip]; sc.frame_set(F); bpy.context.view_layer.update()
    posed = posed_coords()
    me = T.data; bm = bmesh.new(); bm.from_mesh(me)
    dl = bm.verts.layers.deform.verify()
    rl = [bm.verts.layers.float.new(n) for n in ('rx', 'ry', 'rz')]
    part = bm.faces.layers.int.new('part')
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        r = v.co.copy(); v[rl[0]], v[rl[1]], v[rl[2]] = r.x, r.y, r.z; v.co = posed[v.index]
    def top_bone(v):
        d = v[dl]
        if not d: return None
        gi = max(d.items(), key=lambda kv: kv[1])[0]; return GROUPS[gi]
    planes = []; removed = set()
    for pi, piece in enumerate(cut['pieces'], start=1):
        co, no, sgn = plane_for(piece); planes.append((co, no))
        region = subtree(piece['region']) if piece.get('region') else None
        if region: removed |= region
        faces = [f for f in bm.faces if f[part] == 0 and (region is None or sum(1 for v in f.verts if top_bone(v) in region) * 2 > len(f.verts))]
        geom = list(set(faces) | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no)
        bm.faces.ensure_lookup_table()
        cand = [f for f in bm.faces if f[part] == 0 and (region is None or sum(1 for v in f.verts if top_bone(v) in region) * 2 >= len(f.verts))
                and sgn * (f.calc_center_median() - co).dot(no) > 0]
        if piece.get('anchor'):       # keep only the connected chunk that holds the anchor bone (e.g. the head)
            target = (P[piece['anchor']].head + P[piece['anchor']].tail) / 2
            cs = set(cand); seen = set(); comps = []
            for f0 in cand:
                if f0 in seen: continue
                comp = []; st = [f0]; seen.add(f0)
                while st:
                    f = st.pop(); comp.append(f)
                    for e in f.edges:
                        for g in e.link_faces:
                            if g in cs and g not in seen: seen.add(g); st.append(g)
                comps.append(comp)
            best = min(comps, key=lambda c: min((v.co - target).length for f in c[:200] for v in f.verts))
            cand = best
        for f in cand: f[part] = pi
    # separate the parts along the cut
    split = [e for e in bm.edges if len({f[part] for f in e.link_faces}) > 1]
    bmesh.ops.split_edges(bm, edges=split)
    objs = []
    for pi in range(0, len(cut['pieces']) + 1):
        b2 = bm.copy(); pl = b2.faces.layers.int['part']
        bmesh.ops.delete(b2, geom=[f for f in b2.faces if f[pl] != pi], context='FACES')
        bmesh.ops.delete(b2, geom=[v for v in b2.verts if not v.link_faces], context='VERTS')
        # cap the cut: boundary edges lying on one of this ending's planes
        on = lambda v: any(abs((v.co - c).dot(n)) < 2e-4 for c, n in planes)
        bnd = [e for e in b2.edges if e.is_boundary and on(e.verts[0]) and on(e.verts[1])]
        nmat = len(T.data.materials)
        if bnd:
            res = bmesh.ops.holes_fill(b2, edges=bnd, sides=100000)
            capf = bmesh.ops.triangulate(b2, faces=res['faces'])['faces']
            uvl = b2.loops.layers.uv.active
            for f in capf:
                f.material_index = nmat
                if uvl:
                    for lp in f.loops: lp[uvl].uv = (0.001, 0.001)
        dl2 = b2.verts.layers.deform.verify(); r2 = [b2.verts.layers.float[n] for n in ('rx', 'ry', 'rz')]
        if pi == 0:
            for v in b2.verts:
                v.co = V((v[r2[0]], v[r2[1]], v[r2[2]]))
                d = v[dl2]
                for gi in [gi for gi in d.keys() if GROUPS[gi] in removed]: del d[gi]
                tot = sum(d.values())
                if tot > 1e-6:
                    for gi in list(d.keys()): d[gi] /= tot
                else:
                    stump = ao.data.bones[list(removed)[0]].parent.name if removed else 'pelvis'
                    d[GIDX[stump]] = 1.0
        else:
            cb = 'cut_a' if pi == 1 else 'cut_b'
            for v in b2.verts:
                d = v[dl2]
                for gi in list(d.keys()): del d[gi]
                d[GIDX[cb]] = 1.0
        nm = f'SK_Trooper_Cut_{clip}' + ('' if pi == 0 else f'_Piece_{"ab"[pi-1]}')
        mesh = bpy.data.meshes.new(nm); b2.to_mesh(mesh); b2.free()
        for mt in T.data.materials: mesh.materials.append(mt)
        mesh.materials.append(cap_material(cut['style']))
        o = bpy.data.objects.new(nm, mesh); sc.collection.objects.link(o)
        for gname in GROUPS: o.vertex_groups.new(name=gname)
        o.parent = ao; md = o.modifiers.new('Armature', 'ARMATURE'); md.object = ao
        o.hide_render = True; o.hide_viewport = False; o['cut_clip'] = clip; o['cut_frame'] = F
        for poly in mesh.polygons: poly.use_smooth = True
        objs.append(o)
    bm.free()
    print(clip, 'frame', F, 'parts', [(o.name, len(o.data.polygons)) for o in objs])
    return F, objs

def simulate(cut, F, pieces):
    act = bpy.data.actions[cut['clip']]; ao.animation_data.action = act
    N = int(act.frame_range[1]); dt = 1.0 / FPS
    for (piece, obj), cb in zip(zip(cut['pieces'], pieces), ('cut_a', 'cut_b')):
        pts = [v.co.copy() for v in obj.data.vertices]
        step = max(1, len(pts) // 400); hull = pts[::step]
        c0 = sum(pts, V()) / len(pts)
        mo = piece['motion']; kind = mo['kind']
        pos = c0.copy(); rot = Q(); vel = V(mo.get('vel', (0, 0, 0))); spin = V(mo.get('spin', (0, 0, 0))); rest = False
        # explosion throws: the piece also inherits the body's launch (root motion) velocity
        sc.frame_set(F); r0 = P['root'].head.copy(); sc.frame_set(min(N, F + 1)); r1 = P['root'].head.copy()
        vel += (r1 - r0) * FPS
        low_pt = min(hull, key=lambda p: p.z)
        def W():
            return M.Translation(pos) @ rot.to_matrix().to_4x4() @ M.Translation(-c0)
        def ground():
            nonlocal pos
            m = W(); low = min((m @ p).z for p in hull)
            if low < 0.0: pos.z -= low; return True
            return False
        for f in range(F, N + 1):
            t = (f - F) * dt
            if kind == 'topple' and t < mo['delay'] + mo['dur']:
                # hinge over the ground edge in the push direction (gravity ease-in)
                u = max(0.0, (t - mo['delay']) / mo['dur']); a = math.radians(mo['angle']) * u * u
                axis = V(mo['axis']).normalized()
                pivot = V((low_pt.x, low_pt.y, 0.0)) + V(mo.get('push', (0, 0, 0)))
                rot = Q(axis, a); pos = pivot + rot @ (c0 - pivot)
                if u >= 1.0: vel = V((0, 0, -0.5)); spin = V((0, 0, 0))
            elif kind == 'slide' and t < mo['delay'] + mo['dur']:
                co, nrm, _ = plane_for(piece)
                g = V((0, 0, -1)); d = (g - nrm * g.dot(nrm)).normalized()
                u = max(0.0, (t - mo['delay']) / mo['dur']); pos = c0 + d * mo['slide'] * u * u
                vel = d * (2 * mo['slide'] / mo['dur']); spin = V(mo.get('spin', (0, 0, 0)))
            else:
                if not rest:
                    vel.z -= 9.81 * dt; pos += vel * dt
                    wv = spin * dt; rot = (E((math.radians(wv.x), math.radians(wv.y), math.radians(wv.z))).to_quaternion() @ rot).normalized()
                    if ground():
                        if abs(vel.z) > 0.8: vel.z = -vel.z * 0.25; vel.x *= 0.5; vel.y *= 0.5; spin *= 0.35
                        else:
                            vel.z = 0; vel.x *= 0.6; vel.y *= 0.6; spin *= 0.5
                            if vel.length < 0.15 and spin.length < 30: rest = True
                else:
                    ground()
            ground()
            sc.frame_set(f); bpy.context.view_layer.update()
            P[cb].matrix = W(); bpy.context.view_layer.update()
            P[cb].keyframe_insert('location', frame=f, group=cb); P[cb].keyframe_insert('rotation_quaternion', frame=f, group=cb)

OUT = []
for cut in CUTS:
    F, objs = build_variant(cut)
    simulate(cut, F, objs[1:])
    OUT.append(dict(clip=cut['clip'], frame=F, time=F / FPS, style=cut['style'], remainder=objs[0].name, pieces=[o.name for o in objs[1:]]))
json.dump(OUT, open(f'{w}/cut_variants.json', 'w'), indent=1)
ao.animation_data.action = None
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/anim.blend')
print('VARIANTS', len(OUT))
