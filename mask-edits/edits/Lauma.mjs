// The cyan haze of the backdrop between her hair strands at the left edge and right of her hair.
export default [
    ['color', [[0,280],[45,280],[45,640],[30,640],[30,760],[0,760]], (h, s, v) => h >= 160 && h <= 220 && v > 0.45],
    ['color', [[300,330],[356,330],[356,520],[300,520]], (h, s, v) => h >= 160 && h <= 220 && v > 0.45]
];
