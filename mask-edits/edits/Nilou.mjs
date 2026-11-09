// The glowing blue patterns of the backdrop above her crown, the flame-shaped one with its white
// centre, and its glow between the crown's spikes.
export default [
    ['color', [[0,0],[356,0],[356,205],[0,205]], (h, s, v) => h >= 160 && h <= 250 && s > 0.2 && v > 0.35],
    ['color', [[100,205],[250,205],[250,240],[100,240]], (h, s, v) => h >= 160 && h <= 250 && s > 0.2 && v > 0.35],
    ['erase', [[138,140],[167,140],[167,182],[138,182]]]
];
