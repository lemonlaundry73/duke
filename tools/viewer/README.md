# Character preview site

`build_pages.py <out dir>` builds the browser preview from the finalized packs in `assets/characters/`:
`index.html` (Empire trooper), `ally.html` (Alliance trooper), `jedi.html` (Jedi), `battle.html` (squad battle),
plus base64 GLBs and the game sound effects. `wrap_*.html` are the same pages with a document head, used for the
published artifact (ally.html and jedi.html are published from `wrap_ally.html` / `wrap_jedi.html`).

Controls sit in the side rail (under the view on phones), so nothing covers the viewport. **Follow cam** (on by
default) glides the camera after the character; on the battle page it follows the squad's centre, or one trooper
when you click their roster row.

Headless check: serve the out dir on port 8768, then
`node shot_pages.cjs <shots dir> <dir with node_modules/three> "wrap_jedi.html:#bDraw@2500" ...`
