# Sky Maker

Turns one picture into a Minecraft **1.8.9** custom sky resource pack (MCPatcher / OptiFine format).
Everything runs in your browser. Your picture is never uploaded anywhere.

**Use it:** https://alphahylian.github.io/sky-maker/

Process credit: [@banjeerl on YouTube](https://www.youtube.com/watch?v=_5QU1cXuSnE).

## How to use it

1. **Upload.** Drop an image on the page. Every step below runs automatically.
2. **Preview.** The big view is a 3D skybox. Drag to look around and scroll to zoom. The buttons jump to each face.
   You can turn on overlays: the eye-level line (the horizon belongs on it), cube edges (to check seams), a compass,
   and the vanilla sun and moon. The time slider moves the vanilla sun and moon. "Spin" turns the sky the way
   `sky3.properties` (`rotate=true`) does during the day. Under the 3D view you see the flat 3072 x 2048 texture
   (`cloud1.png`) with the square labels, and the prepared picture.
3. **Fix.** Tick a problem to apply its automatic fix. The fix's sliders then appear. Each fix has **Undo this fix**,
   and **Undo last change** (or Ctrl+Z) steps back through every change.
4. **Export.** Type a pack name and click **Download resource pack**. Put the zip in `.minecraft/resourcepacks`.
   It needs OptiFine (Custom Sky on) or MCPatcher.

### What runs automatically on upload

| Step | What the tool does |
|---|---|
| Clean the edges | Removes black letterbox rows/columns and 1-4 px edge rows that differ from the rows next to them |
| Place the horizon | Finds the horizon and moves it a little under the middle, to `H/2 + 1.5 % of H` |
| Fill the gaps | Fills the empty rows by mirroring the rows next to them (like reflecting water) |
| Make the cube | Projects the prepared picture onto a cube at 1024 px per square |
| Lay out the template | Writes each pixel straight into the 3x2 layout, using MCPatcher's own face geometry. The picture's centre goes on **Front** (north) |
| Blend the seam | Mirrors the brighter side across the wrap-around border and fades it in over 256 px on each side, on Back, Top and Bottom |
| Clean the poles | Smooths a small disc at the centre of Top and Bottom ("ghost pixels") |
| Save | `cloud1.png` is an RGBA PNG, 3072 x 2048 |
| Pack | Exported as the day sky, `assets/minecraft/mcpatcher/sky/world0/cloud1.png` |

### Problems you can tick

| Problem | Automatic correction | Settings afterwards |
|---|---|---|
| Visible seams between faces | Turns the seam blend on, or widens it by 1.5x | blend on/off, blend width, side to keep (auto = brighter, left, right) |
| Horizon too high or too low | Detects the horizon again and resets its position | horizon position (higher/lower), where the horizon is in your picture |
| Sky rotated wrong | Turns the sky 180 degrees | rotation, 0-359 degrees |
| Image stretched or squished | Sets the vertical scale so 1 px is the same angle both ways. Images narrower than 3:2 use "mirror" coverage | vertical scale, coverage (stretch once around / image plus mirrored copy) |
| Too dark or too bright | Sets gamma so the average brightness is mid-grey | gamma, brightness, contrast, saturation |
| Upside down or mirrored | Flips vertically if the bottom is clearly brighter than the top, otherwise mirrors left and right | flip upside down, mirror left/right |
| Sun / moon in a bad spot | Finds a painted sun and turns the sky so it faces east (where the vanilla sun rises) and tones it down. This overrides the rotation | direction to face, tone-down amount |
| Odd line or black pixels at the image edge | Trims 4 more pixels from each side | auto-trim on/off, extra pixels |
| Bottom looks obviously mirrored | Cross-fades 48 rows at the mirror line | cross-fade rows |
| White "ghost pixels" / pinch at the top or bottom centre | Doubles the clean-up radius (minimum 48 px) | clean-up radius |

## The exported zip

The zip's root is the pack, so it works dropped straight into `resourcepacks`:

```
pack.mcmeta                                   {"pack": {"pack_format": 1, "description": "<your pack name>"}}
pack.png                                      128 x 128, cropped from your picture
assets/minecraft/mcpatcher/color.properties
assets/minecraft/mcpatcher/sky/world0/cloud1.png        <- your sky, 3072 x 2048 RGBA
assets/minecraft/mcpatcher/sky/world0/cloud2.png        \
assets/minecraft/mcpatcher/sky/world0/starfield01.png    |  copied unchanged from template/
assets/minecraft/mcpatcher/sky/world0/starfield03.png    |  (sunrise/sunset glow, night stars, sun flare)
assets/minecraft/mcpatcher/sky/world0/sky_sunflare.png   |
assets/minecraft/mcpatcher/sky/world0/sky1..4,6..8.properties  /
```

## The template

Everything in [template/](template) is drawn by [scripts/make-template.js](scripts/make-template.js), so the
project has no third-party art. It keeps the usual MCPatcher sky format: the same file names, image sizes and
`.properties` timings.

| File | Size | What it is | When it shows |
|---|---|---|---|
| `Sky Template 1024x1024.png` | 3072 x 2048 | Layout guide: which square goes where | (not in the pack) |
| `cloud1.png` | 800 x 600 | Placeholder, replaced by your sky | Day (`sky3`, replace) |
| `cloud2.png` | 800 x 600 | Warm glow along the horizon | Sunrise and sunset (`sky1`, `sky2`, add) |
| `starfield01.png` | 2304 x 1536 | Star field | Night (`sky4`, add) |
| `starfield03.png` | 800 x 600 | Faint blue night tint with a few stars | Night (`sky6`, add) |
| `sky_sunflare.png` | 1536 x 1024 | Flare around the sun | Sunrise and sunset (`sky7`, `sky8`, add) |

The "add" layers are black wherever they should not change the sky. To change them, edit the script and run
`npm run template`.

## Run it on your computer

You need [Node.js](https://nodejs.org) 18 or newer. Nothing needs installing.

```bash
npm start
```

Then open http://127.0.0.1:8000. (Opening `index.html` straight from disk does not work: browsers block the
background worker on `file://` pages.)

## Checks

```bash
npm test
```

- `tests/geometry.test.js`: the 3x2 face layout matches MCPatcher's renderer and the template labels.
- `tests/pipeline.test.js`: trimming, horizon detection and placement, mirror fill, seam blend, the default
  rotation (picture centre on Front), output sizes, and every automatic fix.
- `tests/pack.test.js`: the zip's file tree, `cloud1.png` at 3072 x 2048 RGBA, the other template files copied
  byte for byte, `pack.mcmeta` and `pack.png`.
- `tests/template.test.js`: the template's files, image sizes and `.properties` sources.

## How it works

- `index.html`: the page. Upload, controls, undo, and the 3D preview drawn with [three.js](https://threejs.org)
  using the same squares and rotations as MCPatcher.
- `src/worker.js`: runs the image work in a background thread so the page stays responsive.
- `src/pipeline.js`: the image processing and automatic fixes.
- `src/geometry.js`: MCPatcher's 3x2 sky geometry (which direction each pixel faces).
- `src/image.js`: small image helpers (resize, blur, flip).
- `src/png.js`: PNG writer and reader. `src/pack.js`: builds the resource pack zip.
- `src/testimage.js`: synthetic test picture for the tests.
- `vendor/fflate.js`: zip and compression library ([fflate](https://github.com/101arrowz/fflate), MIT).

## Design decisions

1. **pack_format 1**, for Minecraft 1.8.9.
2. **Your sky replaces `cloud1.png`**, the main day layer (`sky3.properties`, `blend=replace`, 5:30-18:40). Its
   size is 3072 x 2048, as in the layout guide.
3. **Facing.** The picture's centre goes on the **Front** square (north). The picture's left and right edges meet
   on Back (south), which is where the seam blend works. The rotation slider turns this.
4. **Projection.** The prepared picture is read as a full 360 x 180 degree panorama, whatever its aspect ratio, so
   a 16:9 picture fills all six squares.
5. **"A little under the middle"** is +1.5 % of the image height.
6. **Smooth blend.** The seam blend is a smooth falloff with a 256 px half-width (scaled with square size).
7. **Sun and moon.** The vanilla sun rises in the east and sets in the west, so the fix turns a painted sun to face
   east or west.
8. **Square size** defaults to 1024. 256, 512 and 2048 are offered; 2048 needs a GPU that allows 6144 px textures
   for the preview.
9. **pack.png** is a 128 x 128 centre crop of your picture.

## Limits

- **Hand judgement while blending.** A person blending by hand can erase selectively. The tool uses one even
  falloff plus a width slider and a side choice.
- **Picking a good source image** is up to you. The tool works best with sky on top and water or ground on the
  bottom.
- Pictures wider than 4096 px are scaled down to 4096 px first.
