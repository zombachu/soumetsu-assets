// Zoomed view of a region: art | current out/<id>.png cutout on magenta, with a 10px grid.
// Usage: node zoom.mjs <id> x0 y0 x1 y1 [scale=3] [src=out|orig]
import { join } from 'node:path';
import sharp from 'sharp';
const A = join(import.meta.dirname, '..');
const D = import.meta.dirname;
const [id, ...rest] = process.argv.slice(2);
const meta = await sharp(join(A, 'dist/art/wish', id + '.webp')).metadata();
let [x0, y0, x1, y1] = rest.slice(0, 4).map(Number);
x0 = Math.max(0, x0); y0 = Math.max(0, y0);
x1 = Math.min(meta.width, x1); y1 = Math.min(meta.height, y1);
const k = Number(rest[4] ?? 3);
const src = rest[5] ?? 'out';
const gain = Number(rest[6] ?? 1);
const w = x1 - x0;
const h = y1 - y0;
const art = await sharp(join(A, 'dist/art/wish', id + '.webp'))
    .ensureAlpha()
    .extract({ left: x0, top: y0, width: w, height: h })
    .raw()
    .toBuffer();
const mask = await sharp(join(D, src, id + '.png'))
    .toColourspace('b-w')
    .extract({ left: x0, top: y0, width: w, height: h })
    .raw()
    .toBuffer();
if (gain !== 1) for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) art[p * 4 + c] = Math.min(255, Math.pow(art[p * 4 + c] / 255, 1 / gain) * 255);
const cut = Buffer.from(art);
for (let p = 0; p < w * h; p++) cut[p * 4 + 3] = (cut[p * 4 + 3] * mask[p]) / 255;
const big = (buf, bg) =>
    sharp(buf, { raw: { width: w, height: h, channels: 4 } })
        .flatten({ background: bg })
        .resize(Math.round(w * k), Math.round(h * k), { kernel: 'nearest' })
        .png()
        .toBuffer();
let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * k)}" height="${Math.round(h * k)}">`;
for (let x = Math.ceil(x0 / 10) * 10; x < x1; x += 10) {
    const X = (x - x0) * k;
    g += `<line x1="${X}" y1="0" x2="${X}" y2="${h * k}" stroke="${x % 50 ? '#ffffff40' : '#ffff00b0'}"/>`;
    if (x % 50 === 0) g += `<text x="${X + 2}" y="12" font-size="12" font-family="Helvetica" fill="#ff0" stroke="#000" stroke-width="0.6">${x}</text>`;
}
for (let y = Math.ceil(y0 / 10) * 10; y < y1; y += 10) {
    const Y = (y - y0) * k;
    g += `<line x1="0" y1="${Y}" x2="${w * k}" y2="${Y}" stroke="${y % 50 ? '#ffffff40' : '#ffff00b0'}"/>`;
    if (y % 50 === 0) g += `<text x="2" y="${Y - 2}" font-size="12" font-family="Helvetica" fill="#ff0" stroke="#000" stroke-width="0.6">${y}</text>`;
}
g = Buffer.from(g + '</svg>');
const a = await sharp(await big(art, '#000')).composite([{ input: g }]).png().toBuffer();
const c = await sharp(await big(cut, process.env.BG ?? '#ff00ff')).composite([{ input: g }]).png().toBuffer();
await sharp({ create: { width: 2 * Math.round(w * k) + 6, height: Math.round(h * k), channels: 3, background: '#fff' } })
    .composite([
        { input: a, left: 0, top: 0 },
        { input: c, left: Math.round(w * k) + 6, top: 0 }
    ])
    .png()
    .toFile(join(D, 'zoom.png'));
