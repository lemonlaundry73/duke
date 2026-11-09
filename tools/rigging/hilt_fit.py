# Fit a supplied lightsaber hilt to the Duke saber frame: one mesh, centred, 0.28 m along +Z (emitter must already be +Z).
# Usage: python -I hilt_fit.py <in.glb> <out.glb>   (run by hilt_prep.sh)
import bpy,sys,mathutils
src,out=sys.argv[-2],sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
ms=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in ms: o.select_set(True)
bpy.context.view_layer.objects.active=ms[0]
if len(ms)>1: bpy.ops.object.join()
o=bpy.context.object
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
pts=[v.co for v in o.data.vertices]; mn=mathutils.Vector([min(p[i] for p in pts) for i in range(3)]); mx=mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
s=0.28/(mx.z-mn.z); c=(mn+mx)/2
for v in o.data.vertices: v.co=(v.co-c)*s
o.name='SM_Saber_Hilt'; o.data.materials[0].name='M_Saber_Hilt'
for e in [x for x in bpy.context.scene.objects if x.type!='MESH']: bpy.data.objects.remove(e)
print('TRIS',sum(len(p.vertices)-2 for p in o.data.polygons),'LEN',round((mx.z-mn.z)*s,4),'DIAM',round((mx.x-mn.x)*s,4))
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_image_format='AUTO')
