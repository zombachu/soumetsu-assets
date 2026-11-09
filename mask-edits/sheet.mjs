// Contact sheet: for each id, the wish art and the cutout over a solid colour, side by side, in rows
// of COLS (default: one row). H sets the tile height.
// Usage: [COLS=4] [H=440] node sheet.mjs <out.jpg> <id>...
import sharp from 'sharp';
import { join } from 'node:path';
const A = join(import.meta.dirname, '..');
const [out, ...ids] = process.argv.slice(2);
const H = Number(process.env.H ?? 560); // tile height
const COLS = Number(process.env.COLS ?? Infinity);
const tiles = [];
for (const id of ids) {
  const art = join(A, 'dist/art/wish', id + '.webp');
  const cut = join(A, 'dist/art/cutout', id + '.webp');
  const m = await sharp(art).metadata();
  const w = Math.round(m.width * H / m.height);
  const a = await sharp(art).resize(w, H).flatten({ background: '#000' }).png().toBuffer();
  const c = await sharp(cut).resize(w, H).flatten({ background: '#2bd94a' }).png().toBuffer();
  const label = Buffer.from(`<svg width="${2*w+6}" height="28"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="21" font-size="20" font-family="Helvetica">${id}</text></svg>`);
  tiles.push(await sharp({ create: { width: 2*w+6, height: H+28, channels: 3, background: '#fff' } })
    .composite([{ input: label, left: 0, top: 0 }, { input: a, left: 0, top: 28 }, { input: c, left: w+6, top: 28 }]).png().toBuffer());
}
const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
const comp = [];
let x = 0, y = 0, W = 0;
for (let i = 0; i < tiles.length; i++) {
  if (i && i % COLS === 0) { x = 0; y += H + 38; }
  comp.push({ input: tiles[i], left: x, top: y });
  x += metas[i].width + 10;
  W = Math.max(W, x);
}
await sharp({ create: { width: W, height: y + H + 28, channels: 3, background: '#888' } }).composite(comp).jpeg({ quality: 85 }).toFile(out);
