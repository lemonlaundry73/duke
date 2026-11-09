# Jedi (Jamie)

Your Jedi, rigged on the same 65-bone Duke skeleton as the troopers, with the same physics:
- live ragdoll with muscle tone that fades on the way down and limp on the ground
- floor contact and no sinking
- dismemberment endings

He has a lightsaber and the Force instead of a blaster.

## Source

- **Model:** `Source/trooper_armor_source.glb` is the uploaded `Jamie_Jedi_.glb`: an unrigged Tripo T-pose, facing +X.
- **`tools/rigging/tpose_prep.py`** detects his joints from the mesh:
  - shoulders, elbows and wrists (where bare skin starts on the base-colour texture)
  - each finger and the thumb
  - hips, knees, ankles, toes, neck and head
- It then lowers the arms into the trooper's rest A-pose with smooth blend weights. Every clip, grip and death authored for the troopers fits him unchanged.
- **Proportions:** his arms are about 20% shorter than the trooper's (fingertip span 1.52 m at 1.83 m tall). The saber positions are kept within his reach automatically: `reach_clamp` in `anims.py`.

## Lightsaber

- **Resting place:** hanging from the belt on the **right hip**, emitter up. A cross-draw from the left hip is out of his reach.
- **`draw_saber`:** the right hand takes the hilt from the belt, brings it up and ignites the blade (0.9–1.1 s). He ends in the two-handed guard.
- **`holster_saber`:** the reverse. The blade switches off, the hilt goes back on the belt and the hands relax.
- **Blade:** 0.95 m, blue. It sits on its own `blade` bone (child of `weapon_r`); ignition is the bone's scale along its length.
  - Emissive core plus a translucent glow shell.
  - Unreal materials `M_SaberBlade_Core` / `M_SaberBlade_Glow` (colour parameter).
- **Dropped hilt:** a hilt dropped in a death switches off and falls as a 0.5 kg rigid body.
- **Hilt model: PLACEHOLDER.** `Lightsaber.zip` on Google Drive is 172 MB, and the Drive connector only downloads files up to 10 MB. Until the hilt model is uploaded directly, `tools/rigging/saber_hilt.py` generates a procedural hilt with the same contract (`Source/blaster.json`: hilt along +Z, grip, second-hand hold, emitter). Swapping in the real hilt means:
  1. put its GLB/FBX in `Source/` as `blaster_source.glb`/`.fbx`
  2. fill in its grip, hold and emitter points
  3. rebuild

## Lightsaber form

He fights **one-handed**: saber in the right hand, the left hand free for balance and the Force.
- **Guard:** held out to the sword side at chest height, blade up and forward.
- **Swing paths:** arc out away from the body.
- **Why one-handed:** with his arm length (about 20% shorter than the trooper's) and his bulky tunic, a two-handed waist-height grip drove his sleeves and hands through the tunic. Measured on the guard: 380 overlapping triangles with two hands, 0 with one.
- **Reach limit:** out-of-reach targets come back toward the shoulder along the same line, so the arm extends instead of folding into the body.
- **Switching back:** set `saber_hands` to 2 in `Source/character.json` for a two-handed grip.

## Clips (Jedi-specific)

| Group | Clips |
|---|---|
| Holstered | `idle`, `patrol_look`, `walk` (natural arm swing), `walk_limp`, `run`, `sprint` (arms pumping) |
| Saber | `draw_saber`, `holster_saber`, `aim` (= two-handed guard idle), `aim_walk_fwd/bwd`, `aim_strafe_l/r` (guard footwork), `saber_run` (blade lit, trailing) |
| Attacks | `saber_attack_1` (forehand diagonal, strike 0.42 s), `saber_attack_2` (rising slash from the sword side, 0.40 s), `saber_attack_3` (overhead, 0.50 s), `saber_thrust` (0.38 s) |
| Defence | `saber_block_high`, `saber_block_l`, `saber_block_r`, `saber_deflect_l`, `saber_deflect_r`, `saber_deflect_high` |
| The Force | `force_push` (palm thrust, peak 0.40 s), `force_pull` (reach, close the fist at 0.45 s, pull) |
| Shared with the troopers | deaths (`die`, headshots, `die_back`, `die_run`, the four blasts, the five lightsaber endings), hit reactions, roll to kneel, climb, mantle, vault, dives, get-ups, prone, cover idles, head looks, neck roll, counting, beckon, tiptoe |

The trooper clips the Jedi does not have:
- gun firing and reload
- mortar, radio, crates
- checkpoint duties
- squad commands

## Unreal

`ADukeJedi` (`src/unreal/template/Source/DukeGame/DukeJedi.*`, Alliance, `AssetPath` `/Game/DukeForge/Characters/Jedi`):
- **On contact:** draws the saber, closes in and chains the four attacks. Damage lands on the authored strike frame.
- **Bolts:** deflects bolts from the front (85%), often straight back at the shooter.
- **The Force:** pushes two or more enemies in front of him, and pulls a lone distant shooter.
- **Combat over:** holsters after 6 s without an enemy.

**Uncompiled:** there is no Unreal Editor in this build environment. On a Windows PC with Unreal Engine 5, run `python tools/unreal/build_characters.py --ue <UE folder> --project <project folder>`. It copies the packs and code, compiles, imports all three packs, runs the `DukeForge.Characters` automation test and writes a report.
