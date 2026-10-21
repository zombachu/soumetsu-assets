// The cards' wish art, made from two of the game's images: the wish splash (2048 × 1024, the
// character small in a wide scene) and the wish close-up (320 × 1024, for most characters a tall
// crop of the same painting at 1.6–2.4 times the splash's resolution there). The art is the splash
// cropped a little wider than the close-up, at the close-up's scale, with the close-up laid over
// its middle so the character keeps the close-up's detail. The Traveler has no close-up, so theirs
// is framed from the figure's outline instead (figureArt).
//
// Finding the close-up in the splash is slow, so fetch.ts does it once per character (align) and
// saves it to alignments.json. build.ts only cuts and blends (blendArt).
//
// The originals are in assets-src/wish/<id>/: splash.png, plus closeup.png for every character but
// the Traveler. Either can be a .webp instead, as the Traveler's splash is.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';

export const ROOT = resolve(import.meta.dirname, '..');
export const WISH_SRC_DIR = join(ROOT, 'assets-src/wish');
export const WISH_OUT_DIR = join(ROOT, 'dist/art/wish');
const ALIGNMENTS = join(WISH_SRC_DIR, 'alignments.json');

/** The close-up's share of the art's width: the rest is splash around it. */
export const ZOOM = 0.9;
/** How far in from its edges the close-up fades into the splash, in close-up px. */
export const FEATHER = 24;
/**
 * Below this correlation the close-up wasn't found. Found close-ups score 0.84–0.99.
 */
export const MIN_CORRELATION = 0.8;

/**
 * figureArt's framing, as shares of the figure's height: the art's width, and how far below the top
 * of the figure the face is. Set on Lumine's art, so her head fills as much of the card as a close-up's
 * head does.
 */
const FIGURE_WIDTH = 0.22;
const FACE_BELOW_TOP = 0.1;
/** How far down the art the face sits: the close-ups have faces 25–35% down. */
const FACE_AT = 0.3;
/** A close-up's height over its width. */
const CLOSE_UP_ASPECT = 1024 / 320;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Where the close-up sits in the splash, in splash px, and how well it matched there. */
export type Alignment = Rect & { correlation: number };

/** The splash and close-up blended, with the close-up at `at` in the splash. */
export async function blendArt(splash: Buffer, closeUp: Buffer, at: Rect): Promise<Sharp> {
	const s = await size(splash);
	const c = await size(closeUp);
	const scale = c.width / at.w;
	const rw = Math.min(s.width, Math.round(at.w / ZOOM));
	const rh = Math.min(s.height, Math.round((rw * c.height) / c.width));
	const rx = clamp(Math.round(at.x + at.w / 2 - rw / 2), 0, s.width - rw);
	const ry = clamp(Math.round(at.y + at.h / 2 - rh / 2), 0, s.height - rh);
	const left = Math.round((at.x - rx) * scale);
	const top = Math.round((at.y - ry) * scale);
	const width = Math.max(Math.round(rw * scale), left + c.width);
	const height = Math.max(Math.round(rh * scale), top + c.height);

	const base = await sharp(splash)
		.extract({ left: rx, top: ry, width: rw, height: rh })
		.resize(width, height, { fit: 'fill' })
		.png()
		.toBuffer();
	return sharp(base).composite([{ input: await feathered(closeUp), left, top }]);
}

/**
 * Art for a figure on a transparent ground with no close-up, as the Traveler's is: a strip of a
 * close-up's shape around the head, sized from the figure's height, transparent where it runs past
 * the image.
 */
export async function figureArt(image: Buffer): Promise<Sharp> {
	const { data: alpha, info } = await sharp(image)
		.ensureAlpha()
		.extractChannel(3)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width: iw, height: ih } = info;
	const opaque = (x: number, y: number) => alpha[y * iw + x] > 128;
	let top = -1;
	let bottom = -1;
	for (let y = 0; y < ih; y++) {
		for (let x = 0; x < iw; x++) {
			if (!opaque(x, y)) continue;
			if (top < 0) top = y;
			bottom = y;
			break;
		}
	}
	const figure = bottom - top + 1;
	const face = top + FACE_BELOW_TOP * figure;
	let lo = iw;
	let hi = 0;
	for (let y = top; y < face; y++) {
		for (let x = 0; x < iw; x++) {
			if (!opaque(x, y)) continue;
			lo = Math.min(lo, x);
			hi = Math.max(hi, x);
		}
	}

	const width = Math.round(FIGURE_WIDTH * figure);
	const height = Math.round(width * CLOSE_UP_ASPECT);
	const left = Math.round((lo + hi) / 2 - width / 2);
	const y = Math.round(face - FACE_AT * height);
	const pad = {
		top: Math.max(0, -y),
		bottom: Math.max(0, y + height - ih),
		left: Math.max(0, -left),
		right: Math.max(0, left + width - iw)
	};
	const padded = await sharp(image)
		.extend({ ...pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	return sharp(padded).extract({ left: left + pad.left, top: y + pad.top, width, height });
}

/**
 * Where the close-up sits in the splash: the alignment whose grey levels correlate best where both
 * are opaque, searched at 1/8 size, then around the best at 1/2 size. Correlation rather than
 * difference, since a close-up's colors can be graded differently from the splash's. Both alphas
 * count: Yelan's close-up is cut out where her splash has its backdrop.
 */
export async function align(splash: Buffer, closeUp: Buffer): Promise<Alignment> {
	const s = await size(splash);
	const c = await size(closeUp);
	const aspect = c.height / c.width;
	const search = async (k: number, widths: number[], xs: number[], ys: number[]) => {
		const sw = Math.round(s.width / k);
		const sh = Math.round(s.height / k);
		const grey = await sharp(splash)
			.flatten({ background: '#000' })
			.resize(sw, sh, { fit: 'fill' })
			.greyscale()
			.raw()
			.toBuffer();
		const alpha = await sharp(splash)
			.ensureAlpha()
			.extractChannel(3)
			.resize(sw, sh, { fit: 'fill' })
			.raw()
			.toBuffer();
		let best = { correlation: -1, x: 0, y: 0, w: 0, h: 0 };
		for (const w of widths) {
			const tw = Math.round(w / k);
			const th = Math.round((w * aspect) / k);
			if (tw < 4 || th > sh) continue;
			const t = await sharp(closeUp)
				.flatten({ background: '#000' })
				.resize(tw, th, { fit: 'fill' })
				.greyscale()
				.raw()
				.toBuffer();
			const ta = await sharp(closeUp)
				.ensureAlpha()
				.extractChannel(3)
				.resize(tw, th, { fit: 'fill' })
				.raw()
				.toBuffer();
			for (const Y of ys) {
				for (const X of xs) {
					const x = Math.round(X / k);
					const y = Math.round(Y / k);
					if (x < 0 || y < 0 || x + tw > sw || y + th > sh) continue;
					let n = 0;
					let su = 0;
					let sv = 0;
					let suu = 0;
					let svv = 0;
					let suv = 0;
					for (let j = 0; j < th; j++) {
						for (let i = 0; i < tw; i++) {
							const p = (y + j) * sw + x + i;
							const q = j * tw + i;
							if (alpha[p] < 200 || ta[q] < 200) continue;
							const u = grey[p];
							const v = t[q];
							n++;
							su += u;
							sv += v;
							suu += u * u;
							svv += v * v;
							suv += u * v;
						}
					}
					// Iansan's close-up is half transparent.
					if (n < (tw * th) / 4) continue;
					const spread = (suu - (su * su) / n) * (svv - (sv * sv) / n);
					const correlation = spread > 0 ? (suv - (su * sv) / n) / Math.sqrt(spread) : -1;
					if (correlation <= best.correlation) continue;
					best = { correlation, x: x * k, y: y * k, w: tw * k, h: th * k };
				}
			}
		}
		return best;
	};

	// The close-up is between 1.2 and 6 times the splash's scale (1.3–2.7 seen: Iansan's is 1.33).
	const coarse = await search(
		8,
		steps(c.width / 6, c.width / 1.2, 8),
		steps(0, s.width, 8),
		steps(0, s.height, 8)
	);
	const around = (v: number) => steps(v - 16, v + 16, 2);
	return search(2, around(coarse.w), around(coarse.x), around(coarse.y));
}

/** The close-up with its alpha faded to nothing over FEATHER px at each edge. */
async function feathered(closeUp: Buffer): Promise<Buffer> {
	const { width, height } = await size(closeUp);
	const rgba = await sharp(closeUp).ensureAlpha().raw().toBuffer();
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const edge = Math.min(x, width - 1 - x, y, height - 1 - y);
			if (edge < FEATHER) rgba[(y * width + x) * 4 + 3] *= edge / FEATHER;
		}
	}
	return sharp(rgba, { raw: { width, height, channels: 4 } })
		.png()
		.toBuffer();
}

async function size(image: Buffer): Promise<{ width: number; height: number }> {
	const { width, height } = await sharp(image).metadata();
	return { width, height };
}

function steps(from: number, to: number, step: number): number[] {
	const out: number[] = [];
	for (let v = Math.round(from / step) * step; v <= to; v += step) out.push(v);
	return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export interface WishSource {
	id: string;
	splash: string;
	/** Absent for the Traveler, whose art is framed from the splash's figure. */
	closeUp?: string;
}

/** The originals in assets-src/wish/, one per character folder. */
export async function wishSources(): Promise<WishSource[]> {
	const out: WishSource[] = [];
	for (const entry of await readdir(WISH_SRC_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(WISH_SRC_DIR, entry.name);
		const splash = image(dir, 'splash');
		if (!splash) throw new Error(`${dir} has no splash.png`);
		out.push({ id: entry.name, splash, closeUp: image(dir, 'closeup') });
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The path of `dir`/`name`.png or .webp, whichever is there. */
export function image(dir: string, name: string): string | undefined {
	return ['png', 'webp'].map((ext) => join(dir, `${name}.${ext}`)).find((file) => existsSync(file));
}

export async function readAlignments(): Promise<Record<string, Alignment>> {
	if (!existsSync(ALIGNMENTS)) return {};
	return JSON.parse(await readFile(ALIGNMENTS, 'utf8'));
}

export async function writeAlignments(alignments: Record<string, Alignment>) {
	const sorted = Object.fromEntries(
		Object.entries(alignments).sort(([a], [b]) => a.localeCompare(b))
	);
	await writeFile(ALIGNMENTS, JSON.stringify(sorted, null, '\t') + '\n');
}
