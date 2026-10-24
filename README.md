# soumetsu-assets

The icons, wish art and game data for [soumetsu](../soumetsu).

```sh
npm run fetch    # after a game patch: new data and originals from nanoka into assets-src/
npm run build    # assets-src/ -> dist/ (WebPs and data JSON)
```

fetch also cuts the masks for new characters' cutouts, which needs macOS.

Paste the printed `export const ASSETS = '...'` into the site's `src/lib/assets.ts`. Each upload has
its own folder and old folders stay, so a deployed site keeps working until you point it at a new one.

## Layout

- `assets-src/data/`: game data JSON, written by fetch.
- `assets-src/icons/<kind>/`, `assets-src/wish/<id>/`: the originals, written by fetch.
- `assets-src/wish/alignments.json`: where each close-up sits in its splash (see `scripts/wish-art.ts`).
- `assets-src/wish/<id>/mask.png`, `assets-src/wish/masks.json`: the cutouts' masks, and the framing
  each was cut from.
- `dist/` (ignored): what gets uploaded. The cutouts are in `dist/art/cutout/`, and
  `dist/data/cutouts.json` lists which characters have one.
- `.cache/` (ignored): the segmentation model, downloaded by fetch.

## Cutouts

A cutout is a character's wish art with only the character left. When one keeps part of the scene:

- Fix the mask by hand: paint `assets-src/wish/<id>/mask.png` white where the character is and black
  where they aren't (laying it over `dist/art/wish/<id>.webp` helps), then build.
- Or skip the character: add them to `NO_CUTOUT` in `scripts/wish-art.ts`.

fetch keeps a mask until the art is framed differently, after a new alignment or a change to `ZOOM`.
Then it cuts the mask again and says so, and any hand fix has to be redone. Delete a mask to cut it
again.
