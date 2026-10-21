// Fetches everything build.ts needs from nanoka.cc (static.nanoka.cc, the CDN behind gi.nanoka.cc),
// and only what's missing, so rerun it after each game patch:
// `npm run fetch`
//
// 1. assets-src/data/*.json from the live game version's data, every ID checked against Genshin
//    Optimizer's GOOD key lists, and the icons' originals into assets-src/icons/<kind>/. The
//    element and weapon-type glyphs never change, so they're in assets-src/icons/ for good.
// 2. The wish art's originals into assets-src/wish/<id>/.
// 3. Where each new close-up sits in its splash, into assets-src/wish/alignments.json (see
//    wish-art.ts). Delete a character's entry to align it again, or edit it by hand.
//
// nanoka serves the game's images as WebP, so that's what the originals are.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
	align,
	image,
	MIN_CORRELATION,
	readAlignments,
	ROOT,
	WISH_SRC_DIR,
	wishSources,
	writeAlignments
} from './wish-art.ts';

const NANOKA = 'https://static.nanoka.cc';
const ASSETS = `${NANOKA}/assets/gi`;
const GO_CONSTS =
	'https://raw.githubusercontent.com/frzyc/genshin-optimizer/master/libs/gi/consts/src';

const DATA_DIR = join(ROOT, 'assets-src/data');
const ICON_DIR = join(ROOT, 'assets-src/icons');

const ELEMENTS = ['Anemo', 'Geo', 'Electro', 'Dendro', 'Hydro', 'Pyro', 'Cryo'];
const RARITIES: Record<string, number> = {
	QUALITY_ORANGE: 5,
	// Aloy.
	QUALITY_ORANGE_SP: 5,
	QUALITY_PURPLE: 4
};
const WEAPON_TYPES: Record<string, string> = {
	WEAPON_SWORD_ONE_HAND: 'Sword',
	WEAPON_CLAYMORE: 'Claymore',
	WEAPON_POLE: 'Polearm',
	WEAPON_BOW: 'Bow',
	WEAPON_CATALYST: 'Catalyst'
};

interface NanokaCharacter {
	en: string;
	/** `UI_AvatarIcon_<name>`; the wish art is `UI_Gacha_AvatarImg_<name>` and `…AvatarIcon_<name>`. */
	icon: string;
	rank: string;
	weapon: string;
	element: string;
	/** "2021-03-02 18:00:00", in the game's UTC+8. */
	release: string;
}
interface NanokaWeapon {
	en: string;
	icon: string;
	rank: number;
	type: string;
}
interface NanokaArtifactSet {
	icon: string;
	/** The rarities the set drops in. */
	rank: number[];
	/** The set's pieces, each with the set's name. */
	set: Record<string, { name: { en: string } }>;
}

interface Entry {
	id: string;
	[field: string]: unknown;
}
/** An image to save as `<file>.webp`. */
interface Download {
	url: string;
	file: string;
}
interface WishDownload {
	id: string;
	splash: string;
	closeUp?: string;
}

async function fetchOk(url: string): Promise<Response> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res;
}

async function json<T>(url: string): Promise<T> {
	return (await fetchOk(url)).json();
}

// Reads the quoted keys out of `export const <name> = [ ... ] as const` blocks in a GO source file.
async function goodKeys(file: string, arrayNames: string[]): Promise<Set<string>> {
	const src = await (await fetchOk(`${GO_CONSTS}/${file}`)).text();
	const keys = new Set<string>();
	for (const name of arrayNames) {
		const start = src.indexOf(`${name} = [`);
		if (start < 0) throw new Error(`${file}: ${name} not found`);
		const block = src.slice(start, src.indexOf('] as const', start));
		for (const [, key] of block.matchAll(/'([A-Za-z0-9]+)'/g)) keys.add(key);
	}
	return keys;
}

// "Staff of Homa" → StaffOfHoma, "Gladiator's Finale" → GladiatorsFinale
function toGoodKey(name: string): string {
	return name
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('')
		.replace(/[^A-Za-z0-9]/g, '');
}

function lookup<T>(table: Record<string, T>, value: string, context: string): T {
	const mapped = table[value];
	if (!mapped) throw new Error(`${context}: unknown value ${JSON.stringify(value)}`);
	return mapped;
}

const missing: string[] = [];

/** The image's bytes, or undefined (noted in `missing`) when it isn't there. */
async function download(url: string): Promise<Buffer | undefined> {
	const res = await fetch(url);
	if (res.status === 404) {
		missing.push(url);
		return;
	}
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

/** Saves the images not on disk yet (as .png or .webp), and returns how many. */
async function saveImages(list: Download[]): Promise<number> {
	const queue = list.filter((d) => !image(dirname(d.file), basename(d.file)));
	let saved = 0;
	const worker = async () => {
		for (let d = queue.shift(); d; d = queue.shift()) {
			const bytes = await download(d.url);
			if (!bytes) continue;
			await writeFile(`${d.file}.webp`, bytes);
			saved++;
		}
	};
	await Promise.all(Array.from({ length: 8 }, worker));
	return saved;
}

async function writeJson(name: string, entries: Entry[]) {
	entries.sort((a, b) => a.id.localeCompare(b.id));
	await writeFile(join(DATA_DIR, name), JSON.stringify(entries, null, '\t') + '\n');
}

// Game data and icons.

const manifest = await json<{ gi: { live: string } }>(`${NANOKA}/manifest.json`);
const version = manifest.gi.live;
const data = `${NANOKA}/gi/${version}`;
const [characters, weapons, artifactSets, goCharacters, goWeapons, goArtifactSets] =
	await Promise.all([
		json<Record<string, NanokaCharacter>>(`${data}/character.json`),
		json<Record<string, NanokaWeapon>>(`${data}/weapon.json`),
		json<Record<string, NanokaArtifactSet>>(`${data}/artifact.json`),
		goodKeys('character.ts', ['nonTravelerCharacterKeys', 'allTravelerKeys']),
		goodKeys(
			'weapon.ts',
			['Sword', 'Claymore', 'Polearm', 'Bow', 'Catalyst'].map((t) => `allWeapon${t}Keys`)
		),
		goodKeys('artifact.ts', ['allArtifactSetKeys'])
	]);

const characterEntries: Entry[] = [];
const weaponEntries: Entry[] = [];
const artifactSetEntries: Entry[] = [];
const icons: Download[] = [];
const notInGood: string[] = [];

// Anything GOOD doesn't know (yet) is left out and listed, in case it's toGoodKey getting a name
// wrong.
function add(list: Entry[], entry: Entry, goKeys: Set<string>, kind: string, icon: string) {
	if (!goKeys.has(entry.id)) {
		notInGood.push(`${kind} ${entry.id} (${entry.name})`);
		return;
	}
	list.push(entry);
	icons.push({ url: `${ASSETS}/${icon}.webp`, file: join(ICON_DIR, kind, entry.id) });
}

const now = Date.now();
const wish: WishDownload[] = [];
for (const c of Object.values(characters)) {
	if (Date.parse(`${c.release.replace(' ', 'T')}+08:00`) > now) continue;
	// Manekin and Manekina have no GOOD key, and the element-less Travelers are placeholders.
	if (c.en.startsWith('Manekin') || !ELEMENTS.includes(c.element)) continue;
	const traveler = c.en === 'Traveler';
	// Each Traveler element is listed once per twin. Keep one, with Lumine's icon.
	if (traveler && !c.icon.endsWith('PlayerGirl')) continue;
	const entry = {
		id: traveler ? `Traveler${c.element}` : toGoodKey(c.en),
		name: traveler ? `${c.element} Traveler` : c.en,
		element: c.element,
		weaponType: lookup(WEAPON_TYPES, c.weapon, c.en),
		rarity: lookup(RARITIES, c.rank, c.en)
	};
	add(characterEntries, entry, goCharacters, 'characters', c.icon);
	const name = c.icon.replace('UI_AvatarIcon_', '');
	// Every Traveler shares Lumine's splash, framed from her figure as there's no close-up.
	if (traveler) {
		if (c.element === 'Anemo') {
			wish.push({ id: 'Traveler', splash: `${ASSETS}/UI_Gacha_AvatarImg_${name}.webp` });
		}
	} else if (goCharacters.has(entry.id)) {
		wish.push({
			id: entry.id,
			splash: `${ASSETS}/UI_Gacha_AvatarImg_${name}.webp`,
			closeUp: `${ASSETS}/UI_Gacha_AvatarIcon_${name}.webp`
		});
	}
}

for (const w of Object.values(weapons)) {
	// Weapon skins are listed as weapons, with the type ITEM_TPS_WEAPON.
	if (!(w.type in WEAPON_TYPES)) continue;
	const entry = {
		id: toGoodKey(w.en),
		name: w.en,
		type: lookup(WEAPON_TYPES, w.type, w.en),
		rarity: w.rank
	};
	add(weaponEntries, entry, goWeapons, 'weapons', w.icon);
}

for (const s of Object.values(artifactSets)) {
	const name = Object.values(s.set)[0].name.en;
	const entry = { id: toGoodKey(name), name, rarity: Math.max(...s.rank) };
	add(artifactSetEntries, entry, goArtifactSets, 'sets', s.icon);
}

for (const kind of ['characters', 'weapons', 'sets']) {
	await mkdir(join(ICON_DIR, kind), { recursive: true });
}
const iconsSaved = await saveImages(icons);

await mkdir(DATA_DIR, { recursive: true });
await writeJson('characters.json', characterEntries);
await writeJson('weapons.json', weaponEntries);
await writeJson('artifact-sets.json', artifactSetEntries);

console.log(
	`nanoka ${version}: ${characterEntries.length} characters, ${weaponEntries.length} weapons, ` +
		`${artifactSetEntries.length} artifact sets; ${iconsSaved} new icons`
);
if (notInGood.length > 0) {
	console.warn('Left out, not in GOOD (fix toGoodKey if it should be):');
	for (const key of notInGood) console.warn(`  ${key}`);
}

// The wish art. A character's files are saved together or not at all, since a folder with only a
// splash is taken for the Traveler's.

let wishSaved = 0;
const wishWorker = async () => {
	for (let d = wish.shift(); d; d = wish.shift()) {
		const dir = join(WISH_SRC_DIR, d.id);
		if (image(dir, 'splash')) continue;
		const [splash, closeUp] = await Promise.all([
			download(d.splash),
			d.closeUp && download(d.closeUp)
		]);
		if (!splash || (d.closeUp && !closeUp)) continue;
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'splash.webp'), splash);
		if (closeUp) await writeFile(join(dir, 'closeup.webp'), closeUp);
		wishSaved++;
	}
};
await Promise.all(Array.from({ length: 8 }, wishWorker));
console.log(`Wish art: ${wishSaved} characters saved`);

if (missing.length > 0) {
	console.warn('Not on nanoka (rerun later):');
	for (const url of missing) console.warn(`  ${url}`);
}

// The close-ups' alignments.

const alignments = await readAlignments();
const alignQueue = (await wishSources()).filter((s) => s.closeUp && !(s.id in alignments));
const alignWorker = async () => {
	for (let s = alignQueue.shift(); s; s = alignQueue.shift()) {
		const started = performance.now();
		const [splash, closeUp] = await Promise.all([readFile(s.splash), readFile(s.closeUp!)]);
		const found = await align(splash, closeUp);
		const round = (v: number) => Math.round(v * 1000) / 1000;
		alignments[s.id] = { ...found, correlation: round(found.correlation) };
		const seconds = ((performance.now() - started) / 1000).toFixed(1);
		const note = found.correlation < MIN_CORRELATION ? ', not found: close-up alone' : '';
		console.log(`${s.id}: ${round(found.correlation)} in ${seconds}s${note}`);
	}
};
await Promise.all(Array.from({ length: 4 }, alignWorker));
await writeAlignments(alignments);
