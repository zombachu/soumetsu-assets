// Fetches everything build.ts needs from the Genshin Impact Wiki (genshin-impact.fandom.com), and
// only what's missing, so rerun it after each game patch:
// `npm run fetch`
//
// 1. assets-src/data/*.json from the wiki's released characters, weapons and artifact sets, every
//    ID checked against Genshin Optimizer's GOOD key lists, and the icons' originals into
//    assets-src/icons/<kind>/. The element and weapon-type glyphs never change, so they're in
//    assets-src/icons/ for good.
// 2. The wish art's originals into assets-src/wish/<id>/. The Traveler's splash isn't on the wiki,
//    so it stays in the repo.
// 3. Where each new close-up sits in its splash, into assets-src/wish/alignments.json (see
//    wish-art.ts). Delete a character's entry to align it again, or edit it by hand.
// 4. The cutouts' masks, into assets-src/wish/<id>/mask.png (see wish-art.ts and segment.ts),
//    for characters with none or whose art is now framed differently. Needs macOS. Delete a
//    mask to cut it again, or fix it by hand.
//
// Originals can be PNG or WebP. The wiki's are PNG.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { cutMasks } from './segment.ts';
import {
    align,
    framing,
    image,
    maskFile,
    maskFits,
    MIN_CORRELATION,
    NO_CUTOUT,
    readAlignments,
    readMasks,
    ROOT,
    WISH_SRC_DIR,
    wishArt,
    wishSources,
    writeAlignments,
    writeMasks
} from './wish-art.ts';

const GO_CONSTS =
    'https://raw.githubusercontent.com/frzyc/genshin-optimizer/master/libs/gi/consts/src';
const WIKI = 'https://genshin-impact.fandom.com/api.php';

const DATA_DIR = join(ROOT, 'assets-src/data');
const ICON_DIR = join(ROOT, 'assets-src/icons');

const ELEMENTS = ['Anemo', 'Geo', 'Electro', 'Dendro', 'Hydro', 'Pyro', 'Cryo'];
const WEAPON_TYPES = ['Sword', 'Claymore', 'Polearm', 'Bow', 'Catalyst'];
// The data names rarities as words, so the site can key them in display order (JS lists integer
// keys ascending).
const STARS: Record<string, string> = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' };

interface WikiPage {
    title: string;
    revisions?: { slots: { main: { content: string } } }[];
    imageinfo?: { url: string }[];
}
interface WikiQuery {
    query: { redirects?: { from: string; to: string }[]; pages: WikiPage[] };
}
interface WikiCategory {
    query: { categorymembers: { title: string }[] };
    continue?: Record<string, string>;
}
interface Version {
    /** "6.0", which the wiki names Luna I. */
    number: string;
    /** The update's. */
    date: string;
    /** The names each event wish phase's banners featured. */
    phases: string[][];
}

interface Entry {
    id: string;
    name: string;
    [field: string]: unknown;
}
/** The wiki's file `image`, to save as `<file>.png`. */
interface Download {
    image: string;
    file: string;
}
interface WishDownload {
    id: string;
    splash: string;
    closeUp: string;
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

/** Each page the wiki has, by the title asked for, following redirects. */
async function wikiQuery(
    titles: string[],
    props: Record<string, string>
): Promise<Map<string, WikiPage>> {
    const pages = new Map<string, WikiPage>();
    // The API takes up to 50 titles a request.
    for (let i = 0; i < titles.length; i += 50) {
        const chunk = titles.slice(i, i + 50);
        const params = new URLSearchParams({
            ...props,
            action: 'query',
            redirects: '1',
            format: 'json',
            formatversion: '2',
            titles: chunk.join('|')
        });
        const { query } = await json<WikiQuery>(`${WIKI}?${params}`);
        const redirects = new Map(query.redirects?.map((r) => [r.from, r.to]));
        const byTitle = new Map(query.pages.map((p) => [p.title, p]));
        for (const title of chunk) {
            const page = byTitle.get(redirects.get(title) ?? title);
            if (page !== undefined) pages.set(title, page);
        }
    }
    return pages;
}

/** The wikitext of each page the wiki has, by title. */
async function wikiPages(titles: string[]): Promise<Map<string, string>> {
    const pages = await wikiQuery(titles, {
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main'
    });
    const texts = new Map<string, string>();
    for (const [title, page] of pages) {
        if (page.revisions !== undefined) texts.set(title, page.revisions[0].slots.main.content);
    }
    return texts;
}

/** The URL of each image the wiki has, by file name. */
async function wikiImages(names: string[]): Promise<Map<string, string>> {
    const files = await wikiQuery(
        names.map((name) => `File:${name}`),
        { prop: 'imageinfo', iiprop: 'url' }
    );
    const urls = new Map<string, string>();
    for (const name of names) {
        const url = files.get(`File:${name}`)?.imageinfo?.[0].url;
        if (url === undefined) continue;
        // Fandom's image server sends a lossy WebP copy unless asked for the original.
        const original = new URL(url);
        original.searchParams.set('format', 'original');
        urls.set(name, original.href);
    }
    return urls;
}

/** The titles of a category's articles. */
async function wikiCategory(name: string): Promise<string[]> {
    const titles: string[] = [];
    let next: Record<string, string> | undefined = {};
    while (next !== undefined) {
        const params = new URLSearchParams({
            ...next,
            action: 'query',
            list: 'categorymembers',
            cmtitle: `Category:${name}`,
            cmnamespace: '0',
            cmlimit: '500',
            format: 'json',
            formatversion: '2'
        });
        const page: WikiCategory = await json<WikiCategory>(`${WIKI}?${params}`);
        titles.push(...page.query.categorymembers.map((member) => member.title));
        next = page.continue;
    }
    return titles;
}

/**
 * The value on a template's `|<name> = <value>` line. A field can follow a comment or a tag on its
 * line: `<!--Playable Character Information-->|quality = 5`, `</gallery>|type = Polearm`.
 */
function wikiField(text: string, name: string): string | undefined {
    const line = new RegExp(`(?:^|>)[ \\t]*\\|[ \\t]*${name}[ \\t]*=[ \\t]*(\\S.*?)[ \\t]*$`, 'm');
    return text.match(line)?.[1];
}

// A version page's Event Wishes list each phase as `* Phase 1` (or `I`), then a line per banner,
// `** [[<banner>|…]] (<featured>)`, featuring `[[Zhongli]] & Yanfei` or `[[Arataki Itto]], Kuki
// Shinobu`. 2.8's are headed New Event Wishes, and an upcoming version's may not be listed yet.
function parseVersion(title: string, text: string): Version {
    const wishes = text.split(/^;/m).find((block) => /^(New )?Event Wishes\s*\n/.test(block)) ?? '';
    const phases = wishes
        .split(/^\*\s*Phase\b.*$/m)
        .slice(1)
        .map((phase) =>
            [...phase.matchAll(/^\*\*[^*].*\((.*)\)\s*$/gm)].flatMap(([, featured]) =>
                featured.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').split(/\s*[&,]\s*/)
            )
        );
    const number = wikiField(text, 'number') ?? wikiField(text, 'version');
    const date = wikiField(text, 'date');
    if (number === undefined || date === undefined) throw new Error(`${title}: no version or date`);
    return { number, date, phases };
}

// A releaseDate is "2021-07-21", or "2025-09-10 11:00:00 GMT+8", in the game's UTC+8.
function released(date: string | undefined, title: string): boolean {
    if (date === undefined) throw new Error(`${title}: no release date on the wiki`);
    const [day, time = '00:00:00'] = date.split(' ');
    return Date.parse(`${day}T${time}+08:00`) <= Date.now();
}

// "Staff of Homa" → StaffOfHoma, "Gladiator's Finale" → GladiatorsFinale
function toGoodKey(name: string): string {
    return name
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')
        .replace(/[^A-Za-z0-9]/g, '');
}

function lookup<T>(table: Record<string, T>, value: string | undefined, context: string): T {
    if (value === undefined || !(value in table)) {
        throw new Error(`${context}: unknown value ${JSON.stringify(value)}`);
    }
    return table[value];
}

function oneOf(values: string[], value: string | undefined, context: string): string {
    if (value === undefined || !values.includes(value)) {
        throw new Error(`${context}: unknown value ${JSON.stringify(value)}`);
    }
    return value;
}

/** The images the wiki doesn't have (yet). */
const missing: string[] = [];

async function download(url: string): Promise<Buffer> {
    return Buffer.from(await (await fetchOk(url)).arrayBuffer());
}

/** Saves the images not on disk yet, and returns how many. */
async function saveImages(list: Download[]): Promise<number> {
    const queue = list.filter((d) => !image(dirname(d.file), basename(d.file)));
    const urls = await wikiImages(queue.map((d) => d.image));
    let saved = 0;
    const worker = async () => {
        for (let d = queue.shift(); d; d = queue.shift()) {
            const url = urls.get(d.image);
            if (url === undefined) {
                missing.push(d.image);
                continue;
            }
            await writeFile(`${d.file}.png`, await download(url));
            saved++;
        }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return saved;
}

async function writeJson(name: string, entries: Entry[]) {
    entries.sort((a, b) => a.id.localeCompare(b.id));
    await writeFile(join(DATA_DIR, name), JSON.stringify(entries, null, 4) + '\n');
}

// Game data and icons.

const [
    characterTitles,
    weaponTitles,
    setTitles,
    unreleased,
    questWeapons,
    goCharacters,
    goWeapons,
    goArtifacts
] = await Promise.all([
    wikiCategory('Playable Characters'),
    wikiCategory('Weapons'),
    wikiCategory('Artifact Sets'),
    wikiCategory('Unreleased Content'),
    wikiCategory('Quest-Exclusive Weapons'),
    goodKeys('character.ts', ['nonTravelerCharacterKeys', 'allTravelerKeys']),
    goodKeys(
        'weapon.ts',
        WEAPON_TYPES.map((t) => `allWeapon${t}Keys`)
    ),
    goodKeys('artifact.ts', ['allArtifactSetKeys'])
]);
// Unreleased Content is the beta's weapons, and quests lend variants of weapons of their own.
const skipped = new Set([...unreleased, ...questWeapons]);
const pages = await wikiPages(
    [...characterTitles, ...weaponTitles, ...setTitles].filter((title) => !skipped.has(title))
);

const characterEntries: Entry[] = [];
const weaponEntries: Entry[] = [];
const artifactEntries: Entry[] = [];
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
    icons.push({ image: icon, file: join(ICON_DIR, kind, entry.id) });
}

// Release versions, as "2.0.1": the version an entry's Change History on the wiki starts at, then
// the event wish phase that first featured it, or 0 for what came with the update itself, as every
// set did. A version's page lists the characters its banners featured, phase by phase. A character
// whose releaseDate is the update's came with it even if a later phase featured them, as Aino did
// through 6.0's story quest. Weapon banners aren't listed, but every version has had two weapon
// phases, 1.3's included, so an event wish weapon is from the first if it came out on the update.
const changeVersion = (page: string): string | undefined =>
    page.match(/\{\{Change History\|([^|}]+)/)?.[1].trim();
const versionNames = [...new Set([...pages.values()].map(changeVersion))].filter(
    (name) => name !== undefined
);
const versionPages = await wikiPages(versionNames.map((name) => `Version/${name}`));
const versions = new Map<string, Version>();
for (const name of versionNames) {
    const text = versionPages.get(`Version/${name}`);
    if (text !== undefined) versions.set(name, parseVersion(`Version/${name}`, text));
}
const versionOf = (title: string, page: string): Version => {
    const name = changeVersion(page);
    if (name !== undefined && versions.has(name)) return versions.get(name)!;
    throw new Error(`${title}: no version on the wiki`);
};
const releasedOnUpdate = (page: string, version: Version): boolean =>
    wikiField(page, 'releaseDate')?.startsWith(version.date) === true;

// An element's Traveler page has no weapon or rarity: the Traveler's own page has them.
const travelerPage = pages.get('Traveler');
if (travelerPage === undefined) throw new Error('Traveler: not on the wiki');
const wish: WishDownload[] = [];
for (const title of characterTitles) {
    const page = pages.get(title);
    if (page === undefined) continue;
    // The Traveler's and the Manekins' own pages have no element, or an adaptive one.
    const element = wikiField(page, 'element');
    if (element === undefined || !ELEMENTS.includes(element)) continue;
    if (!released(wikiField(page, 'releaseDate'), title)) continue;
    const traveler = page.includes('{{Traveler Infobox');
    const info = traveler ? travelerPage : page;
    const version = versionOf(title, page);
    if (version.phases.length === 0) throw new Error(`${title}: no event wishes for its version`);
    const index = version.phases.findIndex((featured) => featured.includes(title));
    let phase = 0;
    if (index === 0) phase = 1;
    if (index > 0 && !releasedOnUpdate(page, version)) phase = index + 1;
    const id = traveler ? `Traveler${element}` : toGoodKey(title);
    const entry = {
        id,
        name: traveler ? `${element} Traveler` : title,
        element,
        weaponType: oneOf(WEAPON_TYPES, wikiField(info, 'weapon'), title),
        rarity: lookup(STARS, wikiField(info, 'quality'), title),
        release: `${version.number}.${phase}`
    };
    // Every Traveler has Lumine's icon.
    const icon = traveler ? 'Lumine Icon.png' : `${title} Icon.png`;
    add(characterEntries, entry, goCharacters, 'characters', icon);
    if (!traveler && goCharacters.has(id)) {
        wish.push({ id, splash: `${title} Wish.png`, closeUp: `${title} Multi Wish.png` });
    }
}

for (const title of weaponTitles) {
    const page = pages.get(title);
    // The category also has pages about weapons, and the ores that level them.
    if (page === undefined || !page.includes('{{Weapon Infobox')) continue;
    if (!released(wikiField(page, 'releaseDate'), title)) continue;
    const version = versionOf(title, page);
    const eventWish = wikiField(page, 'obtain')?.includes('Event Wish') === true;
    const onUpdate = releasedOnUpdate(page, version);
    let phase = 0;
    if (eventWish && onUpdate) phase = 1;
    if (eventWish && !onUpdate) phase = 2;
    const entry = {
        id: toGoodKey(title),
        name: title,
        type: oneOf(WEAPON_TYPES, wikiField(page, 'type'), title),
        rarity: lookup(STARS, wikiField(page, 'quality'), title),
        release: `${version.number}.${phase}`
    };
    add(weaponEntries, entry, goWeapons, 'weapons', `Weapon ${title}.png`);
}

for (const title of setTitles) {
    const page = pages.get(title);
    if (page === undefined || !page.includes('{{Artifact Set Infobox')) continue;
    // A set's rarity is the highest it drops at, from its `|source<stars>.<n> = <where>` lines.
    // Initiate, worn only by trial characters, has just `|source1.1 = Unobtainable`.
    const drops = [...page.matchAll(/\|\s*source(\d)\.\d+\s*=\s*(.*)/g)]
        .filter(([, , where]) => where.trim() !== 'Unobtainable')
        .map(([, stars]) => Number(stars));
    if (drops.length === 0) continue;
    const version = versionOf(title, page);
    if (!released(version.date, title)) continue;
    const entry = {
        id: toGoodKey(title),
        name: title,
        rarity: lookup(STARS, String(Math.max(...drops)), title),
        release: `${version.number}.0`
    };
    // Its icon is its flower, or its circlet for the sets that are only circlets.
    const piece = wikiField(page, 'flower') ?? wikiField(page, 'circlet');
    add(artifactEntries, entry, goArtifacts, 'artifacts', `Item ${piece}.png`);
}

for (const kind of ['characters', 'weapons', 'artifacts']) {
    await mkdir(join(ICON_DIR, kind), { recursive: true });
}
const iconsSaved = await saveImages(icons);

await mkdir(DATA_DIR, { recursive: true });
await writeJson('characters.json', characterEntries);
await writeJson('weapons.json', weaponEntries);
await writeJson('artifacts.json', artifactEntries);

console.log(
    `${characterEntries.length} characters, ${weaponEntries.length} weapons, ` +
        `${artifactEntries.length} artifact sets; ${iconsSaved} new icons`
);
if (notInGood.length > 0) {
    console.warn('Left out, not in GOOD (fix toGoodKey if it should be):');
    for (const key of notInGood) console.warn(`  ${key}`);
}

// The wish art. A character's files are saved together or not at all, since a folder with only a
// splash is taken for the Traveler's.

const wishQueue = wish.filter((d) => !image(join(WISH_SRC_DIR, d.id), 'splash'));
const wishUrls = await wikiImages(wishQueue.flatMap((d) => [d.splash, d.closeUp]));
let wishSaved = 0;
const wishWorker = async () => {
    for (let d = wishQueue.shift(); d; d = wishQueue.shift()) {
        const splash = wishUrls.get(d.splash);
        const closeUp = wishUrls.get(d.closeUp);
        if (splash === undefined || closeUp === undefined) {
            missing.push(...[d.splash, d.closeUp].filter((name) => !wishUrls.has(name)));
            continue;
        }
        const dir = join(WISH_SRC_DIR, d.id);
        const [splashBytes, closeUpBytes] = await Promise.all([
            download(splash),
            download(closeUp)
        ]);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'splash.png'), splashBytes);
        await writeFile(join(dir, 'closeup.png'), closeUpBytes);
        wishSaved++;
    }
};
await Promise.all(Array.from({ length: 8 }, wishWorker));
console.log(`Wish art: ${wishSaved} characters saved`);

if (missing.length > 0) {
    console.warn('Not on the wiki (rerun later):');
    for (const name of missing) console.warn(`  ${name}`);
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

// The cutouts' masks.

const masks = await readMasks();
const toCut = (await wishSources()).filter((s) => {
    if (NO_CUTOUT.has(s.id) || (s.closeUp && !alignments[s.id])) return false;
    return !maskFits(s, alignments[s.id], masks);
});
const reframed = toCut.filter((s) => masks[s.id] && existsSync(maskFile(s.id))).map((s) => s.id);
if (toCut.length > 0) {
    const started = performance.now();
    const arts = await Promise.all(
        toCut.map(async (s) => (await wishArt(s, alignments[s.id])).png().toBuffer())
    );
    const cut = await cutMasks(arts);
    for (const [i, s] of toCut.entries()) {
        await writeFile(maskFile(s.id), cut[i]);
        masks[s.id] = framing(s, alignments[s.id]);
    }
    await writeMasks(masks);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`Masks: ${toCut.length} cut in ${seconds}s`);
    if (reframed.length > 0) {
        console.warn(`Cut again, as their art is framed differently: ${reframed.join(', ')}`);
    }
}
