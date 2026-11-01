# render a contact sheet: action, view, frames -> png
import bpy,sys,math,numpy as np
a=sys.argv[sys.argv.index('--')+1:]
blend,act,view,frames,out=a[0],a[1],a[2],[int(x) for x in a[3].split(',')],a[4]; res=int(a[5]) if len(a)>5 else 320
bpy.ops.wm.open_mainfile(filepath=blend)
sc=bpy.context.scene; ao=bpy.data.objects['Armature']; ao.animation_data.action=bpy.data.actions[act]
sc.render.engine='CYCLES'; sc.cycles.samples=6; sc.cycles.device='CPU'; sc.cycles.use_denoising=False
sc.render.resolution_x=res; sc.render.resolution_y=int(res*1.25)
wd=bpy.data.worlds.new('w'); sc.world=wd; wd.use_nodes=True; wd.node_tree.nodes['Background'].inputs[0].default_value=(0.35,0.36,0.4,1)
cam=bpy.data.cameras.new('c'); cam.type='ORTHO'; cam.ortho_scale=2.3
co=bpy.data.objects.new('cam',cam); sc.collection.objects.link(co); sc.camera=co
l=bpy.data.lights.new('s','SUN'); l.energy=3.5; lo=bpy.data.objects.new('s',l); sc.collection.objects.link(lo); lo.rotation_euler=(0.7,0.3,0.6)
if view=='side': co.location=(10,-0.0,0.92); co.rotation_euler=(math.pi/2,0,math.pi/2)
elif view=='front': co.location=(0,-10,0.92); co.rotation_euler=(math.pi/2,0,0)
else: co.location=(7,-7,1.1); co.rotation_euler=(math.radians(85),0,math.radians(45))
# ground line
bpy.ops.mesh.primitive_plane_add(size=6); pl=bpy.context.object; m=bpy.data.materials.new('g'); m.use_nodes=True; m.node_tree.nodes['Principled BSDF'].inputs[0].default_value=(0.2,0.2,0.22,1); pl.data.materials.append(m)
imgs=[]
for f in frames:
    sc.frame_set(f); sc.render.filepath=f'{out}_{f}.png'; bpy.ops.render.render(write_still=True)
    imgs.append(np.array(bpy.data.images.load(sc.render.filepath).pixels[:]).reshape(sc.render.resolution_y,res,4))
im=bpy.data.images.new('m',res*len(imgs),sc.render.resolution_y); im.pixels=np.concatenate(imgs,1).ravel(); im.filepath_raw=out+'.png'; im.file_format='PNG'; im.save()
