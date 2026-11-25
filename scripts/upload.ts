// Puts ../soumetsu-cdn/ (see build.ts) into the R2 bucket under v/<hash>/, where <hash> comes
// from the files' contents and paths, so changed files get a new folder and a deployed site never
// sees its files change. Then prints the URL to set as ASSETS in the site's src/lib/assets.ts:
// `npm run upload`
//
// Needs the R2 keys in .env (see .env.example).

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CDN_DIR } from './wish-art.ts';

const TYPES: Record<string, string> = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.json': 'application/json'
};

const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} isn't set: copy .env.example to .env and fill it in`);
    return value;
};

// The files' keys in the bucket, leaving out hidden files and folders: Finder's .DS_Store, and the
// .git/fork/ settings the Fork git client writes into a folder it still lists as a repo.
const keys = (await readdir(CDN_DIR, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(CDN_DIR, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .filter((key) => !key.split('/').some((part) => part.startsWith('.')))
    .sort();
if (keys.length === 0) {
    console.error(`${CDN_DIR} is empty: run npm run build first.`);
    process.exit(1);
}

// The SHA-256 of the files' `shasum -a 256` lines.
const hash = createHash('sha256');
for (const key of keys) {
    const digest = createHash('sha256').update(await readFile(join(CDN_DIR, key))).digest('hex');
    hash.update(`${digest}  ${key}\n`);
}
const version = hash.digest('hex').slice(0, 12);
const prefix = `v/${version}`;
const url = `${env('R2_PUBLIC_URL').replace(/\/$/, '')}/${prefix}`;

const bucket = env('R2_BUCKET');
const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: env('R2_ACCESS_KEY_ID'),
        secretAccessKey: env('R2_SECRET_ACCESS_KEY')
    }
});

// The last file uploaded, so a folder that has it is complete.
const LAST = `${prefix}/done`;
try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: LAST }));
    console.log(`Already uploaded: ${url}`);
    process.exit(0);
} catch (e) {
    if ((e as { name?: string }).name !== 'NotFound') throw e;
}

let uploaded = 0;
const queue = [...keys];
const worker = async () => {
    for (let key = queue.shift(); key; key = queue.shift()) {
        await s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: `${prefix}/${key}`,
                Body: await readFile(join(CDN_DIR, key)),
                ContentType: TYPES[extname(key)] ?? 'application/octet-stream',
                // A folder's files never change, so browsers can keep them for good.
                CacheControl: 'public, max-age=31536000, immutable'
            })
        );
        if (++uploaded % 100 === 0) console.log(`${uploaded} / ${keys.length}`);
    }
};
await Promise.all(Array.from({ length: 16 }, worker));
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: LAST, Body: version }));

console.log(`Uploaded ${uploaded} files. In the site's src/lib/assets.ts, set:`);
console.log(`export const ASSETS = '${url}';`);
