// Pink firework sparks among the hair strands above her head.
const top = [[0,0],[356,0],[356,260],[0,260]];
export default [['color', top, (h, s, v) => (h >= 315 || h <= 5) && s > 0.3 && v > 0.75], ['islands', 80, 30, top]];
