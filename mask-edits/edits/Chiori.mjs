const bottom = [[0,990],[260,990],[260,1139],[0,1139]];
export default [
    // The gold ribbon behind her sleeve.
    ['erase', [[0,706],[22,716],[38,726],[44,740],[52,752],[62,758],[72,760],[72,768],[60,790],[50,790],[0,762]]],
    // The disc and blue flower behind her legs: left of the sword's tassel, then by colour.
    ['erase', [[0,1038],[46,1042],[84,1046],[96,1139],[0,1139]], [[0,930],[16,930],[10,1000],[0,1000]]],
    ['color', bottom, (h, s, v) => h > 200 && h < 320 && s > 0.12 && v > 0.35],
    ['color', [[112,1040],[165,1040],[165,1115],[118,1115]], (h, s, v) => s < 0.4 && v > 0.55],
    ['islands', 300, 40, bottom],
    // Her stocking, half see-through.
    ['fill', [[262,1000],[300,990],[356,975],[356,1139],[250,1139],[248,1060]]]
];
