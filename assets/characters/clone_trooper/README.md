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
| `Unreal/Animations/` | 47 animation FBX files, `A_Trooper_<clip>.fbx`, 30 fps. In place, except `roll_to_kneel` and `mantle` (root motion) and the blast deaths (the body travels inside the clip) |
| `Unreal/Cuts/` | 8 dismemberment variants `SK_Trooper_Cut_<clip>.fbx` (same skeleton): remaining body + severed piece(s) with cauterized (saber) or charred (blast) caps. Swap to it at the cut time listed in `cut_variants.json` |
| `Unreal/SM_Blaster.fbx` | The Empire blaster as a static mesh: origin at the pistol grip, muzzle along +X, 0.63 m long |
| `Unreal/Textures/` | 4K BaseColor and Normal (OpenGL; flip green in Unreal) for both; ORM (R occlusion, G roughness, B metallic): 4K for the blaster, a flat map for the trooper from its source values (roughness 0.9, metallic 0), since the source has no roughness texture |
| `Audio/` | Synthesized, no recordings: blaster shots x3 and impact (struck-guy-wire model), explosion, lightsaber hum (loop), swing and burn contact |
| `Web/trooper.glb` | Everything in one GLB: all 47 clips, the trooper, the blaster and decimated cut variants (2K textures). `trooper_web.glb` is the same, meshopt-compressed (6 MB) |
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

## Animation clips

| Group | Clips |
|---|---|
| Patrol | `idle` (low ready, breathing), `patrol_look` (scans left/right), `walk` (1.4 m/s, two-stride loop with a slow head scan), `signal_halt`, `signal_moveup` |
| Locomotion | `run` (4.2 m/s, rifle at port, midfoot landing), `sprint` (6.2 m/s, forefoot landing), `jump`, `crouch_walk` (1.0 m/s) |
| Combat stance | `aim`, `aim_walk_fwd` (1.3 m/s), `aim_walk_bwd` (1.1), `aim_strafe_l` / `aim_strafe_r` (1.2), `crouch_aim` |
| Aim offsets | `aim_up`, `aim_down`, `aim_left`, `aim_right` (single poses) |
| Firing | `shoot` (one bolt, loopable), `shoot_burst` (3 bolts), `shoot_hip`, `crouch_shoot` |
| Deaths | `die` (chest hit: stagger, knees give, faceplant), `die_back` (blown back two steps onto his back), `die_headshot` (instant limp crumple onto his side), `die_run` (momentum carries him ~1.3 m into a sliding faceplant). In all four the arms go limp and the blaster leaves his hands and tumbles to the floor |
| Other | `reload` (power-cell swap, 2.2 s), `hit_front`, `hit_back`, `melee` (rifle-butt strike) |
| Movement | `roll_to_kneel` (dive roll over the shoulder, up on one knee aiming down the sights, 3 bolts; root motion 2.3 m), `kneel_aim`, `kneel_shoot`, `climb_ladder` (hand over hand, blaster slung on the back, 0.5 m/s loop), `mantle` (1.1 m ledge, one-handed, blaster kept; root motion) |
| Lightsaber | `saber_hit_1`, `saber_hit_2` (burns 1 and 2), then the 3rd contact: `saber_death_arm` (clutches the stump, staggers, knees, falls forward), `saber_death_leg` (topples sideways, rolls onto his back), `saber_death_head` (body stands a beat, knees buckle, falls forward; the head rolls), `saber_death_half` (the legs stand then topple; the upper body slides back off), `saber_death_diagonal` (the upper piece slides down the cut; hips and legs crumple) |
| Explosions | Completely limp and thrown: `death_explosion` (blown back, flips, lands on his back), `death_explosion_arm` (thrown sideways, left arm off), `death_explosion_leg` (launched high, somersault, right leg off), `death_explosion_armleg` (cartwheel, right arm and left leg off) |

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

## Measured quality (from `QA/`)

- Hands on the blaster while held: no gap in 37 of 47 clips; worst 5.1 cm (`melee` swing).
- Planted-foot slip at the authored speed: 0.9–9.5 cm/s across walks, strafes, run and sprint.
- Mesh stretch (edges over 3x versus idle, of ~125k): walk 0, run 26, sprint 20; 26 of 47 clips under 40.
- Dismemberment: 8 variants; every ending's body lies 13–30 cm off the floor at rest (body thickness), none propped or floating.
- Re-import check: the FBX has 64 bones, both meshes and materials, and is 1.83 m tall; all 47 animation FBXs and all 8 cut-variant FBXs re-import with keys on every bone; the GLB has all 47 clips.

## Known limits

- The source is a single fused Tripo mesh. Faces where body parts touch (arms at the armpits) were cut apart and holes filled; small seams may show up close.
- Joint positions come from the source's Tripo skeleton; skin weights are Duke's own (bone-distance weighting with per-limb separation and smoothing).
- The trooper's roughness is one flat value from the source (0.9, matte). A painted roughness map would give the armour a more realistic semi-gloss.
- The Empire blaster is scaled to 0.63 m so both hands reach it. Its source has no roughness map either (flat 0.9).
- Severed pieces are rigid (they do not flop); cut caps are flat fills of the cut outline.
- Ladder climbing and the mantle need level geometry that matches (rungs 30 cm apart, a 1.1 m ledge).
- Animations are procedurally keyed from gait reference, not motion-captured.

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
