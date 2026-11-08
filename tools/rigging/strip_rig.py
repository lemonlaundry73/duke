# For a source GLB that already has a (foreign) skeleton, e.g. a Tripo auto-rig:
# keep its bind-pose mesh as 'trooper', record its joint positions and bounds (source_rig.json) for placing the
# Duke skeleton, drop the foreign skin, and add the blaster -> raw.blend
import bpy,sys,json,mathutils
w=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f'{w}/trooper_dq.glb')
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
me=next(o for o in bpy.context.scene.objects if o.type=='MESH')
joints={b.name:[list(arm.matrix_world@b.head_local),list(arm.matrix_world@b.tail_local)] for b in arm.data.bones}
mw=me.matrix_world.copy()
me.modifiers.clear(); me.vertex_groups.clear(); me.parent=None
me.data.transform(mw); me.matrix_world.identity(); me.name='trooper'
for o in [o for o in bpy.context.scene.objects if o.type!='MESH']: bpy.data.objects.remove(o)
vs=[v.co for v in me.data.vertices]
bbox=[[min(v[i] for v in vs) for i in range(3)],[max(v[i] for v in vs) for i in range(3)]]
json.dump({'joints':joints,'raw_bbox':bbox},open(f'{w}/source_rig.json','w'))
bpy.ops.import_scene.gltf(filepath=f'{w}/blaster_dq.glb'); bpy.context.selected_objects[0].name='blaster'
print('trooper',len(me.data.vertices),'source joints',len(joints))
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/raw.blend')
