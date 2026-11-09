// The teal anemo wisps of the backdrop around him, and lightning left of his sash. The key spares
// his hair, a darker and bluer teal (h 197–205, v < 0.46).
const top = [[0,0],[356,0],[356,480],[0,480]];
export default [
    ['color', top, (h, s, v) => h >= 165 && h <= 195 && s > 0.3 && v > 0.5],
    ['color', [[0,395],[112,395],[112,525],[0,525]], (h, s, v) => h >= 170 && h <= 194 && s > 0.4 && v > 0.3],
    ['islands', 300, 30, top],
    ['color', [[0,880],[70,880],[55,960],[0,1040]], (h, s, v) => h >= 165 && h <= 200 && s > 0.4 && v > 0.55]
];
