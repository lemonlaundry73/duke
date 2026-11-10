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

## Jedi (`mpfb_jedi.py`)

Built from the user's character sheet (`assets/characters/jedi/Source/reference/`): the same CC0 base human (athletic,
mostly African macro mix), his face projected from the sheet's front close-up (fitted to the eyes, isotropic scale) with
a skin tone sampled from the photo, curly hair and a full beard as displaced shells (the beard takes the photo's colours
in front and the hair colour where the jaw turns away), and the outfit modelled on the body: dark-brown wrap tunic with
long sleeves, black leather tabard (sleeveless, open front, long panels), tunic skirt, sash and wide belt with buckle
and pouches, pants, knee-high boots with straps and buckles, gloves and strapped bracers. Skin and cloth that are
always covered are removed (game-asset practice: a hidden layer otherwise pokes through in motion). One 4K set
(BaseColor, ORM, Normal baked from procedural leather grain, creases and fabric).

```
python -I tools/characters/mpfb_jedi.py <dir>/src/mpfb/data assets/characters/jedi/Source/reference/face_front.png out.glb
```
