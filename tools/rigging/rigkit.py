# Control rig + posing helpers for SK_Trooper (Blender 4.5, bpy)
import bpy,math,json
from mathutils import Vector as V, Matrix as M, Quaternion as Q, Euler as E
R=math.radians
def load(w):
    bpy.ops.wm.open_mainfile(filepath=f'{w}/s2.blend')
    return bpy.data.objects['Armature']
def build_controls(ao,w):
    G=json.load(open(f'{w}/gun.json')); gun=M(G['gun_world']); lat=V(G['lat'])
    hold=gun@V(G['hold_src'])
    bpy.context.view_layer.objects.active=ao; ao.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); eb=ao.data.edit_bones
    def cb(name,head,tail,roll_vec,parent):
        b=eb.new(name); b.head=head; b.tail=tail; b.align_roll(roll_vec); b.parent=eb[parent] if parent else None; b.use_deform=False; return b
    wr=eb['weapon_r']
    cg=cb('ctrl_gun',wr.head.copy(),wr.tail.copy(),wr.z_axis.copy(),'spine_03')
    hr=eb['hand_r']; cb('ctrl_hand_r',hr.head.copy(),hr.tail.copy(),hr.z_axis.copy(),'ctrl_gun')
    hl=eb['hand_l']; hc=(hl.head+hl.tail)/2
    off=hold+lat*(-0.045)-hc
    cb('ctrl_hand_l',hl.head+off,hl.tail+off,hl.z_axis.copy(),'ctrl_gun')
    for s,sg in (('l',1),('r',-1)):
        cb(f'ctrl_elbow_{s}',V((sg*0.55,0.45,1.0)),V((sg*0.55,0.45,1.08)),V((0,-1,0)),'spine_03')
        f=eb[f'foot_{s}']; cb(f'ctrl_foot_{s}',f.head.copy(),f.tail.copy(),f.z_axis.copy(),'root')
        cb(f'ctrl_knee_{s}',V((sg*0.14,-0.7,0.52)),V((sg*0.14,-0.7,0.6)),V((0,-1,0)),f'ctrl_foot_{s}')
    # free bones for severed pieces (lightsaber / explosion dismemberment): rest = identity, children of root
    for cn in ('cut_a','cut_b','prop'):   # prop: crates, datapads, mortar rounds (Unreal attaches the prop mesh here)
        if cn not in eb:
            b=eb.new(cn); b.head=V((0,0,0)); b.tail=V((0,0.1,0)); b.roll=0.0; b.parent=eb['root']
    for b in eb: 
        if b.name.startswith(('weapon_r','muzzle','ik_','cut_','prop')): b.use_deform=True   # exported as bones/sockets for Unreal
    bpy.ops.object.mode_set(mode='POSE')
    pbs=ao.pose.bones
    for pb in pbs: pb.rotation_mode='QUATERNION'
    def ik(bone,target,pole,chain=2):
        c=pbs[bone].constraints.new('IK'); c.target=ao; c.subtarget=target; c.pole_target=ao; c.pole_subtarget=pole; c.chain_count=chain; c.use_tail=True; return c
    for s in 'lr':
        ik(f'lowerarm_{s}',f'ctrl_hand_{s}',f'ctrl_elbow_{s}')
        c=pbs[f'hand_{s}'].constraints.new('COPY_ROTATION'); c.target=ao; c.subtarget=f'ctrl_hand_{s}'
        ik(f'calf_{s}',f'ctrl_foot_{s}',f'ctrl_knee_{s}')
        c=pbs[f'foot_{s}'].constraints.new('COPY_ROTATION'); c.target=ao; c.subtarget=f'ctrl_foot_{s}'
    for b,src in (('ik_foot_l','foot_l'),('ik_foot_r','foot_r'),('ik_hand_gun','hand_r'),('ik_hand_r','hand_r'),('ik_hand_l','hand_l')):
        c=pbs[b].constraints.new('COPY_TRANSFORMS'); c.target=ao; c.subtarget=src
    tune_poles(ao)
    return ao
def tune_poles(ao):
    pbs=ao.pose.bones
    for chain,tgt,pole in (('lowerarm','ctrl_hand','ctrl_elbow'),('calf','ctrl_foot','ctrl_knee')):
        for s in 'lr':
            c=[c for c in pbs[f'{chain}_{s}'].constraints if c.type=='IK'][0]
            # move target so the chain must bend, then pick the pole angle that bends toward the pole
            tb=pbs[f'{tgt}_{s}']; tb.location=V((0,0.12,0)) if chain=='calf' else V((0,0.10,0))
            best=None
            for ang in range(-180,180,5):
                c.pole_angle=R(ang); bpy.context.view_layer.update()
                up=pbs[c.id_data.pose.bones[f'{chain}_{s}'].parent.name]; mid=ao.matrix_world@pbs[f'{chain}_{s}'].head
                a=up.head; b=pbs[f'{chain}_{s}'].tail; pl=pbs[f'{pole}_{s}'].head
                axis=(b-a).normalized(); ve=(mid-a); ve-=axis*ve.dot(axis); vp=(pl-a); vp-=axis*vp.dot(axis)
                sc=ve.normalized().dot(vp.normalized()) if ve.length>1e-5 else -2
                if best is None or sc>best[0]: best=(sc,ang)
            c.pole_angle=R(best[1]); tb.location=V((0,0,0)); print('pole',chain,s,best)
    bpy.context.view_layer.update()
# ---------- posing helpers (angles in degrees, axes in the character's rest frame: X=left, -Y=forward, Z=up) ----------
def qworld(pb,pitch=0,yaw=0,roll=0):
    # pitch about X (+ leans an up-pointing bone forward), yaw about Z (+ turns left), roll about Y (+ tilts top toward left)
    qw=Q(V((0,0,1)),R(yaw))@Q(V((1,0,0)),R(pitch))@Q(V((0,1,0)),R(roll))
    rr=pb.bone.matrix_local.to_3x3().to_quaternion()
    return rr.inverted()@qw@rr
def rot(pb,pitch=0,yaw=0,roll=0): pb.rotation_quaternion=qworld(pb,pitch,yaw,roll)
def loc_world(pb,v):
    pb.location=pb.bone.matrix_local.to_3x3().inverted()@V(v)
def set_rest_space(pb,Mdes):
    # pose so the bone's armature-space matrix equals Mdes when its parents are at rest
    b=pb.bone; pb.matrix_basis=b.matrix_local.inverted()@Mdes
def gun_matrix(pos,yaw=0,pitch=0,roll=0):
    # gun frame: X=gun right, Y=barrel, Z=up. yaw/pitch/roll applied to a forward-pointing gun (barrel -Y)
    base=M(((-1,0,0),(0,-1,0),(0,0,1))).transposed()   # columns: X->-X(world right), Y->-Y(forward), Z->Z
    Rw=(E((0,0,R(yaw))).to_matrix()@M.Rotation(R(-pitch),3,'X')@M.Rotation(R(roll),3,'Y'))
    m=(Rw@base).to_4x4(); m.translation=V(pos); return m
def curl(ao,side,amt=1.0,index=None,thumb=0.6):
    pbs=ao.pose.bones; sg=1 if side=='r' else -1
    for f in ('index','middle','ring','pinky'):
        a=amt if (f!='index' or index is None) else index
        for i,base in ((1,55),(2,70),(3,45)):
            pb=pbs[f'{f}_0{i}_{side}']; rr=pb.bone.matrix_local.to_3x3().to_quaternion()
            pb.rotation_quaternion=Q(V((0,0,1)),R(sg*base*a))
    for i,base in ((1,15),(2,25),(3,25)):
        pbs[f'thumb_0{i}_{side}'].rotation_quaternion=Q(V((0,0,1)),R(base*thumb))
LIMB_CONSTRAINT_BONES=('lowerarm_l','lowerarm_r','hand_l','hand_r','calf_l','calf_r','foot_l','foot_r')
def key_all(ao,frame):
    for pb in ao.pose.bones:
        pb.keyframe_insert('location',frame=frame,group=pb.name); pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
    # IK on/off is animated (limp limbs in deaths), so every clip keys it explicitly
    for b in LIMB_CONSTRAINT_BONES:
        for c in ao.pose.bones[b].constraints: c.keyframe_insert('influence',frame=frame,group=b)
def reset(ao):
    for pb in ao.pose.bones: pb.location=V(); pb.rotation_quaternion=Q(); pb.scale=V((1,1,1))
    for b in LIMB_CONSTRAINT_BONES:
        for c in ao.pose.bones[b].constraints: c.influence=1.0
def limb_ik(ao,limb,side,influence):
    # limb: 'arm' or 'leg'. 0 = free (FK), 1 = locked to its control (gun / foot target)
    for b in (('lowerarm','hand') if limb=='arm' else ('calf','foot')):
        for c in ao.pose.bones[f'{b}_{side}'].constraints: c.influence=max(0.0,min(1.0,influence))
def hand_error(ao):
    pbs=ao.pose.bones; bpy.context.view_layer.update()
    return max((pbs[f'hand_{s}'].head-pbs[f'ctrl_hand_{s}'].head).length for s in 'lr'), max((pbs[f'foot_{s}'].head-pbs[f'ctrl_foot_{s}'].head).length for s in 'lr')
