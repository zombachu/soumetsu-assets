// One image to judge a mask by: art with a 100px grid | cutout on magenta | diff against orig/
// (red = cut, cyan = added), and beside them a zoom of each box: the art, with what the mask cuts
// tinted towards the ground. Applies edits/<id>.mjs first and writes out/<id>.png, as edit.mjs does.
// Writes look/<id>.png, at most 1200 px wide and about 1 MP. BG=#22dd44 swaps the magenta.
// Usage: node look.mjs <id> [x0,y0,x1,y1 ...]
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { apply } from './edit.mjs';
const D = import.meta.dirname;
const MAX_W = 1200;
const GAP = 4;

const [id, ...boxArgs] = process.argv.slice(2);
const boxes = boxArgs.map((s) => s.split(',').map(Number));
const f = join(D, 'edits', id + '.mjs');
const ops = existsSync(f) ? (await import(pathToFileURL(f).href)).default : [];
const { out, w, h, m0, art } = await apply(id, ops);
for (const dir of ['out', 'look']) mkdirSync(join(D, dir), { recursive: true });
await sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toFile(join(D, 'out', id + '.png'));

const hex = (process.env.BG ?? '#ff00ff').replace('#', '');
const bg = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const artRGB = Buffer.alloc(w * h * 3);
const cutRGB = Buffer.alloc(w * h * 3);
const diffRGB = Buffer.alloc(w * h * 3);
const tintRGB = Buffer.alloc(w * h * 3);
for (let p = 0; p < w * h; p++) {
    const a = art[p * 4 + 3] / 255;
    const k = (a * out[p]) / 255;
    const d = (out[p] - m0[p]) * a;
    const lum = ((art[p * 4] + art[p * 4 + 1] + art[p * 4 + 2]) / 3) * a * 0.35;
    diffRGB[p * 3] = Math.min(255, lum + Math.max(0, -d));
    diffRGB[p * 3 + 1] = diffRGB[p * 3 + 2] = Math.min(255, lum + Math.max(0, d));
    for (let c = 0; c < 3; c++) {
        const v = art[p * 4 + c];
        artRGB[p * 3 + c] = v * a;
        cutRGB[p * 3 + c] = v * k + bg[c] * (1 - k);
        tintRGB[p * 3 + c] = v * k + (bg[c] + (v - bg[c]) * 0.4 * a) * (1 - k);
    }
}

// SVG grid over an image of W×H showing art px from (x0, y0) at scale k: lines every `step` art
// px, yellow and labelled every `label`.
function grid(W, H, x0, y0, k, step, label) {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
    const text = (x, y, t) =>
        `<text x="${x}" y="${y}" font-size="12" font-family="Helvetica" fill="#ff0" stroke="#000" stroke-width="0.6">${t}</text>`;
    for (let x = Math.ceil(x0 / step) * step; (x - x0) * k < W; x += step) {
        const X = Math.round((x - x0) * k) + 0.5;
        s += `<line x1="${X}" y1="0" x2="${X}" y2="${H}" stroke="${x % label ? '#ffffff50' : '#ffff00b0'}"/>`;
        if (x % label === 0 && x > x0) s += text(X + 2, 12, x);
    }
    for (let y = Math.ceil(y0 / step) * step; (y - y0) * k < H; y += step) {
        const Y = Math.round((y - y0) * k) + 0.5;
        s += `<line x1="0" y1="${Y}" x2="${W}" y2="${Y}" stroke="${y % label ? '#ffffff50' : '#ffff00b0'}"/>`;
        if (y % label === 0 && y > y0) s += text(2, Y - 2, y);
    }
    return Buffer.from(s + '</svg>');
}

const raw = (buf, ww, hh) => sharp(buf, { raw: { width: ww, height: hh, channels: 3 } });
const PH = boxes.length ? 760 : 1050;
const kp = PH / h;
const PW = Math.round(w * kp);
const panel = async (buf, withGrid) => {
    const img = raw(buf, w, h).resize(PW, PH);
    return (withGrid ? sharp(await img.png().toBuffer()).composite([{ input: grid(PW, PH, 0, 0, kp, 50, 100) }]) : img)
        .png()
        .toBuffer();
};
const comp = [
    { input: await panel(artRGB, true), left: 0, top: 0 },
    { input: await panel(cutRGB, false), left: PW + GAP, top: 0 },
    { input: await panel(diffRGB, false), left: 2 * (PW + GAP), top: 0 }
];
const panelsW = 3 * PW + 2 * GAP;

// Zooms: the boxes in rows of 1–3 columns, whichever gives the smallest zoom the most scale.
let W = panelsW;
if (boxes.length) {
    const ZW = MAX_W - panelsW - 2 * GAP;
    const scaleFor = (b, sw, sh) => Math.min(sw / (b[2] - b[0]), sh / (b[3] - b[1]), 8);
    let best;
    for (let cols = 1; cols <= Math.min(3, boxes.length); cols++) {
        const rows = Math.ceil(boxes.length / cols);
        const sw = (ZW - (cols - 1) * GAP) / cols;
        const sh = (PH - (rows - 1) * GAP) / rows;
        const score = Math.min(...boxes.map((b) => scaleFor(b, sw, sh)));
        if (!best || score > best.score) best = { cols, sw, sh, score };
    }
    for (let i = 0; i < boxes.length; i++) {
        let [x0, y0, x1, y1] = boxes[i];
        x0 = Math.max(0, Math.round(x0));
        y0 = Math.max(0, Math.round(y0));
        x1 = Math.min(w, Math.round(x1));
        y1 = Math.min(h, Math.round(y1));
        const k = scaleFor([x0, y0, x1, y1], best.sw, best.sh);
        const zw = Math.round((x1 - x0) * k);
        const zh = Math.round((y1 - y0) * k);
        const crop = await raw(tintRGB, w, h)
            .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
            .resize(zw, zh, { kernel: k >= 2 ? 'nearest' : 'lanczos3' })
            .png()
            .toBuffer();
        const input = await sharp(crop)
            .composite([{ input: grid(zw, zh, x0, y0, k, k >= 2.5 ? 10 : 50, k >= 1.5 ? 50 : 100) }])
            .png()
            .toBuffer();
        const col = i % best.cols;
        const row = Math.floor(i / best.cols);
        comp.push({
            input,
            left: panelsW + 2 * GAP + Math.round(col * (best.sw + GAP)),
            top: Math.round(row * (best.sh + GAP))
        });
    }
    W = MAX_W;
}
await sharp({ create: { width: W, height: PH, channels: 3, background: '#fff' } })
    .composite(comp)
    .png()
    .toFile(join(D, 'look', id + '.png'));
console.log(id, 'ok');
