# Duke Local: runs inside Blender (blender -b --factory-startup -P blender_runner.py -- <job.json>).
# Opens a scene (or starts empty), runs one generated script, inspects the result, saves a NEW versioned
# .blend (never over the original) and renders a preview. Writes everything it did to the result JSON.
import bpy, sys, json, math, os, traceback, io, contextlib
from mathutils import Vector

job = json.load(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8'))
res = {'ok': True, 'blender': bpy.app.version_string, 'stdout': '', 'error': None}

if job.get('scene') and os.path.isfile(job['scene']):
    bpy.ops.wm.open_mainfile(filepath=job['scene'])
    res['opened'] = job['scene']
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    res['opened'] = None

if job.get('script'):
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            code = open(job['script'], encoding='utf-8').read()
            exec(compile(code, job['script'], 'exec'), {'bpy': bpy, 'math': math, 'Vector': Vector, '__name__': '__duke__'})
    except Exception:
        res['ok'] = False
        res['error'] = traceback.format_exc()[-4000:]
    res['stdout'] = buf.getvalue()[-6000:]


def inspect():
    sc = bpy.context.scene
    objs = []
    for o in sc.objects:
        d = {'name': o.name, 'type': o.type, 'location': [round(v, 3) for v in o.location],
             'dimensions': [round(v, 3) for v in o.dimensions], 'parent': o.parent.name if o.parent else None}
        if o.type == 'MESH':
            d['vertices'] = len(o.data.vertices)
            d['faces'] = len(o.data.polygons)
            d['materials'] = [m.name for m in o.data.materials if m]
            d['modifiers'] = [m.type for m in o.modifiers]
        objs.append(d)
    return {'scene': sc.name, 'objects': objs, 'object_count': len(objs),
            'meshes': sum(1 for o in objs if o['type'] == 'MESH'), 'materials': sorted({m for o in objs for m in o.get('materials', [])}),
            'frame': sc.frame_current, 'unit_scale': sc.unit_settings.scale_length}


res['inspection'] = inspect()

if res['ok'] and job.get('save'):
    os.makedirs(os.path.dirname(job['save']), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=job['save'], copy=False)
    res['saved'] = job['save']

if res['ok'] and job.get('render'):
    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == 'MESH']
    temp = []
    if meshes:
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    else:
        mn, mx = Vector((-1, -1, 0)), Vector((1, 1, 2))
    center, radius = (mn + mx) / 2, max((mx - mn).length / 2, 0.5)
    cam = sc.camera
    if not cam or job.get('preview_camera', True):
        cd = bpy.data.cameras.new('DukePreviewCam'); cd.lens = 40
        cam = bpy.data.objects.new('DukePreviewCam', cd); sc.collection.objects.link(cam); temp.append(cam)
        d = radius / math.tan(cd.angle / 2) * 1.25
        a = math.radians(job.get('angle', 35))
        cam.location = center + Vector((math.sin(a) * d, -math.cos(a) * d, radius * 0.6))
        cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    old_cam = sc.camera; sc.camera = cam
    if not any(o.type == 'LIGHT' for o in sc.objects):
        ld = bpy.data.lights.new('DukePreviewSun', 'SUN'); ld.energy = 3
        lo = bpy.data.objects.new('DukePreviewSun', ld); sc.collection.objects.link(lo); temp.append(lo)
        lo.rotation_euler = (math.radians(50), 0, math.radians(30))
    if not sc.world:
        sc.world = bpy.data.worlds.new('DukePreviewWorld')
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    sc.render.resolution_x, sc.render.resolution_y = job.get('res', [960, 640])
    sc.render.filepath = job['render']
    rendered = False
    for eng in [e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH') if e in engines]:
        try:
            sc.render.engine = eng
            bpy.ops.render.render(write_still=True)
            rendered = os.path.isfile(job['render']); res['render_engine'] = eng
            if rendered:
                break
        except Exception as e:
            res.setdefault('render_warnings', []).append('%s: %s' % (eng, e))
    res['rendered'] = job['render'] if rendered else None
    sc.camera = old_cam
    for o in temp:  # the preview camera and light are not part of the saved scene
        bpy.data.objects.remove(o, do_unlink=True)

json.dump(res, open(job['out'], 'w', encoding='utf-8'), indent=1)
