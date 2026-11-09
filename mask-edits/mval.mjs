// Print mask values on a grid: node mval.mjs <id> x0 y0 x1 y1 step [src=out]
import sharp from 'sharp';
const [id, x0, y0, x1, y1, step, src = 'out'] = process.argv.slice(2);
const { data, info } = await sharp(`${import.meta.dirname}/${src}/${id}.png`).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
let head = '     ';
for (let x = +x0; x < +x1; x += +step) head += String(x).padStart(4);
console.log(head);
for (let y = +y0; y < +y1; y += +step) {
    let row = String(y).padStart(5);
    for (let x = +x0; x < +x1; x += +step) row += String(data[y * info.width + x]).padStart(4);
    console.log(row);
}
