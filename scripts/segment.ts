// The masks for the cutouts (see wish-art.ts): which of a card's pixels are the character rather
// than the scene and effects painted around them. Cutting one takes a second or two and needs
// macOS, for Vision, so fetch.ts does it once per character.
//
// Two models, since each fails differently on this art (measured on 18 cards):
// - isnet-anime (SkyTNT's anime-segmentation) tells the character from the effects best, but
//   leaves dark areas see-through: Hu Tao's face and hat, Neuvillette's coat.
// - Vision's subject lifting is solid inside, but keeps some effects (Klee's Dodoco) and can drop
//   parts of the character (Qiqi below the chest).
// So the mask is isnet-anime's, raised to Vision's wherever isnet-anime sees a trace of the
// character. BiRefNet (what Cloudflare Images' segment=foreground runs) and ToonOut, an anime
// fine-tune of it, keep most of the effects.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import sharp from 'sharp';
import { ROOT } from './wish-art.ts';

const MODEL = join(ROOT, '.cache/isnetis.onnx');
const MODEL_URL = 'https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.onnx';
const MODEL_SHA256 = 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99';
/** isnet-anime's input and output are this many px square. */
const SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
/** Above this, isnet-anime's mask counts as the character, so Vision's can fill it in. */
const TRACE = 0.15;
/**
 * The mask's levels: at or below LOW is cut, at or above HIGH kept whole. Drops the faint wisps
 * of effects that isnet-anime half keeps.
 */
const LOW = 0.2;
const HIGH = 0.9;

/** The masks of the given card art, as greyscale PNGs the art's size: white for the character. */
export async function cutMasks(arts: Buffer[]): Promise<Buffer[]> {
	// Both models see the art on black, so what's transparent reads as background.
	const flat = await Promise.all(
		arts.map((art) => sharp(art).flatten({ background: '#000' }).png().toBuffer())
	);
	const dir = await mkdtemp(join(tmpdir(), 'soumetsu-masks-'));
	try {
		const files = flat.map((_, i) => [join(dir, `${i}.png`), join(dir, `${i}.mask.png`)]);
		await Promise.all(flat.map((image, i) => writeFile(files[i][0], image)));
		await promisify(execFile)('swift', [join(ROOT, 'scripts/vision-mask.swift'), ...files.flat()]);

		const session = await InferenceSession.create(await model());
		const masks: Buffer[] = [];
		for (let i = 0; i < flat.length; i++) {
			const { width, height } = await sharp(flat[i]).metadata();
			const isnet = await isnetMask(session, flat[i], width, height);
			// sharp hands back a greyscale image as RGB unless told otherwise, even unchanged.
			const vision = await sharp(files[i][1]).toColourspace('b-w').raw().toBuffer();
			// What's half transparent in the art is effects, not the character (Columbina's pale
			// backdrop), so both masks are weighed by the art's alpha before the levels cut it.
			const alpha = await sharp(arts[i]).ensureAlpha().extractChannel(3).raw().toBuffer();
			const mask = Buffer.alloc(width * height);
			for (let p = 0; p < mask.length; p++) {
				const a = alpha[p] / 255;
				const v = (isnet[p] / 255) * a;
				const raised = v > TRACE ? Math.max(v, (vision[p] / 255) * a) : v;
				mask[p] = Math.round(Math.min(Math.max((raised - LOW) / (HIGH - LOW), 0), 1) * 255);
			}
			masks.push(
				await sharp(mask, { raw: { width, height, channels: 1 } })
					.png()
					.toBuffer()
			);
		}
		return masks;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** isnet-anime's mask of the image, `width` × `height` at a byte a pixel, prepared like rembg. */
async function isnetMask(
	session: InferenceSession,
	image: Buffer,
	width: number,
	height: number
): Promise<Buffer> {
	const rgb = await sharp(image).resize(SIZE, SIZE, { fit: 'fill' }).removeAlpha().raw().toBuffer();
	let max = 1;
	for (const v of rgb) max = Math.max(max, v);
	const input = new Float32Array(3 * SIZE * SIZE);
	for (let p = 0; p < SIZE * SIZE; p++) {
		for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + p] = rgb[p * 3 + c] / max - MEAN[c];
	}
	const { mask } = await session.run({ img: new Tensor('float32', input, [1, 3, SIZE, SIZE]) });
	const pred = mask.data as Float32Array;
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of pred) {
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
	}
	const grey = Buffer.alloc(SIZE * SIZE);
	for (let p = 0; p < grey.length; p++) grey[p] = ((pred[p] - lo) / (hi - lo)) * 255;
	return sharp(grey, { raw: { width: SIZE, height: SIZE, channels: 1 } })
		.resize(width, height, { fit: 'fill' })
		.toColourspace('b-w')
		.raw()
		.toBuffer();
}

/** The path of isnet-anime's weights (176 MB), downloaded the first time. */
async function model(): Promise<string> {
	if (existsSync(MODEL)) return MODEL;
	const res = await fetch(MODEL_URL);
	if (!res.ok) throw new Error(`${MODEL_URL}: HTTP ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	const sha = createHash('sha256').update(bytes).digest('hex');
	if (sha !== MODEL_SHA256) throw new Error(`${MODEL_URL}: SHA-256 is ${sha}, not ${MODEL_SHA256}`);
	await mkdir(dirname(MODEL), { recursive: true });
	await writeFile(MODEL, bytes);
	return MODEL;
}
