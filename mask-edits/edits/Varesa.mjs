// The pale halftone backdrop and its lilac streaks right of her leg, around her tail (pink, kept).
export default [
    ['color', [[262,780],[356,780],[356,1135],[300,1135],[290,1050],[278,950],[268,850]],
        (h, s, v) => (s < 0.2 && v > 0.5) || (h >= 160 && h <= 325 && v > 0.35)],
    ['islands', 150, 40, [[262,780],[356,780],[356,1135],[262,1135]]]
];
