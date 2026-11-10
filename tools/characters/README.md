# Character creator

`mpfb_trooper.py` builds an armoured trooper from scratch on the MakeHuman / MPFB base human and writes a pre-rigged
source GLB for `tools/rigging/run.sh` (character.json `"joints": "source"`).

- **Body:** the MakeHuman base mesh shaped with its macro morph targets (gender, age, muscle, weight, height,
  proportions, race mix), blended with MakeHuman's own rules. Helper geometry is dropped.
- **Skeleton:** exact joints from MakeHuman's joint cubes (game-engine rig, Unreal mannequin names), exported under the
  joint names the pipeline reads. Arms are re-posed into the Duke A-pose with MakeHuman's own skin weights.
- **Armour (original):** chest/back/shoulder/arm/leg plates as offset shells of the body (smoothed without shrinking,
  thickened, bevelled), belt with pouches, radio pack, gloves, boots with toe caps, an ellipsoid helmet with a recessed
  visor. One UV atlas; colour, roughness and metal baked to a 2K BaseColor + ORM set.
- **Recipe:** defaults in the script; override with a JSON file (body sliders, colours, texture size).

Only MPFB's CC0 *data* files are read (base mesh, targets, joint cubes, weights); no MPFB code is run.

```
git clone --depth 1 https://github.com/makehumancommunity/mpfb2 <dir>
python -I tools/characters/mpfb_trooper.py <dir>/src/mpfb/data out.glb [recipe.json]
```
