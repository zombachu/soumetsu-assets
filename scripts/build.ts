// Makes what the site uses from the originals in assets-src/ (see fetch.ts) into dist/, which
// upload.ts puts online. Only remakes what changed:
// `npm run build`
//
// 1. dist/icons/<kind>/<id>.webp, shrunk to fit ICON_SIZES. An icon is remade when its original
//    is newer, so after changing ICON_SIZES or QUALITY, delete dist/icons/ to remake them all.
// 2. dist/art/wish/<id>.webp (see wish-art.ts). Art is remade when its inputs change, tracked in
//    .inputs.json there.
// 3. dist/data/*.json, copied from assets-src/data/.

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import sharp from 'sharp';
import {
	blendArt,
	FEATHER,
	figureArt,
	MIN_CORRELATION,
	readAlignments,
	ROOT,
	WISH_OUT_DIR,
	wishSources,
	ZOOM
} from './wish-art.ts';

const QUALITY = 80;
const ICON_SRC_DIR = join(ROOT, 'assets-src/icons');
const ICON_OUT_DIR = join(ROOT, 'dist/icons');
const DATA_SRC_DIR = join(ROOT, 'assets-src/data');
const DATA_OUT_DIR = join(ROOT, 'dist/data');
/** The largest width and height for each kind's icons, in px. */
const ICON_SIZES: Record<string, number> = {
	characters: 256,
	weapons: 256,
	artifacts: 256,
	elements: 128,
	'weapon-types': 128
};
const INPUTS = join(WISH_OUT_DIR, '.inputs.json');

const modified = async (file?: string) => file && (await stat(file)).mtimeMs;

// Icons.

let iconsMade = 0;
let iconsUnchanged = 0;
for (const [kind, size] of Object.entries(ICON_SIZES)) {
	const dir = join(ICON_SRC_DIR, kind);
	if (!existsSync(dir)) continue;
	await mkdir(join(ICON_OUT_DIR, kind), { recursive: true });
	for (const name of await readdir(dir)) {
		if (!/\.(png|webp)$/.test(name)) continue;
		const src = join(dir, name);
		const out = join(ICON_OUT_DIR, kind, `${parse(name).name}.webp`);
		if (existsSync(out) && (await modified(out))! >= (await modified(src))!) {
			iconsUnchanged++;
			continue;
		}
		await sharp(src)
			.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: QUALITY })
			.toFile(out);
		iconsMade++;
	}
}
console.log(`Icons: ${iconsMade} made, ${iconsUnchanged} unchanged`);

// The game data.

await mkdir(DATA_OUT_DIR, { recursive: true });
const dataFiles = (await readdir(DATA_SRC_DIR)).filter((name) => name.endsWith('.json'));
for (const name of dataFiles) await copyFile(join(DATA_SRC_DIR, name), join(DATA_OUT_DIR, name));
console.log(`Data: ${dataFiles.length} files copied`);

// The wish art.

const alignments = await readAlignments();
await mkdir(WISH_OUT_DIR, { recursive: true });
const previous: Record<string, string> = existsSync(INPUTS)
	? JSON.parse(await readFile(INPUTS, 'utf8'))
	: {};
const inputs: Record<string, string> = {};
const unaligned: string[] = [];
let artMade = 0;

for (const s of await wishSources()) {
	const alignment = alignments[s.id];
	if (s.closeUp && !alignment) {
		unaligned.push(s.id);
		continue;
	}
	const file = join(WISH_OUT_DIR, `${s.id}.webp`);
	const key = JSON.stringify([
		await modified(s.splash),
		await modified(s.closeUp),
		alignment,
		ZOOM,
		FEATHER,
		QUALITY
	]);
	inputs[s.id] = key;
	if (previous[s.id] === key && existsSync(file)) continue;

	const splash = await readFile(s.splash);
	let art;
	if (!s.closeUp) art = await figureArt(splash);
	else if (alignment.correlation < MIN_CORRELATION) art = sharp(s.closeUp);
	else art = await blendArt(splash, await readFile(s.closeUp), alignment);
	await art.webp({ quality: QUALITY }).toFile(file);
	artMade++;
}

await writeFile(INPUTS, JSON.stringify(inputs, null, '\t') + '\n');
console.log(`Wish art: ${artMade} made, ${Object.keys(inputs).length - artMade} unchanged`);
if (unaligned.length > 0) {
	console.error(`No alignment for ${unaligned.join(', ')}: run npm run fetch and commit it`);
	process.exit(1);
}
