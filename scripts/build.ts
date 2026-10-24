// Makes what the site uses from the originals in assets-src/ (see fetch.ts) into dist/, which
// upload.ts puts online. Only remakes what changed:
// `npm run build`
//
// 1. dist/icons/<kind>/<id>.webp, shrunk to fit ICON_SIZES. An icon is remade when its original
//    is newer, so after changing ICON_SIZES or QUALITY, delete dist/icons/ to remake them all.
// 2. dist/art/wish/<id>.webp and dist/art/cutout/<id>.webp (see wish-art.ts). Art is remade when
//    its inputs change, tracked in .inputs.json in dist/art/wish/.
// 3. dist/data/*.json, copied from assets-src/data/, and dist/data/cutouts.json, the IDs of the
//    characters with a cutout.

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import sharp from 'sharp';
import {
	CUTOUT_OUT_DIR,
	cutout,
	FEATHER,
	maskFile,
	maskFits,
	NO_CUTOUT,
	readAlignments,
	readMasks,
	ROOT,
	WISH_OUT_DIR,
	wishArt,
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
const masks = await readMasks();
await mkdir(WISH_OUT_DIR, { recursive: true });
await mkdir(CUTOUT_OUT_DIR, { recursive: true });
const previous: Record<string, string> = existsSync(INPUTS)
	? JSON.parse(await readFile(INPUTS, 'utf8'))
	: {};
const inputs: Record<string, string> = {};
const unaligned: string[] = [];
const uncut: string[] = [];
const cutouts: string[] = [];
let artMade = 0;

for (const s of await wishSources()) {
	const alignment = alignments[s.id];
	if (s.closeUp && !alignment) {
		unaligned.push(s.id);
		continue;
	}
	const mask = maskFile(s.id);
	const cut = !NO_CUTOUT.has(s.id);
	if (cut && !maskFits(s, alignment, masks)) {
		uncut.push(s.id);
		continue;
	}
	const file = join(WISH_OUT_DIR, `${s.id}.webp`);
	const cutoutFile = join(CUTOUT_OUT_DIR, `${s.id}.webp`);
	if (cut) cutouts.push(s.id);
	else await rm(cutoutFile, { force: true });
	const key = JSON.stringify([
		await modified(s.splash),
		await modified(s.closeUp),
		alignment,
		cut && (await modified(mask)),
		ZOOM,
		FEATHER,
		QUALITY
	]);
	inputs[s.id] = key;
	if (previous[s.id] === key && existsSync(file) && (!cut || existsSync(cutoutFile))) continue;

	const art = await (await wishArt(s, alignment)).png().toBuffer();
	await sharp(art).webp({ quality: QUALITY }).toFile(file);
	if (cut) await (await cutout(art, mask)).webp({ quality: QUALITY }).toFile(cutoutFile);
	artMade++;
}

await writeFile(INPUTS, JSON.stringify(inputs, null, '\t') + '\n');
await writeFile(join(DATA_OUT_DIR, 'cutouts.json'), JSON.stringify(cutouts, null, '\t') + '\n');
console.log(`Wish art: ${artMade} made, ${Object.keys(inputs).length - artMade} unchanged`);
console.log(`Cutouts: ${cutouts.length}, ${NO_CUTOUT.size} left out (NO_CUTOUT)`);
if (unaligned.length > 0) {
	console.error(`No alignment for ${unaligned.join(', ')}: run npm run fetch and commit it`);
}
if (uncut.length > 0) {
	console.error(
		`No mask, or one cut for other framing, for ${uncut.join(', ')}: run npm run fetch and commit it`
	);
}
if (unaligned.length > 0 || uncut.length > 0) process.exit(1);
