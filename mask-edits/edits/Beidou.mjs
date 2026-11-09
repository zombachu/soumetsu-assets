// The electro crystal behind her sword's hilt, by colour, then its loose outline pieces.
const around = [[203,660],[305,660],[305,805],[203,805]];
export default [
    ['color', around, (h, s) => h > 230 && h < 300 && s > 0.15],
    ['islands', 150, 60, around]
];
