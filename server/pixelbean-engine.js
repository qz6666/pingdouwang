"use strict";
/* ========== 像素豆 PixelBean · 服务端拼豆转换引擎 ==========
   无 DOM 依赖，纯 Node 计算模块。
   约定：客户端负责解码图片，把像素以「扁平 RGBA 数组」传上来，
        服务端做 k-means 主色提取 + 12 色官方色板匹配 + 各规格用豆量统计。
   算法与前端 deploy/assets/bead.js / color.html 中保持一致，保证两端结果可对照。
*/

var PALETTE = [
  { name: "珊瑚粉", hex: "#EC6A9C" },
  { name: "正红",   hex: "#E5484D" },
  { name: "深红",   hex: "#C9434B" },
  { name: "橘红",   hex: "#F2643E" },
  { name: "暖橙",   hex: "#F4A259" },
  { name: "亮黄",   hex: "#F4C041" },
  { name: "青绿",   hex: "#1FA89A" },
  { name: "天蓝",   hex: "#5AA9E6" },
  { name: "草绿",   hex: "#6FCF97" },
  { name: "奶白",   hex: "#F6F1E7" },
  { name: "浅棕",   hex: "#C9A27E" },
  { name: "墨黑",   hex: "#241E18" }
];

var RGB = PALETTE.map(function (p) {
  var h = p.hex.replace("#", "");
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
});

function hexToRgb(hex) {
  var h = String(hex).replace("#", "");
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function rgbToHex(rgb) {
  return "#" + rgb.map(function (v) {
    var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
    return s.length < 2 ? "0" + s : s;
  }).join("");
}

/* 最近官方色板索引（欧氏距离） */
function nearestBead(r, g, b) {
  var best = 0, bd = Infinity;
  for (var i = 0; i < RGB.length; i++) {
    var dr = r - RGB[i][0], dg = g - RGB[i][1], db = b - RGB[i][2];
    var d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* 把扁平 RGBA 数组转成 [r,g,b] 点集，忽略透明像素 */
function toPoints(flat) {
  var pts = [];
  if (!flat) return pts;
  for (var i = 0; i < flat.length; i += 4) {
    if (flat[i + 3] < 128) continue;
    pts.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  if (!pts.length) pts.push([240, 240, 240]);
  return pts;
}

/* k-means 提取主色（k-means++ 初始化，12 次迭代） */
function kmeans(flat, kk) {
  var pts = toPoints(flat);
  if (!pts.length) return [];
  var k = Math.max(1, Math.min(kk || 8, pts.length));
  var centers = [pts[Math.floor(Math.random() * pts.length)].slice()];
  while (centers.length < k) {
    var bestd = -1, bestp = pts[0];
    for (var t = 0; t < pts.length; t += Math.max(1, Math.floor(pts.length / 200))) {
      var pd = Infinity;
      for (var ci = 0; ci < centers.length; ci++) {
        var dr = pts[t][0] - centers[ci][0], dg = pts[t][1] - centers[ci][1], db = pts[t][2] - centers[ci][2];
        var dd = dr * dr + dg * dg + db * db;
        if (dd < pd) pd = dd;
      }
      if (pd > bestd) { bestd = pd; bestp = pts[t]; }
    }
    centers.push(bestp.slice());
  }
  for (var it = 0; it < 12; it++) {
    var sums = centers.map(function () { return [0, 0, 0, 0]; });
    for (var p = 0; p < pts.length; p++) {
      var bi = 0, bd2 = Infinity;
      for (var cj = 0; cj < centers.length; cj++) {
        var er = pts[p][0] - centers[cj][0], eg = pts[p][1] - centers[cj][1], eb = pts[p][2] - centers[cj][2];
        var e = er * er + eg * eg + eb * eb;
        if (e < bd2) { bd2 = e; bi = cj; }
      }
      sums[bi][0] += pts[p][0]; sums[bi][1] += pts[p][1]; sums[bi][2] += pts[p][2]; sums[bi][3]++;
    }
    for (var cj2 = 0; cj2 < centers.length; cj2++) {
      if (sums[cj2][3] > 0) centers[cj2] = [sums[cj2][0] / sums[cj2][3], sums[cj2][1] / sums[cj2][3], sums[cj2][2] / sums[cj2][3]];
    }
  }
  var pop = centers.map(function () { return 0; });
  for (var p2 = 0; p2 < pts.length; p2++) {
    var bi2 = 0, bd3 = Infinity;
    for (var cj3 = 0; cj3 < centers.length; cj3++) {
      var er2 = pts[p2][0] - centers[cj3][0], eg2 = pts[p2][1] - centers[cj3][1], eb2 = pts[p2][2] - centers[cj3][2];
      var e2 = er2 * er2 + eg2 * eg2 + eb2 * eb2;
      if (e2 < bd3) { bd3 = e2; bi2 = cj3; }
    }
    pop[bi2]++;
  }
  return centers.map(function (cc, i) { return { rgb: cc, pop: pop[i] }; })
                 .sort(function (a, b) { return b.pop - a.pop; });
}

/* 按规格统计每种色用豆量，返回 [{idx,name,hex,count}] 降序 */
function estimateCounts(flat, gridSize) {
  var counts = new Array(PALETTE.length).fill(0);
  var n = gridSize * gridSize;
  for (var i = 0; i < n; i++) {
    var idx = i * 4;
    if (flat && flat[idx + 3] !== undefined && flat[idx + 3] < 128) continue;
    counts[nearestBead(flat[idx], flat[idx + 1], flat[idx + 2])]++;
  }
  return PALETTE.map(function (p, i) {
    return { idx: i, name: p.name, hex: p.hex, count: counts[i] };
  }).sort(function (a, b) { return b.count - a.count; });
}

/* 统一处理入口 */
function process(input) {
  input = input || {};
  var k = input.k || 8;
  var size = input.size || 29;
  var samplePts = input.sample ? toPoints(input.sample) : [];
  var colors = samplePts.length ? kmeans(input.sample, k).map(function (c) {
    var bi = nearestBead(c.rgb[0], c.rgb[1], c.rgb[2]);
    return {
      rgb: c.rgb,
      hex: rgbToHex(c.rgb),
      pop: c.pop,
      pct: Math.round(c.pop / samplePts.length * 100),
      bead: { name: PALETTE[bi].name, hex: PALETTE[bi].hex }
    };
  }) : [];
  var scheme = estimateCounts(input.grid, size);
  return {
    colors: colors,
    scheme: scheme,
    total: size * size,
    dims: { w: size, h: size }
  };
}

module.exports = {
  PALETTE: PALETTE,
  RGB: RGB,
  hexToRgb: hexToRgb,
  rgbToHex: rgbToHex,
  nearestBead: nearestBead,
  kmeans: kmeans,
  estimateCounts: estimateCounts,
  process: process
};
