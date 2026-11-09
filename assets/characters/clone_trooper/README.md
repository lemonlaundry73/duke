# Blaster Trooper (Phase II clone trooper + Empire blaster)

Rigged, skinned and animated from the creator's uploaded Phase II clone trooper and blaster models
(this replaced the earlier caped trooper on 2026-11-08; that version is in git history, commit 82e158a). Patrol and combat ready, holding the
blaster in both hands, firing red blaster bolts.

Status: **rigged and animated, validated in Blender and the browser. Not yet imported or tested in Unreal**
(this pack was built in a Linux container with no Unreal Editor). See *Unreal status* below.

## What is here

| Folder | Contents |
|---|---|
| `Source/` | The original uploads, untouched (Tripo-generated GLB, meshopt-compressed): `trooper_armor_source.glb` (came with Tripo's own 80-joint auto-rig, which is discarded), `blaster_source.glb` (Empire blaster); `character.json` (no cape, place the skeleton on the source's joints); `blaster.json` (grip, handguard, muzzle and scale measured on the blaster) |
| `Unreal/SK_Trooper.fbx` | Skeletal mesh: trooper (~85k tris) + Empire blaster (~20k tris) skinned to `weapon_r`. 1.83 m. 64 bones |
| `Unreal/Animations/` | 103 animation FBX files, `A_Trooper_<clip>.fbx`, 30 fps. In place, except the root-motion clips (`roll_to_kneel`, `mantle`, `breach_clear`, `run_stop`, `dive_left`, `dive_right`, `vault`; `turn_l90`/`turn_r90` rotate the root) and the blast deaths (the body travels inside the clip) |
| `Unreal/Cuts/` | 8 dismemberment variants `SK_Trooper_Cut_<clip>.fbx` (same skeleton): remaining body + severed piece(s) with cauterized (saber) or charred (blast) caps. Swap to it at the cut time listed in `cut_variants.json` |
| `Unreal/SM_Blaster.fbx` | The Empire blaster as a static mesh: origin at the pistol grip, muzzle along +X, 0.63 m long |
| `Unreal/Textures/` | 4K BaseColor and Normal (OpenGL; flip green in Unreal) for both; ORM (R occlusion, G roughness, B metallic): 4K for the blaster, a flat map for the trooper from its source values (roughness 0.9, metallic 0), since the source has no roughness texture |
| `Audio/` | Synthesized, no recordings: blaster shots x3 and impact (struck-guy-wire model), explosion, lightsaber hum (loop), swing and burn contact |
| `Web/trooper.glb` | Everything in one GLB: all 103 clips, the trooper, the blaster and decimated cut variants (2K textures). `trooper_web.glb` is the same, meshopt-compressed (8.4 MB) |
| `QA/` | `anim_stats.json` (per-clip IK and foot-slip metrics), `stretch.json` (mesh stretch per clip), `validation.json` (re-import check), renders |

Rebuild everything from `Source/` with `tools/rigging/run.sh <work> <out>`.

## Skeleton

Unreal mannequin naming, so the UE5 IK Retargeter can map it to Manny/Quinn animation:
`root, pelvis, spine_01..03, neck_01, head, clavicle_l/r, upperarm, lowerarm, hand, thumb/index/middle/ring/pinky_01..03, thigh, calf, foot, ball`,
plus `ik_foot_root, ik_foot_l/r, ik_hand_root, ik_hand_gun, ik_hand_l/r` (keyed to match the hands and feet).

Extra bones:
- `weapon_r` (child of `hand_r`): the blaster's grip. The built-in blaster is 100% weighted to it; any other weapon can snap here.
- `muzzle` (child of `weapon_r`): barrel tip. Bolts spawn here.
- `cut_a`, `cut_b` (children of `root`): free bones that carry severed pieces in the dismemberment variants.
- `prop` (child of `root`): crates, datapads, mortar rounds and detonators during duty clips.

## Animation clips

| Group | Clips |
|---|---|
| Patrol | `idle` (low ready, breathing), `patrol_look` (scans left/right), `walk` (1.3 m/s, two-stride loop with a slow head scan; see *Walk* below), `signal_halt`, `signal_moveup`, `tiptoe_walk` (0.7 m/s sneak on the balls of the feet, heels never touch), `tiptoe_peek` (rises onto his toes to see over a wall) |
| Head and neck | `look_left`, `look_right`, `look_up`, `look_down`, `look_tilt_l`, `look_tilt_r` (single poses for an additive look-at), `look_around` (left, up, right, down; loop), `neck_roll` (chin down, ear to shoulder, head back, other shoulder) |
| Hand signs | `count_five` (left hand, palm out: index, middle, ring, pinky, thumb, one at a time, from a fist with the thumb tucked), `beckon` (palm up, the index finger straightens and curls back four times: *come here*) |
| Locomotion | `run` (4.2 m/s, rifle at port, midfoot landing), `sprint` (6.2 m/s, forefoot landing), `jump`, `crouch_walk` (1.0 m/s) |
| Combat stance | `aim`, `aim_walk_fwd` (1.3 m/s), `aim_walk_bwd` (1.1), `aim_strafe_l` / `aim_strafe_r` (1.2), `crouch_aim` |
| Aim offsets | `aim_up`, `aim_down`, `aim_left`, `aim_right` (single poses) |
| Firing | `shoot` (one bolt, loopable), `shoot_burst` (3 bolts), `shoot_hip`, `crouch_shoot` |
| Deaths | `die` (blaster bolt: hit, slow sag to the knees, sway, topple forward, flat), `die_headshot` / `die_headshot_back` (limp while standing, falls nearly straight forward / back, flat), `die_back` (blown back onto his back), `die_run` (momentum into a sliding faceplant). Every death hands over to a physics ragdoll (see below) |
| Injured | `hit_foot` (shot in the foot: jerks it up, hops), `walk_limp` (0.9 m/s, weight off the right leg), `wounded_down`, `wounded_crawl` |
| Squad tactics | `drag_rescuer` + `drag_wounded` (pair: dragging a wounded trooper to cover by the collar; offset in `Unreal/drag_pair.json`), `stack_up`, `breach_clear` (root motion), `stairs_up_aim`, `suppress`, `grenade_throw` |
| Duties | `carry_crate`, `crate_pickup`, `crate_putdown` (logistics; crate on the `prop` bone), `radio_call`, `mortar_load` (artillery), `checkpoint_halt`, `check_credentials`, `inspect_freight` (roadblock), `attention` (port arms, for officers), `command_point`, `command_advance` (officer / sergeant) |
| Getting up | `getup_back` (lying on his back: sits up with feet planted, one knee, rises), `getup_front` (face down / prone: pushes up, knees under, rises), `medic_treat` (kneels over a wounded man, working on his chest) |
| Cover | `cover_low_idle`, `cover_low_fire` (behind a ~1 m wall: crouched, pops up for 3 bolts, back down), `cover_high_idle`, `cover_lean_fire_r`, `cover_lean_fire_l` (tall wall edge: leans out for 3 bolts) |
| Prone | `go_prone`, `prone_aim`, `prone_shoot`, `prone_crawl` (getting up: `getup_front`) |
| Combat movement | `turn_l90`, `turn_r90` (stepping turn in place, root rotation), `run_stop` (braking steps, root motion), `dive_left`, `dive_right` (root motion ~2.5 m), `vault` (1 m wall, root motion 1.6 m) |
| Reactions | `hit_left`, `hit_right` (with `hit_front` / `hit_back`: hits from all four sides), `flinch_duck` (explosion nearby) |
| Other | `reload` (power-cell swap, 2.2 s), `hit_front`, `hit_back`, `melee` (rifle-butt strike) |
| Movement | `roll_to_kneel` (dive roll over the shoulder, up on one knee aiming down the sights, 3 bolts; root motion 2.3 m), `kneel_aim`, `kneel_shoot`, `climb_ladder` (hand over hand, blaster slung on the back, 0.5 m/s loop), `mantle` (1.1 m ledge, one-handed, blaster kept; root motion) |
| Lightsaber | `saber_hit_1`, `saber_hit_2` (burns 1 and 2), then the 3rd contact: `saber_death_arm` (clutches the stump, staggers, knees, falls forward), `saber_death_leg` (topples sideways, rolls onto his back), `saber_death_head` (body stands a beat, knees buckle, falls forward; the head rolls), `saber_death_half` (the legs stand then topple; the upper body slides back off), `saber_death_diagonal` (the upper piece slides down the cut; hips and legs crumple) |
| Explosions | Completely limp and thrown: `death_explosion` (blown back, flips, lands on his back), `death_explosion_arm` (thrown sideways, left arm off), `death_explosion_leg` (launched high, somersault, right leg off), `death_explosion_armleg` (cartwheel, right arm and left leg off) |

Walk: heel strike, then the loading response (the knee flexes and the pelvis sinks), mid-stance (pelvis highest), heel rise as the body rolls over the ball of the foot and the toes bend, and toe-off.
In swing the knee folds the foot up behind, then the hip flexor carries the thigh through and the foot reaches heel-first. The pelvis rotates (7°), lists (5°), bobs about 4 cm and tilts forward at push-off.
The spine segments, neck, head and rifle are driven by damped springs (2–3.4 Hz) from that pelvis motion, so the thorax counter-rotates, the trunk flexes slightly on each heel strike and rebounds,
and the head steadies the gaze with a small lag instead of everything moving in lockstep. The skeleton has no separate arch bone (UE mannequin feet: `foot` and `ball`), so the arch and toe bend are carried by the ankle and the ball joint.

Run and sprint use human running reference: a flight phase, the pelvis lowest at mid-stance and highest in the air, landing under the body,
heel recovery (heel kicks up behind), knee drive and the foot pawing back into contact, with counter-rotating chest and trailing head and rifle (and cape, on caped characters).

Deaths are Call of Duty style: limbs switch from IK to limp FK, falls accelerate like gravity, the body is kept on the floor (never through it) and
bounces and settles on impact, and the blaster is simulated as a rigid body (gravity, bounce, friction, settles on its side). Unreal picks the death
from the hit: running -> `die_run`, head-height hit -> `die_headshot`, shot from behind or heavy damage -> `die_back`, otherwise `die`.

Feet: a heel rocker (land on the heel with the toes lifted, controlled lowering, no slap), a forefoot rocker (the heel rises and the foot rolls over the ball
while the toe bone bends up to ~34° and the toes leave the ground last), ankle push-off, dorsiflexion for toe clearance in the swing, and a slight
inversion/pronation/supination roll through the step. The patrol walk is slower (1.3 m/s) and smoother.

Dismemberment: at the cut the trooper is sliced along the real cut plane (limb cuts limited to that limb); the remaining body keeps its skinning
(weights interpolated across the cut) and both cut faces are capped. Each severed piece rides a free bone (`cut_a`/`cut_b`) simulated with gravity,
bounce and friction, toppling, or sliding down the cut. Collapses rest on the torso and hips, so limp arms lie on the floor instead of propping the body up.

Walks (`walk`, `aim_walk_*`, `aim_strafe_*`, `crouch_walk`) are built from human gait reference: heel strike, foot flat, heel rise and toe push-off;
the swing foot peaks early and reaches before contact; pelvis bob, side drop, rotation, sway and a small forward surge per step;
the spine, head and rifle (and a cape, if the character has one) each trail the pelvis slightly (overlapping action), the head stays level, and the knees stay soft
at one constant height instead of the hips pumping to reach.

How they were made: a control rig (IK arms locked to the blaster, IK legs with knee/elbow pole targets), with
procedurally authored keys. Locomotion feet are planted in world space at the clip's authored speed, and the
pelvis drops automatically wherever a leg would over-extend.

## Death physics (Battlefront / Call of Duty style)

`tools/rigging/ragdoll.py` turns every death into a real rigid-body ragdoll (Blender's Bullet engine) and bakes it into the clip:
- 15 solid parts whose collision shapes are convex hulls of the trooper's own armour; joints with human limits (knees and elbows bend one way).
- Body parts collide with each other and with the floor; the blaster and severed pieces are rigid bodies too.
- The authored hit reaction plays first; at the limp moment physics takes over with the animation's momentum.
- Muscle tone: joint springs hold the posture he is in at that instant and fade, so the body is not a rag while thrown or falling;
  the tone cuts to zero the moment the torso, hips or head reach the ground, so it ends completely limp and flat.
- A grounding pass then guarantees the real skinned mesh rests on the floor (never below it), every frame, in order.

In Unreal, `DukeTrooper` does the same live: at the limp moment it switches the mesh to Unreal's own physics ragdoll with a Physical
Animation component for the fading tone (zero on ground contact), so bodies drape over crates, stairs and slopes. Dismemberment
endings use their baked clips.

## Measured quality (from `QA/`)

- Floor contact (QA/body_qa.json, every frame of every clip, evaluated in order like the FBX bake): the skinned mesh stays within 0.5 cm of the floor surface in 101 of 103 clips; `dive_left` and `dive_right` dip 0.6 and 1.3 cm below it for a few frames as the trailing foot drags through the landing. Every death ends resting on the floor.
- Armour self-intersection (real triangle crossings between non-adjacent body regions, minus what the idle pose already has): 55 of 103 clips within 60 triangles. Worst: `vault` 847, `crate_pickup` 591, `crate_putdown` 577, `flinch_duck` 545, `roll_to_kneel` 491, `mortar_load` 434, `cover_low_fire` 428 (forearm and hand armour against the torso in close-to-the-body poses).
- Hands on the blaster while held: no gap in 84 of 103 clips.
- Re-import check: the FBX has 65 bones, both meshes and materials, and is 1.83 m tall; all 103 animation FBXs and all 8 cut-variant FBXs re-import with keys on every bone; the GLB has all 103 clips.

## Known limits

- The source is a single fused Tripo mesh. Faces where body parts touch (arms at the armpits) were cut apart and holes filled; small seams may show up close.
- Joint positions come from the source's Tripo skeleton; skin weights are Duke's own (bone-distance weighting with per-limb separation and smoothing).
- The trooper's roughness is one flat value from the source (0.9, matte). A painted roughness map would give the armour a more realistic semi-gloss.
- The Empire blaster is scaled to 0.63 m so both hands reach it. Its source has no roughness map either (flat 0.9).
- Severed pieces are rigid (they do not flop); cut caps are flat fills of the cut outline.
- Ladder climbing and the mantle need level geometry that matches (rungs 30 cm apart, a 1.1 m ledge).
- Animations are procedurally keyed from gait reference, not motion-captured.

## Squad AI (Unreal, not compiled here)

- `ADukeSquad`: members with ranks (Officer, Sergeant, Corporal, Trooper) and duties (rifleman, medic, radio, heavy, artillery,
  logistics, checkpoint); chain of command follows rank. Modes: Patrol (staggered file behind the leader), Hold / Roadblock
  (occupation duties), Assault, ClearBuilding (stack, signal, breach one by one).
- Combat: bounding overwatch (half the squad moves cover to cover, the other half lays down covering fire), cover found with
  line traces, the heavy always suppresses, the radio operator calls in contact, the mortar crew fires on the threat's last
  position, buddy rescue (nearest healthy trooper, a medic first, drags the wounded man to cover; a medic patches him up).
- Peace: logistics haul crates between depot and drop-off, the radio operator stays with the officer, the officer inspects
  the posts and troopers stand to attention as he passes.
- `ADukeCheckpoint` + `ADukeTraveller`: travellers queue at the barrier; the gate guard halts them, checks papers, searches the
  freight, then waves them through, detains them, or the squad engages if a rebel draws a weapon.

In combat (`DukeTrooper`): picks low or tall cover by tracing at 60 cm and 150 cm, then crouches and pops up or leans out to
fire; the heavy goes prone to suppress; hit reactions follow the shooter's side; a nearby blast makes him duck; large turns
while standing use the stepping turns; braking out of a run plays `run_stop`; a ~1 m wall in his path is vaulted; a revived
trooper gets up (`getup_back`) before doing anything else; a treating medic plays `medic_treat`.

## Unreal status

Code for the Duke game template (`src/unreal/template`) is in the repo but has **not been compiled or run** here:
- `DukeTrooper` (character: patrol → alert → combat → death AI, bursts of bolts from `muzzle`, reloads, hit reactions, crouch under fire, combat roll into a kneeling position, `Mantle()` and `StartLadderClimb()`, lightsaber hit counter (3rd contact picks an ending from where the blade landed), explosion endings by blast direction, swap to the cut mesh at the cut)
- `DukeDamageTypes` (`UDukeSaberDamageType`, `UDukeExplosionDamageType`)
- `DukeTrooperAnimInstance` (graph-free native anim instance: speed- and direction-matched locomotion blending, cross-fades, aim pitch, upper-body action layer)
- `DukeBlasterBolt` (red emissive bolt with glow, light, impact flash and sound)
- `DukeCharacter` now fires visible bolts for any weapon whose type contains "Blaster", and attaches weapons to `weapon_r` when the mesh has it.
- `Content/Python/duke_trooper_import.py` imports this pack: textures (normal green flip), PBR and bolt materials, skeletal mesh, 31 animations, static blaster, sounds.

To finish on the Windows GPU worker:
1. Copy `Unreal/` and `Audio/` to `<Project>/Import/characters/clone_trooper/`.
2. Build the project, then run `UnrealEditor-Cmd <Project>.uproject -run=pythonscript -script=<Project>/Content/Python/duke_trooper_import.py`.
3. Read `Saved/DukeForge/trooper_import.json` for errors, then place `DukeTrooper` actors (or call `spawn_test_troopers()`) and run PIE.

## Provenance

| Asset | Origin |
|---|---|
| Trooper armor mesh + textures | Creator upload `clone_trooper_armor_3d_model.glb` (Tripo, with Tripo auto-rig; gltfpack 1.2), 2026-11-08 |
| Blaster mesh + textures | Creator upload `final_empire_blaster.glb` (Tripo; gltfpack 1.2), 2026-11-08 |
| Rig, weights, animations, LOD0 reduction | Generated by Duke Forger (`tools/rigging`, Blender 4.5 as a Python module) |
| Blaster sounds | `tools/rigging/blaster_sfx.py`: physical model of a hammer-struck steel guy-wire (dispersive bending waves), the technique behind the classic film blaster. Not Lucasfilm's recordings |
