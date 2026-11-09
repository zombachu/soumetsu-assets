// Print HSV of art pixels: node px.mjs <id> x,y x,y ...
import sharp from 'sharp';
const [id, ...pts] = process.argv.slice(2);
const { data, info } = await sharp(`${import.meta.dirname}/../dist/art/wish/${id}.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (const pt of pts) {
    const [x, y] = pt.split(',').map(Number);
    const p = (y * info.width + x) * 4;
    const [r, g, b, a] = data.slice(p, p + 4);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    console.log(pt, [r, g, b, a].join(' '), 'h', h.toFixed(0), 's', (mx ? d / mx : 0).toFixed(2), 'v', (mx / 255).toFixed(2));
}
