# soumetsu-assets

The pipeline that makes the icons, wish art and game data for [soumetsu](../soumetsu).

```sh
npm run fetch    # after a game patch: new data and originals from the Genshin Impact Wiki into assets-src/
npm run build    # assets-src/ -> ../soumetsu-cdn/ (the WebPs the site loads) and dist/ (the rest)
```

fetch also cuts the masks for new characters' cutouts, which needs macOS.

build also upscales the originals for each character's art (see `scripts/wish-art.ts`), about 7 s
a character on an M5 Pro: 14 minutes when everything is remade, as after a change to `QUALITY`,
`ZOOM` or `FEATHER`. The upscaler, 4x-AnimeSharp, is downloaded the first time and licensed CC
BY-NC-SA 4.0 (non-commercial).

Paste the printed `export const ASSETS = '...'` into the site's `src/lib/assets.ts`. Each set of files
gets its own folder, named from their contents, and old folders stay, so a deployed site keeps working
until you point it at a new one.

## Layout

- `assets-src/data/`: game data JSON, written by fetch. soumetsu's `npm run data:sync` copies it
  into the site.
- `assets-src/icons/<kind>/`, `assets-src/wish/<id>/`: the originals, written by fetch.
- `assets-src/icons/portraits/`: our copies of prydwen's character icons
  (`cdn.prydwen.gg/images/genshin-impact/characters/<slug>_icon.webp`) for soumetsu's Tier cards,
  each the square of the character's art that prydwen's shows. fetch cuts them from the wiki's
  `<Name> Profile.png` (see `scripts/prydwen.ts`), except two made by hand: `Rosaria.png` is her
  1× cutout at (9, 185), 321 px square, and `Traveler.png`, for every Traveler, is Lumine's
  `Traveler (Female) Portrait.png` at (874, 6), 720 px square, under Aether's
  `Traveler (Male) Portrait.png` at (1695, 150), 799 px square, both drawn at 799 px.
- `assets-src/wish/alignments.json`: where each close-up sits in its splash (see `scripts/wish-art.ts`).
- `assets-src/wish/<id>/mask.png`, `assets-src/wish/masks.json`: the cutouts' masks, and the framing
  each was cut from.
- `../soumetsu-cdn/`: what gets uploaded, all of it loaded by the site: `icons/<kind>/<id>.webp`
  and `art/wish/<id>.webp`.
- `dist/` (ignored): what build makes that the site doesn't load. Each wish art has an `@2x` twin at
  twice the scale in `dist/art/wish/` (`HuTao@2x.webp`). The cutouts and their `@2x` twins are in
  `dist/art/cutout/`, and `dist/data/cutouts.json` lists which characters have one.
- `.cache/` (ignored): the segmentation model, the face detector and the upscaler, downloaded by
  fetch and build.

## Cutouts

A cutout is a character's wish art with only the character left. When one keeps part of the scene:

- Fix the mask by hand: paint `assets-src/wish/<id>/mask.png` white where the character is and black
  where they aren't (laying it over `../soumetsu-cdn/art/wish/<id>.webp` helps), then build. The
  2× cutout uses the same mask, enlarged.
- Or skip the character: add them to `NO_CUTOUT` in `scripts/wish-art.ts`.

fetch keeps a mask until the art is framed differently, after a new alignment or a change to `ZOOM`.
Then it cuts the mask again and says so, and any hand fix has to be redone. Delete a mask to cut it
again.
