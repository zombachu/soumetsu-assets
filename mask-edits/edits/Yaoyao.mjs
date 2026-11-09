// Yuegui, her jade rabbit, above her left, and the yellow starburst below her feet. The burst's key
// skips the box around her boot, whose ribbon is yellow.
const burst = (h, s, v) => (h >= 38 && h <= 66 && s > 0.1 && v > 0.8) || (h >= 25 && h <= 50 && s > 0.45 && v > 0.7);
const below = [[0,960],[356,960],[356,1135],[0,1135]];
export default [
    ['color', [[10,40],[165,40],[165,228],[10,228]], (h, s, v) => h >= 55 && h <= 110 && s > 0.25 && v > 0.3],
    ['islands', 300, 30, [[10,40],[165,40],[165,228],[10,228]]],
    ['color', [[0,960],[50,960],[50,1135],[0,1135]], burst],
    ['color', [[50,960],[155,960],[155,1060],[50,1060]], burst],
    ['color', [[155,960],[356,960],[356,1135],[155,1135]], burst],
    ['erase', [[0,1060],[72,1060],[80,1090],[85,1135],[0,1135]]],
    ['islands', 300, 30, below]
];
