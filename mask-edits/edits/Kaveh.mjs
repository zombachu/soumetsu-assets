// The green glow of the dendro construct behind his hair.
const left = [[0,220],[102,220],[102,492],[60,492],[0,488]];
export default [
    ['color', left, (h, s, v) => h > 70 && h < 150 && s > 0.3 && v > 0.3],
    ['islands', 120, 30, left],
    ['restore', [[0,476],[20,468],[36,462],[48,465],[60,472],[100,474],[102,540],[0,540]]]
];
