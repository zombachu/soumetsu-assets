// Where prydwen's icon of a character sits in the character's official art from the wiki
// (`<Name> Profile.png`, on a transparent ground), which prydwen cuts its icons from. fetch.ts
// keeps that square as our own copy of the icon, for soumetsu's Tier cards: prydwen's CDN sends no
// CORS headers, so a capture of the page leaves prydwen's own images out.
//
// The icon is placed by the face first, which an anime face detector finds in both, then by the
// correlation of their grey levels where both are opaque, searched around that, then a pixel at a
// time against the square itself. macOS Vision finds no faces in this art.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import sharp from 'sharp';
import { ROOT } from './wish-art.ts';

const ICONS = 'https://cdn.prydwen.gg/images/genshin-impact/characters';
const MODEL = join(ROOT, '.cache/face_detect_v1.4_s.onnx');
const MODEL_URL =
    'https://huggingface.co/deepghs/anime_face_detection/resolve/main/face_detect_v1.4_s/model.onnx';
const MODEL_SHA256 = '403b5bc93b6ff789b7d183418df4a1364049bac00c24acd927604a7ff6891483';
/** The detector's input is this many px square. */
const SIZE = 640;
const LETTERBOX = { r: 114, g: 114, b: 114 };
/** The icon's scale against the art is about this share of the faces' sizes' ratio. */
const FACE_SCALE = 0.83;
/**
 * The places tried for the icon, around where the faces put it: scales `scaleSteps` steps of
 * `scaleStep` either side, as shares of the faces' estimate, and shifts `shiftSteps` steps of
 * `shiftStep` icon px either way. Coarsely first, then finely around the best. For the 119 icons
 * cut from Profile art, the best lay at 0.93–1.14 of the estimate and within 9 icon px of it.
 */
const COARSE = { scaleStep: 0.03, scaleSteps: 13, shiftStep: 3, shiftSteps: 8 };
const FINE = { scaleStep: 0.0075, scaleSteps: 4, shiftStep: 1, shiftSteps: 3 };
/**
 * The search places the icon to an icon px, about 3 art px, so the square is then polished in art
 * px: every square this many px from it in x, y and size, then 1 px steps from the best.
 */
const POLISH = 2;

/**
 * Below this correlation the icon wasn't found in the art: the 119 icons cut from Profile art score
 * 0.97 or more there, and other art of a character scores 0.77 at most.
 */
export const MIN_ICON_CORRELATION = 0.85;

/** Where an icon sits in the art, in the art's px, and how well it matched there. */
export interface IconMatch {
    x: number;
    y: number;
    size: number;
    correlation: number;
}

/** A face's centre, and its size: the geometric mean of its box's sides. */
interface Face {
    cx: number;
    cy: number;
    size: number;
}

/** An image's grey levels and alpha, a byte a pixel each. */
interface Levels {
    width: number;
    height: number;
    grey: Buffer;
    alpha: Buffer;
}

/** A place tried for the icon, by its scale and shift from where the faces put it. */
type Place = IconMatch & { scale: number; dx: number; dy: number };

let session: InferenceSession | undefined;

/** prydwen's icon of the character with this name, or none while prydwen has none. */
export async function fetchIcon(name: string): Promise<Buffer | undefined> {
    const url = `${ICONS}/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_icon.webp`;
    const res = await fetch(url);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

/** Where `icon` sits in `art`. */
export async function findIcon(icon: Buffer, art: Buffer): Promise<IconMatch> {
    const target = await readLevels(icon);
    const n = target.width;
    const iconFace = await findFace(icon);
    const artFace = await findFace(art);
    const estimate = (FACE_SCALE * iconFace.size) / artFace.size;
    // At the smallest scale tried, the icon reaches less than this far from the face.
    const reach = Math.ceil((2 * n) / estimate);
    const { width, height } = await sharp(art).metadata();
    const left = Math.max(0, Math.round(artFace.cx - reach));
    const top = Math.max(0, Math.round(artFace.cy - reach));
    const nearWidth = Math.min(width, Math.round(artFace.cx + reach)) - left;
    const nearHeight = Math.min(height, Math.round(artFace.cy + reach)) - top;
    const near = await sharp(art)
        .extract({ left, top, width: nearWidth, height: nearHeight })
        .png()
        .toBuffer();
    const scaled = new Map<number, Levels>();

    const place = async (scale: number, dx: number, dy: number): Promise<Place> => {
        const w = Math.round(nearWidth * estimate * scale);
        let levels = scaled.get(w);
        if (levels === undefined) {
            const h = Math.round((nearHeight * w) / nearWidth);
            const resized = await sharp(near)
                .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
                .png()
                .toBuffer();
            levels = await readLevels(resized);
            scaled.set(w, levels);
        }
        const k = w / nearWidth;
        // Where the near art's corner lands in the icon, in icon px.
        const x = Math.round(iconFace.cx - k * (artFace.cx - left) + dx);
        const y = Math.round(iconFace.cy - k * (artFace.cy - top) + dy);
        const correlation = correlate(target, levels, x, y);
        return { scale, dx, dy, x: left - x / k, y: top - y / k, size: n / k, correlation };
    };

    const search = async (around: Place, grid: typeof COARSE): Promise<Place> => {
        let best = around;
        for (let i = -grid.scaleSteps; i <= grid.scaleSteps; i++) {
            for (let j = -grid.shiftSteps; j <= grid.shiftSteps; j++) {
                for (let l = -grid.shiftSteps; l <= grid.shiftSteps; l++) {
                    const scale = around.scale + i * grid.scaleStep;
                    const dx = around.dx + l * grid.shiftStep;
                    const dy = around.dy + j * grid.shiftStep;
                    const tried = await place(scale, dx, dy);
                    if (tried.correlation > best.correlation) best = tried;
                }
            }
        }
        return best;
    };

    const found = await search(await search(await place(1, 0, 0), COARSE), FINE);
    const start = {
        x: Math.round(found.x),
        y: Math.round(found.y),
        size: Math.round(found.size),
        correlation: found.correlation
    };
    return polish(target, art, start);
}

/**
 * The square near `start` whose cut, shrunk to the icon's size, correlates best with the icon. A
 * climb of 1 px steps alone stops on lesser peaks a pixel or two away, and one that can't zoom
 * about the square's centre (a 2 px step in size) ends on different squares from different starts.
 */
async function polish(target: Levels, art: Buffer, start: IconMatch): Promise<IconMatch> {
    const { data, info } = await sharp(art)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const raw = { width: info.width, height: info.height, channels: 4 as const };
    const scores = new Map<string, number>();

    const score = async (x: number, y: number, size: number): Promise<number> => {
        const key = `${x},${y},${size}`;
        const known = scores.get(key);
        if (known !== undefined) return known;
        let correlation = -1;
        if (x >= 0 && y >= 0 && x + size <= info.width && y + size <= info.height) {
            const cut = await sharp(data, { raw })
                .extract({ left: x, top: y, width: size, height: size })
                .resize(target.width, target.height, { kernel: 'lanczos3' })
                .png()
                .toBuffer();
            correlation = correlate(target, await readLevels(cut), 0, 0);
        }
        scores.set(key, correlation);
        return correlation;
    };

    /** The best of the squares within `reach` px of `from`, and its zooms about its centre. */
    const findBestAround = async (from: IconMatch, reach: number): Promise<IconMatch> => {
        let best = { ...from, correlation: await score(from.x, from.y, from.size) };
        const tryOne = async (x: number, y: number, size: number): Promise<void> => {
            const correlation = await score(x, y, size);
            if (correlation > best.correlation) best = { x, y, size, correlation };
        };
        for (let dy = -reach; dy <= reach; dy++) {
            for (let dx = -reach; dx <= reach; dx++) {
                for (let ds = -reach; ds <= reach; ds++) {
                    await tryOne(from.x + dx, from.y + dy, from.size + ds);
                }
            }
        }
        await tryOne(from.x + 1, from.y + 1, from.size - 2);
        await tryOne(from.x - 1, from.y - 1, from.size + 2);
        return best;
    };

    let best = await findBestAround(start, POLISH);
    for (;;) {
        const next = await findBestAround(best, 1);
        if (next.correlation <= best.correlation) return best;
        best = next;
    }
}

/**
 * The correlation of the icon's grey levels with the art's where both are opaque, with the art's
 * corner at (x, y) in the icon. -1 where they share too little to tell.
 */
function correlate(icon: Levels, art: Levels, x: number, y: number): number {
    let n = 0;
    let su = 0;
    let sv = 0;
    let suu = 0;
    let svv = 0;
    let suv = 0;
    for (let v = 0; v < icon.height; v++) {
        const ay = v - y;
        if (ay < 0 || ay >= art.height) continue;
        for (let u = 0; u < icon.width; u++) {
            const ax = u - x;
            if (ax < 0 || ax >= art.width) continue;
            const p = v * icon.width + u;
            const q = ay * art.width + ax;
            if (icon.alpha[p] < 200 || art.alpha[q] < 200) continue;
            const a = icon.grey[p];
            const b = art.grey[q];
            n++;
            su += a;
            sv += b;
            suu += a * a;
            svv += b * b;
            suv += a * b;
        }
    }
    if (n < (icon.width * icon.height) / 4) return -1;
    const spread = (suu - (su * su) / n) * (svv - (sv * sv) / n);
    if (spread <= 0) return -1;
    return (suv - (su * sv) / n) / Math.sqrt(spread);
}

async function readLevels(image: Buffer): Promise<Levels> {
    const { width, height } = await sharp(image).metadata();
    const grey = await sharp(image).flatten({ background: '#000' }).greyscale().raw().toBuffer();
    const alpha = await sharp(image).ensureAlpha().extractChannel(3).raw().toBuffer();
    return { width, height, grey, alpha };
}

/** The face the detector is surest of in `image`, in the image's px. */
async function findFace(image: Buffer): Promise<Face> {
    if (session === undefined) session = await InferenceSession.create(await fetchModel());
    const { width, height } = await sharp(image).metadata();
    const k = SIZE / Math.max(width, height);
    const w = Math.round(width * k);
    const h = Math.round(height * k);
    const left = Math.floor((SIZE - w) / 2);
    const top = Math.floor((SIZE - h) / 2);
    const rgb = await sharp(image)
        .flatten({ background: LETTERBOX })
        .resize(w, h, { kernel: 'lanczos3' })
        .extend({
            top,
            left,
            bottom: SIZE - h - top,
            right: SIZE - w - left,
            background: LETTERBOX
        })
        .removeAlpha()
        .raw()
        .toBuffer();
    const input = new Float32Array(3 * SIZE * SIZE);
    for (let p = 0; p < SIZE * SIZE; p++) {
        for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + p] = rgb[p * 3 + c] / 255;
    }
    const { output0 } = await session.run({
        images: new Tensor('float32', input, [1, 3, SIZE, SIZE])
    });
    // A column per candidate box: its centre's x and y, its width and height, then its score.
    const out = output0.data as Float32Array;
    const n = output0.dims[2];
    let best = 0;
    for (let i = 1; i < n; i++) {
        if (out[4 * n + i] > out[4 * n + best]) best = i;
    }
    return {
        cx: (out[best] - left) / k,
        cy: (out[n + best] - top) / k,
        size: Math.sqrt(out[2 * n + best] * out[3 * n + best]) / k
    };
}

/** The path of the face detector's weights (45 MB), downloaded the first time. */
async function fetchModel(): Promise<string> {
    if (existsSync(MODEL)) return MODEL;
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`${MODEL_URL}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== MODEL_SHA256) {
        throw new Error(`${MODEL_URL}: SHA-256 is ${sha}, not ${MODEL_SHA256}`);
    }
    await mkdir(dirname(MODEL), { recursive: true });
    await writeFile(MODEL, bytes);
    return MODEL;
}
