# Blaster Trooper (clone trooper armor + blaster carbine)

Rigged, skinned and animated from the creator's two uploaded models. Patrol and combat ready, holding the
blaster in both hands, firing red blaster bolts.

Status: **rigged and animated, validated in Blender and the browser. Not yet imported or tested in Unreal**
(this pack was built in a Linux container with no Unreal Editor). See *Unreal status* below.

## What is here

| Folder | Contents |
|---|---|
| `Source/` | The original uploads, untouched (Tripo-generated GLB, meshopt-compressed): `trooper_armor_source.glb`, `blaster_source.glb` |
| `Unreal/SK_Trooper.fbx` | Skeletal mesh: trooper (83,861 tris) + blaster (19,996 tris) skinned to `weapon_r`. 1.83 m. 74 bones |
| `Unreal/Animations/` | 28 animation FBX files, `A_Trooper_<clip>.fbx`, 30 fps, in place (no root motion) |
| `Unreal/SM_Blaster.fbx` | The blaster as a static mesh: origin at the pistol grip, muzzle along +X, 0.61 m long |
| `Unreal/Textures/` | 4K PBR sets for both: BaseColor, ORM (R occlusion, G roughness, B metallic), Normal (OpenGL; flip green in Unreal) |
| `Audio/` | Procedurally synthesized blaster shots (3 variations) and an impact. No third-party samples |
| `Web/trooper.glb` | Everything in one GLB with all 28 clips (2K textures) for web preview |
| `QA/` | `anim_stats.json` (per-clip IK and foot-slip metrics), `stretch.json` (mesh stretch per clip), `validation.json` (re-import check), renders |

Rebuild everything from `Source/` with `tools/rigging/run.sh <work> <out>`.

## Skeleton

Unreal mannequin naming, so the UE5 IK Retargeter can map it to Manny/Quinn animation:
`root, pelvis, spine_01..03, neck_01, head, clavicle_l/r, upperarm, lowerarm, hand, thumb/index/middle/ring/pinky_01..03, thigh, calf, foot, ball`,
plus `ik_foot_root, ik_foot_l/r, ik_hand_root, ik_hand_gun, ik_hand_l/r` (keyed to match the hands and feet).

Extra bones:
- `weapon_r` (child of `hand_r`): the blaster's grip. The built-in blaster is 100% weighted to it; any other weapon can snap here.
- `muzzle` (child of `weapon_r`): barrel tip. Bolts spawn here.
- `cape_01..04_c/_l/_r`: three cape chains (centre, left, right) for cloth sway.

## Animation clips

| Group | Clips |
|---|---|
| Patrol | `idle` (low ready, breathing), `patrol_look` (scans left/right), `walk` (1.4 m/s), `signal_halt`, `signal_moveup` |
| Locomotion | `run` (4.2 m/s, rifle at port), `sprint` (6.2 m/s), `jump`, `crouch_walk` (1.0 m/s) |
| Combat stance | `aim`, `aim_walk_fwd` (1.3 m/s), `aim_walk_bwd` (1.1), `aim_strafe_l` / `aim_strafe_r` (1.2), `crouch_aim` |
| Aim offsets | `aim_up`, `aim_down`, `aim_left`, `aim_right` (single poses) |
| Firing | `shoot` (one bolt, loopable), `shoot_burst` (3 bolts), `shoot_hip`, `crouch_shoot` |
| Other | `reload` (power-cell swap, 2.2 s), `hit_front`, `hit_back`, `die` (falls backward), `melee` (rifle-butt strike) |

How they were made: a control rig (IK arms locked to the blaster, IK legs with knee/elbow pole targets), with
procedurally authored keys. Locomotion feet are planted in world space at the clip's authored speed, and the
pelvis drops automatically wherever a leg would over-extend.

## Measured quality (from `QA/`)

- Hands on the blaster: max gap 0.0 cm in 25 of 28 clips; 0.9 cm in `hit_back`, 1.1 cm in `shoot_hip`, 4.4 cm briefly during the `melee` swing.
- Foot targets reached in every clip (max gap 0.01 cm), except 1.5 cm during the `melee` step.
- Planted-foot slip at the authored speed: 0.0–4.2 cm/s for walk, aim-walks, strafes, crouch-walk and run; 14.6 cm/s peak in `sprint` (fast toe-off frames).
- Mesh stretch (edges stretched over 3× versus idle): under 40 edges (of ~125k) in 23 of 28 clips, 0 in `idle` and `walk`;
  51–94 in `melee`, `run`, `aim_down`, `sprint` and `die`, where the waist bends furthest.
- Re-import check: the FBX has 74 bones, both meshes and materials, and is 1.83 m tall; all 28 animation FBXs re-import with keys on every bone; the GLB has all 28 clips.

## Known limits

- The source is a single fused scan-style mesh (Tripo). Contact areas (hands on thighs, helmet rim on collar, cape on belt)
  were cut apart and holes filled. Small seams may show up close.
- The cape is skinned to bone chains and animated by hand, not cloth-simulated. In Unreal you can add Chaos Cloth to the cape section.
- Fingers are weighted by position bands on a fused glove, so finger curls are approximate.
- The blaster was scaled to 0.61 m (a carbine) so both hands can reach it with this model's arm length.
- Animations are procedurally keyed, not motion-captured.

## Unreal status

Code for the Duke game template (`src/unreal/template`) is in the repo but has **not been compiled or run** here:
- `DukeTrooper` (character: patrol → alert → combat → death AI, bursts of bolts from `muzzle`, reloads, hit reactions, crouch under fire)
- `DukeTrooperAnimInstance` (graph-free native anim instance: speed- and direction-matched locomotion blending, cross-fades, aim pitch, upper-body action layer)
- `DukeBlasterBolt` (red emissive bolt with glow, light, impact flash and sound)
- `DukeCharacter` now fires visible bolts for any weapon whose type contains "Blaster", and attaches weapons to `weapon_r` when the mesh has it.
- `Content/Python/duke_trooper_import.py` imports this pack: textures (normal green flip), PBR and bolt materials, skeletal mesh, 28 animations, static blaster, sounds.

To finish on the Windows GPU worker:
1. Copy `Unreal/` and `Audio/` to `<Project>/Import/characters/clone_trooper/`.
2. Build the project, then run `UnrealEditor-Cmd <Project>.uproject -run=pythonscript -script=<Project>/Content/Python/duke_trooper_import.py`.
3. Read `Saved/DukeForge/trooper_import.json` for errors, then place `DukeTrooper` actors (or call `spawn_test_troopers()`) and run PIE.

## Provenance

| Asset | Origin |
|---|---|
| Trooper armor mesh + textures | Creator upload `clone_trooper_armor_3d_model_2.glb` (Tripo; gltfpack 1.2), 2026-11-01 |
| Blaster mesh + textures | Creator upload `assault_rifle_3d_model.glb` (Tripo; gltfpack 1.2), 2026-11-01 |
| Rig, weights, animations, LOD0 reduction | Generated by Duke Forger (`tools/rigging`, Blender 4.5 as a Python module) |
| Blaster sounds | Synthesized by `tools/rigging/blaster_sfx.py` (no samples) |
