# Measures where the dragged trooper's root sits relative to the rescuer so the rescuer's left hand is on his collar.
import bpy, sys, json
w, o = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend'); ao = bpy.data.objects['Armature']; P = ao.pose.bones; sc = bpy.context.scene
ao.animation_data.action = bpy.data.actions['drag_rescuer']; sc.frame_set(0); h = P['hand_l'].head.copy()
ao.animation_data.action = bpy.data.actions['drag_wounded']; sc.frame_set(0); n = (P['neck_01'].head + P['spine_03'].head) / 2
# Blender: forward = -Y, left = +X. Both actors share a heading; the wounded lies ahead of the rescuer.
out = {'forward': round(-h.y + n.y, 3), 'left': round(h.x - n.x, 3), 'hand_height': round(h.z, 3), 'collar_height': round(n.z, 3)}
json.dump(out, open(f'{w}/drag_pair.json', 'w'), indent=1); json.dump(out, open(f'{o}/Unreal/drag_pair.json', 'w'), indent=1)
print('DRAG', out)
