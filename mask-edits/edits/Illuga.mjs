// The gold ribbon behind his head, by colour, then its pale core, and the motes around him.
// Where it crosses his boots it stays: it's in front of him.
const top = [[0,0],[356,0],[356,470],[0,470]];
export default [
    ['color', top, (h, s, v) => h > 22 && h < 65 && s > 0.4 && v > 0.35],
    ['erase',
        [[0,200],[42,200],[42,290],[50,310],[50,350],[56,380],[64,400],[72,412],[76,422],[0,440]],
        [[312,345],[356,340],[356,375],[312,372]]
    ],
    ['islands', 300, 30, top]
];
