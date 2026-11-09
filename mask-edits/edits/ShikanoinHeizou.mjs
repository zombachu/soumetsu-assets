// The anemo glow arcs of the backdrop: behind his right arm, at the bottom right, and left of his
// face. The right region stops above his vision, which is teal too.
const teal = (h, s, v) => h >= 140 && h <= 210 && s > 0.12 && v > 0.35;
export default [
    ['color', [[250,560],[356,560],[356,785],[250,785]], teal],
    ['color', [[270,880],[356,880],[356,1135],[270,1135]], teal],
    ['color', [[0,230],[120,230],[120,520],[0,520]], teal]
];
