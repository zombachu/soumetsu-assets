// The golden glow of the backdrop: its flare above her right, and the pale yellow shape behind her
// hair and arm.
export default [
    ['erase', [[150,0],[356,0],[356,240],[310,240],[300,190],[270,180],[150,100]]],
    ['color', [[265,240],[356,240],[356,720],[300,720],[290,600],[280,468],[265,468]], (h, s, v) => h >= 36 && h <= 75 && s > 0.12 && v > 0.55],
    ['color', [[292,240],[356,240],[356,468],[292,468]], (h, s, v) => h >= 30 && h <= 100 && s > 0.05 && v > 0.6]
];
