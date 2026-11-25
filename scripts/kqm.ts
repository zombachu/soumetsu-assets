// Scrapes the KQM Sim Database (db.kqm.gg) for analysis:
// `node scripts/kqm.ts`
//
// kqm/raw.json holds every simulation as the API returns it, gcsim configs included. It's fetched
// only when missing, so delete it to scrape again. kqm/sims.json is derived from it on every run,
// one simulation a line, with each character's and weapon's soumetsu id and rarity from
// assets-src/data.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://db.kqm.gg/api/db';
const PAGE_SIZE = 100;

const ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'kqm');
const RAW_FILE = join(OUT_DIR, 'raw.json');
const SIMS_FILE = join(OUT_DIR, 'sims.json');

const STARS: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };

interface RawCharacter {
    name: string;
    level: number;
    cons?: number;
    talents: { attack: number; skill: number; burst: number };
    weapon: { name: string; refine: number; level: number };
    sets?: Record<string, number>;
}
interface RawSim {
    _id: string;
    description: string;
    submitter: string;
    create_date: string | number;
    accepted_tags: number[];
    summary: {
        team: RawCharacter[];
        target_count: number;
        mean_dps_per_target: number;
        sim_duration: { mean: number };
    };
}

interface GameEntry {
    id: string;
    rarity?: number;
}
interface Member {
    key: string;
    id?: string;
    rarity?: number;
    cons: number;
    level: number;
    talents: { attack: number; skill: number; burst: number };
    weapon: { key: string; id?: string; rarity?: number; refine: number; level: number };
    sets: Record<string, number>;
}
interface Sim {
    id: string;
    url: string;
    description: string;
    submitter: string;
    created: number;
    tags: number[];
    targets: number;
    dps: number;
    duration: number;
    team: Member[];
}

async function fetchPage(skip: number): Promise<RawSim[]> {
    const q = JSON.stringify({ query: {}, limit: PAGE_SIZE, skip, sort: { _id: 1 } });
    for (let attempt = 1; ; attempt++) {
        const response = await fetch(`${API}?q=${encodeURIComponent(q)}`);
        if (response.ok) {
            const body = (await response.json()) as { data?: RawSim[] | null };
            if (body.data === undefined || body.data === null) {
                return [];
            }
            return body.data;
        }
        if (attempt === 3) {
            throw new Error(`${response.status} ${response.statusText} at skip ${skip}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
}

async function fetchAll(): Promise<RawSim[]> {
    const sims = new Map<string, RawSim>();
    for (let skip = 0; ; skip += PAGE_SIZE) {
        const page = await fetchPage(skip);
        for (const sim of page) {
            sims.set(sim._id, sim);
        }
        console.log(`${skip + page.length} fetched`);
        if (page.length < PAGE_SIZE) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return Array.from(sims.values());
}

await mkdir(OUT_DIR, { recursive: true });
if (!existsSync(RAW_FILE)) {
    const sims = await fetchAll();
    await writeFile(RAW_FILE, JSON.stringify(sims));
    console.log(`${sims.length} simulations written to ${RAW_FILE}`);
}
const raw = JSON.parse(await readFile(RAW_FILE, 'utf8')) as RawSim[];

async function readGameData(file: string): Promise<Map<string, GameEntry>> {
    const entries = JSON.parse(await readFile(join(ROOT, 'assets-src/data', file), 'utf8')) as {
        id: string;
        rarity: string;
    }[];
    return new Map(
        entries.map((entry) => [
            entry.id.toLowerCase(),
            { id: entry.id, rarity: STARS[entry.rarity] }
        ])
    );
}
const characters = await readGameData('characters.json');
const weapons = await readGameData('weapons.json');

const unmapped = new Set<string>();
function lookUp(table: Map<string, GameEntry>, key: string): GameEntry | undefined {
    const entry = table.get(key);
    if (entry === undefined) {
        unmapped.add(key);
    }
    return entry;
}
function lookUpCharacter(key: string): GameEntry | undefined {
    const traveler = /^(aether|lumine)(\w+)$/.exec(key);
    if (traveler !== null) {
        return lookUp(characters, `traveler${traveler[2]}`);
    }
    return lookUp(characters, key);
}

function toMember(character: RawCharacter): Member {
    const entry = lookUpCharacter(character.name);
    const weapon = lookUp(weapons, character.weapon.name);
    return {
        key: character.name,
        id: entry?.id,
        rarity: entry?.rarity,
        cons: character.cons ?? 0,
        level: character.level,
        talents: character.talents,
        weapon: {
            key: character.weapon.name,
            id: weapon?.id,
            rarity: weapon?.rarity,
            refine: character.weapon.refine,
            level: character.weapon.level
        },
        sets: character.sets ?? {}
    };
}

const sims: Sim[] = raw.map((sim) => ({
    id: sim._id,
    url: `https://db.kqm.gg/db/${sim._id}`,
    description: sim.description,
    submitter: sim.submitter,
    created: Number(sim.create_date),
    tags: sim.accepted_tags,
    targets: sim.summary.target_count,
    dps: sim.summary.mean_dps_per_target,
    duration: sim.summary.sim_duration.mean,
    team: sim.summary.team.map(toMember)
}));
await writeFile(SIMS_FILE, `[\n${sims.map((sim) => JSON.stringify(sim)).join(',\n')}\n]\n`);
console.log(`${sims.length} simulations written to ${SIMS_FILE}`);
if (unmapped.size > 0) {
    console.warn(`Not in assets-src/data, so no id or rarity: ${Array.from(unmapped).join(', ')}`);
}
