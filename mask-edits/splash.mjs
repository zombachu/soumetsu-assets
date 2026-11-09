// Splash crop around the close-up, for context: node splash.mjs <id> [pad=0.6]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
const W = join(import.meta.dirname, '../assets-src/wish');
const [id, padArg] = process.argv.slice(2);
const al = JSON.parse(readFileSync(join(W, 'alignments.json'), 'utf8'))[id];
const f = ['png', 'webp'].map((e) => join(W, id, 'splash.' + e)).find(existsSync);
const m = await sharp(f).metadata();
const pad = Number(padArg ?? 0.6);
const x0 = Math.max(0, Math.round(al.x - al.w * pad * 2));
const x1 = Math.min(m.width, Math.round(al.x + al.w * (1 + pad * 2)));
const y0 = Math.max(0, Math.round(al.y - al.h * pad * 0.5));
const y1 = Math.min(m.height, Math.round(al.y + al.h * (1 + pad * 0.5)));
await sharp(f).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).resize({ height: 900 }).flatten({ background: '#000' }).png().toFile(join(import.meta.dirname, 'splash.png'));
console.log(id, al, x0, y0, x1, y1);
