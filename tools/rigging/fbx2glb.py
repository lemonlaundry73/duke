# FBX weapon source -> single-mesh GLB (textures embedded) for the rest of the pipeline
import bpy,sys
src,dst=sys.argv[-2],sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
for o in [o for o in bpy.context.scene.objects if o.type!='MESH']: bpy.data.objects.remove(o)
ms=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in ms: o.select_set(True)
bpy.context.view_layer.objects.active=ms[0]
if len(ms)>1: bpy.ops.object.join()
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
for img in bpy.data.images:
    if img.packed_file is None and img.filepath: img.pack()
bpy.ops.export_scene.gltf(filepath=dst,export_format='GLB',use_selection=False,export_animations=False)
print('fbx2glb',src,'->',dst,len(ms),'mesh(es)')
