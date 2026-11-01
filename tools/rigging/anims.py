# Authors the trooper animation set on the control rig, measures quality, saves anim.blend
import bpy,sys,math,json
sys.path.insert(0,sys.argv[-2]); import rigkit as K
from mathutils import Vector as V, Matrix as M, Quaternion as Q, Euler as E
w=sys.argv[-1]; R=math.radians
ao=K.load(w); K.build_controls(ao,w); P=ao.pose.bones
FPS=30; bpy.context.scene.render.fps=FPS
REST={pb.name:pb.bone.matrix_local.copy() for pb in P}
def ss(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def lerp(a,b,t): return a+(b-a)*t
def mix(a,b,t): return tuple(lerp(x,y,t) for x,y in zip(a,b))
def env(t,keys):
    """piecewise smooth interpolation of dict params over keys [(time, dict)]"""
    if t<=keys[0][0]: return dict(keys[0][1])
    for (t0,a),(t1,b) in zip(keys,keys[1:]):
        if t<=t1:
            u=ss((t-t0)/(t1-t0) if t1>t0 else 1); out={}
            for k in set(a)|set(b):
                va=a.get(k,b.get(k)); vb=b.get(k,a.get(k))
                if isinstance(va,(int,float)) and isinstance(vb,(int,float)): out[k]=lerp(va,vb,u)
                elif isinstance(va,tuple) and isinstance(vb,tuple): out[k]=mix(va,vb,u)
                else: out[k]=va if u<0.5 else vb
            return out
    return dict(keys[-1][1])
# ---------------- stances ----------------
# gun placements (pos of pistol grip, yaw/pitch/roll of a forward gun), in the torso-at-rest frame
GUN={
 'aim':   dict(gpos=(-0.06,-0.30,1.30),gyaw=0,gpitch=0,groll=0),
 'ready': dict(gpos=(-0.06,-0.22,1.19),gyaw=12,gpitch=-28,groll=-8),     # low ready: muzzle down-forward
 'patrol':dict(gpos=(-0.07,-0.21,1.15),gyaw=22,gpitch=-38,groll=-12),
 'port':  dict(gpos=(-0.05,-0.24,1.22),gyaw=40,gpitch=22,groll=-25),     # run: across the chest, muzzle up-left
 'sprint':dict(gpos=(-0.03,-0.20,1.20),gyaw=62,gpitch=30,groll=-35),
}
BASE=dict(px=0,py=0,pz=0,pp=0,pyw=0,pr=0, s1p=0,s1y=0,s1r=0, s2p=0,s2y=0,s2r=0, s3p=0,s3y=0,s3r=0, np_=0,ny=0,nr=0, hp=0,hy=0,hr=0,
          gdx=0,gdy=0,gdz=0,gdp=0,gdyaw=0,gdr=0, curlR=0.9,idxR=0.1,curlL=0.85, capeP=0,capeS=0, lhand=1.0, lpos=None)
def stance(name,**kw):
    d=dict(BASE); d.update(GUN[name])
    if name=='aim': d.update(pz=-0.03,pyw=10,s1y=-3,s2y=-4,s3y=-5,s1p=3,s2p=3,s3p=2,np_=6,nr=-4,hp=6,hr=-7,idxR=0.35)
    if name in('ready','patrol'): d.update(pz=-0.01,s2p=2,s3p=1,hp=4)
    d.update(kw); return d
FOOT0={s:REST[f'ctrl_foot_{s}'].copy() for s in 'lr'}
ANK0={s:REST[f'foot_{s}'].translation.copy() for s in 'lr'}
BALL0={s:REST[f'ball_{s}'].translation.copy() for s in 'lr'}
TOE0={s:(REST[f'ball_{s}']@V((0,P[f'ball_{s}'].bone.length,0))) for s in 'lr'}
def foot_mat(s,off=(0,0,0),pitch=0,yaw=0,pivot='ankle'):
    """foot target: rest foot translated by off, pitched (+ toe down) about ankle/ball/heel, yawed"""
    base=FOOT0[s].copy()
    piv={'ankle':ANK0[s],'ball':BALL0[s].copy(),'heel':V((ANK0[s].x,ANK0[s].y+0.06,0.02))}[pivot]
    piv=V(piv)
    Rm=(M.Rotation(R(yaw),4,'Z')@M.Rotation(R(pitch),4,'X'))
    m=M.Translation(piv)@Rm@M.Translation(-piv)@base
    m.translation+=V(off); return m
def apply(d,feet=None,ball=None,frame=None):
    K.reset(ao)
    K.loc_world(P['pelvis'],(d['px'],d['py'],d['pz'])); K.rot(P['pelvis'],d['pp'],d['pyw'],d['pr'])
    for i in (1,2,3): K.rot(P[f'spine_0{i}'],d[f's{i}p'],d[f's{i}y'],d[f's{i}r'])
    K.rot(P['neck_01'],d['np_'],d['ny'],d['nr']); K.rot(P['head'],d['hp'],d['hy'],d['hr'])
    g=d['gpos']; G=K.gun_matrix((g[0]+d['gdx'],g[1]+d['gdy'],g[2]+d['gdz']),d['gyaw']+d['gdyaw'],d['gpitch']+d['gdp'],d['groll']+d['gdr'])
    K.set_rest_space(P['ctrl_gun'],G)
    K.curl(ao,'r',d['curlR'],index=d['idxR']); K.curl(ao,'l',d['curlL'])
    for s in 'lr':
        fm=(feet or {}).get(s); K.set_rest_space(P[f'ctrl_foot_{s}'],fm if fm is not None else FOOT0[s])
        if ball and s in ball: K.rot(P[f'ball_{s}'],ball[s],0,0)
    for i in (1,2,3,4):
        for c,sg in (('c',0),('l',1),('r',-1)):
            k=f'cape_0{i}_{c}'
            if k in P: K.rot(P[k],d['capeP']*(0.6+0.25*i),0,d['capeS']*sg*0.5)
    # left hand: on the gun (lhand=1) or free at lpos (armature space matrix)
    c=[c for c in P['lowerarm_l'].constraints if c.type=='IK'][0]
    if d.get('lpos') is not None:
        bpy.context.view_layer.update()
        P['ctrl_hand_l'].matrix=d['lpos']
def key(frame):
    K.key_all(ao,frame)
STATS={}
def finish(name,nframes,loop=True,speed=0.0,notes=''):
    act=ao.animation_data.action; act.name=name; act.use_fake_user=True
    act.frame_range=(0,nframes); act.use_frame_range=True; act['loop']=loop; act['speed_cm_s']=speed*100; act['notes']=notes
    # QA: sample every frame -> IK hand gap, foot gap, planted-foot slip
    bpy.context.scene.frame_start=0; bpy.context.scene.frame_end=nframes
    hgap=fgap=0; slip=0; prev=None; prev_t={'l':False,'r':False}
    for f in range(0,nframes+1):
        bpy.context.scene.frame_set(f)
        a,b=K.hand_error(ao) if True else (0,0)
        hl=(P['hand_l'].head-P['ctrl_hand_l'].head).length if act.get('lhand_on',1) else 0
        hgap=max(hgap,(P['hand_r'].head-P['ctrl_hand_r'].head).length,hl); fgap=max(fgap,b)
        # foot slip: world speed of a planted foot (z of sole near ground) given the character moves at `speed` along its travel dir
        cur={s:P[f'foot_{s}'].head.copy() for s in 'lr'}
        if prev is not None and speed>0:
            for s in 'lr':
                if P[f'ctrl_foot_{s}'].head.z<ANK0[s].z+0.002 and abs(P[f'ctrl_foot_{s}'].head.z-ANK0[s].z)<0.002 and prev_t[s]:
                    dv=(cur[s]-prev[s])*FPS; tv=act['dir']; wv=V((dv.x+tv[0]*speed,dv.y+tv[1]*speed,0)).length
                    slip=max(slip,wv)
        prev=cur; prev_t={s:abs(P[f'ctrl_foot_{s}'].head.z-ANK0[s].z)<0.002 for s in 'lr'}
    STATS[name]=dict(frames=nframes,seconds=round(nframes/FPS,3),loop=loop,speed_m_s=speed,max_hand_gap_cm=round(hgap*100,2),max_foot_gap_cm=round(fgap*100,2),planted_foot_slip_cm_s=round(slip*100,2),notes=notes)
    print(name,STATS[name])
    ao.animation_data.action=None
def new(name,direction=(0,-1),lhand_on=1):
    ao.animation_data_create(); a=bpy.data.actions.new(name); ao.animation_data.action=a; a['dir']=direction; a['lhand_on']=lhand_on; return a
# ---------------- locomotion ----------------
def gait(name,T,v,s,stride_dir,lift,bob,sway,yawamp,stanceKw,stanceName,lean=0,width=0.0,crouch=0.0,pz=0.0,flight=False,cape=0.0,notes=''):
    new(name,direction=stride_dir)   # character travels along stride_dir; planted feet move opposite in root space
    N=round(T*FPS); L=v*T*s
    d0=stance(stanceName,**stanceKw)
    LEG={sd:(P[f'thigh_{sd}'].bone.length+P[f'calf_{sd}'].bone.length) for sd in 'lr'}
    def frame(f,drop):
        p=f/N; feet={}; balls={}
        for side,ph in (('l',0.0),('r',0.5)):
            q=(p+ph)%1.0
            if q<s:
                u=q/s; off=L*(0.5-u)-0.03*(1 if stride_dir[1]<0 else 0); lz=0
                pitch=0; piv='ankle'; ball=0
                if u<0.12: pitch=-14*(1-u/0.12) if not flight else -6*(1-u/0.12); piv='heel'
                if u>0.72: pitch=(u-0.72)/0.28*(24 if not flight else 32); piv='ball'; ball=-pitch*0.9
            else:
                u=(q-s)/(1-s); off=-L/2-0.03*(1 if stride_dir[1]<0 else 0)+L*ss(u); lz=lift*math.sin(math.pi*u)**0.9
                pitch=(24 if not flight else 32)*(1-ss(u*2.2))-14*ss((u-0.7)/0.3); piv='ankle'; ball=-max(0,pitch)*0.5
            dx,dy=stride_dir
            sidesgn=1 if side=='l' else -1
            feet[side]=foot_mat(side,(dx*off+sidesgn*width,dy*off,lz),pitch=pitch,yaw=0,pivot=piv); balls[side]=ball
        d=dict(d0)
        fwd=(1 if stride_dir[1]<0 else -1 if stride_dir[1]>0 else 0)
        d['pz']=(pz-bob*math.cos(4*math.pi*(p-s/2))) if flight else (pz-bob*math.cos(4*math.pi*p))
        d['pz']+=d0['pz']-drop
        d['px']=sway*math.sin(2*math.pi*p)
        d['pyw']=d0['pyw']-yawamp*math.cos(2*math.pi*p)*fwd
        d['s2y']=d0['s2y']+yawamp*0.6*math.cos(2*math.pi*p)*fwd
        d['s1p']=d0['s1p']+lean*0.4; d['s2p']=d0['s2p']+lean*0.35; d['s3p']=d0['s3p']+lean*0.25; d['hp']=d0['hp']-lean*0.5
        d['pr']=-sway*60*math.sin(2*math.pi*p)
        d['gdz']=bob*0.25*math.cos(4*math.pi*p); d['gdx']=sway*0.15*math.sin(2*math.pi*p)
        d['capeP']=cape+3*math.sin(4*math.pi*p-1.0); d['capeS']=4*math.sin(2*math.pi*p-0.8)
        if crouch: d['pz']-=crouch
        apply(d,feet,balls); return feet
    # pass 1: how far must the pelvis drop so both legs reach their targets (98% extension)?
    need=[]
    for f in range(N):
        feet=frame(f,0.0); bpy.context.view_layer.update(); dr=0
        for sd in 'lr':
            hip=P[f'thigh_{sd}'].head; A=feet[sd].translation; hz=(V((A.x-hip.x,A.y-hip.y,0))).length
            maxv=math.sqrt(max(0.0,(0.98*LEG[sd])**2-hz*hz)); dr=max(dr,(hip.z-A.z)-maxv)
        need.append(max(0.0,dr))
    # cyclic smoothing (keep the max so legs never over-extend)
    sm=[max(need[(i+k)%N] for k in (-2,-1,0,1,2)) for i in range(N)]
    sm=[sum(sm[(i+k)%N] for k in (-2,-1,0,1,2))/5 for i in range(N)]
    sm=[max(a,b) for a,b in zip(sm,need)]
    for f in range(N+1):
        frame(f,sm[f%N]+0.004); key(f)
    print(name,'pelvis drop cm min/max',round(min(sm)*100,1),round(max(sm)*100,1))
    finish(name,N,True,v,notes)
# ---------------- clips ----------------
def hold(name,secs,keys,loop=True,feetfn=None,notes='',lhand_on=1):
    new(name,lhand_on=lhand_on); N=round(secs*FPS)
    for f in range(N+1):
        t=f/FPS; d=env(t,keys)
        feet=feetfn(t) if feetfn else None
        apply(d,feet); key(f)
    finish(name,N,loop,0,notes)
def breathe(st,secs,amp=1.0,**extra):
    ks=[]
    for i in range(0,int(secs*10)+1):
        t=i/10; ph=2*math.pi*t/secs*round(secs/4.0 if secs>=4 else 1)
        d=dict(st); d['s2p']+=1.2*amp*math.sin(ph); d['s3p']+=1.0*amp*math.sin(ph); d['gdz']=0.004*amp*math.sin(ph); d['capeP']=1.5*math.sin(ph+1)
        d.update({k:v(t) for k,v in extra.items()}); ks.append((t,d))
    return ks
FE_AIM={'l':foot_mat('l',(0.02,-0.12,0),yaw=8),'r':foot_mat('r',(-0.04,0.12,0),yaw=-25)}
FE_RDY={'l':foot_mat('l',(0.0,-0.05,0),yaw=4),'r':foot_mat('r',(-0.02,0.06,0),yaw=-12)}
aim=stance('aim'); ready=stance('ready'); patrol=stance('patrol')
# idle (relaxed low ready, breathing)
hold('idle',4.0,breathe(ready,4.0),feetfn=lambda t:FE_RDY,notes='Relaxed low-ready idle with breathing. Loop.')
# patrol look-around
look=[(0,ready),(1.0,dict(ready,s2y=12,s3y=10,ny=14,hy=16,gdyaw=6)),(2.2,dict(ready,s2y=12,s3y=10,ny=14,hy=16,gdyaw=6)),
      (3.4,dict(ready,s2y=-12,s3y=-10,ny=-14,hy=-18,gdyaw=-6)),(4.6,dict(ready,s2y=-12,s3y=-10,ny=-14,hy=-18,gdyaw=-6)),(6.0,ready)]
hold('patrol_look',6.0,look,feetfn=lambda t:FE_RDY,notes='Patrol idle: scans left and right. Loop.')
# aim idle
hold('aim',3.0,breathe(aim,3.0,0.5),feetfn=lambda t:FE_AIM,notes='Shouldered aim idle (weight on back foot). Loop.')
# aim offsets (single poses, for an aim offset / pitch blend)
for nm,kw in (('aim_up',dict(s1p=-8,s2p=-12,s3p=-14,np_=-4,hp=-6,gdz=0.06,gdp=40,gdy=0.05)),('aim_down',dict(s1p=12,s2p=14,s3p=12,np_=8,hp=10,gdz=-0.05,gdp=-38,gdy=0.04)),
              ('aim_left',dict(s1y=14,s2y=16,s3y=16,ny=4,gdyaw=10,gdx=0.04)),('aim_right',dict(s1y=-16,s2y=-18,s3y=-16,ny=-4,gdyaw=-8,gdx=0.0,gdy=0.02))):
    d=dict(aim); [d.__setitem__(k,d.get(k,0)+v) for k,v in kw.items()]
    hold(nm,1/FPS,[(0,d)],loop=False,feetfn=lambda t:FE_AIM,notes='Aim offset pose.')
# shoot: single bolt with recoil (loopable at 200 rpm; scale play rate for faster blasters)
def recoil_keys(base,shots,interval,kick=1.0):
    ks=[(0,base)]
    for i in range(shots):
        t0=i*interval
        ks+= [(t0+0.001,dict(base,idxR=0.65)),(t0+0.04,dict(base,gdy=0.035*kick,gdz=0.012*kick,gdp=7*kick,s3p=base['s3p']-2.5*kick,hp=base['hp']-1.5*kick,idxR=0.65,pz=base['pz']+0.004)),
              (t0+min(interval,0.3)*0.9,dict(base,idxR=0.45))]
    ks.append((shots*interval,base)); return ks
hold('shoot',0.3,recoil_keys(aim,1,0.3),loop=True,feetfn=lambda t:FE_AIM,notes='One blaster bolt: trigger squeeze, kick, settle. Muzzle bone = bolt spawn. Loop for sustained fire.')
hold('shoot_burst',0.6,recoil_keys(aim,3,0.2,0.85),loop=False,feetfn=lambda t:FE_AIM,notes='Three-bolt burst.')
hold('shoot_hip',0.3,recoil_keys(stance('ready',gpitch=-6,gpos=(-0.07,-0.28,1.16),idxR=0.35),1,0.3,1.2),loop=True,feetfn=lambda t:FE_RDY,notes='Hip-fire bolt.')
# reload (swap the power cell): left hand off the gun to the belt and back
def lh_mat(pos,yaw=0,pitch=0,roll=0):
    r=REST['hand_l'].to_3x3(); m=(E((R(pitch),R(roll),R(yaw))).to_matrix()@r).to_4x4(); m.translation=V(pos); return m
gun_tilt=dict(aim,gdr=35,gdp=12,gdy=0.06,gdz=-0.06,gdyaw=-10,hp=14,np_=8,s3y=0)
belt=lh_mat((0.15,-0.16,1.02),pitch=-60,yaw=20); mag=None
def reload_keys():
    ks=[(0,aim),(0.25,gun_tilt)]
    ks+=[(0.45,dict(gun_tilt,lpos='mag')),(0.65,dict(gun_tilt,lpos='magdown',gdr=40)),(0.95,dict(gun_tilt,lpos=belt,gdr=38)),(1.15,dict(gun_tilt,lpos=belt,curlL=1.0)),
         (1.45,dict(gun_tilt,lpos='magdown')),(1.65,dict(gun_tilt,lpos='mag',gdz=-0.05)),(1.75,dict(gun_tilt,lpos='magpush',gdz=-0.055,gdp=10)),(1.9,dict(gun_tilt)),(2.2,aim)]
    return ks
def reload_clip():
    new('reload',lhand_on=0); N=round(2.2*FPS); ks=reload_keys()
    for f in range(N+1):
        t=f/FPS
        # find bracket to blend lpos manually
        prevk=max([k for k in ks if k[0]<=t],key=lambda k:k[0]); nxt=min([k for k in ks if k[0]>=t] or [ks[-1]],key=lambda k:k[0])
        dA=dict(prevk[1]); dB=dict(nxt[1]); la=dA.pop('lpos',None); lb=dB.pop('lpos',None)
        u=ss((t-prevk[0])/(nxt[0]-prevk[0])) if nxt[0]>prevk[0] else 1
        d=env(t,[(k[0],{kk:vv for kk,vv in k[1].items() if kk!='lpos'}) for k in ks])
        apply(d,FE_AIM); bpy.context.view_layer.update()
        ongun=P['ctrl_hand_l'].matrix.copy()
        def resolve(x):
            if x is None: return ongun
            if isinstance(x,str):
                m=ongun.copy(); gz=(P['ctrl_gun'].matrix.to_3x3()@V((0,0,1)))
                if x=='mag': m.translation+= -gz*0.03
                if x=='magdown': m.translation+= -gz*0.12
                if x=='magpush': m.translation+= -gz*0.015
                return m
            return x
        A=resolve(la); B=resolve(lb)
        mm=A.lerp(B,u) if hasattr(A,'lerp') else A
        loc=A.translation.lerp(B.translation,u); rq=A.to_quaternion().slerp(B.to_quaternion(),u)
        P['ctrl_hand_l'].matrix=M.Translation(loc)@rq.to_matrix().to_4x4()
        key(f)
    finish('reload',N,False,0,'Power-cell swap: tilt, pull cell, stow on belt, seat new cell, back to aim.')
reload_clip()
# hit reactions
hold('hit_front',0.7,[(0,aim),(0.08,dict(aim,pp=-6,py=0.03,s2p=-10,s3p=-12,np_=-8,hp=-10,gdz=0.06,gdp=18,gdy=0.05,s3y=6,curlL=0.6)),(0.3,dict(aim,pp=-2,s2p=-3,s3p=-4,hp=-3,gdp=6)),(0.7,aim)],loop=False,feetfn=lambda t:FE_AIM,notes='Blaster hit from the front.')
hold('hit_back',0.7,[(0,aim),(0.08,dict(aim,pp=8,py=-0.03,s2p=12,s3p=12,hp=10,gdz=-0.05,gdp=-12)),(0.3,dict(aim,s2p=4,s3p=4,gdp=-4)),(0.7,aim)],loop=False,feetfn=lambda t:FE_AIM,notes='Hit from behind.')
# death: shot, knees buckle, falls on his back; left hand lets go
def death():
    new('die',lhand_on=0); N=round(2.0*FPS)
    for f in range(N+1):
        t=f/FPS
        u1=ss(t/0.25); u2=ss((t-0.2)/0.6); u3=ss((t-0.75)/0.5); u4=ss((t-1.25)/0.3)
        d=dict(aim)
        d.update(pp=lerp(-8*u1,-88,u3), pz=-0.03-0.30*u2-0.50*u3, py=0.05*u1+0.12*u3, pyw=10-25*u2,
                 s2p=-10*u1+6*u2-14*u3, s3p=-12*u1+4*u2-10*u3, hp=-15*u1+20*u2-20*u3, hy=25*u4, hr=-10*u4,
                 gdz=-0.08*u2, gdp=-25*u2-45*u3, gdyaw=30*u3, gdr=50*u3, gdx=-0.04*u3, gdy=0.06*u3, curlR=0.9-0.3*u4, idxR=0.4, curlL=0.5, capeP=18*u3)
        fl=foot_mat('l',(0.02,-0.12-0.18*u2-0.22*u3,0.02*u3),pitch=-40*u3,yaw=8+10*u3)
        fr=foot_mat('r',(-0.04,0.12-0.22*u2-0.38*u3,0.0+0.04*u3),pitch=-30*u3,yaw=-25+10*u3)
        apply(d,{'l':fl,'r':fr}); bpy.context.view_layer.update()
        # left arm flops out to the side
        ongun=P['ctrl_hand_l'].matrix.copy()
        free=P['spine_03'].matrix@REST['spine_03'].inverted()@lh_mat((0.48,-0.05,1.05),pitch=-20,roll=-30)
        k=ss((t-0.15)/0.6)
        P['ctrl_hand_l'].matrix=M.Translation(ongun.translation.lerp(free.translation,k))@ongun.to_quaternion().slerp(free.to_quaternion(),k).to_matrix().to_4x4()
        key(f)
    finish('die',N,False,0,'Shot, knees buckle, falls backward; ends lying on the ground.')
death()
# jump (in place: capsule moves in Unreal)
hold('jump',0.9,[(0,ready),(0.12,dict(ready,pz=-0.09,s2p=10,s3p=6)),(0.22,dict(ready,pz=0.0,s2p=-2)),(0.55,dict(ready,pz=0.0,s2p=4,capeP=-12)),(0.7,dict(ready,pz=-0.11,s2p=12,s3p=8)),(0.9,ready)],loop=False,
     feetfn=lambda t:{s:foot_mat(s,(0,0,0.16*ss((t-0.2)/0.12)*(1-ss((t-0.5)/0.15))),pitch=25*ss((t-0.15)/0.1)*(1-ss((t-0.45)/0.15))) for s in 'lr'},notes='Jump: crouch, push, tuck, land.')
# crouch aim + crouch walk
FE_CR={'l':foot_mat('l',(0.04,-0.22,0),yaw=10),'r':foot_mat('r',(-0.06,0.24,0.0),pitch=35,pivot='ball',yaw=-20)}
cra=stance('aim',pz=-0.40,pp=12,s1p=8,s2p=6,s3p=-2,hp=2)
hold('crouch_aim',3.0,breathe(cra,3.0,0.5),feetfn=lambda t:FE_CR,notes='Crouched aim (cover). Loop.')
hold('crouch_shoot',0.3,recoil_keys(cra,1,0.3),loop=True,feetfn=lambda t:FE_CR,notes='Crouched bolt.')
gait('crouch_walk',1.1,1.0,0.62,(0,-1),0.07,0.012,0.012,5,dict(pp=14,s1p=8,s2p=6,s3p=-2,hp=2,idxR=0.35),'aim',crouch=0.33,cape=6,notes='Crouched advance, rifle up. 1.1 m/s.')
# walking
gait('walk',0.92,1.4,0.56,(0,-1),0.09,0.018,0.02,6,{},'patrol',notes='Patrol walk, low ready. 1.5 m/s.')
gait('aim_walk_fwd',0.94,1.3,0.57,(0,-1),0.07,0.012,0.012,4,{},'aim',cape=3,notes='Combat walk forward while aiming. 1.4 m/s.')
gait('aim_walk_bwd',0.94,1.1,0.58,(0,1),0.07,0.012,0.012,4,{},'aim',notes='Backpedal while aiming. 1.2 m/s.')
gait('aim_strafe_l',0.9,1.2,0.60,(1,0),0.07,0.012,0.0,0,{},'aim',width=0.03,notes='Strafe left while aiming. 1.3 m/s.')
gait('aim_strafe_r',0.9,1.2,0.60,(-1,0),0.07,0.012,0.0,0,{},'aim',width=0.03,notes='Strafe right while aiming. 1.3 m/s.')
gait('run',0.66,4.2,0.30,(0,-1),0.16,0.035,0.015,8,dict(curlR=0.9),'port',lean=12,pz=-0.035,flight=True,cape=9,notes='Combat jog, rifle at port. 4.2 m/s.')
gait('sprint',0.58,6.2,0.26,(0,-1),0.22,0.045,0.012,10,{},'sprint',lean=20,pz=-0.05,flight=True,cape=12,notes='Sprint, rifle across chest. 6.2 m/s.')
# melee: rifle-butt strike
hold('melee',0.9,[(0,ready),(0.2,dict(ready,s2y=-25,s3y=-20,pyw=-10,gpos=(-0.1,-0.18,1.32),gyaw=60,gpitch=10,groll=-80,curlL=1.0)),
                  (0.36,dict(ready,s2y=22,s3y=18,pyw=12,s2p=8,gpos=(-0.02,-0.42,1.38),gyaw=-40,gpitch=40,groll=-90,curlL=1.0)),(0.55,dict(ready,s2y=10,s3y=8,gpos=(-0.04,-0.36,1.3),gyaw=-20,gpitch=20,groll=-60)),(0.9,ready)],
     loop=False,feetfn=lambda t:{'l':foot_mat('l',(0.02,-0.05-0.15*ss((t-0.15)/0.2)*(1-ss((t-0.6)/0.3)),0.04*math.sin(math.pi*max(0,min(1,(t-0.12)/0.22)))),yaw=4),'r':FE_RDY['r']},notes='Rifle-butt melee strike with a step.')
# hand signals (patrol): left hand raised fist (halt) / forward chop (move up)
def signal(name,poses,secs,notes):
    new(name,lhand_on=0); N=round(secs*FPS)
    for f in range(N+1):
        t=f/FPS; apply(dict(ready,curlL=1.0 if 'halt' in name else 0.15),FE_RDY); bpy.context.view_layer.update()
        ongun=P['ctrl_hand_l'].matrix.copy(); tgt=None
        for (t0,t1,m) in poses:
            if t0<=t<=t1: tgt=(ss((t-t0)/0.25) if t<t0+0.25 else 1)*(1-ss((t-(t1-0.3))/0.3)), m
        if tgt:
            k,m=tgt; m=P['spine_03'].matrix@REST['spine_03'].inverted()@m
            P['ctrl_hand_l'].matrix=M.Translation(ongun.translation.lerp(m.translation,k))@ongun.to_quaternion().slerp(m.to_quaternion(),k).to_matrix().to_4x4()
        key(f)
    finish(name,N,False,0,notes)
signal('signal_halt',[(0.1,1.4,lh_mat((0.24,-0.12,1.55),pitch=180,yaw=-10))],1.6,'Patrol hand signal: halt (raised fist).')
signal('signal_moveup',[(0.1,1.3,lh_mat((0.16,-0.42,1.36),pitch=-95,yaw=-15))],1.5,'Patrol hand signal: move up (forward point).')
bpy.context.scene.frame_set(0)
for o in bpy.context.scene.objects: o.select_set(False)
bpy.ops.object.mode_set(mode='OBJECT')
json.dump(STATS,open(f'{w}/anim_stats.json','w'),indent=1)
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/anim.blend')
print('ANIMS',len(STATS))
