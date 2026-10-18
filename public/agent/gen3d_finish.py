# Duke 3D Generator: AAA finishing script, run by the Duke app inside Blender on the creator's GPU worker.
#   blender -b --factory-startup -P gen3d_finish.py -- <job_dir> <out_dir>
# <job_dir> holds job.json (recipe spec), raw/ (the generator's files) and inputs/ (the photos).
# Steps: import -> clean -> real-world scale -> pivot -> LOD chain -> collision -> textures -> UV and geometry
# checks -> four turntable renders -> FBX/GLB for Unreal -> report.json (judged against the AAA gates by Duke).
import bpy, bmesh, json, math, os, sys, glob, shutil, re
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
JOB, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
job = json.load(open(os.path.join(JOB, 'job.json'), encoding='utf-8'))
spec = job['spec']
kind = spec['kind']
safe = re.sub(r'[^A-Za-z0-9]+', '', job.get('name') or 'Asset')[:40] or 'Asset'
prefix = {'character': 'SK', 'weapon': 'SM', 'vehicle': 'SM', 'prop': 'SM', 'building': 'SM'}.get(kind, 'SM')
NAME = '%s_%s' % ('SM', safe)  # static mesh name; characters get SK_ after rigging
report = {'name': safe, 'kind': kind, 'blender': bpy.app.version_string, 'steps': [], 'warnings': []}


def note(s):
    report['steps'].append(s)
    print('[duke] ' + s, flush=True)


# ---------------------------------------------------------------- import
bpy.ops.wm.read_factory_settings(use_empty=True)
raw = os.path.join(JOB, 'raw')
cands = sorted(glob.glob(os.path.join(raw, '*.glb')) + glob.glob(os.path.join(raw, '*.gltf')))
cands = [c for c in cands if 'pre_remesh' not in c] or cands
if cands:
    bpy.ops.import_scene.gltf(filepath=cands[0])
    src = cands[0]
else:
    fbx = glob.glob(os.path.join(raw, '*.fbx'))
    objf = glob.glob(os.path.join(raw, '*.obj'))
    if fbx:
        bpy.ops.import_scene.fbx(filepath=fbx[0]); src = fbx[0]
    elif objf:
        bpy.ops.wm.obj_import(filepath=objf[0]); src = objf[0]
    else:
        raise SystemExit('No model file (.glb, .fbx or .obj) in the generator output')
note('Imported ' + os.path.basename(src))

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('The generator output has no mesh')
for o in bpy.context.scene.objects:
    if o.type not in ('MESH',):
        o.select_set(False)
# bake parent transforms into the meshes, drop empties/armatures from the generator
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = NAME
obj.data.name = NAME
note('Combined %d mesh part(s)' % len(meshes))


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


# ---------------------------------------------------------------- clean geometry
mn, mx = bbox(obj)
diag = (mx - mn).length or 1.0
bm = bmesh.new(); bm.from_mesh(obj.data)
before = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=diag * 1e-5)
loose_e = [e for e in bm.edges if not e.link_faces]
bmesh.ops.delete(bm, geom=loose_e, context='EDGES')
loose_v = [v for v in bm.verts if not v.link_edges]
bmesh.ops.delete(bm, geom=loose_v, context='VERTS')
# islands: drop specks (generator floaters) smaller than 0.2% of the faces
bm.faces.ensure_lookup_table()
seen, islands = set(), []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, isl = [f], []
    seen.add(f.index)
    while stack:
        x = stack.pop(); isl.append(x)
        for e in x.edges:
            for y in e.link_faces:
                if y.index not in seen:
                    seen.add(y.index); stack.append(y)
    islands.append(isl)
total_f = len(bm.faces) or 1
specks = [i for i in islands if len(i) < max(12, total_f * 0.002)]
if specks and len(specks) < len(islands):
    bmesh.ops.delete(bm, geom=[f for i in specks for f in i], context='FACES')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(obj.data); bm.free()
report['loose_parts'] = len(islands) - len(specks)
note('Cleaned: merged %d duplicate vertices, removed %d floating specks, fixed normals' % (before - len(obj.data.vertices), len(specks)))

# ---------------------------------------------------------------- real-world scale and pivot
mn, mx = bbox(obj)
dims = mx - mn
if kind == 'character':
    measured, target = dims.z, float(job.get('size_m') or spec.get('height_m') or 1.8)
elif kind in ('weapon', 'vehicle'):
    measured, target = max(dims.x, dims.y), float(job.get('size_m') or spec.get('length_m') or 1)
else:
    measured, target = max(dims.x, dims.y, dims.z), float(job.get('size_m') or spec.get('size_m') or 1)
s = target / measured if measured > 1e-6 else 1.0
obj.scale = (s, s, s)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
mn, mx = bbox(obj)
pivot = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
if kind == 'weapon':
    pivot = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
obj.data.transform(__import__('mathutils').Matrix.Translation(-pivot))
obj.location = (0, 0, 0)
mn, mx = bbox(obj)
dims = mx - mn
report['size_m'] = round(dims.z if kind == 'character' else (max(dims.x, dims.y) if kind in ('weapon', 'vehicle') else max(dims)), 3)
report['dims_m'] = [round(dims.x, 3), round(dims.y, 3), round(dims.z, 3)]
note('Scaled to %.2f m and set the pivot to the %s' % (report['size_m'], 'grip center' if kind == 'weapon' else 'ground center'))

# smooth shading with sharp creases kept (weighted normals)
for p in obj.data.polygons:
    p.use_smooth = True
try:
    m = obj.modifiers.new('WeightedNormals', 'WEIGHTED_NORMAL'); m.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=m.name)
except Exception as e:
    report['warnings'].append('Weighted normals skipped: %s' % e)

# ---------------------------------------------------------------- textures and materials
tex_dir = os.path.join(OUT, 'Textures'); os.makedirs(tex_dir, exist_ok=True)
pbr = {'base_color': False, 'normal': False, 'roughness': False, 'metallic': False, 'ao': False}
tex_max, saved = 0, []


def feeds(node_socket):
    """Image textures that end up driving a socket (through normal map / separate nodes)."""
    out, stack = [], [node_socket]
    while stack:
        sck = stack.pop()
        for l in sck.links:
            n = l.from_node
            if n.type == 'TEX_IMAGE' and n.image:
                out.append(n.image)
            else:
                stack.extend(i for i in n.inputs)
    return out


for slot in obj.material_slots:
    mat = slot.material
    if not mat or not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for key, sock in (('base_color', 'Base Color'), ('normal', 'Normal'), ('roughness', 'Roughness'), ('metallic', 'Metallic')):
        if sock in bsdf.inputs:
            ims = feeds(bsdf.inputs[sock])
            if ims:
                pbr[key] = True
            for im in ims:
                tex_max = max(tex_max, max(im.size[0], im.size[1]))
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.image.name not in saved:
            im = n.image
            label = re.sub(r'[^A-Za-z0-9]+', '', im.name)[:30] or 'Map'
            path = os.path.join(tex_dir, 'T_%s_%s.png' % (safe, label))
            try:
                im.filepath_raw = path; im.file_format = 'PNG'; im.save()
                saved.append(im.name)
            except Exception as e:
                report['warnings'].append('Texture %s not saved: %s' % (im.name, e))
    mat.name = 'MI_%s_%d' % (safe, obj.material_slots[:].index(slot))
report['pbr'] = pbr
report['texture_max'] = tex_max
report['textures'] = sorted(os.listdir(tex_dir))
note('Textures: %d maps, largest %dpx, PBR %s' % (len(report['textures']), tex_max, ', '.join(k for k, v in pbr.items() if v) or 'none'))

# ---------------------------------------------------------------- UVs and geometry checks
uv = obj.data.uv_layers.active
report['has_uv'] = bool(uv)
if uv:
    out_n = sum(1 for d in uv.data if not (-0.001 <= d.uv.x <= 1.001 and -0.001 <= d.uv.y <= 1.001))
    report['uv_out_of_bounds_pct'] = round(100.0 * out_n / max(1, len(uv.data)), 2)
else:
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    report['warnings'].append('The generator gave no UVs; Duke unwrapped it (textures will need re-baking).')
bm = bmesh.new(); bm.from_mesh(obj.data)
nm = sum(1 for e in bm.edges if not e.is_manifold)
report['non_manifold_pct'] = round(100.0 * nm / max(1, len(bm.edges)), 3)
bm.free()

# ---------------------------------------------------------------- level of detail chain
targets = spec['lods']
lods = []
t0 = tri_count(obj)
if t0 > targets[0]:
    m = obj.modifiers.new('LOD0', 'DECIMATE'); m.ratio = targets[0] / float(t0); m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
    note('LOD0 reduced from %d to %d triangles' % (t0, tri_count(obj)))
lods.append({'lod': 0, 'tris': tri_count(obj), 'object': obj})
for i, t in enumerate(targets[1:], start=1):
    cur = tri_count(obj)
    dup = obj.copy(); dup.data = obj.data.copy(); dup.name = '%s_LOD%d' % (NAME, i)
    bpy.context.collection.objects.link(dup)
    bpy.ops.object.select_all(action='DESELECT'); dup.select_set(True); bpy.context.view_layer.objects.active = dup
    if cur > t:
        m = dup.modifiers.new('Decimate', 'DECIMATE'); m.ratio = t / float(cur); m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    lods.append({'lod': i, 'tris': tri_count(dup), 'object': dup})
report['lods'] = [{'lod': l['lod'], 'tris': l['tris']} for l in lods]
note('LODs: ' + ', '.join('LOD%d %d' % (l['lod'], l['tris']) for l in lods))

# ---------------------------------------------------------------- collision
col_kind = spec.get('finish', {}).get('collision', 'convex')
ucx = None
if kind == 'character':
    report['collision'] = 'capsule (set by the Unreal character)'
else:
    bm = bmesh.new()
    for v in obj.data.vertices:
        bm.verts.new(v.co)
    hull = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    junk = [g for g in hull.get('geom_interior', []) + hull.get('geom_unused', []) if isinstance(g, bmesh.types.BMVert)]
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    me = bpy.data.meshes.new('UCX_%s_00' % NAME); bm.to_mesh(me); bm.free()
    ucx = bpy.data.objects.new('UCX_%s_00' % NAME, me); bpy.context.collection.objects.link(ucx)
    if len(ucx.data.polygons) > 255:
        m = ucx.modifiers.new('d', 'DECIMATE'); m.ratio = 250.0 / len(ucx.data.polygons)
        bpy.ops.object.select_all(action='DESELECT'); ucx.select_set(True); bpy.context.view_layer.objects.active = ucx
        bpy.ops.object.modifier_apply(modifier=m.name)
    report['collision'] = 'convex hull (%d faces, UCX)' % len(ucx.data.polygons)
note('Collision: ' + report['collision'])

# ---------------------------------------------------------------- turntable renders (front, left, back, right)
for l in lods[1:]:
    l['object'].hide_render = True
if ucx:
    ucx.hide_render = True
scene = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else ('BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'CYCLES')
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.film_transparent = False
world = bpy.data.worlds.new('Studio'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.18, 0.19, 0.21, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
try:
    scene.view_settings.view_transform = 'AgX'
except Exception:
    scene.view_settings.view_transform = 'Filmic'
mn, mx = bbox(obj)
center = (mn + mx) / 2
radius = max((mx - mn).length / 2, 0.05)
for nm_, energy, loc in (('Key', 900, (2.5, -3, 3)), ('Fill', 300, (-3, -2, 1.5)), ('Rim', 600, (0, 3.5, 3))):
    ld = bpy.data.lights.new(nm_, 'AREA'); ld.energy = energy * radius * radius; ld.size = radius * 2
    lo = bpy.data.objects.new(nm_, ld); scene.collection.objects.link(lo)
    lo.location = center + Vector(loc) * radius
    lo.rotation_euler = (center - lo.location).to_track_quat('-Z', 'Y').to_euler()
cam_d = bpy.data.cameras.new('Cam'); cam_d.lens = 70
cam = bpy.data.objects.new('Cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam
dist = radius / math.tan(cam_d.angle / 2) * 1.15
renders = []
for label, ang in (('front', 0), ('left', 90), ('back', 180), ('right', 270)):
    a = math.radians(ang)
    cam.location = center + Vector((math.sin(a) * dist, -math.cos(a) * dist, radius * 0.25))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT, 'render_%s.png' % label)
    try:
        bpy.ops.render.render(write_still=True)
        renders.append(os.path.basename(scene.render.filepath))
    except Exception as e:
        report['warnings'].append('Render %s failed: %s' % (label, e))
report['renders'] = renders
note('Rendered %d turntable views' % len(renders))

# ---------------------------------------------------------------- export for Unreal
def export(objs, path, fmt):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_render = False; o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if fmt == 'fbx':
        bpy.ops.export_scene.fbx(filepath=path, use_selection=True, apply_scale_options='FBX_SCALE_ALL', mesh_smooth_type='FACE',
                                 use_tspace=True, path_mode='COPY', embed_textures=False, add_leaf_bones=False, bake_anim=False)
    else:
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True)


files = []
export([obj] + ([ucx] if ucx else []), os.path.join(OUT, NAME + '.fbx'), 'fbx'); files.append(NAME + '.fbx')
export([obj], os.path.join(OUT, NAME + '.glb'), 'glb'); files.append(NAME + '.glb')
for l in lods[1:]:
    p = os.path.join(OUT, '%s_LOD%d.fbx' % (NAME, l['lod']))
    export([l['object']], p, 'fbx'); files.append(os.path.basename(p))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '.blend'), compress=True)
files.append(NAME + '.blend')
report['files'] = files
report['rig'] = None
report['front_axis'] = '-Y in Blender (+Z glTF), standard Unreal FBX import'
note('Exported %s' % ', '.join(files))
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8'), indent=1)
print('[duke] DONE', flush=True)
