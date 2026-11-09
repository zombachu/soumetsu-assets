// Applies hand edits (edits/<id>.mjs, default export: array of ops) to orig/<id>.png,
// writes out/<id>.png and a preview prev/<id>.png. orig/ holds the masks as fetch cut them, from
// commit 77f70f6. Copy out/<id>.png over assets-src/wish/<id>/mask.png to apply a fix.
// Usage: node edit.mjs <id>...
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';
const A = join(import.meta.dirname, '..');
const D = import.meta.dirname;

async function polyCoverage(polys, w, h) {
    const shapes = polys
        .map((p) => `<polygon points="${p.map(([x, y]) => `${x},${y}`).join(' ')}" fill="#fff"/>`)
        .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#000"/>${shapes}</svg>`;
    return sharp(Buffer.from(svg)).toColourspace('b-w').raw().toBuffer();
}

// Labels connected components of (m[p] > t), 8-connected. Returns [labels Int32Array, sizes[]].
function components(m, w, h, t) {
    const lab = new Int32Array(w * h).fill(-1);
    const sizes = [];
    const stack = [];
    for (let s = 0; s < w * h; s++) {
        if (m[s] <= t || lab[s] >= 0) continue;
        const id = sizes.length;
        let n = 0;
        lab[s] = id;
        stack.push(s);
        while (stack.length) {
            const p = stack.pop();
            n++;
            const x = p % w;
            const y = (p - x) / w;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const X = x + dx;
                    const Y = y + dy;
                    if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
                    const q = Y * w + X;
                    if (m[q] > t && lab[q] < 0) {
                        lab[q] = id;
                        stack.push(q);
                    }
                }
        }
        sizes.push(n);
    }
    return [lab, sizes];
}

function hsv(r, g, b) {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    let hh = 0;
    if (d) {
        if (mx === r) hh = ((g - b) / d) % 6;
        else if (mx === g) hh = (b - r) / d + 2;
        else hh = (r - g) / d + 4;
        hh *= 60;
        if (hh < 0) hh += 360;
    }
    return [hh, mx ? d / mx : 0, mx / 255];
}

// Grows a binary region by r px (square).
function dilate(bin, w, h, r) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            if (!bin[y * w + x]) continue;
            for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                    const X = x + dx;
                    const Y = y + dy;
                    if (X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 1;
                }
        }
    return out;
}

export async function apply(id, ops) {
    const { data: m0, info } = await sharp(join(D, 'orig', id + '.png'))
        .toColourspace('b-w')
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const m = Float32Array.from(m0);
    const art = await sharp(join(A, 'dist/art/wish', id + '.webp')).ensureAlpha().raw().toBuffer();
    const all = await polyCoverage([[[0, 0], [w, 0], [w, h], [0, h]]], w, h);
    const region = async (poly) => (poly ? polyCoverage([poly], w, h) : all);

    for (const [op, ...a] of ops) {
        if (op === 'erase') {
            // erase(poly...): zero inside each polygon, antialiased.
            const c = await polyCoverage(a, w, h);
            for (let p = 0; p < m.length; p++) m[p] *= 1 - c[p] / 255;
        } else if (op === 'keep') {
            // keep(poly...): zero outside the union of the polygons.
            const c = await polyCoverage(a, w, h);
            for (let p = 0; p < m.length; p++) m[p] *= c[p] / 255;
        } else if (op === 'restore') {
            // restore(poly...): back to the original mask inside the polygons.
            const c = await polyCoverage(a, w, h);
            for (let p = 0; p < m.length; p++) m[p] = m[p] * (1 - c[p] / 255) + m0[p] * (c[p] / 255);
        } else if (op === 'fill') {
            // fill(poly...): full inside the polygons.
            const c = await polyCoverage(a, w, h);
            for (let p = 0; p < m.length; p++) m[p] = Math.max(m[p], c[p]);
        } else if (op === 'seeds') {
            // seeds([[x,y]...], t=20, poly?): within poly (default all), keep only the components of
            // mask > t containing a seed, plus a 2px fringe around them.
            const [pts, t = 20, poly] = a;
            const c = await region(poly);
            const [lab] = components(m, w, h, t);
            const keepIds = new Set(pts.map(([x, y]) => lab[y * w + x]).filter((v) => v >= 0));
            const kept = new Uint8Array(w * h);
            for (let p = 0; p < m.length; p++) kept[p] = keepIds.has(lab[p]) ? 1 : 0;
            const near = dilate(kept, w, h, 2);
            for (let p = 0; p < m.length; p++) if (c[p] > 127 && !near[p]) m[p] = 0;
        } else if (op === 'islands') {
            // islands(minSize, t=20, poly?): within poly, drop components of mask > t smaller than
            // minSize px, and their fringe.
            const [min, t = 20, poly] = a;
            const c = await region(poly);
            const [lab, sizes] = components(m, w, h, t);
            const kept = new Uint8Array(w * h);
            for (let p = 0; p < m.length; p++) kept[p] = lab[p] >= 0 && sizes[lab[p]] >= min ? 1 : 0;
            const near = dilate(kept, w, h, 2);
            for (let p = 0; p < m.length; p++) if (c[p] > 127 && !near[p]) m[p] = 0;
        } else if (op === 'color') {
            // color(poly, test(h,s,v,r,g,b) => bool, amount=1): within poly, erase matching pixels.
            const [poly, test, amount = 1] = a;
            const c = await region(poly);
            for (let p = 0; p < m.length; p++) {
                if (!c[p]) continue;
                const r = art[p * 4];
                const g = art[p * 4 + 1];
                const b = art[p * 4 + 2];
                const [H, S, V] = hsv(r, g, b);
                if (test(H, S, V, r, g, b)) m[p] *= 1 - (amount * c[p]) / 255;
            }
        } else if (op === 'luma') {
            // luma(poly, lo, hi): within poly, raise the mask to a key of the art's brightness against
            // a dark ground: 0 at max channel <= lo, full at >= hi.
            const [poly, lo, hi] = a;
            const c = await region(poly);
            for (let p = 0; p < m.length; p++) {
                if (!c[p]) continue;
                const v = Math.max(art[p * 4], art[p * 4 + 1], art[p * 4 + 2]);
                const k = Math.min(Math.max((v - lo) / (hi - lo), 0), 1) * 255 * (c[p] / 255);
                m[p] = Math.max(m[p], k);
            }
        } else if (op === 'close') {
            // close(r, poly?): within poly, greyscale closing (max filter, then min filter) of
            // radius r: fills dark outlines thinner than about 2r that a key cut out.
            const [r, poly] = a;
            const c = await region(poly);
            const filt = (src, fn) => {
                const tmp = new Float32Array(w * h);
                const dst = new Float32Array(w * h);
                for (let y = 0; y < h; y++)
                    for (let x = 0; x < w; x++) {
                        let v = src[y * w + x];
                        for (let d = -r; d <= r; d++) {
                            const X = Math.min(Math.max(x + d, 0), w - 1);
                            v = fn(v, src[y * w + X]);
                        }
                        tmp[y * w + x] = v;
                    }
                for (let y = 0; y < h; y++)
                    for (let x = 0; x < w; x++) {
                        let v = tmp[y * w + x];
                        for (let d = -r; d <= r; d++) {
                            const Y = Math.min(Math.max(y + d, 0), h - 1);
                            v = fn(v, tmp[Y * w + x]);
                        }
                        dst[y * w + x] = v;
                    }
                return dst;
            };
            const closed = filt(filt(m, Math.max), Math.min);
            for (let p = 0; p < m.length; p++) {
                const k = c[p] / 255;
                m[p] = Math.max(m[p], closed[p] * k + m[p] * (1 - k));
            }
        } else if (op === 'floor') {
            // floor(t, poly?): within poly, values below t become 0.
            const [t, poly] = a;
            const c = await region(poly);
            for (let p = 0; p < m.length; p++) if (c[p] > 127 && m[p] < t) m[p] = 0;
        } else if (op === 'solid') {
            // solid(t, poly?): within poly, values at or above t become 255.
            const [t, poly] = a;
            const c = await region(poly);
            for (let p = 0; p < m.length; p++) if (c[p] > 127 && m[p] >= t) m[p] = 255;
        } else if (op === 'holes') {
            // holes(t=128, poly?, maxSize=Infinity): within poly, fill regions of mask <= t not
            // connected to the image border (through mask <= t) and at most maxSize px.
            const [t = 128, poly, max = Infinity] = a;
            const c = await region(poly);
            const inv = new Float32Array(w * h);
            for (let p = 0; p < m.length; p++) inv[p] = m[p] <= t ? 255 : 0;
            const [lab, sizes] = components(inv, w, h, 127);
            const border = new Set();
            for (let x = 0; x < w; x++) border.add(lab[x]).add(lab[(h - 1) * w + x]);
            for (let y = 0; y < h; y++) border.add(lab[y * w]).add(lab[y * w + w - 1]);
            for (let p = 0; p < m.length; p++) {
                const l = lab[p];
                if (l >= 0 && !border.has(l) && sizes[l] <= max && c[p] > 127) m[p] = 255;
            }
        } else throw new Error(`${id}: unknown op ${op}`);
    }
    const out = Buffer.alloc(w * h);
    for (let p = 0; p < m.length; p++) out[p] = Math.round(Math.min(Math.max(m[p], 0), 255));
    return { out, w, h, m0, art };
}

function gridSvg(w, h, step = 50, labels = true) {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
    for (let x = step; x < w; x += step)
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${x % 100 ? '#ffffff55' : '#ffff00aa'}" stroke-width="1"/>`;
    for (let y = step; y < h; y += step)
        s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${y % 100 ? '#ffffff55' : '#ffff00aa'}" stroke-width="1"/>`;
    if (labels) {
        for (let y = 100; y < h; y += 100)
            s += `<text x="2" y="${y - 2}" font-size="12" font-family="Helvetica" fill="#ff0" stroke="#000" stroke-width="0.6">${y}</text>`;
        for (let x = 100; x < w; x += 100)
            s += `<text x="${x + 2}" y="12" font-size="12" font-family="Helvetica" fill="#ff0" stroke="#000" stroke-width="0.6">${x}</text>`;
    }
    return Buffer.from(s + '</svg>');
}

async function over(art, mask, w, h, bg) {
    const rgba = Buffer.from(art);
    for (let p = 0; p < w * h; p++) rgba[p * 4 + 3] = (rgba[p * 4 + 3] * mask[p]) / 255;
    return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).flatten({ background: bg }).png().toBuffer();
}

export async function preview(id, { out, w, h, m0, art }, file) {
    const g = gridSvg(w, h);
    const artP = await sharp(art, { raw: { width: w, height: h, channels: 4 } })
        .flatten({ background: '#000' })
        .composite([{ input: g }])
        .png()
        .toBuffer();
    const before = await over(art, m0, w, h, '#ff00ff');
    const after = await sharp(await over(art, out, w, h, '#ff00ff')).composite([{ input: g }]).png().toBuffer();
    const dark = await over(art, out, w, h, '#000000');
    // What changed: red where the mask went down, cyan where it went up, over the art dimmed.
    const diff = Buffer.alloc(w * h * 3);
    for (let p = 0; p < w * h; p++) {
        const a = art[p * 4 + 3] / 255;
        const d = (out[p] - m0[p]) * a;
        const lum = ((art[p * 4] + art[p * 4 + 1] + art[p * 4 + 2]) / 3) * a * 0.35;
        diff[p * 3] = Math.min(255, lum + Math.max(0, -d));
        diff[p * 3 + 1] = Math.min(255, lum + Math.max(0, d));
        diff[p * 3 + 2] = Math.min(255, lum + Math.max(0, d));
    }
    const diffP = await sharp(diff, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const gap = 6;
    const panels = [artP, before, after, dark, diffP];
    await sharp({ create: { width: panels.length * (w + gap), height: h, channels: 3, background: '#fff' } })
        .composite(panels.map((input, i) => ({ input, left: i * (w + gap), top: 0 })))
        .png()
        .toFile(file);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    for (const dir of ['out', 'prev']) mkdirSync(join(D, dir), { recursive: true });
    for (const id of process.argv.slice(2)) {
        const f = join(D, 'edits', id + '.mjs');
        const ops = existsSync(f) ? (await import(pathToFileURL(f).href + '?' + Date.now())).default : [];
        const r = await apply(id, ops);
        await sharp(r.out, { raw: { width: r.w, height: r.h, channels: 1 } }).png().toFile(join(D, 'out', id + '.png'));
        await preview(id, r, join(D, 'prev', id + '.png'));
        console.log(id, 'ok');
    }
}
