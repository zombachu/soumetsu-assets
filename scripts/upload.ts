// Puts dist/ (see build.ts) into the R2 bucket under v/<commit>/, where <commit> is this repo's
// current commit, so each upload gets its own folder and a deployed site never sees its files
// change. Then prints the URL to set as ASSETS in the site's src/lib/assets.ts:
// `npm run upload`
//
// Needs a clean working tree, so the folder name says exactly what's in it, and the R2 keys in
// .env (see .env.example).

import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ROOT } from './wish-art.ts';

const DIST = join(ROOT, 'dist');
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

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) {
	console.error('Commit your changes first, so the upload matches a commit.');
	process.exit(1);
}
const version = git('rev-parse', '--short', 'HEAD');
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

// Every file in dist/ but the build's own (.inputs.json).
const files = (await readdir(DIST, { recursive: true, withFileTypes: true }))
	.filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
	.map((entry) => join(entry.parentPath, entry.name));
if (!files.some((file) => file.endsWith('.json'))) {
	console.error('dist/ has no data: run npm run build first.');
	process.exit(1);
}

let uploaded = 0;
const queue = [...files];
const worker = async () => {
	for (let file = queue.shift(); file; file = queue.shift()) {
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: `${prefix}/${relative(DIST, file).split('\\').join('/')}`,
				Body: await readFile(file),
				ContentType: TYPES[extname(file)] ?? 'application/octet-stream',
				// A folder's files never change, so browsers can keep them for good.
				CacheControl: 'public, max-age=31536000, immutable'
			})
		);
		if (++uploaded % 100 === 0) console.log(`${uploaded} / ${files.length}`);
	}
};
await Promise.all(Array.from({ length: 16 }, worker));
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: LAST, Body: version }));

console.log(`Uploaded ${uploaded} files. In the site's src/lib/assets.ts, set:`);
console.log(`export const ASSETS = '${url}';`);
