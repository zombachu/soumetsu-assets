// The upscaler for the 2× wish art (see wish-art.ts): 4x-AnimeSharp, run through Core ML on macOS
// (about 3 s a close-up on an M5 Pro) and on the CPU elsewhere (about 12 s).
//
// Measured on all the close-ups, halved and upscaled back, it came out the sharpest that keeps the
// art as drawn: Real-ESRGAN's anime 6B and APISR add heavy outlines, Real-ESRGAN's animevideov3
// smooths out texture, and Apple's VideoToolbox scaler is softer.
//
// Its weights are CC BY-NC-SA 4.0: non-commercial use only.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import sharp from 'sharp';

const MODEL = resolve(import.meta.dirname, '../.cache/4x-AnimeSharp-fp32-opset16.onnx');
const MODEL_URL =
    'https://huggingface.co/Kim2091/AnimeSharp/resolve/main/ONNX/4x-AnimeSharp-fp32-opset16.onnx';
export const MODEL_SHA256 = 'da3c917439487e0c5b897aae776ce82759dabe8b68a00b0a1fdf5af2f90cc5eb';
const SCALE = 4;

let session: Promise<InferenceSession> | undefined;

/** `image` at four times its size: colours through the model, alpha resized with Lanczos. */
export async function upscale(image: Buffer): Promise<Buffer> {
    session ??= model().then((file) =>
        InferenceSession.create(file, {
            executionProviders: [process.platform === 'darwin' ? 'coreml' : 'cpu'],
            // Core ML warns at every start that it leaves a couple of nodes to the CPU.
            logSeverityLevel: 3
        })
    );
    const { data, info } = await sharp(image)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const input = new Float32Array(3 * n);
    for (let p = 0; p < n; p++) {
        for (let c = 0; c < 3; c++) input[c * n + p] = data[p * 4 + c] / 255;
    }
    const tensor = new Tensor('float32', input, [1, 3, info.height, info.width]);
    const { output } = await (await session).run({ input: tensor });
    const rgb = output.data as Float32Array;

    const width = info.width * SCALE;
    const height = info.height * SCALE;
    const alpha = await sharp(image)
        .ensureAlpha()
        .extractChannel(3)
        .resize(width, height, { kernel: 'lanczos3' })
        .raw()
        .toBuffer();
    const N = width * height;
    const rgba = Buffer.alloc(4 * N);
    for (let p = 0; p < N; p++) {
        for (let c = 0; c < 3; c++) {
            rgba[p * 4 + c] = Math.round(Math.min(Math.max(rgb[c * N + p], 0), 1) * 255);
        }
        rgba[p * 4 + 3] = alpha[p];
    }
    return sharp(rgba, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
}

/** The path of the model (67 MB), downloaded the first time. */
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
