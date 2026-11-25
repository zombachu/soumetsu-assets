// Puts ../soumetsu-cdn/ (see build.ts) into the R2 bucket at the same paths, uploading only the
// files that are new or changed. Nothing in the bucket is deleted, so a deployed site keeps finding
// every file it was built against. The site's `npm run deploy` runs this before deploying:
// `npm run upload`
//
// Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in .env.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CDN_DIR } from './wish-art.ts';

const TYPES: Record<string, string> = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.json': 'application/json'
};

const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} isn't set in .env`);
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

const bucket = env('R2_BUCKET');
const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: env('R2_ACCESS_KEY_ID'),
        secretAccessKey: env('R2_SECRET_ACCESS_KEY')
    }
});

// R2 gives a file uploaded in one request the MD5 of its contents as its ETag.
const etags = new Map<string, string>();
let page: string | undefined;
do {
    const list = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: page })
    );
    for (const { Key, ETag } of list.Contents ?? []) {
        if (Key !== undefined && ETag !== undefined) etags.set(Key, ETag.replaceAll('"', ''));
    }
    page = list.NextContinuationToken;
} while (page !== undefined);

let added = 0;
let changed = 0;
const queue = [...keys];
const worker = async () => {
    for (let key = queue.shift(); key; key = queue.shift()) {
        const body = await readFile(join(CDN_DIR, key));
        const etag = etags.get(key);
        if (etag === createHash('md5').update(body).digest('hex')) continue;

        await s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: TYPES[extname(key)] ?? 'application/octet-stream',
                // A file can be replaced at the same URL, so browsers check for a new one daily.
                CacheControl: 'public, max-age=86400'
            })
        );
        if (etag === undefined) {
            added++;
        } else {
            changed++;
        }
        if ((added + changed) % 100 === 0) console.log(`${added + changed} uploaded`);
    }
};
await Promise.all(Array.from({ length: 16 }, worker));

console.log(
    `Uploaded ${added} new and ${changed} changed files, ${keys.length - added - changed} unchanged.`
);
