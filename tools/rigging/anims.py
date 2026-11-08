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
def foot_mat(s,off=(0,0,0),pitch=0,yaw=0,pivot='ankle',roll=0.0):
    """foot target: rest foot translated by off, pitched (+ toe down) about ankle/ball/heel, yawed, and rolled
    (+ = inversion: sole turns toward the midline) about the ankle"""
    base=FOOT0[s].copy()
    piv={'ankle':ANK0[s],'ball':BALL0[s].copy(),'heel':V((ANK0[s].x,ANK0[s].y+0.06,0.02))}[pivot]
    piv=V(piv)
    ank=V(ANK0[s]); sg=1 if s=='l' else -1
    m=M.Translation(ank)@M.Rotation(R(yaw),4,'Z')@M.Rotation(R(sg*roll),4,'Y')@M.Translation(-ank)@M.Translation(piv)@M.Rotation(R(pitch),4,'X')@M.Translation(-piv)@base
    m.translation+=V(off); return m
def foot_mat_blend(s,off,pitch,yaw,pivA,pivB,k,roll=0.0):
    # same foot rotation, pivot moving smoothly from pivA to pivB (keeps the ankle path continuous)
    mA=foot_mat(s,off,pitch,yaw,pivA,roll); mB=foot_mat(s,off,pitch,yaw,pivB,roll)
    m=mA.copy(); m.translation=mA.translation.lerp(mB.translation,k); return m
def apply(d,feet=None,ball=None,frame=None):
    K.reset(ao)
    if 'rootx' in d or 'rooty' in d or 'rootz' in d:      # root motion (roll, mantle, blast throws)
        K.loc_world(P['root'],(d.get('rootx',0.0),d.get('rooty',0.0),d.get('rootz',0.0)))
    if d.get('rootyaw'):                                   # root rotation (turn in place)
        K.rot(P['root'],0,d['rootyaw'],0)
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
            if k in P: K.rot(P[k],d['capeP']*(0.6+0.25*i),0,d['capeS']*sg*0.5+d.get('capeR',0)*(0.5+0.2*i))
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
        locked=lambda bn: all(c.influence>0.999 for c in P[bn].constraints)
        hl=(P['hand_l'].head-P['ctrl_hand_l'].head).length if (act.get('lhand_on',1) and locked('lowerarm_l')) else 0
        hr=(P['hand_r'].head-P['ctrl_hand_r'].head).length if locked('lowerarm_r') else 0
        fg=max(((P[f'foot_{sd}'].head-P[f'ctrl_foot_{sd}'].head).length if locked(f'calf_{sd}') else 0) for sd in 'lr')
        hgap=max(hgap,hr,hl); fgap=max(fgap,fg)
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
# ---------------- human walk (reference-based, overlapping action) ----------------
def walkcycle(name,T,v,travel,stanceName,stanceKw=None,s=0.60,lift=0.11,bob=0.018,roll='fwd',cycles=1,crouch=0.0,injured=None,
              lean=3.0,scan=0.0,gun=1.0,width=0.0,cape=0.0,notes=''):
    """Walk built from gait reference: heel strike -> foot flat -> heel rise -> toe-off; swing foot peaks early
    and reaches before contact; pelvis bob/list/rotation/sway/surge; spine, head, gun and cape trail the pelvis
    (phase lags) so the motion follows through instead of moving in lockstep. Pelvis height is a constant
    soft-knee level (no reach pumping)."""
    new(name,direction=travel)
    N=round(T*cycles*FPS); L=v*T*s
    d0=stance(stanceName,**(stanceKw or {}))
    LEG={sd:(P[f'thigh_{sd}'].bone.length+P[f'calf_{sd}'].bone.length) for sd in 'lr'}
    dx,dy=travel
    fwd=1.0 if roll=='fwd' else -1.0 if roll=='bwd' else 0.0
    yawk=abs(fwd)+(0.35 if roll=='side' else 0)
    C=lambda ph: math.cos(2*math.pi*ph); Sn=lambda ph: math.sin(2*math.pi*ph)
    def foot(side,q):
        asym=1.0 if side=='l' else 0.93
        if q<s:
            u=q/s; off=L*(0.5-u); lz=0.0; pitch=0.0; piv='ankle'; ball=0.0
            froll=0.0
            if roll=='fwd':
                # heel rocker: land on the heel with the toes up, lower the forefoot under control (no slap)
                if u<0.18: x=u/0.18; e=1-(1-x)**2.5; pitch=-16*(1-e); piv='heel'; ball=-10*(1-ss(x))
                # forefoot rocker: heel rises, the foot rolls over the ball while the toes stay planted and bend
                elif u>0.50:
                    k=(u-0.50)/0.50; pitch=34*k**1.5; piv='ball'
                    ball=-pitch*(1-0.35*ss((k-0.82)/0.18))     # toes leave the ground last
                # slight inversion at contact -> pronation in mid-stance -> supination for push-off
                froll=3.0*(1-ss(u/0.25))-3.0*ss((u-0.15)/0.3)*(1-ss((u-0.55)/0.3))+2.5*ss((u-0.6)/0.4)
            elif roll=='bwd':
                if u<0.14: e=1-(1-u/0.14)**2; pitch=12*(1-e); piv='ball'; ball=-pitch*0.9
                elif u>0.6: k=(u-0.6)/0.4; pitch=-14*k**1.5; piv='heel'
        else:
            w=(q-s)/(1-s)
            prog=ss(min(1.0,w/0.92))*1.015-0.015*ss((w-0.92)/0.08)
            off=-L/2+L*prog
            lz=lift*asym*(math.sin(math.pi*w**0.7))**1.3
            froll=0.0
            if roll=='fwd':
                # toe-off plantarflexion, then the ankle dorsiflexes for toe clearance, heel-first before contact
                pitch=34*(1-ss(w/0.38))-7*ss(w/0.45)-9*ss((w-0.62)/0.38)
                ball=-34*0.65*(1-ss(w/0.35))-6*ss((w-0.7)/0.3)   # toes relax in swing, lift before contact
                froll=2.5*(1-ss(w/0.4))+3.0*ss((w-0.6)/0.4)
            elif roll=='bwd': pitch=-14*(1-ss(w/0.45))+12*ss((w-0.6)/0.4); ball=-max(0.0,pitch)*0.4*(1-ss(w/0.5))
            else: pitch=6*math.sin(math.pi*w); ball=-max(0.0,pitch)*0.4*(1-ss(w/0.5))
            sg=1 if side=='l' else -1; toe=sg*(6 if roll!='side' else 3)
            pa,pb={'fwd':('ball','heel'),'bwd':('heel','ball')}.get(roll,('ankle','ankle'))
            pass_y=(-0.09*math.sin(math.pi*w) if roll=='side' else 0.0)   # strafing: swing foot passes in front of the planted one
            spread=(sg*L*0.25 if roll=='side' else 0.0)                      # step-together strafe: the feet never cross
            return foot_mat_blend(side,(dx*off+sg*width+spread,dy*off+pass_y,lz),pitch,toe,pa,pb,ss(w),froll),ball
        sg=1 if side=='l' else -1
        toe=sg*(6 if roll!='side' else 3)
        spread=(sg*L*0.25 if roll=='side' else 0.0)
        return foot_mat(side,(dx*off+sg*width+spread,dy*off,lz),pitch=pitch,yaw=toe,pivot=piv,roll=froll if roll=='fwd' else 0.0),ball
    def frame(f,drop):
        g=f/N*cycles; p=g%1.0; feet={}; balls={}
        for side,ph in (('l',0.0),('r',0.5)):
            if injured:
                # limp: spend less of the cycle on the hurt foot (it lands after a long step of the good leg)
                ph=0.0 if side!=injured else 0.40
            feet[side],balls[side]=foot(side,(p+ph)%1.0)
            if injured==side:   # hurt foot: flat, no push-off, kept short of the floor roll
                feet[side]=feet[side]@M.Identity(4)
        d=dict(d0)
        if injured:
            sgi=1 if injured=='l' else -1
            qh=(p+0.40)%1.0; on_hurt=qh<s
            dip=math.sin(math.pi*min(1.0,qh/s)) if on_hurt else 0.0
            d['pz']=d0['pz']-0.035*dip           # sinks over the hurt leg
            d['s2r']=d0['s2r']+sgi*8*dip; d['s3r']=d0['s3r']+sgi*4*dip   # leans the weight off it
            d['hp']=d0['hp']+4*dip
        surge=-0.010*Sn(2*p)                              # decelerate after contact, push off
        d['px']=d0['px']+0.022*Sn(p-0.08)+dx*surge
        d['py']=d0['py']+dy*surge
        d['pz']=d0['pz']-bob*C(2*(p-0.06))-drop-crouch
        d['pr']=d0['pr']-3.5*Sn(p-0.08)                   # pelvic list: swing hip drops
        d['pyw']=d0['pyw']-5.0*C(p)*yawk*(1 if fwd>=0 else -1)
        d['pp']=d0['pp']+1.0*C(2*(p-0.1))
        # spine counter-rotates and counter-lists, each level a little later than the one below
        y1=2.0*C(p-0.04)*yawk; y2=2.4*C(p-0.06)*yawk; y3=1.2*C(p-0.08)*yawk
        r1=2.0*Sn(p-0.12); r2=1.0*Sn(p-0.16); r3=0.6*Sn(p-0.2)
        d['s1y']=d0['s1y']+y1; d['s2y']=d0['s2y']+y2; d['s3y']=d0['s3y']+y3
        d['s1r']=d0['s1r']+r1; d['s2r']=d0['s2r']+r2; d['s3r']=d0['s3r']+r3
        d['s1p']=d0['s1p']+lean*0.4; d['s2p']=d0['s2p']+lean*0.35+0.8*C(2*(p-0.16)); d['s3p']=d0['s3p']+lean*0.25
        # head keeps the eyes level and forward (stabilisation), plus an optional slow scan over the loop
        yawsum=d['pyw']-d0['pyw']+y1+y2+y3; rollsum=d['pr']-d0['pr']+r1+r2+r3
        look=scan*Sn(f/N)
        d['ny']=d0['ny']-0.45*yawsum+0.4*look; d['hy']=d0['hy']-0.4*yawsum+0.6*look
        d['nr']=d0['nr']-0.4*rollsum; d['hr']=d0['hr']-0.45*rollsum
        d['hp']=d0['hp']-lean*0.5-0.9*C(2*(p-0.2))
        # weapon trails the chest: figure-eight bob and sway
        d['gdz']=gun*0.010*C(2*(p-0.14)); d['gdx']=gun*0.012*Sn(p-0.16); d['gdy']=gun*0.006*C(2*(p-0.2))
        d['gdyaw']=gun*2.2*Sn(p-0.14); d['gdr']=gun*1.8*Sn(p-0.18); d['gdp']=gun*1.2*C(2*(p-0.18))
        d['capeP']=cape+4*C(2*(p-0.3)); d['capeS']=5*Sn(p-0.3)
        apply(d,feet,balls); return feet
    need=[]
    for f in range(N):
        feet=frame(f,0.0); bpy.context.view_layer.update(); dr=0
        for sd in 'lr':
            hip=P[f'thigh_{sd}'].head; A=feet[sd].translation; hz=(V((A.x-hip.x,A.y-hip.y,0))).length
            maxv=math.sqrt(max(0.0,(0.985*LEG[sd])**2-hz*hz)); dr=max(dr,(hip.z-A.z)-maxv)
        need.append(max(0.0,dr))
    drop=max(need)+0.004   # one constant soft-knee height: the designed bob is the only vertical motion
    for f in range(N+1):
        frame(f,drop); key(f)
    print(name,'soft-knee pelvis drop cm',round(drop*100,1))
    finish(name,N,True,v,notes)
# ---------------- human run (reference-based) ----------------
def runcycle(name,T,v,s,stanceName,stanceKw=None,bias=0.1,heel=0.30,bob=0.035,lean=8.0,strike='mid',yawamp=8.0,listamp=4.0,gun=1.0,cape=8.0,notes=''):
    """Running from gait reference: flight phase; pelvis lowest at mid-stance (compression), highest mid-flight;
    landing under the body (midfoot for a jog, forefoot for a sprint); heel recovery (heel kicks up behind),
    knee drive, then the foot paws back before contact. Chest counter-rotates; head, rifle and cape trail."""
    new(name,direction=(0,-1))
    N=round(T*FPS); L=v*T*s
    d0=stance(stanceName,**(stanceKw or {}))
    LEG={sd:(P[f'thigh_{sd}'].bone.length+P[f'calf_{sd}'].bone.length) for sd in 'lr'}
    C=lambda ph: math.cos(2*math.pi*ph); Sn=lambda ph: math.sin(2*math.pi*ph)
    fwdbias=-bias*L       # contact a little ahead of the hip, toe-off further behind
    def foot(side,q):
        sg=1 if side=='l' else -1
        if q<s:
            u=q/s; off=L*(0.5-u)+fwdbias+L*0.5*0.0; lz=0.0; ball=0.0
            if strike=='fore':
                if u<0.25: e=ss(u/0.25); pitch=14*(1-e); piv='ball'; ball=-pitch*0.8
                else: pitch=0.0; piv='ankle'
            else:
                pitch=0.0; piv='ankle'
            if u>0.45: k=(u-0.45)/0.55; pitch=40*k**1.5; piv='ball'; ball=-pitch*0.9
        else:
            w=(q-s)/(1-s)
            # first the foot keeps travelling back and up (heel recovery), then the knee drives it forward,
            # it reaches slightly past the landing point and paws back into contact
            back=0.10*L*math.sin(math.pi*min(1.0,w/0.35))
            prog=ss(max(0.0,(w-0.12)/0.78))*1.04-0.04*ss((w-0.9)/0.1)
            off=-L/2+fwdbias-back+L*prog
            lz=heel*(math.sin(math.pi*w**0.75))**1.1+0.012*math.sin(math.pi*w)
            land=14 if strike=='fore' else 0
            pitch=40*(1-ss(w/0.35))+30*math.sin(math.pi*min(1.0,w/0.6))*(1-ss(w/0.6))+land*ss((w-0.6)/0.4)
            ball=-max(0.0,pitch)*0.3*(1-ss(w/0.5))
            return foot_mat_blend(side,(0.0,-off,lz),pitch,sg*5,'ball','ball' if strike=='fore' else 'ankle',ss(w)),ball
        return foot_mat(side,(0.0,-off,lz),pitch=pitch,yaw=sg*5,pivot=piv),ball
    def frame(f,drop):
        p=f/N; feet={}; balls={}
        for side,ph in (('l',0.0),('r',0.5)):
            feet[side],balls[side]=foot(side,(p+ph)%1.0)
        d=dict(d0)
        d['pz']=d0['pz']-bob*math.cos(4*math.pi*(p-s/2))-drop        # lowest at mid-stance, highest in flight
        d['py']=d0['py']-0.012*Sn(2*(p-s/2))                           # brake at contact, drive at toe-off
        d['px']=d0['px']+0.016*Sn(p-s/2)
        d['pr']=d0['pr']-listamp*Sn(p-s/2)
        d['pyw']=d0['pyw']-yawamp*C(p)
        d['pp']=d0['pp']+lean*0.3+1.5*C(2*(p-s/2))
        y1=yawamp*0.45*C(p-0.03); y2=yawamp*0.55*C(p-0.06); y3=yawamp*0.35*C(p-0.09)
        r1=listamp*0.5*Sn(p-s/2-0.06); r2=listamp*0.25*Sn(p-s/2-0.1)
        d['s1y']=d0['s1y']+y1; d['s2y']=d0['s2y']+y2; d['s3y']=d0['s3y']+y3
        d['s1r']=d0['s1r']+r1; d['s2r']=d0['s2r']+r2
        d['s1p']=d0['s1p']+lean*0.35; d['s2p']=d0['s2p']+lean*0.3+1.5*C(2*(p-s/2-0.08)); d['s3p']=d0['s3p']+lean*0.2
        yawsum=d['pyw']-d0['pyw']+y1+y2+y3; rollsum=d['pr']-d0['pr']+r1+r2
        d['ny']=d0['ny']-0.5*yawsum; d['hy']=d0['hy']-0.45*yawsum; d['nr']=d0['nr']-0.4*rollsum; d['hr']=d0['hr']-0.45*rollsum
        d['hp']=d0['hp']-lean*0.6-2.0*C(2*(p-s/2-0.12))
        d['gdz']=gun*0.020*C(2*(p-s/2-0.1)); d['gdx']=gun*0.018*Sn(p-0.14); d['gdy']=gun*0.010*C(2*(p-0.16))
        d['gdyaw']=gun*4.0*Sn(p-0.12); d['gdr']=gun*3.0*Sn(p-0.16); d['gdp']=gun*3.0*C(2*(p-s/2-0.14))
        d['capeP']=cape+6*C(2*(p-0.3)); d['capeS']=7*Sn(p-0.3)
        apply(d,feet,balls); return feet
    need=[]
    for f in range(N):
        feet=frame(f,0.0); bpy.context.view_layer.update(); dr=0
        for sd in 'lr':
            hip=P[f'thigh_{sd}'].head; A=feet[sd].translation; hz=(V((A.x-hip.x,A.y-hip.y,0))).length
            maxv=math.sqrt(max(0.0,(0.985*LEG[sd])**2-hz*hz)); dr=max(dr,(hip.z-A.z)-maxv)
        need.append(max(0.0,dr))
    drop=max(need)+0.004
    for f in range(N+1):
        frame(f,drop); key(f)
    print(name,'run pelvis drop cm',round(drop*100,1),'worst frame',need.index(max(need)),'of',N,[round(x*100) for x in need])
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
# ---------------- deaths (Call of Duty style): limp limbs, dropped blaster, gravity, grounded landing ----------------
GROUND_PTS=[('head','mid',0.13),('spine_03','mid',0.16),('spine_02','mid',0.15),('pelvis','head',0.13),('neck_01','tail',0.09),
            ('upperarm_l','tail',0.06),('upperarm_r','tail',0.06),('lowerarm_l','tail',0.05),('lowerarm_r','tail',0.05),
            ('hand_l','tail',0.035),('hand_r','tail',0.035),('thigh_l','mid',0.085),('thigh_r','mid',0.085),
            ('calf_l','head',0.07),('calf_r','head',0.07),('calf_l','tail',0.06),('calf_r','tail',0.06),('ball_l','tail',0.03),('ball_r','tail',0.03)]
def body_min_z(pts=None):
    bpy.context.view_layer.update(); m=1e9
    for b,where,r in (pts or GROUND_PTS):
        pb=P[b]; pt=pb.head if where=='head' else pb.tail if where=='tail' else (pb.head+pb.tail)/2
        m=min(m,pt.z-r)
    return m
GUN_PTS=[V((0,0,0)),V((0,0.45,0.08)),V((0,-0.16,0.05)),V((0,0.1,0.14)),V((0,0,-0.07))]   # weapon_r local (Y barrel, Z up)
def damp(t,t0,amp,freq=4.0,tau=0.12):
    if t<t0: return 0.0
    x=t-t0; return amp*math.exp(-x/tau)*math.sin(2*math.pi*freq*x)
def ein(x): x=max(0.0,min(1.0,x)); return x*x          # gravity-like ease-in (accelerating fall)
def eout(x): x=max(0.0,min(1.0,x)); return 1-(1-x)**2
BACK_GUN=None
def back_gun_matrix():
    """blaster slung diagonally across the back, muzzle up over the left shoulder (follows spine_03)"""
    yb=V((0.45,0.0,0.89)).normalized(); zb=V((0,1,0)); xb=yb.cross(zb).normalized(); zb=xb.cross(yb).normalized()
    m=M((xb,yb,zb)).transposed().to_4x4(); m.translation=V((0.02,0.20,1.18))
    return P['spine_03'].matrix@REST['spine_03'].inverted()@m
def hand_grip_matrix(side,pos,palm_fwd=True,fingers_up=True,extra_pitch=0.0):
    """armature-space hand target for grabbing a rung/ledge: palm forward, fingers up/over"""
    r=REST[f'hand_{side}'].to_3x3()
    yaw=-90 if side=='r' else 90
    m=(M.Rotation(R(extra_pitch),3,'X')@(M.Rotation(R(180),3,'Y') if fingers_up else M.Identity(3))@M.Rotation(R(yaw),3,'Z')@r).to_4x4()
    m.translation=V(pos); return m
def death_clip(name,dur,tl,release,gun_vel,gun_spin,t_contact,notes,start='aim',loop=False,gun_mode='hand',ground_exclude=(),lhand_on=0):
    return fk_clip(name,dur,tl,release,gun_vel,gun_spin,t_contact,notes,loop,gun_mode,ground_exclude,lhand_on)
def fk_clip(name,dur,tl,release,gun_vel,gun_spin,t_contact,notes,loop=False,gun_mode='hand',ground_exclude=(),lhand_on=0):
    """tl(t) -> (d, feet, ik{'armL','armR','legs'}, fk{bone:(pitch,yaw,roll)}). The blaster leaves the hand at
    `release` with velocity gun_vel (m/s, armature space) and spin (deg/s about its own axes) and is simulated
    with gravity, ground bounce and friction. The body never goes below the ground; after t_contact it rests on it."""
    new(name,lhand_on=lhand_on); N=round(dur*FPS); dt=1.0/FPS
    gun=None; prevW=None; contact_off=None
    gpts=[g for g in GROUND_PTS if g[0] not in ground_exclude]
    for f in range(N+1):
        t=f/FPS
        d,feet,ik,fk=tl(t)
        apply(d,feet)
        K.limb_ik(ao,'arm','l',ik.get('armL',1)); K.limb_ik(ao,'arm','r',ik.get('armR',1)); 
        K.limb_ik(ao,'leg','l',ik.get('legs',1)); K.limb_ik(ao,'leg','r',ik.get('legs',1))
        for b,(pi,ya,ro) in fk.items(): K.rot(P[b],pi,ya,ro)
        # ground: never penetrate; rest on the floor once the body has landed
        mz=body_min_z(gpts)
        off=0.0
        if mz<0.0: off=-mz
        if t_contact is not None and t>=t_contact:
            # once landed the body rests on its torso, hips and legs; limp arms lie on the floor, they do not prop it up
            core=[g_ for g_ in gpts if not g_[0].startswith(('upperarm','lowerarm','hand'))]
            off=-body_min_z(core)
        if off:
            K.loc_world(P['pelvis'],(d['px'],d['py'],d['pz']+off)); bpy.context.view_layer.update()
        bpy.context.view_layer.update()
        CH=P['spine_03'].matrix@REST['spine_03'].inverted()
        for kk in ('handL','handR','prop'):
            if d.get(kk+'_rel') is not None: d[kk]=CH@d[kk+'_rel']
        # free hands (rungs, ledges, clutching a wound): armature-space targets
        for sd in 'lr':
            hm=d.get('hand'+sd.upper())
            if hm is not None:
                bpy.context.view_layer.update(); P[f'ctrl_hand_{sd}'].matrix=hm
            pass
        if d.get('prop') is not None:
            bpy.context.view_layer.update(); P['prop'].matrix=d['prop']
        for sd in 'lr':
            ep=d.get('elbow'+sd.upper())          # elbow pole position (armature space) for poses like clutching a wound
            if ep is not None:
                bpy.context.view_layer.update(); m=P[f'ctrl_elbow_{sd}'].matrix.copy(); m.translation=ep; P[f'ctrl_elbow_{sd}'].matrix=m
        bpy.context.view_layer.update()
        if gun_mode=='back':
            P['weapon_r'].matrix=back_gun_matrix(); key(f); continue
        # blaster: carried until release, then a rigid body
        Wcur=P['weapon_r'].matrix.copy()
        if t<release:
            prevW=Wcur
        else:
            if gun is None:
                vel=(Wcur.translation-prevW.translation)/dt+V(gun_vel)
                gun=dict(pos=Wcur.translation.copy(),rot=Wcur.to_quaternion(),vel=vel,spin=V(gun_spin),rest=False)
            else:
                g=gun
                if not g['rest']:
                    g['vel'].z-=9.81*dt; g['pos']+=g['vel']*dt
                    q=g['rot']; w=g['spin']*dt
                    g['rot']=(q@E((R(w.x),R(w.y),R(w.z))).to_quaternion()).normalized()
                    m=M.Translation(g['pos'])@g['rot'].to_matrix().to_4x4()
                    low=min((m@p).z for p in GUN_PTS)
                    if low<0.012:
                        g['pos'].z+=0.012-low
                        if abs(g['vel'].z)>0.6: g['vel'].z=-g['vel'].z*0.28; g['vel'].x*=0.55; g['vel'].y*=0.55; g['spin']*=0.4
                        else: g['rest']=True
                if g['rest']:
                    # settle onto its side: gun X (lateral) vertical, keep its heading
                    fwd=g['rot']@V((0,1,0)); fwd.z=0
                    if fwd.length<1e-3: fwd=V((0,1,0))
                    fwd.normalize(); up=V((0,0,1)); xax=up; yax=fwd; zax=xax.cross(yax)
                    target=M((xax,yax,zax)).transposed().to_quaternion()
                    g['rot']=g['rot'].slerp(target,0.35)
                    g['vel']*=0.5; g['pos']+=V((g['vel'].x,g['vel'].y,0))*dt
                    m=M.Translation(g['pos'])@g['rot'].to_matrix().to_4x4()
                    low=min((m@p).z for p in GUN_PTS); g['pos'].z+=0.012-low
            P['weapon_r'].matrix=M.Translation(gun['pos'])@gun['rot'].to_matrix().to_4x4()
        key(f)
    finish(name,N,loop,0,notes)

def mixd(a,b,u):
    out={}
    for k in set(a)|set(b):
        va=a.get(k,b.get(k)); vb=b.get(k,a.get(k))
        out[k]=lerp(va,vb,u) if isinstance(va,(int,float)) and isinstance(vb,(int,float)) else (mix(va,vb,u) if isinstance(va,tuple) else (va if u<0.5 else vb))
    return out
def segs(t,keys):
    """keys: [(t, dict, ease)] ; ease of the segment ending at that key: 's' smooth, 'i' gravity ease-in, 'o' ease-out"""
    if t<=keys[0][0]: return dict(keys[0][1])
    for (t0,a,_),(t1,b,e) in zip(keys,keys[1:]):
        if t<=t1:
            x=(t-t0)/(t1-t0) if t1>t0 else 1.0
            u={'s':ss,'i':ein,'o':eout}[e](x)
            return mixd(a,b,u)
    return dict(keys[-1][1])
LIMBS0=dict(ulp=0,ulr=0,urp=0,urr=0,llp=0,lrp=0,tlp=0,tlr=0,trp=0,trr=0,clp=0,crp=0)
def fk_of(x):
    return {'upperarm_l':(x['ulp'],0,x['ulr']),'upperarm_r':(x['urp'],0,x['urr']),'lowerarm_l':(x['llp'],0,0),'lowerarm_r':(x['lrp'],0,0),
            'thigh_l':(x['tlp'],0,x['tlr']),'thigh_r':(x['trp'],0,x['trr']),'calf_l':(x['clp'],0,0),'calf_r':(x['crp'],0,0)}
AIMFEET={'l':foot_mat('l',(0.02,-0.12,0),yaw=8),'r':foot_mat('r',(-0.04,0.12,0),yaw=-25)}

# 1) chest hit: jolt back, stagger a step, knees give, drop to the knees, pitch forward onto the face
def die_front():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,K0,'s'),
          (0.07,dict(K0,s2p=-14,s3p=-10,hp=-14,pp=-6,py=0.04,pz=-0.04,gdp=22,gdz=0.04,curlL=0.4,armL=0.6),'o'),
          (0.30,dict(K0,s2p=-8,s3p=-6,hp=-6,pp=-3,py=0.08,pz=-0.12,pyw=18,gdp=-10,gdz=-0.08,armL=0,ulp=-5,ulr=-12,llp=-30),'s'),
          (0.62,dict(K0,s2p=14,s3p=10,hp=26,np_=10,pp=16,py=0.02,pz=-0.50,pyw=22,armL=0,armR=0.2,ulp=-12,ulr=-6,llp=-25,urp=-15,urr=8,lrp=-35,legs=1),'i'),
          (0.80,dict(K0,s2p=18,s3p=12,hp=30,np_=12,pp=28,py=-0.02,pz=-0.62,pyw=22,armL=0,armR=0,ulp=-30,ulr=-8,llp=-30,urp=-30,urr=10,lrp=-30,legs=0.6,
                      tlp=-70,trp=-65,clp=110,crp=105),'s'),
          (1.12,dict(K0,s2p=6,s3p=4,hp=-10,np_=-5,hy=0,pp=88,py=-0.55,pz=-0.70,pyw=26,armL=0,armR=0,ulp=-150,ulr=-35,llp=-50,urp=-40,urr=30,lrp=-25,legs=0,
                      tlp=-6,trp=-4,tlr=-6,trr=8,clp=25,crp=10),'i'),
          (1.35,dict(K0,s2p=2,s3p=2,hp=-14,np_=-6,hy=55,hr=18,pp=90,py=-0.58,pz=-0.70,pyw=26,armL=0,armR=0,ulp=-160,ulr=-40,llp=-60,urp=12,urr=35,lrp=-15,legs=0,
                      tlp=-2,trp=-1,tlr=-8,trr=10,clp=3,crp=2),'o'),
          (1.9,dict(K0,s2p=2,s3p=2,hp=-14,np_=-6,hy=58,hr=20,pp=90,py=-0.58,pz=-0.70,pyw=26,armL=0,armR=0,ulp=-160,ulr=-40,llp=-62,urp=12,urr=35,lrp=-14,legs=0,
                      tlp=-2,trp=-1,tlr=-8,trr=10,clp=3,crp=2,curlR=0.4,curlL=0.4),'s')]
    def tl(t):
        x=segs(t,keys)
        # secondary motion after the faceplant (t=1.12): head and limbs bounce, settle
        b=damp(t,1.12,1.0,3.5,0.11)
        x['hp']+=6*b; x['pz']+=0.0; x['ulp']+=10*b; x['urp']+=8*b; x['clp']+=12*b; x['crp']+=10*b; x['s2p']+=3*b
        x['capeP']=10*ss((t-0.6)/0.6)-15*ss((t-0.95)/0.3)
        # one stagger step back with the right foot
        st=ss((t-0.1)/0.22)
        feet={'l':AIMFEET['l'],'r':foot_mat('r',(-0.04,0.12+0.16*st,0.07*math.sin(math.pi*min(1,max(0,(t-0.1)/0.22)))),yaw=-25)}
        fk=fk_of(x); return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk
    death_clip('die',1.9,tl,release=0.50,gun_vel=(0.3,-0.6,0.8),gun_spin=(-200,40,250),t_contact=1.12,
               notes='Chest hit: jolts back, staggers a step, knees give, drops to the knees, falls on his face. Blaster flies from his hands.')

# 2) blown back: violent jolt, two stumbling steps back, falls onto his back, legs bounce
def die_back():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,K0,'s'),
          (0.06,dict(K0,s2p=-24,s3p=-16,hp=-24,np_=-8,pp=-14,py=0.10,pz=-0.02,gdp=35,gdz=0.06,armL=0.2,armR=0.5),'o'),
          (0.20,dict(K0,s2p=-20,s3p=-12,hp=-18,pp=-16,py=0.30,pz=-0.06,armL=0,armR=0,ulp=-50,ulr=-45,llp=-25,urp=-45,urr=40,lrp=-30),'s'),
          (0.40,dict(K0,s2p=-16,s3p=-10,hp=-10,pp=-24,py=0.50,pz=-0.18,armL=0,armR=0,ulp=-60,ulr=-60,llp=-20,urp=-55,urr=55,lrp=-25,legs=0.5,
                      tlp=-25,trp=-10,clp=30,crp=15),'s'),
          (0.74,dict(K0,s2p=-8,s3p=-4,hp=-25,np_=-8,pp=-86,py=0.75,pz=-0.72,armL=0,armR=0,ulp=-80,ulr=-65,llp=-25,urp=-70,urr=70,lrp=-30,legs=0,
                      tlp=-35,trp=-20,clp=40,crp=25),'i'),
          (1.0,dict(K0,s2p=-4,s3p=-2,hp=-4,np_=0,hy=-35,hr=-10,pp=-90,py=0.78,pz=-0.72,armL=0,armR=0,ulp=-100,ulr=-75,llp=-35,urp=-80,urr=80,lrp=-40,legs=0,
                      tlp=-12,trp=-6,tlr=-8,trr=6,clp=18,crp=10),'o'),
          (1.6,dict(K0,s2p=-4,s3p=-2,hp=-4,np_=0,hy=-40,hr=-12,pp=-90,py=0.78,pz=-0.72,armL=0,armR=0,ulp=-100,ulr=-78,llp=-38,urp=-78,urr=82,lrp=-42,legs=0,
                      tlp=-10,trp=-5,tlr=-9,trr=7,clp=16,crp=9,curlR=0.4,curlL=0.4),'s')]
    def tl(t):
        x=segs(t,keys)
        b=damp(t,0.74,1.0,3.0,0.13)
        x['tlp']-=18*b; x['trp']-=14*b; x['hp']-=10*b; x['ulp']-=8*b; x['urp']-=8*b; x['s2p']-=3*b
        x['capeP']=-12*ss((t-0.1)/0.3)+20*ss((t-0.6)/0.3)
        s1=ss((t-0.06)/0.16); s2=ss((t-0.18)/0.18)
        feet={'l':foot_mat('l',(0.02,-0.12+0.30*s1,0.08*math.sin(math.pi*min(1,max(0,(t-0.06)/0.16)))),yaw=8),
              'r':foot_mat('r',(-0.04,0.12+0.34*s2,0.08*math.sin(math.pi*min(1,max(0,(t-0.18)/0.18)))),yaw=-25)}
        return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    death_clip('die_back',1.6,tl,release=0.10,gun_vel=(-0.8,0.4,1.6),gun_spin=(380,-60,140),t_contact=0.74,
               notes='Blown backward: violent jolt, two stumbling steps back, lands on his back, legs bounce. Blaster flung away.')

# 3) headshot: lights out, straight-down crumple, slumps onto his side
def die_headshot():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,K0,'s'),
          (0.05,dict(K0,hp=-28,np_=-10,s3p=-6,gdp=10,armL=0.4,armR=0.5),'o'),
          (0.16,dict(K0,hp=-10,np_=-4,s2p=4,s3p=4,pz=-0.10,armL=0,armR=0,ulp=-10,llp=-20,urp=-10,lrp=-25),'s'),
          (0.48,dict(K0,hp=35,np_=15,s1p=8,s2p=14,s3p=10,pp=12,pz=-0.60,pr=-6,armL=0,armR=0,ulp=5,llp=-10,urp=5,lrp=-10,legs=0.7,
                      tlp=-80,trp=-75,clp=120,crp=115),'i'),
          (0.82,dict(K0,hp=20,np_=10,hr=-25,s1p=6,s2p=9,s3p=6,pp=10,pz=-0.70,pr=-88,px=-0.30,armL=0,armR=0,ulp=-30,ulr=25,llp=-40,urp=-60,urr=-20,lrp=-50,legs=0,
                      tlp=-30,trp=-18,clp=45,crp=35),'i'),
          (1.3,dict(K0,hp=18,np_=8,hr=-28,s1p=6,s2p=8,s3p=6,pp=10,pz=-0.70,pr=-90,px=-0.32,armL=0,armR=0,ulp=-35,ulr=28,llp=-45,urp=-62,urr=-22,lrp=-55,legs=0,
                      tlp=-28,trp=-16,clp=46,crp=36,curlR=0.4,curlL=0.4),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,0.82,1.0,3.5,0.1)
        x['hr']+=8*b; x['ulp']+=10*b; x['urp']+=10*b; x['clp']+=8*b
        x['capeP']=6*ss((t-0.2)/0.4); x['capeR']=18*ss((t-0.55)/0.4)
        return x,AIMFEET,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    death_clip('die_headshot',1.3,tl,release=0.12,gun_vel=(0.0,-0.2,0.2),gun_spin=(90,0,200),t_contact=0.82,
               notes='Headshot: instant limp collapse straight down, slumps onto his side. Blaster drops from his hands.')

# 4) shot while running: momentum carries him forward into a sliding faceplant
def die_run():
    st=stance('port'); K0=dict(st,**LIMBS0,armL=1,armR=1,legs=1,s1p=st['s1p']+5,s2p=st['s2p']+4,hp=st['hp']-6)
    # forward travel: running speed 4.2 m/s decaying to zero (body slides on landing)
    def travel(t): v0=4.2; k=3.2; return -(v0/k)*(1-math.exp(-k*t))
    keys=[(0.00,dict(K0,pz=-0.06),'s'),
          (0.08,dict(K0,pz=-0.08,s2p=-6,hp=-12,gdp=10,armL=0.4,armR=0.6),'o'),
          (0.30,dict(K0,pz=-0.22,pp=30,s2p=10,s3p=8,hp=10,armL=0,armR=0,ulp=-60,ulr=-15,llp=-20,urp=-55,urr=15,lrp=-25,legs=0.4,tlp=-30,trp=15,clp=40,crp=60),'s'),
          (0.58,dict(K0,pz=-0.72,pp=88,s2p=4,s3p=2,hp=-12,armL=0,armR=0,ulp=-140,ulr=-25,llp=-35,urp=-120,urr=25,lrp=-40,legs=0,tlp=-6,trp=4,clp=30,crp=15),'i'),
          (0.95,dict(K0,pz=-0.72,pp=90,s2p=2,s3p=2,hp=-14,hy=-50,hr=-15,armL=0,armR=0,ulp=-155,ulr=-30,llp=-50,urp=12,urr=25,lrp=-20,legs=0,tlp=-2,trp=-1,tlr=-6,trr=6,clp=3,crp=2),'o'),
          (1.4,dict(K0,pz=-0.72,pp=90,s2p=2,s3p=2,hp=-14,hy=-55,hr=-16,armL=0,armR=0,ulp=-158,ulr=-32,llp=-52,urp=12,urr=26,lrp=-18,legs=0,tlp=-2,trp=-1,tlr=-6,trr=6,clp=3,crp=2,curlR=0.4,curlL=0.4),'s')]
    def tl(t):
        x=segs(t,keys); x['py']=travel(t)
        b=damp(t,0.58,1.0,3.5,0.11); x['ulp']+=10*b; x['urp']+=10*b; x['hp']+=6*b; x['clp']+=15*b; x['crp']+=10*b
        x['capeP']=-14*ss(t/0.3)+10*ss((t-0.5)/0.3)
        u=ss(t/0.3)
        feet={'l':foot_mat('l',(0,-0.10+travel(t)*0.5*u,0.10*u),pitch=30*u),'r':foot_mat('r',(0,0.25+travel(t)*0.5*u,0.18*u),pitch=40*u)}
        return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    death_clip('die_run',1.4,tl,release=0.14,gun_vel=(0.2,-3.2,1.2),gun_spin=(-420,30,120),t_contact=0.58,
               notes='Shot while running: momentum throws him forward into a sliding faceplant (travels ~1.3 m). Blaster flies ahead.')

# ---- blaster death, Battlefront / Call of Duty style: hit, slow sag to the knees, sway, topple (physics takes over mid-topple) ----
def die_knees():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    KN={'l':foot_mat('l',(0.03,-0.04,0),yaw=8),'r':foot_mat('r',(-0.05,0.10,0.0),yaw=-18)}
    keys=[(0.00,K0,'s'),
          (0.08,dict(K0,s2p=-12,s3p=-9,hp=-12,pp=-5,py=0.03,gdp=18,gdz=0.03,curlL=0.4),'o'),            # bolt hits the chest
          (0.40,dict(K0,s2p=6,s3p=4,hp=8,pp=4,py=0.03,pz=-0.08,gdp=-25,gdz=-0.06,gdx=-0.06,armL=0,ulp=-5,ulr=-10,llp=-35),'s'),   # left hand drops off the gun
          (1.10,dict(K0,s2p=14,s3p=10,hp=22,np_=8,pp=8,py=0.06,pz=-0.56,gdp=-40,gdz=-0.12,gdx=-0.12,gdyaw=-20,armL=0,ulp=-2,ulr=-8,llp=-25),'s'),  # slow sag onto the knees
          (1.45,dict(K0,s2p=18,s3p=12,hp=28,np_=10,pp=12,pr=4,py=0.06,pz=-0.58,gdp=-40,gdz=-0.12,gdx=-0.13,gdyaw=-22,armL=0,ulp=0,ulr=-6,llp=-20),'s'),  # kneeling, swaying
          (1.75,dict(K0,s2p=22,s3p=14,hp=30,np_=12,pp=26,pr=8,py=0.02,pz=-0.60,gdp=-40,gdz=-0.12,gdx=-0.13,gdyaw=-22,armL=0,ulp=-10,ulr=-6,llp=-20),'i'),  # tipping forward
          (2.00,dict(K0,s2p=30,s3p=18,hp=34,np_=14,pp=50,pr=24,px=0.06,py=-0.20,pz=-0.66,gdp=-40,gdz=-0.12,gdx=-0.13,gdyaw=-22,armL=0,ulp=-14,ulr=-6,llp=-20),'i')]  # past the tipping point
    def tl(t):
        x=segs(t,keys)
        k=ss((t-0.35)/0.75)
        tip=ss((t-1.70)/0.30)
        feet={'l':foot_mat('l',(0.03,-0.04*k-0.12*(1-k)+0.14*tip,0),yaw=8),'r':foot_mat('r',(-0.05,0.12*(1-k)+0.10*k+0.10*tip,0.0),pitch=55*k,pivot='ball',yaw=-18)}
        return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=1),fk_of(x)
    death_clip('die',2.0,tl,release=1.30,gun_vel=(0.1,-0.3,0.0),gun_spin=(60,0,90),t_contact=None,
               notes='Blaster bolt: hit, slow sag to the knees, sway, topple forward; physics ragdoll from the topple (muscle tone fades), flat and limp on the ground.')
# ---- headshot: limp while still standing; physics takes over at once and he falls nearly straight, flat ----
def die_headshot_fb(name,back):
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    jolt=dict(K0,hp=(-30 if back else 24),np_=(-12 if back else 12),s3p=(-6 if back else 10),s2p=(0 if back else 6),pp=(-5 if back else 8),py=(0.04 if back else -0.05),armL=0.3,armR=0.4)
    keys=[(0.00,K0,'s'),(0.06,jolt,'o')]
    def tl(t):
        x=segs(t,keys); return x,AIMFEET,dict(armL=x['armL'],armR=x['armR'],legs=1),fk_of(x)
    death_clip(name,0.4,tl,release=0.07,gun_vel=(0,0.2 if back else -0.2,0.1),gun_spin=(90,0,160),t_contact=None,
               notes='Headshot: goes limp while standing and falls '+('backward' if back else 'forward')+' nearly straight, flat on the ground (physics ragdoll).')
# ---- shot in the foot: stumble, then a limping walk ----
def hit_foot():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.0,K0,'s'),(0.10,dict(K0,s2p=10,s3p=6,hp=12,pz=-0.06,pr=-6,gdp=-15),'o'),(0.45,dict(K0,s2p=6,hp=6,pz=-0.04,pr=-4),'s'),(0.9,dict(K0,s2p=3,pr=-2),'s')]
    def tl(t):
        x=segs(t,keys); u=math.sin(math.pi*min(1,max(0,(t-0.05)/0.5)))
        feet={'l':AIMFEET['l'],'r':foot_mat('r',(-0.04,0.12-0.04*u,0.10*u),pitch=-20*u,yaw=-25)}   # right foot jerks up off the ground
        return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('hit_foot',0.9,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes='Shot in the right foot: the foot jerks up, he hops and staggers.')
die_knees(); die_headshot_fb('die_headshot',False); die_headshot_fb('die_headshot_back',True); hit_foot()
die_back(); die_run()

# jump (in place: capsule moves in Unreal)
hold('jump',0.9,[(0,ready),(0.12,dict(ready,pz=-0.09,s2p=10,s3p=6)),(0.22,dict(ready,pz=0.0,s2p=-2)),(0.55,dict(ready,pz=0.0,s2p=4,capeP=-12)),(0.7,dict(ready,pz=-0.11,s2p=12,s3p=8)),(0.9,ready)],loop=False,
     feetfn=lambda t:{s:foot_mat(s,(0,0,0.16*ss((t-0.2)/0.12)*(1-ss((t-0.5)/0.15))),pitch=25*ss((t-0.15)/0.1)*(1-ss((t-0.45)/0.15))) for s in 'lr'},notes='Jump: crouch, push, tuck, land.')
# crouch aim + crouch walk
FE_CR={'l':foot_mat('l',(0.04,-0.22,0),yaw=10),'r':foot_mat('r',(-0.06,0.24,0.0),pitch=35,pivot='ball',yaw=-20)}
cra=stance('aim',pz=-0.40,pp=12,s1p=8,s2p=6,s3p=-2,hp=2)
hold('crouch_aim',3.0,breathe(cra,3.0,0.5),feetfn=lambda t:FE_CR,notes='Crouched aim (cover). Loop.')
hold('crouch_shoot',0.3,recoil_keys(cra,1,0.3),loop=True,feetfn=lambda t:FE_CR,notes='Crouched bolt.')
walkcycle('crouch_walk',1.1,1.0,(0,-1),'aim',dict(pp=14,s1p=8,s2p=6,s3p=-2,hp=2,idxR=0.35),s=0.64,lift=0.08,bob=0.010,crouch=0.30,lean=0,gun=0.45,cape=6,notes='Crouched advance, rifle up. 1.0 m/s.')
# walking
walkcycle('walk',1.04,1.3,(0,-1),'patrol',s=0.60,lift=0.10,bob=0.014,cycles=2,lean=2.5,scan=8,gun=0.8,notes='Patrol walk: relaxed low ready, full heel-to-toe roll with toe bend and ankle push-off, slow scan. 1.3 m/s.')
walkcycle('walk_limp',1.25,0.9,(0,-1),'patrol',s=0.62,lift=0.07,bob=0.012,cycles=1,lean=4,gun=0.6,injured='r',notes='Injured (shot in the right foot): limping walk, weight kept off the right leg. 0.9 m/s.')
walkcycle('aim_walk_fwd',0.96,1.3,(0,-1),'aim',s=0.62,lift=0.09,bob=0.012,lean=2,gun=0.45,cape=3,notes='Tactical walk forward while aiming (soft knees, stable rifle). 1.3 m/s.')
walkcycle('aim_walk_bwd',1.0,1.1,(0,1),'aim',s=0.62,lift=0.08,bob=0.011,roll='bwd',lean=2,gun=0.45,notes='Backpedal while aiming (toe-first contact). 1.1 m/s.')
walkcycle('aim_strafe_l',0.86,1.2,(1,0),'aim',s=0.45,lift=0.08,bob=0.010,roll='side',lean=2,gun=0.45,width=0.09,notes='Strafe left while aiming. 1.2 m/s.')
walkcycle('aim_strafe_r',0.86,1.2,(-1,0),'aim',s=0.45,lift=0.08,bob=0.010,roll='side',lean=2,gun=0.45,width=0.09,notes='Strafe right while aiming. 1.2 m/s.')
runcycle('run',0.70,4.2,0.30,'port',dict(curlR=0.9),bias=0.12,heel=0.30,bob=0.035,lean=10,strike='mid',yawamp=8,listamp=4,gun=1.0,cape=9,notes='Combat jog, rifle at port: midfoot landing, heel recovery, flight phase. 4.2 m/s.')
runcycle('sprint',0.62,6.2,0.24,'sprint',{},bias=0.06,heel=0.44,bob=0.04,lean=18,strike='fore',yawamp=10,listamp=5,gun=1.2,cape=12,notes='Sprint, rifle across chest: forefoot landing, high heel recovery and knee drive. 6.2 m/s.')
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
# ================= combat roll, kneeling fire, climbing, lightsaber, explosions =================
CUTS=[]     # dismemberment endings for cuts.py: which clip, when, where, which piece, how it moves
LEGS_L=('thigh_l','calf_l','ball_l'); LEGS_R=('thigh_r','calf_r','ball_r')
ARM_L=('upperarm_l','lowerarm_l','hand_l'); ARM_R=('upperarm_r','lowerarm_r','hand_r')
def kneel_feet():
    return {'l':foot_mat('l',(0.03,-0.30,0),yaw=10),'r':foot_mat('r',(-0.05,0.34,0.0),pitch=62,pivot='ball',yaw=-14)}
KNEEL=dict(aim,**LIMBS0,armL=1,armR=1,legs=1,pz=-0.50,pp=8,s1p=4,s2p=4,s3p=0)
def shots(t,times,base):
    x=dict(base)
    for t0 in times:
        if t0<=t<t0+0.3:
            k=(t-t0); a=math.exp(-k/0.06)*min(1.0,k/0.015)
            x['gdy']=x.get('gdy',0)+0.035*a; x['gdz']=x.get('gdz',0)+0.012*a; x['gdp']=x.get('gdp',0)+7*a
            x['s3p']=x.get('s3p',0)-2.5*a; x['hp']=x.get('hp',0)-1.5*a; x['idxR']=0.65 if k<0.12 else 0.45
    return x
# --- roll forward into a kneeling aim, then fire (root motion: travels ~2.3 m) ---
def roll_to_kneel():
    st=stance('port'); K0=dict(st,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,dict(K0,pz=-0.08,s1p=8,s2p=6,hp=-4),'s'),
          (0.22,dict(K0,pz=-0.28,pp=24,s1p=12,s2p=14,hp=8),'s'),
          (0.38,dict(K0,pz=-0.42,pp=95,s2p=18,s3p=10,hp=30,np_=10,legs=0.3,tlp=-60,trp=-40,clp=80,crp=60),'s'),
          (0.56,dict(K0,pz=-0.55,pp=185,s2p=24,s3p=14,hp=38,np_=14,legs=0,tlp=-95,trp=-90,clp=135,crp=130),'s'),
          (0.76,dict(K0,pz=-0.55,pp=280,s2p=22,s3p=12,hp=30,np_=12,legs=0,tlp=-98,trp=-95,clp=140,crp=138),'s'),
          (0.96,dict(K0,pz=-0.52,pp=345,s2p=12,s3p=6,hp=14,legs=0,tlp=-100,trp=-60,clp=130,crp=100),'s'),
          (1.18,dict(KNEEL,pp=368,gpos=GUN['port']['gpos'],gyaw=GUN['port']['gyaw'],gpitch=GUN['port']['gpitch'],groll=GUN['port']['groll'],legs=1),'s'),
          (1.38,dict(KNEEL,pp=368),'s'),(2.6,dict(KNEEL,pp=368),'s')]
    def travel(t):
        v0=3.2; t1=0.35; t2=1.15
        if t<t1: return -v0*t
        if t<t2: u=(t-t1)/(t2-t1); return -v0*t1-v0*(t2-t1)*(u-u*u/2)
        return -v0*t1-v0*(t2-t1)*0.5
    def tl(t):
        x=segs(t,keys); x=shots(t,(1.55,1.8,2.05),x); x['rooty']=travel(t)
        u=ss((t-1.0)/0.25)
        run={'l':foot_mat('l',(0,-0.25,0)),'r':foot_mat('r',(0,0.28,0.04),pitch=30,pivot='ball')}
        feet=run if t<0.9 else kneel_feet()
        return x,feet,dict(armL=1,armR=1,legs=x['legs']),fk_of(x)
    fk_clip('roll_to_kneel',2.6,tl,release=99,gun_vel=(0,0,0),gun_spin=(0,0,0),t_contact=0.36,lhand_on=1,
            notes='Combat roll: dives forward, rolls over the shoulder, comes up on one knee aiming down the sights and fires three bolts. Root motion ~2.3 m.')
def kneel_clips():
    def tl_aim(t):
        x=dict(KNEEL); ph=2*math.pi*t/3.0
        x['s2p']+=1.0*math.sin(ph); x['s3p']+=0.8*math.sin(ph); x['gdz']=0.003*math.sin(ph)
        return x,kneel_feet(),dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('kneel_aim',3.0,tl_aim,99,(0,0,0),(0,0,0),0.0,loop=True,lhand_on=1,notes='Kneeling aim down the sights (one knee down). Loop.')
    def tl_shoot(t):
        x=shots(t,(0.0,),dict(KNEEL)); return x,kneel_feet(),dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('kneel_shoot',0.3,tl_shoot,99,(0,0,0),(0,0,0),0.0,loop=True,lhand_on=1,notes='Kneeling bolt with recoil. Loop for sustained fire.')
# --- ladder climb (in place loop, 0.5 m/s up; blaster slung on the back) ---
def climb_ladder():
    T=1.2; v=0.5; ladder_y=-0.33
    K0=dict(stance('ready'),**LIMBS0,armL=1,armR=1,legs=1)
    def limb_z(q,top,drop):
        if q<0.5: return top-drop*(q/0.5), 0.0
        w=(q-0.5)/0.5; return top-drop+drop*ss(w), math.sin(math.pi*w)
    def tl(t):
        p=(t/T)%1.0; x=dict(K0)
        x.update(pz=-0.10+0.015*math.cos(4*math.pi*p),py=-0.07,px=0.015*math.sin(2*math.pi*p),pp=6,s2p=5,s3p=3,hp=-14,np_=-6,
                 pr=2.5*math.sin(2*math.pi*p),s2r=-1.5*math.sin(2*math.pi*(p-0.05)),curlR=1.0,curlL=1.0)
        hands={}
        for sd,ph in (('r',0.0),('l',0.5)):
            z,sw=limb_z((p+ph)%1.0,1.80,v*T*0.5)
            sg=1 if sd=='l' else -1
            hands['hand'+sd.upper()]=hand_grip_matrix(sd,(sg*0.21,ladder_y+0.05+0.06*sw,z),extra_pitch=-15)
        feet={}
        for sd,ph in (('l',0.0),('r',0.5)):
            z,sw=limb_z((p+ph)%1.0,0.46,v*T*0.5)
            sg=1 if sd=='l' else -1
            feet[sd]=foot_mat(sd,(sg*-0.02,ladder_y-0.02+0.10*sw-ANK0[sd].y+0.13,z-0.06),pitch=12-10*sw,pivot='ball')
        x.update(hands); return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('climb_ladder',T,tl,99,(0,0,0),(0,0,0),None,loop=True,gun_mode='back',
            notes='Ladder climb, hand-over-hand with opposite feet, blaster slung on the back. In place loop at 0.5 m/s (move the character up).')
# --- mantle up a 1.1 m ledge, one-handed (blaster stays in the right hand; root motion) ---
def mantle():
    st=stance('ready'); K0=dict(st,**LIMBS0,armL=1,armR=1,legs=1); H=1.10; edge=-0.50
    keys=[(0.00,dict(K0,rootz=0,rooty=0),'s'),
          (0.22,dict(K0,rootz=0,rooty=-0.05,pz=-0.14,pp=10,s2p=8),'s'),
          (0.40,dict(K0,rootz=0.40,rooty=-0.15,pz=-0.10,pp=18,s2p=14,hp=-8,gdz=0.20,gdp=45,gdx=-0.06),'o'),
          (0.66,dict(K0,rootz=0.80,rooty=-0.35,pz=-0.22,pp=30,s2p=20,s3p=8,hp=-4,gdz=0.24,gdp=50,gdx=-0.08),'s'),
          (0.95,dict(K0,rootz=H,rooty=-0.58,pz=-0.38,pp=26,s2p=16,s3p=6,gdz=0.22,gdp=45,gdx=-0.08),'s'),
          (1.30,dict(K0,rootz=H,rooty=-0.74,pz=-0.06,pp=6,s2p=4),'s'),
          (1.70,dict(K0,rootz=H,rooty=-0.82),'s')]
    def tl(t):
        x=segs(t,keys); rz,ry=x['rootz'],x['rooty']
        # left hand: reach and plant on the ledge, push, then back to the blaster
        ledge=hand_grip_matrix('l',(0.32,edge-0.04,H+0.03),fingers_up=False,extra_pitch=-80)
        on=ss((t-0.12)/0.14)*(1-ss((t-1.0)/0.25))
        if on>0.001:
            bpy.context.view_layer.update()
        x['handL_w']=on; x['handL_m']=ledge
        # feet in world: right knee drives onto the ledge, left follows
        # feet in root space: they lift with the body (hanging/tucked) until each steps onto the ledge
        def fl_(sd,u,ledge_y,tuck,pitch):
            loc=V((0,0.0,tuck))                        # follows the body
            onl=V((0,ledge_y-ry,H-rz))                 # world ledge spot, expressed relative to the root
            p=loc.lerp(onl,u); p.z+=0.22*math.sin(math.pi*u)
            return foot_mat(sd,tuple(p),pitch=pitch*math.sin(math.pi*u))
        jump=ss((t-0.25)/0.2)*(1-ss((t-0.9)/0.3))
        uR=ss((t-0.38)/0.35); uL=ss((t-0.78)/0.35)
        fr=fl_('r',uR,edge-0.12,0.10*jump,25); fl=fl_('l',uL,edge-0.28,0.05*jump,25)
        return x,{'l':fl,'r':fr},dict(armL=1,armR=1,legs=1),fk_of(x)
    # wrap: blend the left hand between the gun and the ledge inside fk_clip via handL
    def tl2(t):
        x,feet,ik,fk=tl(t)
        if x['handL_w']>0.001:
            bpy.context.view_layer.update()
            ongun=P['ctrl_hand_l'].matrix.copy(); m=x['handL_m']; k=x['handL_w']
            x['handL']=M.Translation(ongun.translation.lerp(m.translation,k))@ongun.to_quaternion().slerp(m.to_quaternion(),k).to_matrix().to_4x4()
        return x,feet,ik,fk
    fk_clip('mantle',1.7,tl2,99,(0,0,0),(0,0,0),None,lhand_on=0,
            notes='Mantle up a 1.1 m ledge: left hand plants, right knee drives up, stands on top. Blaster stays in the right hand. Root motion (0.82 m forward, 1.1 m up).')
# --- lightsaber hits 1 and 2 (the third hit is one of the endings below) ---
def saber_hits():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    k1=[(0.0,K0,'s'),(0.05,dict(K0,s2y=18,s3y=14,pyw=24,s2p=-10,hp=-12,py=0.05,gdyaw=20,gdp=15,gdz=0.04),'o'),
        (0.35,dict(K0,s2y=6,s3y=4,pyw=14,s2p=-3,py=0.10,gdyaw=8),'s'),(0.8,K0,'s')]
    def tl1(t):
        x=segs(t,k1); st=ss((t-0.06)/0.22)
        feet={'l':AIMFEET['l'],'r':foot_mat('r',(-0.04,0.12+0.14*st,0.06*math.sin(math.pi*min(1,max(0,(t-0.06)/0.22)))),yaw=-25)}
        return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('saber_hit_1',0.8,tl1,99,(0,0,0),(0,0,0),None,lhand_on=1,notes='First lightsaber contact: burned across the chest, twists away and steps back, recovers.')
    k2=[(0.0,K0,'s'),(0.05,dict(K0,s2y=-22,s3y=-16,pyw=-20,s2p=14,s3p=8,hp=20,pz=-0.10,gdyaw=-25,gdp=-20,gdz=-0.06,curlL=0.5),'o'),
        (0.45,dict(K0,s2y=-8,s3y=-6,pyw=-10,s2p=8,pz=-0.16,hp=10),'s'),(0.95,K0,'s')]
    def tl2(t):
        x=segs(t,k2)
        # the left hand leaves the blaster to clutch the burn, then returns
        k=ss((t-0.06)/0.12)*(1-ss((t-0.6)/0.25))
        if k>0.001:
            bpy.context.view_layer.update(); ongun=P['ctrl_hand_l'].matrix.copy()
            tgt=P['spine_03'].matrix@REST['spine_03'].inverted()@lh_mat((0.03,-0.31,1.34),pitch=-70,yaw=50)
            fwdv=(P['spine_03'].matrix.to_3x3()@V((0,0,1))).normalized()        # out in front of the chest (spine_03 local +Z = forward)
            bulge=fwdv*0.14*math.sin(math.pi*k)
            x['handL']=M.Translation(ongun.translation.lerp(tgt.translation,k)+bulge)@ongun.to_quaternion().slerp(tgt.to_quaternion(),k).to_matrix().to_4x4()
        st=ss((t-0.08)/0.25)
        feet={'l':foot_mat('l',(0.02,-0.12+0.10*st,0.05*math.sin(math.pi*min(1,max(0,(t-0.08)/0.25)))),yaw=8),'r':AIMFEET['r']}
        return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('saber_hit_2',0.95,tl2,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Second lightsaber contact: doubles over, left hand clutches the burn, staggers, recovers.')
# --- lightsaber endings (third contact at t=0; the cut happens at CUT_T) ---
CUT_T=0.07
def saber_endings():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    # 1) right arm severed mid-upper-arm: clutches the stump, staggers back, knees, falls forward
    keys=[(0.0,K0,'s'),(0.08,dict(K0,s2y=20,s3y=16,pyw=20,s2p=-8,hp=-10,armR=0),'o'),
          (0.5,dict(K0,s2y=10,s2p=14,s3p=8,hp=22,np_=8,py=0.18,pz=-0.10,armR=0,urp=10),'s'),
          (1.0,dict(K0,s2p=18,s3p=10,hp=26,py=0.24,pz=-0.55,pp=12,armR=0,legs=0.6,tlp=-70,trp=-70,clp=110,crp=110),'i'),
          (1.25,dict(K0,s2p=16,s3p=10,hp=26,py=0.24,pz=-0.62,pp=24,armR=0,legs=0,tlp=-72,trp=-70,clp=112,crp=110),'s'),
          (1.62,dict(K0,s2p=6,hp=-12,hy=50,py=-0.30,pz=-0.70,pp=88,pr=12,armR=0,armL=0,legs=0,tlp=-2,trp=-1,clp=4,crp=3,ulp=8,ulr=-30,llp=-25),'i'),
          (2.6,dict(K0,s2p=4,hp=-14,hy=55,py=-0.32,pz=-0.70,pp=90,pr=14,armR=0,armL=0,legs=0,tlp=-2,trp=-1,clp=3,crp=2,ulp=12,ulr=-30,llp=-20,curlL=0.4),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,1.62,1.0,3.5,0.11); x['hp']+=6*b; x['clp']+=10*b
        k=ss((t-0.12)/0.15)*(1-ss((t-1.3)/0.2))
        if k>0.001:
            bpy.context.view_layer.update(); ongun=P['ctrl_hand_l'].matrix.copy()
            ch=P['spine_03'].matrix@REST['spine_03'].inverted()
            tgt=ch@lh_mat((-0.15,-0.21,1.37),pitch=-40,yaw=80)               # on the front of the chest plate, by the stump
            x['handL']=M.Translation(ongun.translation.lerp(tgt.translation,k))@ongun.to_quaternion().slerp(tgt.to_quaternion(),k).to_matrix().to_4x4()
            x['elbowL']=(ch@V((0.42,-0.55,1.20)))                            # elbow out in front, so the forearm lies across the chest, not through it
        st=ss((t-0.1)/0.25); st2=ss((t-0.35)/0.25)
        feet={'l':foot_mat('l',(0.02,-0.12+0.14*st2,0.05*math.sin(math.pi*min(1,max(0,(t-0.35)/0.25)))),yaw=8),
              'r':foot_mat('r',(-0.04,0.12+0.16*st,0.06*math.sin(math.pi*min(1,max(0,(t-0.1)/0.25)))),yaw=-25)}
        return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    fk_clip('saber_death_arm',2.6,tl,CUT_T,(-0.4,0.3,-0.2),(120,40,-200),1.62,ground_exclude=ARM_R,
            notes='Lightsaber third hit: right arm severed. Clutches the stump, staggers back, drops to his knees, falls forward.')
    CUTS.append(dict(clip='saber_death_arm',t=CUT_T,style='saber',pieces=[dict(bone='upperarm_r',at=0.5,region='upperarm_r',side='child',
                     motion=dict(kind='sim',vel=(-0.6,0.4,0.3),spin=(150,60,-260)))]))
    # 2) left leg severed mid-thigh: topples to the left immediately, lands on his side, rolls to his back
    keys=[(0.0,K0,'s'),(0.08,dict(K0,s2p=-6,hp=-8,legs=0.6),'o'),
          (0.70,dict(K0,pr=70,px=0.30,pz=-0.55,s2r=-14,s3r=-10,hr=-20,armL=0,armR=0,legs=0,ulp=-60,ulr=-70,llp=-20,urp=-40,urr=30,trp=-20,crp=25),'i'),
          (1.0,dict(K0,pr=86,px=0.36,pz=-0.72,s2r=-8,hr=-12,armL=0,armR=0,legs=0,ulp=-90,ulr=-80,llp=-15,urp=-30,urr=35,trp=-30,crp=40),'o'),
          (1.6,dict(K0,pr=40,pp=-60,px=0.36,pz=-0.72,hy=-30,armL=0,armR=0,legs=0,ulp=-90,ulr=-70,llp=-20,urp=-60,urr=50,trp=-40,crp=50),'s'),
          (2.2,dict(K0,pr=20,pp=-82,px=0.36,pz=-0.72,hy=-35,armL=0,armR=0,legs=0,ulp=-95,ulr=-72,llp=-24,urp=-65,urr=55,trp=-38,crp=48,curlL=0.4),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,0.7,1.0,3.5,0.1); x['hr']+=8*b; x['ulp']+=10*b
        return x,AIMFEET,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    fk_clip('saber_death_leg',2.2,tl,0.30,(0.3,0.2,0.4),(80,-40,220),0.7,ground_exclude=LEGS_L,
            notes='Lightsaber third hit: left leg severed at the thigh. Topples sideways, lands on his side, rolls onto his back.')
    CUTS.append(dict(clip='saber_death_leg',t=CUT_T,style='saber',pieces=[dict(bone='thigh_l',at=0.45,region='thigh_l',side='child',
                     motion=dict(kind='topple',delay=0.0,dur=0.65,axis=(0,1,0),angle=-80,push=(0.05,0,0)))]))
    # 3) beheaded: stands a beat, arms drop, knees buckle straight down, falls forward
    keys=[(0.0,K0,'s'),(0.10,dict(K0,s3p=-4,armL=0.3,armR=0.3),'o'),
          (0.40,dict(K0,s2p=4,armL=0,armR=0,ulp=5,llp=-10,urp=5,lrp=-10),'s'),
          (0.85,dict(K0,s1p=8,s2p=12,pz=-0.58,pp=10,armL=0,armR=0,ulp=8,llp=-8,urp=8,lrp=-8,legs=0.6,tlp=-80,trp=-78,clp=118,crp=116),'i'),
          (1.30,dict(K0,s1p=4,s2p=4,pz=-0.70,pp=86,py=-0.30,armL=0,armR=0,ulp=10,ulr=-20,llp=-15,urp=10,urr=22,lrp=-15,legs=0,tlp=-2,trp=-1,clp=5,crp=4),'i'),
          (2.4,dict(K0,s1p=2,s2p=2,pz=-0.70,pp=90,py=-0.32,armL=0,armR=0,ulp=14,ulr=-22,llp=-18,urp=14,urr=24,lrp=-18,legs=0,tlp=-2,trp=-1,clp=3,crp=2,curlL=0.3,curlR=0.3),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,1.3,1.0,3.5,0.1); x['ulp']+=10*b; x['urp']+=10*b; x['clp']+=8*b
        return x,AIMFEET,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    fk_clip('saber_death_head',2.4,tl,0.14,(0.0,0.0,0.1),(60,0,150),1.3,ground_exclude=('head','neck_01'),
            notes='Lightsaber third hit: beheaded. The body stands a moment, arms drop, knees buckle straight down, falls forward.')
    CUTS.append(dict(clip='saber_death_head',t=CUT_T,style='saber',pieces=[dict(bone='neck_01',at=0.45,region=None,side='child',anchor='head',
                     motion=dict(kind='sim',vel=(0.3,0.5,1.4),spin=(-300,90,120)))]))
    # 4) cut in half at the waist: legs stay standing then topple; the upper body slides back off and falls on its back
    keys=[(0.0,K0,'s'),(0.08,dict(K0,s2p=-6,hp=-10),'o'),
          (0.35,dict(K0,py=0.18,pz=-0.18,pp=-25,s2p=-10,hp=-14,armL=0,armR=0,ulp=-40,ulr=-30,urp=-40,urr=30,llp=-30,lrp=-30),'s'),
          (0.80,dict(K0,py=0.45,pz=-0.95,pp=-85,s2p=-6,hp=-20,armL=0,armR=0,ulp=-110,ulr=-60,urp=-100,urr=60,llp=-30,lrp=-35),'i'),
          (2.4,dict(K0,py=0.48,pz=-0.95,pp=-90,s2p=-4,hp=-6,hy=30,armL=0,armR=0,ulp=-120,ulr=-70,urp=-105,urr=70,llp=-35,lrp=-40,curlL=0.3,curlR=0.3),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,0.8,1.0,3.2,0.12); x['ulp']-=12*b; x['urp']-=12*b; x['hp']-=8*b
        return x,AIMFEET,dict(armL=x['armL'],armR=x['armR'],legs=1.0),fk_of(x)
    fk_clip('saber_death_half',2.4,tl,0.20,(0.0,0.6,0.3),(200,30,90),0.8,ground_exclude=LEGS_L+LEGS_R+('pelvis',),
            notes='Lightsaber third hit: cut in half at the waist. The legs stand a beat then topple; the upper body slides back off and falls.')
    CUTS.append(dict(clip='saber_death_half',t=CUT_T,style='saber',pieces=[dict(plane='waist',side='below',
                     motion=dict(kind='topple',delay=0.45,dur=0.75,axis=(1,0,0),angle=-85,push=(0,0.05,0)))]))
    # 5) diagonal: shoulder-to-hip cut, the upper piece slides down the cut and falls; the hips and legs crumple
    keys=[(0.0,K0,'s'),(0.08,dict(K0,s2p=-4),'o'),
          (0.45,dict(K0,pz=-0.06,legs=1),'s'),
          (1.00,dict(K0,pz=-0.60,pp=-10,pr=-15,legs=0.5,tlp=-80,trp=-60,clp=120,crp=100),'i'),
          (1.45,dict(K0,pz=-0.80,pp=-70,pr=-40,px=-0.15,py=0.25,legs=0,tlp=-60,trp=-35,clp=90,crp=60),'i'),
          (2.4,dict(K0,pz=-0.80,pp=-80,pr=-50,px=-0.16,py=0.27,legs=0,tlp=-50,trp=-30,clp=80,crp=55),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,1.45,1.0,3.2,0.12); x['clp']+=12*b; x['crp']+=10*b
        return x,AIMFEET,dict(armL=0,armR=0,legs=x['legs']),fk_of(x)
    fk_clip('saber_death_diagonal',2.4,tl,CUT_T,(-0.6,0.2,0.0),(60,-40,220),1.45,ground_exclude=('head','neck_01','spine_03','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','hand_l','hand_r'),
            notes='Lightsaber third hit: cut diagonally shoulder to hip. The upper piece slides down the cut and falls; the hips and legs crumple.')
    CUTS.append(dict(clip='saber_death_diagonal',t=CUT_T,style='saber',pieces=[dict(plane='diagonal',side='above',
                     motion=dict(kind='slide',delay=0.0,slide=0.55,dur=0.55,then='sim',spin=(40,-30,160)))]))
# --- explosions: completely limp, thrown by the blast, variations lose limbs ---
def blast_clip(name,dur,v,up,spin,land,notes,cuts=(),excl=(),final=None,limbs=None):
    """v: horizontal throw (m/s, armature space); up: vertical speed; spin: (pitch,yaw,roll) total degrees during flight"""
    g=9.81; t_land=2*up/g
    K0=dict(aim,**LIMBS0,armL=0,armR=0,legs=0)
    def tl(t):
        x=dict(K0)
        tf=min(t,t_land)
        x['rootx']=v[0]*tf+(v[0]*0.25*(1-math.exp(-(t-t_land)/0.15)) if t>t_land else 0)
        x['rooty']=v[1]*tf+(v[1]*0.25*(1-math.exp(-(t-t_land)/0.15)) if t>t_land else 0)
        x['rootz']=max(0.0,up*tf-0.5*g*tf*tf)
        u=tf/t_land
        x['pp']=spin[0]*u+(final or {}).get('pp',0)*ss((t-t_land)/0.3)
        x['pyw']=spin[1]*u; x['pr']=spin[2]*u+(final or {}).get('pr',0)*ss((t-t_land)/0.3)
        x['pz']=-0.10-0.60*ss((t-t_land+0.1)/0.25)
        # limbs trail the motion while airborne, splay on impact, settle
        fl=math.sin(math.pi*min(1,t/t_land)) if t<t_land else 0
        L=limbs or {}
        x.update(ulp=-100*fl+L.get('ulp',-90)*ss((t-t_land)/0.2),ulr=-60*fl+L.get('ulr',-60)*ss((t-t_land)/0.2),urp=-90*fl+L.get('urp',-80)*ss((t-t_land)/0.2),
                 urr=55*fl+L.get('urr',60)*ss((t-t_land)/0.2),llp=-30*fl+L.get('llp',-30)*ss((t-t_land)/0.2),lrp=-35*fl+L.get('lrp',-35)*ss((t-t_land)/0.2),tlp=-35*fl+L.get('tlp',-15)*ss((t-t_land)/0.2),trp=-20*fl+L.get('trp',-25)*ss((t-t_land)/0.2),
                 clp=40*fl+L.get('clp',25),crp=30*fl+L.get('crp',35),s2p=-10*fl,hp=-25*fl+L.get('hp',-5),hy=L.get('hy',30)*ss((t-t_land)/0.3),curlL=0.4,curlR=0.4)
        b=damp(t,t_land,1.0,3.2,0.1)
        x['ulp']+=12*b; x['urp']+=12*b; x['tlp']-=12*b; x['clp']+=10*b; x['hp']+=8*b
        return x,AIMFEET,dict(armL=0,armR=0,legs=0),fk_of(x)
    fk_clip(name,dur,tl,0.03,(v[0]*1.1,v[1]*1.1,up*1.2),(500,200,-300),t_land,ground_exclude=excl,notes=notes)
    if cuts: CUTS.append(dict(clip=name,t=0.04,style='blast',pieces=list(cuts)))
def explosions():
    blast_clip('death_explosion',2.4,(0,3.6,0),3.6,(-200,0,0),0.0,
               'Explosion in front: completely limp, blown backward through the air, flips, lands on his back.',final=dict(pp=110),limbs=dict(ulp=0,ulr=-70,urp=0,urr=70,llp=-4,lrp=-6,tlp=2,trp=-4,clp=4,crp=8,hp=-5,hy=30))
    blast_clip('death_explosion_arm',2.4,(-3.4,0.8,0),3.2,(70,220,-90),0.0,
               'Explosion from his left: thrown sideways with a spin, left arm blown off, lands on his front.',
               cuts=[dict(bone='upperarm_l',at=0.06,region='upperarm_l',side='child',motion=dict(kind='sim',vel=(-2.5,0.8,2.2),spin=(700,300,-500)))],
               excl=ARM_L,final=dict(pp=20,pr=0),limbs=dict(ulp=10,ulr=-30,urp=10,urr=30,tlp=-2,trp=-1,clp=4,crp=5,hp=-5,hy=50))
    blast_clip('death_explosion_leg',2.6,(0,-2.4,0),4.4,(250,0,0),0.0,
               'Explosion beneath him: launched high, somersaults forward, right leg blown off, lands face down.',
               cuts=[dict(bone='thigh_r',at=0.06,region='thigh_r',side='child',motion=dict(kind='sim',vel=(-1.2,-0.4,1.2),spin=(-600,200,400)))],
               excl=LEGS_R,final=dict(pp=-160),limbs=dict(ulp=10,ulr=-35,urp=-150,urr=30,tlp=-2,trp=-1,clp=4,crp=3,hp=-5,hy=-45))
    blast_clip('death_explosion_armleg',2.6,(0.6,-3.6,0),3.4,(0,40,270),0.0,
               'Explosion behind him: cartwheels forward, right arm and left leg blown off, lands on his side.',
               cuts=[dict(bone='upperarm_r',at=0.06,region='upperarm_r',side='child',motion=dict(kind='sim',vel=(-1.6,-1.2,1.6),spin=(500,-400,300))),
                     dict(bone='thigh_l',at=0.06,region='thigh_l',side='child',motion=dict(kind='sim',vel=(1.6,-0.8,1.2),spin=(-400,300,-500)))],
               excl=ARM_R+LEGS_L,final=dict(pr=-180),limbs=dict(ulp=-30,ulr=-20,urp=-30,urr=20,tlp=-25,trp=-35,clp=40,crp=50,hp=5,hy=20))
roll_to_kneel(); kneel_clips(); climb_ladder(); mantle(); saber_hits(); saber_endings(); explosions()
# ================= squad duties and tactics =================
def hmat(side,pos,pitch=0,yaw=0,roll=0):
    """hand target in rest-armature space: rest hand orientation rotated by pitch/yaw/roll (deg), at pos"""
    m=(E((R(pitch),R(roll),R(yaw))).to_matrix()@REST[f'hand_{side}'].to_3x3()).to_4x4(); m.translation=V(pos); return m
def pmat(pos,yaw=0): m=M.Rotation(R(yaw),4,'Z'); m.translation=V(pos); return m
HIDE=M.Translation((0,0,-20))     # prop parked out of sight
def step_feet(t,T,L,travel=(0,-1),s=0.62,lift=0.09,rise=0.0,width=0.0):
    """planted-in-world stepping (no slide): stance feet move opposite to travel at exactly the clip speed;
    swing feet arc forward. rise: height gained per step (stairs)."""
    p=(t/T)%1.0; out={}
    for side,ph in (('l',0.0),('r',0.5)):
        q=(p+ph)%1.0; sg=1 if side=='l' else -1
        rs=rise*s   # height the body gains while this foot is planted
        if q<s: u=q/s; off=L*(0.5-u); z=rs*(1-u); lz=0.0; pitch=0.0
        else:
            w=(q-s)/(1-s); off=-L/2+L*ss(w); z=rs*ss(w); lz=lift*math.sin(math.pi*w); pitch=12*math.sin(math.pi*w)
        out[side]=foot_mat(side,(travel[0]*off+sg*width,travel[1]*off,z+lz),pitch=pitch)
    return out
RDY=dict(stance('ready'),**LIMBS0); RDY.update(armL=1,armR=1,legs=1)
BACK=dict(stance('ready'),**LIMBS0); BACK.update(armL=0,armR=0,legs=1)     # blaster slung on the back, both hands free (hands set per clip)
LIE=dict(stance('ready'),**LIMBS0); LIE.update(armL=0,armR=1,legs=0,pp=-88,pz=-0.74,s2p=-4,hp=-10,
         gpos=(-0.04,-0.20,1.26),gyaw=10,gpitch=60,groll=-20,tlp=-28,trp=-12,clp=45,crp=20)
def osc(t,per,a,ph=0.0): return a*math.sin(2*math.pi*(t/per+ph))

def wounded_clips():
    def tl(t):
        x=dict(LIE); x['s2p']+=osc(t,2.2,3); x['hr']=osc(t,3.1,8); x['tlp']+=osc(t,2.6,8); x['clp']+=osc(t,2.6,10)
        x['handL_rel']=hmat('l',(-0.02,-0.25,1.08),pitch=-80,yaw=70)        # pressing the wound (on the armour, not in it)
        return x,None,dict(armL=1,armR=1,legs=0),fk_of(x)
    fk_clip('wounded_down',4.4,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=0,notes='Wounded on his back: presses the wound, writhes, blaster held across the chest. Loop.')
    def tl(t):
        p=(t/1.4)%1.0; x=dict(LIE)
        x['tlp']=-35-30*math.sin(2*math.pi*p); x['trp']=-35-30*math.sin(2*math.pi*(p+0.5))
        x['clp']=60+40*math.sin(2*math.pi*p); x['crp']=60+40*math.sin(2*math.pi*(p+0.5))
        x['py']=0.03*math.sin(2*math.pi*p); x['hr']=osc(t,1.4,6)
        x['handL_rel']=hmat('l',(0.25,0.05,0.95),pitch=-60)                  # left hand pushing on the ground
        return x,None,dict(armL=1,armR=1,legs=0),fk_of(x)
    fk_clip('wounded_crawl',1.4,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=0,notes='Wounded: pushes himself backward along the ground with his legs, 0.3 m/s. Loop.')

DRAG_T=1.2; DRAG_V=0.9
def drag_clips():
    # rescuer: bent over, walking backward, left hand on the wounded man's collar, blaster one-handed scanning
    K=dict(stance('aim'),**LIMBS0,armL=0,armR=1,legs=1,pz=-0.24,pp=32,s1p=14,s2p=12,s3p=-6,hp=-26,gpos=(-0.10,-0.30,1.20),gyaw=-8,gpitch=-5)
    def tl(t):
        x=dict(K); x['pz']+=-0.012*math.cos(4*math.pi*t/DRAG_T)
        x['handL']=hmat('l',(0.16,-0.62,0.52),pitch=-100,yaw=10)            # gripping the collar (armature space: low, in front)
        return x,step_feet(t,DRAG_T,DRAG_V*DRAG_T*0.62,travel=(0,1),lift=0.06),dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('drag_rescuer',DRAG_T,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=0,
            notes='Rescuer drags a wounded trooper to safety: walks backward bent over, left hand on the collar, blaster up one-handed. 0.9 m/s. Pair with drag_wounded.')
    # wounded being dragged: on his back, torso lifted by the collar, heels sliding, arms trailing
    Kw=dict(LIE,armR=0,pp=-58,pz=-0.56,s2p=-8,hp=-14,tlp=-18,trp=-24,clp=12,crp=20)
    def tl(t):
        x=dict(Kw); x['pr']=osc(t,DRAG_T,4); x['hr']=osc(t,DRAG_T,6,0.2)
        x.update(ulp=-20+osc(t,DRAG_T,6),ulr=-60,urp=-20+osc(t,DRAG_T,6,0.5),urr=60,llp=-25,lrp=-25)
        return x,None,dict(armL=0,armR=0,legs=0),fk_of(x)
    fk_clip('drag_wounded',DRAG_T,tl,99,(0,0,0),(0,0,0),None,loop=True,gun_mode='back',
            notes='Wounded trooper being dragged by the collar: torso lifted, heels sliding, arms trailing. Pair with drag_rescuer (offset in drag_pair.json).')

def cqb_clips():
    # stack up on a door: crouched, rifle low, left hand on the shoulder of the man in front (squeeze to go)
    K=dict(stance('ready'),**LIMBS0,armL=0,armR=1,legs=1,pz=-0.16,pp=10,s2p=6,hp=2,gpos=(-0.08,-0.24,1.08),gyaw=8,gpitch=-35)
    FE={'l':foot_mat('l',(0.04,-0.14,0),yaw=8),'r':foot_mat('r',(-0.05,0.16,0),yaw=-15)}
    def tl(t):
        x=dict(K); x['s2p']+=osc(t,2.5,1.2); x['handL']=hmat('l',(0.10,-0.62,1.22),pitch=-30,yaw=-10)
        return x,FE,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('stack_up',2.5,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=0,notes='Stacked on a door: crouched, rifle low, left hand on the shoulder of the trooper in front. Loop.')
    # breach and clear: steps through the doorway rifle up, slicing the pie left to right (root motion 1.6 m)
    A=dict(stance('aim'),**LIMBS0,armL=1,armR=1,legs=1)
    def tl(t):
        T=1.5; u=min(1.0,t/1.1); x=dict(A); sweep=40*math.cos(math.pi*ss(u))
        x['rooty']=-1.6*ss(min(1.0,t/1.2)); x['s1y']+=sweep*0.25; x['s2y']+=sweep*0.35; x['s3y']+=sweep*0.4; x['pyw']+=sweep*0.15
        x['pz']+=-0.04
        steps=step_feet(t,0.6,0.55,lift=0.07) if t<1.2 else AIMFEET
        return x,steps,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('breach_clear',1.5,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes='Breach and clear: steps through the doorway rifle up, sweeping the room left to right. Root motion 1.6 m.')
    # stairs up, aiming: two steps per cycle, 18 cm rise / 28 cm run (in place; the character moves up)
    def tl(t):
        x=dict(A); x['pz']+=-0.04+0.015*math.cos(4*math.pi*t/1.0); x['s1p']+=4
        return x,step_feet(t,1.0,0.56,rise=0.36,lift=0.10),dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('stairs_up_aim',1.0,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Climbing stairs while aiming: 2 steps per loop, 18 cm rise, 28 cm run (0.56 m forward, 0.36 m up per loop).')

CRATE_W=0.40
def logistics_clips():
    held=lambda: dict(handL_rel=hmat('l',(CRATE_W/2,-0.30,1.00),pitch=-10,yaw=90,roll=0),handR_rel=hmat('r',(-CRATE_W/2,-0.30,1.00),pitch=-10,yaw=-90),prop_rel=pmat((0,-0.30,1.06)))
    K=dict(BACK,s2p=-4,s3p=-3,hp=4,pz=-0.07)
    def tl(t):
        x=dict(K); x['pz']+=-0.012*math.cos(4*math.pi*t/1.1); x['pr']=osc(t,1.1,2); x.update(held())
        return x,step_feet(t,1.1,1.0*1.1*0.62,lift=0.08),dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('carry_crate',1.1,tl,99,(0,0,0),(0,0,0),None,loop=True,gun_mode='back',notes='Logistics: carries a supply crate in both hands, blaster slung. 1.0 m/s. Crate on the prop bone.')
    def lift(rev):
        def tl(t):
            u=ss(t/0.8)*(1-ss((t-1.0)/0.7))     # squat down, then stand up (both directions)
            g=ss((t-0.75)/0.2)   # crate gripped / lifted
            up=1-u if not rev else u
            x=dict(BACK,pz=-0.78*u,pp=34*u,s1p=16*u,s2p=18*u,hp=-12*u,tlp=0)
            ground=(0,-0.34,0.22); chest=(0,-0.30,1.06)
            lifted=g if not rev else 1-ss((t-0.85)/0.2)
            c=V(ground).lerp(V(chest),max(0.0,1-u) if lifted>0.5 else 0.0) if True else None
            cpos=V(ground) if lifted<0.5 else V(ground).lerp(V(chest),1-u)
            x['prop']=pmat(cpos)
            gw=ss((t-0.10)/0.65) if not rev else 1-ss((t-1.05)/0.6)     # hands go to the crate as he squats (and leave it after)
            gl=V((cpos.x+CRATE_W/2,cpos.y,cpos.z-0.06)); gr=V((cpos.x-CRATE_W/2,cpos.y,cpos.z-0.06))
            bpy.context.view_layer.update(); CH_=P['spine_03'].matrix@REST['spine_03'].inverted()
            homeL=CH_@V((0.24,-0.06,0.98)); homeR=CH_@V((-0.24,-0.06,0.98))
            x['handL']=hmat('l',tuple(homeL.lerp(gl,gw)),pitch=-10*gw,yaw=90*gw); x['handR']=hmat('r',tuple(homeR.lerp(gr,gw)),pitch=-10*gw,yaw=-90*gw)
            FE={'l':foot_mat('l',(0.06,0.0,0),yaw=12),'r':foot_mat('r',(-0.06,0.0,0),yaw=-12)}
            return x,FE,dict(armL=1,armR=1,legs=1),fk_of(x)
        return tl
    fk_clip('crate_pickup',1.8,lift(False),99,(0,0,0),(0,0,0),None,gun_mode='back',notes='Logistics: squats, grips a crate on the ground, lifts it to the chest (ends in carry_crate hold).')
    fk_clip('crate_putdown',1.8,lift(True),99,(0,0,0),(0,0,0),None,gun_mode='back',notes='Logistics: squats and sets the crate down, stands up.')

def comms_artillery_clips():
    def tl(t):
        x=dict(RDY,armL=0,hp=6+osc(t,1.6,4),hr=-10,hy=osc(t,3.2,8)); x['handL_rel']=hmat('l',(0.13,-0.06,1.63),pitch=-70,yaw=-40,roll=60)
        return x,FE_RDY,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('radio_call',3.2,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=0,notes='Radio operator: hand to the helmet comlink, talking, scanning. Loop.')
    # mortar: kneeling, drops a round into the tube, ducks and covers, back up
    MUZ=V((0.0,-0.46,0.62)); FEk=kneel_feet()
    def tl(t):
        x=dict(BACK,pz=-0.50,pp=8,s2p=4)
        raise_=ss((t-0.2)/0.5)*(1-ss((t-0.85)/0.15)); drop=ss((t-0.85)/0.12); duck=ss((t-1.1)/0.3)*(1-ss((t-2.2)/0.3))
        hold=V((0.0,-0.30,1.05)).lerp(MUZ+V((0,0,0.12)),raise_)
        x['prop']=HIDE if drop>0.99 else pmat(hold.lerp(MUZ-V((0,0,0.3)),drop))
        hp=hold+V((0,0,-0.04))
        x['handL']=hmat('l',(hp.x+0.06,hp.y,hp.z),pitch=-40,yaw=70); x['handR']=hmat('r',(hp.x-0.06,hp.y,hp.z),pitch=-40,yaw=-70)
        if duck>0.01:
            x['s2p']+=30*duck; x['hp']+=25*duck; x['pp']+=10*duck
            x['handL_rel']=hmat('l',(0.14,-0.02,1.60),pitch=-90,yaw=-30); x['handR_rel']=hmat('r',(-0.14,-0.02,1.60),pitch=-90,yaw=30)
        return x,FEk,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('mortar_load',2.6,tl,99,(0,0,0),(0,0,0),None,gun_mode='back',notes='Artillery crew: kneeling at the mortar, drops a round down the tube, ducks and covers his helmet, back up. Round on the prop bone.')
    # thermal detonator throw (left hand), back on the blaster
    def tl(t):
        x=dict(RDY,armL=0); k1=ss(t/0.25); k2=ss((t-0.35)/0.25); k3=ss((t-0.6)/0.12); back=ss((t-0.95)/0.3)
        belt=V((0.16,-0.12,1.02)); wind=V((0.38,0.22,1.62)); rel=V((0.18,-0.62,1.62))
        pos=belt.lerp(wind,k2).lerp(rel,k3)
        x['s2y']=-25*k2+30*k3; x['s3y']=-15*k2+20*k3; x['pyw']=-10*k2+12*k3
        if back<0.999: x['handL_rel']=hmat('l',tuple(pos),pitch=-60)
        x['prop']=None if t<0.72 else HIDE
        if t<0.72:
            x['prop_rel']=pmat(pos+V((0,-0.03,0)))
        return x,FE_RDY,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('grenade_throw',1.4,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Throws a thermal detonator with the left hand (released at 0.72 s), back on the blaster. Detonator on the prop bone.')
    def tl(t):
        x=shots(t,[i*0.12 for i in range(5)],dict(aim)); x.update(LIMBS0); x.update(armL=1,armR=1,legs=1)
        return x,AIMFEET,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('suppress',0.6,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Suppressing fire: sustained bolts every 0.12 s with recoil. Loop.')

def checkpoint_clips():
    def tl(t):
        x=dict(RDY,armL=0,hp=2); x['handL_rel']=hmat('l',(0.20,-0.58,1.48),pitch=-95,yaw=-15,roll=0)
        x['s2p']+=osc(t,2.0,1)
        return x,FE_RDY,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('checkpoint_halt',2.0,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=0,notes='Roadblock: left palm raised, halting the vehicle or person, blaster low ready. Loop.')
    def tl(t):
        x=dict(RDY,armL=0); out_=ss(t/0.5)*(1-ss((t-0.9)/0.4)); read=ss((t-0.9)/0.4)*(1-ss((t-2.9)/0.4)); give=ss((t-2.9)/0.4)*(1-ss((t-3.6)/0.4))
        reach=V((0.18,-0.55,1.25)); readp=V((0.08,-0.34,1.30)); home=V((0.16,-0.14,1.10))
        pos=home.lerp(reach,out_).lerp(readp,read)
        if give>0: pos=readp.lerp(reach,give)
        x['hp']=4+16*read; x['hy']=osc(t,1.3,6)*read
        x['handL_rel']=hmat('l',tuple(pos),pitch=-70+20*read,yaw=-30)
        x['prop_rel']=HIDE if (t<0.75 or t>3.55) else pmat(pos+V((-0.02,-0.04,0.05)))
        return x,FE_RDY,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('check_credentials',4.0,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Roadblock: takes the travel papers / datapad, reads and checks them, hands them back. Datapad on the prop bone.')
    def tl(t):
        x=dict(BACK,s2p=40,s3p=12,hp=18,pz=-0.14,pp=18,hy=osc(t,1.7,14))
        lid=ss(t/0.5)*(1-ss((t-3.4)/0.5))
        x['handL']=hmat('l',(0.20,-0.56,0.92+0.22*lid),pitch=-120*lid-20,yaw=0)
        x['handR']=hmat('r',(-0.10+0.08*math.sin(2*math.pi*t/1.1),-0.55,0.80+0.04*math.sin(2*math.pi*t/0.7)),pitch=-80)
        FE={'l':foot_mat('l',(0.04,-0.10,0),yaw=8),'r':foot_mat('r',(-0.05,0.10,0),yaw=-12)}
        return x,FE,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('inspect_freight',4.0,tl,99,(0,0,0),(0,0,0),None,gun_mode='back',notes='Roadblock: bends over a cargo crate, lifts the lid, searches inside for weapons, closes it. Blaster slung.')

def rank_clips():
    PORT=dict(stance('ready'),**LIMBS0,armL=1,armR=1,legs=1,gpos=(0.0,-0.20,1.28),gyaw=50,gpitch=55,groll=-30,s2p=-2,hp=-2)
    FEa={'l':foot_mat('l',(-0.02,0,0),yaw=12),'r':foot_mat('r',(0.02,0,0),yaw=-12)}
    def tl(t):
        x=dict(PORT); x['s2p']+=osc(t,4.0,0.6); return x,FEa,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('attention',4.0,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='At attention, blaster at port arms, heels together: standing for an officer. Loop.')
    def tl(t):
        x=dict(RDY,armL=0); k=ss(t/0.35)*(1-ss((t-1.2)/0.35))
        x['s2y']=12*k; x['hy']=20*k; x['handL_rel']=hmat('l',tuple(V((0.16,-0.14,1.10)).lerp(V((0.48,-0.55,1.52)),k)),pitch=-90*k,yaw=-20)
        return x,FE_RDY,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('command_point',1.6,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Officer / sergeant: points the squad to a position.')
    def tl(t):
        x=dict(RDY,armL=0); a=ss(t/0.3); b=ss((t-0.35)/0.35); back=ss((t-0.9)/0.3)
        pos=V((0.16,-0.14,1.10)).lerp(V((0.22,-0.10,1.85)),a).lerp(V((0.22,-0.65,1.45)),b).lerp(V((0.16,-0.14,1.10)),back)
        x['handL_rel']=hmat('l',tuple(pos),pitch=-90,yaw=-10); return x,FE_RDY,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('command_advance',1.3,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Officer / sergeant: arm up, then chops forward: "advance".')

wounded_clips(); drag_clips(); cqb_clips(); logistics_clips(); comms_artillery_clips(); checkpoint_clips(); rank_clips()
# ================= combat completeness: get-ups, cover, prone, turns, stops, dives, vault, reactions =================
def blend_feet(a,b,k):
    out={}
    for sd in 'lr':
        A,B=a[sd],b[sd]; m=A.to_quaternion().slerp(B.to_quaternion(),k).to_matrix().to_4x4(); m.translation=A.translation.lerp(B.translation,k); out[sd]=m
    return out
def feet_at(t,keys):
    """keys: [(t, feet_dict)] -> smoothly blended feet"""
    if t<=keys[0][0]: return keys[0][1]
    for (t0,a),(t1,b) in zip(keys,keys[1:]):
        if t<=t1: return blend_feet(a,b,ss((t-t0)/(t1-t0)))
    return keys[-1][1]
AIMd=dict(stance('aim'),**LIMBS0); AIMd.update(armL=1,armR=1,legs=1)
READYd=dict(stance('ready'),**LIMBS0); READYd.update(armL=1,armR=1,legs=1)
KNEELd=dict(KNEEL)
LYING_BACK=dict(LIE,armL=1,armR=1)
PRONE=dict(stance('aim'),**LIMBS0); PRONE.update(armL=1,armR=1,legs=0,pp=86,pz=-0.80,s1p=-12,s2p=-16,s3p=-14,np_=-20,hp=-30,tlp=4,trp=4,tlr=-10,trr=10,clp=4,crp=4,pyw=0,s1y=0,s2y=0,s3y=0)

def getup_clips():
    # from lying on his back: sit up, roll onto the right knee, push up, stand at the ready
    keys=[(0.0,dict(LYING_BACK,armL=0),'s'),
          (0.45,dict(LYING_BACK,armL=0,pp=-45,pz=-0.64,s2p=22,s3p=12,hp=18,tlp=-70,trp=-60,clp=105,crp=95),'s'),
          (0.95,dict(KNEELd,armL=0,pr=-12,pyw=18,s2p=18,hp=10,legs=1),'s'),
          (1.35,dict(KNEELd,armL=0,legs=1),'s'),
          (1.95,dict(READYd,pz=-0.12,s2p=10,legs=1),'s'),
          (2.4,dict(READYd),'s')]
    def tl(t):
        x=segs(t,keys); x['legs']=ss((t-0.2)/0.25)     # feet plant in front of him as he sits up; IK carries them to the kneel
        if t<1.6: x['handL_rel']=hmat('l',(0.30,0.10 if t<0.7 else -0.10,0.98),pitch=-60)      # pushing off the ground
        else: x['armL']=ss((t-1.6)/0.4)                                                          # back on the blaster
        SIT={'l':foot_mat('l',(0.06,-0.52,0),pitch=-18,yaw=10),'r':foot_mat('r',(-0.06,-0.46,0),pitch=-18,yaw=-10)}
        return x,feet_at(t,[(0.2,SIT),(0.55,SIT),(0.95,kneel_feet()),(1.5,kneel_feet()),(2.1,FE_RDY)]),dict(armL=x['armL'] if t>=1.6 else 0,armR=1,legs=x['legs']),fk_of(x)
    fk_clip('getup_back',2.4,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Get up from lying on his back (after being patched up): sits up, rolls onto a knee, pushes up, ready.')
    # from face down / prone: push up, knees under, one knee, stand
    PR=dict(PRONE,armL=0)
    keys=[(0.0,PR,'s'),
          (0.4,dict(PR,pp=62,pz=-0.62,s2p=-6,s3p=-6,hp=-20),'s'),
          (0.9,dict(PR,pp=40,pz=-0.58,s2p=10,s3p=4,hp=-6,tlp=-100,trp=-100,clp=135,crp=135),'s'),
          (1.35,dict(KNEELd,armL=0,legs=1),'s'),
          (1.95,dict(READYd,pz=-0.12,s2p=10,legs=1),'s'),
          (2.4,dict(READYd),'s')]
    def tl(t):
        x=segs(t,keys); x['legs']=ss((t-0.9)/0.45)
        if t<1.4: x['handL_rel']=hmat('l',(0.22,-0.30,1.05),pitch=-100)
        else: x['armL']=ss((t-1.4)/0.4)
        return x,feet_at(t,[(0.9,kneel_feet()),(1.5,kneel_feet()),(2.1,FE_RDY)]),dict(armL=x['armL'] if t>=1.4 else 0,armR=1,legs=x['legs']),fk_of(x)
    fk_clip('getup_front',2.4,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Get up from face down or prone: pushes up, knees under, one knee, stands at the ready. Also prone-to-stand.')
    # medic treating a wounded man lying at his left front: kneels, both hands working on the chest
    def tl(t):
        x=dict(KNEELd,armL=0,armR=0,pp=24,s2p=22,s3p=10,hp=26,hy=8)
        w=0.03*math.sin(2*math.pi*t/0.7)
        x['handL']=hmat('l',(0.18,-0.46,0.42+w),pitch=-110,yaw=20); x['handR']=hmat('r',(0.00,-0.48,0.42-w),pitch=-110,yaw=-20)
        return x,kneel_feet(),dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('medic_treat',2.8,tl,99,(0,0,0),(0,0,0),None,loop=True,gun_mode='back',notes='Medic kneeling over a wounded trooper, working on his chest (blaster slung). Loop.')

def cover_clips():
    LOW=dict(READYd,pz=-0.52,pp=16,s1p=8,s2p=10,s3p=6,hp=6,gpos=(-0.05,-0.20,1.18),gyaw=30,gpitch=55,groll=-25)   # crouched, rifle up at the chest
    FEc={'l':foot_mat('l',(0.04,-0.16,0),yaw=10),'r':foot_mat('r',(-0.06,0.18,0),pitch=40,pivot='ball',yaw=-14)}
    def tl(t):
        x=dict(LOW); x['s2p']+=osc(t,2.6,1.5); x['hy']=osc(t,3.9,12); return x,FEc,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('cover_low_idle',2.6,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Behind low cover (about 1 m): crouched, blaster up at the chest, head down, glancing. Loop.')
    UP=dict(AIMd,pz=-0.18,pp=6,s2p=4)
    keys=[(0.0,LOW,'s'),(0.35,UP,'o'),(1.35,UP,'s'),(1.75,LOW,'s'),(2.0,LOW,'s')]
    def tl(t):
        x=segs(t,keys); x=shots(t,(0.5,0.75,1.0),x); x.update({k:x.get(k,0) for k in LIMBS0})
        return x,FEc,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('cover_low_fire',2.0,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes='Low cover: pops up over the wall, fires 3 bolts (0.5, 0.75, 1.0 s), drops back down.')
    # tall cover: the wall edge is on his right; he stands close to it, then leans out to fire
    HIGH=dict(READYd,s2p=2,hp=2,hy=-25,s3y=-8,gpos=(-0.04,-0.20,1.24),gyaw=35,gpitch=60,groll=-30)
    FEh={'l':foot_mat('l',(0.04,-0.04,0),yaw=8),'r':foot_mat('r',(-0.04,0.06,0),yaw=-14)}
    def tl(t):
        x=dict(HIGH); x['s2p']+=osc(t,2.8,1.2); return x,FEh,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('cover_high_idle',2.8,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Behind tall cover, wall edge on his right: standing close, blaster at port, watching the edge. Loop.')
    for side,sg in (('r',-1),('l',1)):
        LEAN=dict(AIMd,s1r=-sg*6,s2r=-sg*12,s3r=-sg*10,pr=-sg*4,px=sg*0.10,hr=sg*6)
        keys=[(0.0,HIGH,'s'),(0.3,LEAN,'o'),(1.3,LEAN,'s'),(1.65,HIGH,'s'),(1.9,HIGH,'s')]
        def tl(t,keys=keys,sg=sg):
            x=segs(t,keys); x=shots(t,(0.45,0.7,0.95),x); x.update({k:x.get(k,0) for k in LIMBS0})
            k=ss(t/0.3)*(1-ss((t-1.3)/0.35))
            feet={'l':foot_mat('l',(0.04+sg*0.18*k*(sg>0),-0.04,0),yaw=8),'r':foot_mat('r',(-0.04+sg*0.18*k*(sg<0),0.06,0),yaw=-14)}
            return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
        fk_clip(f'cover_lean_fire_{side}',1.9,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,
                notes=f'Tall cover: steps and leans out to the {"right" if side=="r" else "left"}, fires 3 bolts, back behind the wall.')

def prone_clips():
    keys=[(0.0,AIMd,'s'),(0.35,dict(KNEELd),'s'),(0.75,dict(PRONE,pp=50,pz=-0.62,s2p=0,hp=-10,legs=0.4,tlp=-60,trp=-60,clp=90,crp=90),'s'),(1.25,PRONE,'o'),(1.6,PRONE,'s')]
    def tl(t):
        x=segs(t,keys); x['legs']=1-ss((t-0.4)/0.4)
        return x,feet_at(t,[(0.0,AIMFEET),(0.35,kneel_feet())]),dict(armL=1,armR=1,legs=x['legs']),fk_of(x)
    fk_clip('go_prone',1.6,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes='Drops from standing to prone: kneels, falls forward onto the elbows, rifle aimed.')
    def tl(t):
        x=dict(PRONE); x['s2p']+=osc(t,3.0,1.0); return x,None,dict(armL=1,armR=1,legs=0),fk_of(x)
    fk_clip('prone_aim',3.0,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Prone, up on the elbows, aiming. Loop.')
    def tl(t):
        x=shots(t,(0.0,),dict(PRONE)); return x,None,dict(armL=1,armR=1,legs=0),fk_of(x)
    fk_clip('prone_shoot',0.3,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Prone bolt with recoil. Loop for sustained fire.')
    def tl(t):
        p=(t/1.4)%1.0; x=dict(PRONE)
        x['tlp']=-35*max(0,math.sin(2*math.pi*p)); x['trp']=-35*max(0,math.sin(2*math.pi*(p+0.5)))
        x['clp']=55*max(0,math.sin(2*math.pi*p)); x['crp']=55*max(0,math.sin(2*math.pi*(p+0.5)))
        x['tlr']=-10-12*max(0,math.sin(2*math.pi*p)); x['trr']=10+12*max(0,math.sin(2*math.pi*(p+0.5)))
        x['s1y']=6*math.sin(2*math.pi*p); x['s2y']=5*math.sin(2*math.pi*p); x['pr']=4*math.sin(2*math.pi*p)
        x['gdy']=0.04*math.sin(2*math.pi*p); x['s2p']=PRONE['s2p']+6
        return x,None,dict(armL=1,armR=1,legs=0),fk_of(x)
    fk_clip('prone_crawl',1.4,tl,99,(0,0,0),(0,0,0),None,loop=True,lhand_on=1,notes='Prone crawl on elbows and knees, rifle cradled forward. 0.4 m/s. Loop.')

def move_clips():
    # turn in place: root rotates 90 deg, the feet step around (planted foot pivots, the other steps)
    for name,sg in (('turn_l90',1),('turn_r90',-1)):
        def tl(t,sg=sg):
            k=ss(t/0.8); yaw=90*sg*k; x=dict(READYd,rootyaw=yaw)
            x['s2y']=-sg*12*math.sin(math.pi*k); x['hy']=sg*14*math.sin(math.pi*min(1,k*1.4))   # head leads, chest follows
            lead,trail=('l','r') if sg>0 else ('r','l')
            ka=ss((t-0.05)/0.35); kb=ss((t-0.35)/0.4)
            feet={}
            for sd,kk in ((lead,ka),(trail,kb)):
                ang=90*sg*kk-yaw                                     # world heading of this foot minus the root's
                base=FE_RDY[sd]; m=M.Rotation(R(ang),4,'Z')@base; m.translation=M.Rotation(R(ang),3,'Z')@base.translation
                m.translation.z+=0.07*math.sin(math.pi*kk); feet[sd]=m
            return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
        fk_clip(name,0.8,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes=f'Turn in place 90 deg {"left" if sg>0 else "right"}, stepping (root rotation; the feet do not skate).')
    # stop from a run: lean back, two short braking steps, settle at the ready
    RUNP=dict(stance('port'),**LIMBS0); RUNP.update(armL=1,armR=1,legs=1,s1p=6,s2p=5,hp=-6,pz=-0.08)
    keys=[(0.0,RUNP,'s'),(0.25,dict(RUNP,pp=-8,s2p=-4,pz=-0.14),'o'),(0.5,dict(READYd,pz=-0.06),'s'),(0.8,READYd,'s')]
    def tl(t):
        x=segs(t,keys); x['rooty']=-(1.2*(1-math.exp(-t/0.18)))
        f1=ss(t/0.2); f2=ss((t-0.2)/0.25)
        feet={'l':foot_mat('l',(0,0.25*(1-f1)-0.25*f1*0+(-0.0),0.06*math.sin(math.pi*f1)),pitch=-10*(1-f1)),'r':foot_mat('r',(0,0.30*(1-f2),0.06*math.sin(math.pi*f2)))}
        for sd in 'lr': feet[sd].translation.y+= 1.2*(1-math.exp(-t/0.18)) - 1.2*(1-math.exp(-min(t,0.45)/0.18))
        return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
    fk_clip('run_stop',0.8,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes='Stops from a run: leans back, two braking steps, settles at the ready (root motion ~1.2 m).')
    # dive sideways to cover: push off, fly, land on the side and roll to prone-ish
    for name,sg in (('dive_left',1),('dive_right',-1)):
        def tl(t,sg=sg):
            g=9.81; up=2.2; tl_=2*up/g; tf=min(t,tl_)
            x=dict(AIMd); x['rootx']=sg*(2.6*tf+(0.4*(1-math.exp(-(t-tl_)/0.12)) if t>tl_ else 0)); x['rootz']=max(0.0,up*tf-0.5*g*tf*tf)
            k=ss(t/0.15); fl=math.sin(math.pi*min(1,t/tl_)) if t<tl_ else 0; land=ss((t-tl_)/0.25)
            x.update(pr=sg*75*min(1,t/tl_)+sg*10*land,pz=-0.25*k-0.5*land,legs=1-k,s2r=sg*10*fl,tlp=-40*fl,trp=-20*fl,clp=60*fl,crp=40*fl)
            return x,AIMFEET,dict(armL=1,armR=1,legs=x['legs']),fk_of(x)
        fk_clip(name,1.2,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes=f'Dives to the {"left" if sg>0 else "right"} away from a grenade or fire, lands on his side with the rifle up (root motion ~2.5 m).')
    # vault a 1 m wall: left hand on top, legs swing over, land and continue
    H=1.0
    keys=[(0.0,dict(READYd,rooty=0,rootz=0),'s'),(0.25,dict(READYd,rooty=-0.25,rootz=0,pz=-0.12,pp=10),'s'),
          (0.5,dict(READYd,rooty=-0.6,rootz=0.55,pz=-0.30,pp=18,pr=-12,legs=0.0,tlp=-80,trp=-70,clp=90,crp=80,tlr=-20,trr=-20),'o'),
          (0.75,dict(READYd,rooty=-1.0,rootz=0.40,pz=-0.30,pp=10,pr=-8,legs=0.0,tlp=-40,trp=-30,clp=50,crp=40),'i'),
          (0.95,dict(READYd,rooty=-1.4,rootz=0.0,pz=-0.18,pp=8,legs=1),'s'),(1.3,dict(READYd,rooty=-1.6,rootz=0.0),'s')]
    def tl(t):
        x=segs(t,keys); ry,rz=x['rooty'],x['rootz']
        on=ss((t-0.25)/0.12)*(1-ss((t-0.7)/0.12))
        if on>0.01:
            bpy.context.view_layer.update(); ongun=P['ctrl_hand_l'].matrix.copy()
            top=hmat('l',(0.18,-0.75-ry,H+0.02-rz),pitch=-90)
            x['handL']=M.Translation(ongun.translation.lerp(top.translation,on))@ongun.to_quaternion().slerp(top.to_quaternion(),on).to_matrix().to_4x4()
        ik=1.0 if t<0.4 or t>0.9 else 0.0
        return x,AIMFEET if t>0.9 else FE_RDY,dict(armL=1,armR=1,legs=ik if t<0.4 or t>0.95 else x['legs']),fk_of(x)
    fk_clip('vault',1.3,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Vaults a 1 m wall: left hand on top, legs swing over, lands and moves on. Blaster kept in the right hand (root motion 1.6 m).')

def reaction_clips():
    for name,sg in (('hit_left',1),('hit_right',-1)):
        keys=[(0.0,AIMd,'s'),(0.06,dict(AIMd,s2y=-sg*20,s3y=-sg*14,s2r=-sg*10,pyw=-sg*10,px=-sg*0.05,hr=-sg*12,gdyaw=-sg*14,gdz=0.03),'o'),(0.3,dict(AIMd,s2y=-sg*6,s2r=-sg*3,px=-sg*0.06),'s'),(0.65,AIMd,'s')]
        def tl(t,keys=keys,sg=sg):
            x=segs(t,keys); st=ss((t-0.05)/0.22); side='r' if sg>0 else 'l'
            feet=dict(AIMFEET); feet[side]=foot_mat(side,((-0.04 if side=='r' else 0.02)-sg*0.12*st,(0.12 if side=='r' else -0.12),0.05*math.sin(math.pi*min(1,max(0,(t-0.05)/0.22)))),yaw=(-25 if side=='r' else 8))
            return x,feet,dict(armL=1,armR=1,legs=1),fk_of(x)
        fk_clip(name,0.65,tl,99,(0,0,0),(0,0,0),None,lhand_on=1,notes=f'Blaster hit from the {"left" if sg>0 else "right"}: twists away and side-steps, recovers.')
    keys=[(0.0,READYd,'s'),(0.12,dict(READYd,pz=-0.42,pp=22,s2p=24,s3p=14,hp=30,armL=0),'o'),(0.85,dict(READYd,pz=-0.40,pp=20,s2p=22,s3p=12,hp=28,armL=0),'s'),(1.25,READYd,'s')]
    def tl(t):
        x=segs(t,keys); k=ss(t/0.12)*(1-ss((t-0.85)/0.3))
        if k>0.01:
            x['handL_rel']=hmat('l',(0.10,-0.06,1.66),pitch=-90,yaw=-30)                   # arm over the helmet
        else: x['armL']=1
        FE={'l':foot_mat('l',(0.05,-0.10*k,0),yaw=10),'r':foot_mat('r',(-0.06,0.14*k,0),pitch=30*k,pivot='ball',yaw=-14)}
        return x,FE,dict(armL=x['armL'] if k<=0.01 else 0,armR=1,legs=1),fk_of(x)
    fk_clip('flinch_duck',1.25,tl,99,(0,0,0),(0,0,0),None,lhand_on=0,notes='Explosion nearby: ducks low, left arm over the helmet, back up.')

getup_clips(); cover_clips(); prone_clips(); move_clips(); reaction_clips()
json.dump(CUTS,open(f'{w}/cuts.json','w'),indent=1)
bpy.context.scene.frame_set(0)
for o in bpy.context.scene.objects: o.select_set(False)
bpy.ops.object.mode_set(mode='OBJECT')
json.dump(STATS,open(f'{w}/anim_stats.json','w'),indent=1)
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/anim.blend')
print('ANIMS',len(STATS))
