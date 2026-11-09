# PLACEHOLDER lightsaber hilt (procedural), used until the real hilt model is supplied.
# Source frame matches blaster.json for kind "saber": hilt along +Z (emitter at +Z, pommel at -Z), origin at the centre.
import bpy,sys,math
out=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name,col,metal,rough):
    m=bpy.data.materials.new(name); m.use_nodes=True; b=m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=(*col,1); b.inputs['Metallic'].default_value=metal; b.inputs['Roughness'].default_value=rough; return m
steel=mat('M_Hilt_Steel',(0.62,0.63,0.66),1.0,0.28); black=mat('M_Hilt_Grip',(0.03,0.03,0.035),0.2,0.55)
parts=[]
def cyl(r,z0,z1,m,v=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=z1-z0,location=(0,0,(z0+z1)/2)); o=bpy.context.object; o.data.materials.append(m); parts.append(o)
cyl(0.0175,-0.140,-0.120,steel)          # pommel
cyl(0.0160,-0.120,0.050,steel)           # body
for i in range(7): cyl(0.0182,-0.105+i*0.022,-0.093+i*0.022,black)   # grip ridges
cyl(0.0170,0.050,0.075,black)            # activation band
bpy.ops.mesh.primitive_cube_add(size=1,location=(0.0185,0,0.062)); o=bpy.context.object; o.scale=(0.008,0.010,0.012); o.data.materials.append(steel); parts.append(o)   # switch
cyl(0.0210,0.075,0.130,steel)            # emitter shroud
cyl(0.0150,0.130,0.140,steel)            # emitter
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join(); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
bpy.context.object.name='saber_hilt_placeholder'
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB')
print('placeholder hilt ->',out)
