/* ========== 像素豆 PixelBean · 数据后端前端封装 ==========
   优先调用数据后端 /api/process，失败时由调用方回退到客户端 bead.js。
   仅依赖 fetch（现代浏览器均支持）。
*/
window.PixelBeanAPI = (function () {
  "use strict";

  function post(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* 把图片解码为扁平 RGBA 数组（居中裁方 → 缩放到 w×h） */
  function extractPixels(img, w, h) {
    var sw = img.width || img.naturalWidth, sh = img.height || img.naturalHeight;
    var side = Math.min(sw, sh);
    var sx = (sw - side) / 2, sy = (sh - side) / 2;
    var tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    var x = tmp.getContext("2d");
    x.drawImage(img, sx, sy, side, side, 0, 0, w, h);
    return Array.from(x.getImageData(0, 0, w, h).data);
  }

  /* 主接口：把像素送后端，返回主色+色板匹配+用豆量 */
  function process(img, opts) {
    opts = opts || {};
    var k = opts.k || 8;
    var size = opts.size || 29;
    var sample = extractPixels(img, 80, 80);
    var grid = extractPixels(img, size, size);
    return post("/api/process", {
      sample: sample, grid: grid, k: k, size: size
    });
  }

  /* 精确分解接口：直接发送已逐格取色好的网格数组，后端仅做色板匹配与用豆量统计 */
  function processGrid(grid, size) {
    return post("/api/process", { grid: Array.from(grid), size: size || 29 });
  }

  function palette() {
    return fetch("/api/palette").then(function (r) { return r.json(); }).then(function (d) { return d.palette; });
  }

  function health() {
    return fetch("/api/health").then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  return { process: process, processGrid: processGrid, palette: palette, health: health, extractPixels: extractPixels };
})();
