# soumetsu-assets

The icons, wish art and game data for [soumetsu](../soumetsu).

```sh
npm run fetch    # after a game patch: new data and originals from nanoka into assets-src/
npm run build    # assets-src/ -> dist/ (WebPs and data JSON)
```

Paste the printed `export const ASSETS = '...'` into the site's `src/lib/assets.ts`. Each upload has
its own folder and old folders stay, so a deployed site keeps working until you point it at a new one.

## Layout

- `assets-src/data/`: game data JSON, written by fetch.
- `assets-src/icons/<kind>/`, `assets-src/wish/<id>/`: the originals, written by fetch.
- `assets-src/wish/alignments.json`: where each close-up sits in its splash (see `scripts/wish-art.ts`).
- `dist/` (ignored): what gets uploaded.
