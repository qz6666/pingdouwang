/* ========== 像素豆 PixelBean · 拼豆转换引擎 ==========
   把任意图片转换成拼豆风格点阵，并匹配到 12 色官方色板。
   用法：
     PixelBean.renderBeadArt(canvas, imageOrCanvas, gridSize)  // 渲染预览
     PixelBean.estimateCounts(imageOrCanvas, gridSize)         // 返回每种色用豆量
*/
window.PixelBean = (function () {
  "use strict";

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

  function nearest(r, g, b) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < RGB.length; i++) {
      var dr = r - RGB[i][0], dg = g - RGB[i][1], db = b - RGB[i][2];
      var d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* 把图片按比例裁成正方形，缩放到 gridSize×gridSize，返回每格采样像素 */
  function sampleGrid(img, gridSize) {
    var sw = img.width || img.naturalWidth, sh = img.height || img.naturalHeight;
    var side = Math.min(sw, sh);
    var sx = (sw - side) / 2, sy = (sh - side) / 2;
    var tmp = document.createElement("canvas");
    tmp.width = gridSize; tmp.height = gridSize;
    var tctx = tmp.getContext("2d");
    tctx.drawImage(img, sx, sy, side, side, 0, 0, gridSize, gridSize);
    return tctx.getImageData(0, 0, gridSize, gridSize).data;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 立体珠渲染：真实光泽圆珠（径向渐变 + 边缘暗角 + 镜面高光 + 接触阴影）
     x,y 为格子左上角；cell 为格宽；hex 珠色；pad 控制珠子与格边的间隙（间隙越大越像 pegboard） */
  function drawBead(ctx, x, y, cell, hex, pad) {
    var r = (cell - 2 * pad) / 2, cx = x + cell / 2, cy = y + cell / 2;
    // 接触阴影（微微下沉、偏右下）
    ctx.fillStyle = "rgba(36,30,24,0.10)";
    ctx.beginPath(); ctx.arc(cx + cell * 0.02, cy + cell * 0.06, r * 1.0, 0, Math.PI * 2); ctx.fill();
    // 珠体：上左亮、下右暗的径向渐变，制造圆润塑料光泽
    var g = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.12, cx, cy, r * 1.08);
    g.addColorStop(0, shade(hex, 0.36));
    g.addColorStop(0.5, hex);
    g.addColorStop(1, shade(hex, -0.22));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // 边缘暗角（rim），增强立体感
    ctx.strokeStyle = shade(hex, -0.34); ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2); ctx.stroke();
    // 镜面高光点（小而亮）
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.36, r * 0.17, 0, Math.PI * 2); ctx.fill();
    // 柔光晕（上方弧形反光）
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.arc(cx - r * 0.16, cy - r * 0.16, r * 0.5, Math.PI * 1.05, Math.PI * 1.7); ctx.fill();
  }

  /* 2x 超采样后下采样，消除珠边锯齿 */
  var SS = 2;
  function withSuper(W, H, draw) {
    var off = document.createElement("canvas");
    off.width = W * SS; off.height = H * SS;
    var o = off.getContext("2d");
    draw(o, off.width, off.height);
    return off;
  }

  /* 渲染拼豆点阵到可见 canvas（超采样抗锯齿 + 立体珠 + 留缝） */
  function renderBeadArt(canvas, img, gridSize) {
    var data = sampleGrid(img, gridSize);
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext("2d");
    var off = withSuper(W, H, function (o, OW, OH) {
      o.fillStyle = "#FFFFFF"; o.fillRect(0, 0, OW, OH);
      var cell = OW / gridSize, pad = cell * 0.06;
      for (var row = 0; row < gridSize; row++) {
        for (var col = 0; col < gridSize; col++) {
          var idx = (row * gridSize + col) * 4;
          var ci = nearest(data[idx], data[idx + 1], data[idx + 2]);
          drawBead(o, col * cell, row * cell, cell, PALETTE[ci].hex, pad);
        }
      }
    });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W, H);
  }

  /* 统计每种颜色的用豆量，返回 [{idx,name,hex,count}]（已按数量降序） */
  function estimateCounts(img, gridSize) {
    var data = sampleGrid(img, gridSize);
    var counts = new Array(PALETTE.length).fill(0);
    var n = gridSize * gridSize;
    for (var i = 0; i < n; i++) {
      var idx = (i * 4);
      counts[nearest(data[idx], data[idx + 1], data[idx + 2])]++;
    }
    return PALETTE.map(function (p, i) {
      return { idx: i, name: p.name, hex: p.hex, count: counts[i] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  /* 生成一张示例图（爱心），无需上传即可体验 */
  function makeSample() {
    var c = document.createElement("canvas");
    c.width = 260; c.height = 260;
    var x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, 260, 260);
    g.addColorStop(0, "#F2643E"); g.addColorStop(1, "#EC6A9C");
    x.fillStyle = "#F6F1E7"; x.fillRect(0, 0, 260, 260);
    x.fillStyle = g;
    x.beginPath();
    var cx = 130, cy = 120, s = 70;
    for (var t = 0; t <= Math.PI * 2; t += 0.01) {
      var px = 16 * Math.pow(Math.sin(t), 3);
      var py = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      var X = cx + px * s / 16, Y = cy - py * s / 16;
      if (t === 0) x.moveTo(X, Y); else x.lineTo(X, Y);
    }
    x.closePath(); x.fill();
    return c;
  }

  /* 颜色明暗调整：amt>0 变亮，amt<0 变暗 */
  function shade(hex, amt) {
    var h = hex.replace("#", "");
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    function hx(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }
    return "#" + hx(r) + hx(g) + hx(b);
  }

  /* 渲染带坐标网格的拼豆图纸（多规格图纸 / 一键打印） */
  function renderBlueprint(canvas, img, gridSize, margin) {
    margin = margin || 0;
    var data = sampleGrid(img, gridSize);
    var total = canvas.width;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, total, total);
    var inner = total - margin * 2;
    var cell = inner / gridSize;
    var r = cell * 0.40;
    for (var row = 0; row < gridSize; row++) {
      for (var col = 0; col < gridSize; col++) {
        var idx = (row * gridSize + col) * 4;
        var ci = nearest(data[idx], data[idx + 1], data[idx + 2]);
        var cx = margin + col * cell + cell / 2;
        var cy = margin + row * cell + cell / 2;
        ctx.fillStyle = PALETTE[ci].hex;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.strokeStyle = "rgba(36,30,24,0.16)"; ctx.lineWidth = 1;
    for (var i = 0; i <= gridSize; i++) {
      var p = margin + i * cell;
      ctx.beginPath(); ctx.moveTo(p, margin); ctx.lineTo(p, margin + inner); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin, p); ctx.lineTo(margin + inner, p); ctx.stroke();
    }
    if (margin > 0) {
      ctx.fillStyle = "#6E655A";
      ctx.font = "600 " + Math.max(9, Math.min(14, Math.floor(cell * 0.5))) + "px 'Outfit', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (var c = 0; c < gridSize; c++) {
        var label = gridSize <= 26 ? String.fromCharCode(65 + c) : String(c + 1);
        ctx.fillText(label, margin + c * cell + cell / 2, margin / 2);
      }
      for (var rr = 0; rr < gridSize; rr++) {
        ctx.fillText(String(rr + 1), margin / 2, margin + rr * cell + cell / 2);
      }
    }
  }

  /* 渲染"成品"质感预览（立体珠光 + 阴影 + 超采样） */
  function renderProductPreview(canvas, img, gridSize) {
    var data = sampleGrid(img, gridSize);
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext("2d");
    var off = withSuper(W, H, function (o, OW, OH) {
      o.fillStyle = "#FBF7EF"; o.fillRect(0, 0, OW, OH);
      var cell = OW / gridSize, pad = cell * 0.06;
      for (var row = 0; row < gridSize; row++) {
        for (var col = 0; col < gridSize; col++) {
          var idx = (row * gridSize + col) * 4;
          var ci = nearest(data[idx], data[idx + 1], data[idx + 2]);
          drawBead(o, col * cell, row * cell, cell, PALETTE[ci].hex, pad);
        }
      }
    });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W, H);
  }

  /* ---------- 内置模板 ---------- */
  function tcv() { var c = document.createElement("canvas"); c.width = 300; c.height = 300; return c; }
  function tbg(x) { x.fillStyle = "#F6F1E7"; x.fillRect(0, 0, 300, 300); }
  function tplHeart() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#E5484D"; x.beginPath();
    var cx = 150, cy = 140, s = 64;
    for (var t = 0; t <= Math.PI * 2; t += 0.005) {
      var px = 16 * Math.pow(Math.sin(t), 3);
      var py = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      var X = cx + px * s / 16, Y = cy - py * s / 16;
      if (t === 0) x.moveTo(X, Y); else x.lineTo(X, Y);
    }
    x.closePath(); x.fill(); return c;
  }
  function tplStar() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#F4C041"; var pts = [];
    for (var i = 0; i < 10; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 === 0 ? 110 : 46;
      pts.push([150 + Math.cos(ang) * rad, 150 + Math.sin(ang) * rad]);
    }
    x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }); x.closePath(); x.fill(); return c;
  }
  function tplBolt() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#F4C041"; x.beginPath();
    x.moveTo(170, 40); x.lineTo(90, 170); x.lineTo(140, 170);
    x.lineTo(110, 260); x.lineTo(215, 120); x.lineTo(160, 120); x.closePath(); x.fill(); return c;
  }
  function tplRainbow() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    var cols = ["#E5484D", "#F2643E", "#F4C041", "#6FCF97", "#5AA9E6", "#EC6A9C"];
    for (var i = 0; i < cols.length; i++) {
      x.strokeStyle = cols[i]; x.lineWidth = 18;
      x.beginPath(); x.arc(150, 230, 180 - i * 22, Math.PI, 2 * Math.PI); x.stroke();
    }
    return c;
  }
  function tplSmiley() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#F4C041"; x.beginPath(); x.arc(150, 150, 108, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#241E18";
    x.beginPath(); x.arc(112, 128, 14, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(188, 128, 14, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#241E18"; x.lineWidth = 12; x.lineCap = "round";
    x.beginPath(); x.arc(150, 150, 62, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); return c;
  }
  function tplCat() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#C9A27E";
    x.beginPath(); x.moveTo(70, 80); x.lineTo(110, 40); x.lineTo(120, 95); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(230, 80); x.lineTo(190, 40); x.lineTo(180, 95); x.closePath(); x.fill();
    x.beginPath(); x.arc(150, 160, 95, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#241E18";
    x.beginPath(); x.arc(118, 150, 12, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(182, 150, 12, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#F2643E"; x.beginPath(); x.arc(150, 180, 9, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#241E18"; x.lineWidth = 5; x.beginPath();
    x.moveTo(150, 189); x.lineTo(150, 200);
    x.arc(135, 200, 15, 0, Math.PI * 0.5); x.moveTo(150, 200); x.arc(165, 200, 15, Math.PI, Math.PI * 1.5); x.stroke();
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(60, 175); x.lineTo(110, 180); x.moveTo(60, 195); x.lineTo(110, 190);
    x.moveTo(240, 175); x.lineTo(190, 180); x.moveTo(240, 195); x.lineTo(190, 190); x.stroke();
    return c;
  }
  function tplFlower() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    var R = 70, r = 30;
    x.fillStyle = "#EC6A9C";
    for (var i = 0; i < 8; i++) {
      var a = i * 2 * Math.PI / 8;
      x.beginPath(); x.arc(150 + Math.cos(a) * R, 150 + Math.sin(a) * R, r, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = "#F4C041"; x.beginPath(); x.arc(150, 150, r + 8, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#6FCF97"; x.lineWidth = 14; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 220); x.lineTo(150, 262); x.stroke(); return c;
  }
  function tplFish() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#5AA9E6";
    x.beginPath(); x.ellipse(140, 150, 90, 60, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(225, 150); x.lineTo(275, 110); x.lineTo(275, 190); x.closePath(); x.fill();
    x.fillStyle = "#241E18"; x.beginPath(); x.arc(95, 135, 10, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#241E18"; x.lineWidth = 4; x.beginPath(); x.arc(95, 150, 26, 0.1 * Math.PI, 0.5 * Math.PI); x.stroke();
    return c;
  }
  function tplLetter(ch) {
    return function () {
      var c = tcv(), x = c.getContext("2d"); tbg(x);
      x.fillStyle = "#1FA89A"; x.font = "900 230px sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(ch, 150, 162); return c;
    };
  }
  function tplRobot() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#5AA9E6"; x.fillRect(90, 110, 120, 120);
    x.beginPath(); x.arc(150, 120, 60, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#F6F1E7"; x.beginPath(); x.arc(135, 115, 14, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(165, 115, 14, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#241E18"; x.beginPath(); x.arc(135, 115, 6, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(165, 115, 6, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#241E18"; x.lineWidth = 5; x.beginPath(); x.moveTo(150, 60); x.lineTo(150, 30); x.stroke();
    x.fillStyle = "#F2643E"; x.beginPath(); x.arc(150, 25, 8, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#F4C041"; x.beginPath(); x.arc(150, 170, 12, 0, Math.PI * 2); x.fill();
    return c;
  }
  function tplKid() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = "#F6F1E7"; x.beginPath(); x.arc(150, 150, 90, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#C9A27E"; x.beginPath(); x.arc(150, 120, 88, Math.PI, 0); x.fill();
    x.fillStyle = "#241E18"; x.beginPath(); x.arc(125, 155, 10, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(175, 155, 10, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#EC6A9C"; x.beginPath(); x.arc(115, 180, 8, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(185, 180, 8, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#241E18"; x.lineWidth = 5; x.lineCap = "round"; x.beginPath(); x.arc(150, 180, 25, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
    return c;
  }
  /* ---------- 模板配色速记 + 新增精致模板 ---------- */
  var C = {
    pink: "#EC6A9C", red: "#E5484D", dred: "#C9434B", ored: "#F2643E",
    orange: "#F4A259", yellow: "#F4C041", teal: "#1FA89A", blue: "#5AA9E6",
    green: "#6FCF97", cream: "#F6F1E7", tan: "#C9A27E", ink: "#241E18"
  };
  function tplPrincess() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.pink; x.beginPath(); x.moveTo(150, 150); x.lineTo(95, 265); x.lineTo(205, 265); x.closePath(); x.fill();
    x.fillStyle = C.cream;
    [[130, 210], [170, 210], [150, 235], [125, 250], [175, 250]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 5, 0, 7); x.fill(); });
    x.beginPath(); x.moveTo(125, 150); x.lineTo(175, 150); x.lineTo(168, 172); x.lineTo(132, 172); x.closePath(); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(150, 120, 40, 0, 7); x.fill();
    x.fillStyle = C.tan; x.beginPath(); x.arc(150, 118, 44, Math.PI * 1.05, Math.PI * 1.95); x.fill();
    x.beginPath(); x.ellipse(112, 136, 12, 26, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(188, 136, 12, 26, 0, 0, 7); x.fill();
    x.fillStyle = C.yellow; x.beginPath(); x.moveTo(120, 84); x.lineTo(130, 68); x.lineTo(150, 84); x.lineTo(170, 68); x.lineTo(180, 84); x.closePath(); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(136, 120, 5, 0, 7); x.fill(); x.beginPath(); x.arc(164, 120, 5, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round"; x.beginPath(); x.arc(150, 132, 12, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    x.fillStyle = C.pink; x.beginPath(); x.arc(126, 134, 6, 0, 7); x.fill(); x.beginPath(); x.arc(174, 134, 6, 0, 7); x.fill();
    return c;
  }
  function tplHero() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.red; x.beginPath(); x.moveTo(110, 120); x.lineTo(190, 120); x.lineTo(206, 250); x.lineTo(94, 250); x.closePath(); x.fill();
    x.fillStyle = C.blue; x.beginPath(); x.moveTo(118, 120); x.lineTo(182, 120); x.lineTo(196, 255); x.lineTo(104, 255); x.closePath(); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(150, 95, 34, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(150, 90, 36, Math.PI, 0); x.fill();
    x.fillStyle = C.blue; x.fillRect(120, 88, 60, 16);
    x.fillStyle = C.ink; x.beginPath(); x.arc(136, 96, 5, 0, 7); x.fill(); x.beginPath(); x.arc(164, 96, 5, 0, 7); x.fill();
    x.fillStyle = C.yellow; x.beginPath(); x.arc(150, 178, 20, 0, 7); x.fill();
    x.fillStyle = C.red; x.beginPath(); x.arc(150, 178, 8, 0, 7); x.fill();
    return c;
  }
  function tplSnow() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.cream; x.beginPath(); x.arc(150, 205, 55, 0, 7); x.fill(); x.beginPath(); x.arc(150, 125, 40, 0, 7); x.fill();
    x.fillStyle = C.ink; x.fillRect(110, 78, 80, 12); x.fillRect(120, 50, 60, 32);
    x.fillStyle = C.ink; x.beginPath(); x.arc(138, 120, 5, 0, 7); x.fill(); x.beginPath(); x.arc(162, 120, 5, 0, 7); x.fill();
    x.fillStyle = C.ored; x.beginPath(); x.moveTo(150, 128); x.lineTo(150, 140); x.lineTo(172, 134); x.closePath(); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 2; x.beginPath(); x.arc(150, 140, 12, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
    x.fillStyle = C.ink; x.beginPath(); x.arc(150, 190, 5, 0, 7); x.fill(); x.beginPath(); x.arc(150, 215, 5, 0, 7); x.fill();
    x.strokeStyle = C.tan; x.lineWidth = 4; x.lineCap = "round"; x.beginPath(); x.moveTo(95, 200); x.lineTo(60, 180); x.moveTo(205, 200); x.lineTo(240, 180); x.stroke();
    x.fillStyle = C.red; x.fillRect(120, 158, 60, 12);
    return c;
  }
  function tplDog() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.beginPath(); x.ellipse(108, 122, 18, 34, 0.3, 0, 7); x.fill(); x.beginPath(); x.ellipse(192, 122, 18, 34, -0.3, 0, 7); x.fill();
    x.beginPath(); x.arc(150, 150, 68, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.ellipse(150, 178, 40, 32, 0, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(128, 145, 7, 0, 7); x.fill(); x.beginPath(); x.arc(172, 145, 7, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.ellipse(150, 168, 12, 9, 0, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 177); x.lineTo(150, 188); x.stroke();
    x.beginPath(); x.arc(138, 188, 12, 0, Math.PI); x.stroke(); x.beginPath(); x.arc(162, 188, 12, 0, Math.PI); x.stroke();
    x.fillStyle = C.pink; x.beginPath(); x.ellipse(150, 196, 8, 12, 0, 0, 7); x.fill();
    return c;
  }
  function tplBear() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.beginPath(); x.arc(112, 100, 26, 0, 7); x.fill(); x.beginPath(); x.arc(188, 100, 26, 0, 7); x.fill();
    x.beginPath(); x.arc(150, 155, 72, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.ellipse(150, 175, 34, 28, 0, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.ellipse(150, 160, 11, 8, 0, 0, 7); x.fill();
    x.beginPath(); x.arc(125, 140, 7, 0, 7); x.fill(); x.beginPath(); x.arc(175, 140, 7, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 168); x.lineTo(150, 180); x.stroke();
    x.beginPath(); x.arc(138, 182, 10, 0, Math.PI); x.stroke(); x.beginPath(); x.arc(162, 182, 10, 0, Math.PI); x.stroke();
    return c;
  }
  function tplRabbit() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.cream; x.beginPath(); x.ellipse(126, 70, 16, 46, 0.1, 0, 7); x.fill(); x.beginPath(); x.ellipse(174, 70, 16, 46, -0.1, 0, 7); x.fill();
    x.fillStyle = C.pink; x.beginPath(); x.ellipse(126, 74, 7, 30, 0.1, 0, 7); x.fill(); x.beginPath(); x.ellipse(174, 74, 7, 30, -0.1, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(150, 160, 66, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(126, 160, 8, 0, 7); x.fill(); x.beginPath(); x.arc(174, 160, 8, 0, 7); x.fill();
    x.fillStyle = C.pink; x.beginPath(); x.arc(150, 182, 7, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 189); x.lineTo(150, 196); x.stroke();
    x.beginPath(); x.arc(140, 196, 9, 0, Math.PI); x.stroke(); x.beginPath(); x.arc(160, 196, 9, 0, Math.PI); x.stroke();
    x.fillStyle = C.pink; x.beginPath(); x.arc(112, 180, 7, 0, 7); x.fill(); x.beginPath(); x.arc(188, 180, 7, 0, 7); x.fill();
    return c;
  }
  function tplPanda() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.ink; x.beginPath(); x.arc(112, 108, 26, 0, 7); x.fill(); x.beginPath(); x.arc(188, 108, 26, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(150, 160, 72, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.ellipse(124, 150, 18, 24, 0.3, 0, 7); x.fill(); x.beginPath(); x.ellipse(176, 150, 18, 24, -0.3, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(124, 150, 7, 0, 7); x.fill(); x.beginPath(); x.arc(176, 150, 7, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(124, 150, 4, 0, 7); x.fill(); x.beginPath(); x.arc(176, 150, 4, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.ellipse(150, 185, 12, 9, 0, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 194); x.lineTo(150, 204); x.stroke();
    x.beginPath(); x.arc(140, 204, 9, 0, Math.PI); x.stroke(); x.beginPath(); x.arc(160, 204, 9, 0, Math.PI); x.stroke();
    return c;
  }
  function tplIce() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.beginPath(); x.moveTo(120, 170); x.lineTo(180, 170); x.lineTo(150, 265); x.closePath(); x.fill();
    x.strokeStyle = "rgba(36,30,24,0.25)"; x.lineWidth = 2;
    x.beginPath(); x.moveTo(134, 182); x.lineTo(158, 252); x.moveTo(166, 182); x.lineTo(142, 252); x.stroke();
    x.fillStyle = C.pink; x.beginPath(); x.arc(150, 150, 40, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(132, 120, 30, 0, 7); x.fill();
    x.fillStyle = C.blue; x.beginPath(); x.arc(170, 118, 28, 0, 7); x.fill();
    x.fillStyle = C.red; x.beginPath(); x.arc(150, 82, 10, 0, 7); x.fill();
    return c;
  }
  function tplCupcake() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.beginPath(); x.moveTo(112, 180); x.lineTo(188, 180); x.lineTo(176, 265); x.lineTo(124, 265); x.closePath(); x.fill();
    x.strokeStyle = C.ored; x.lineWidth = 2;
    [124, 138, 152, 166, 180].forEach(function (xx) { x.beginPath(); x.moveTo(xx, 184); x.lineTo(xx + (xx < 150 ? -3 : 3), 262); x.stroke(); });
    x.fillStyle = C.pink; x.beginPath(); x.arc(150, 150, 46, Math.PI, 0); x.fill();
    x.beginPath(); x.arc(128, 140, 26, 0, 7); x.fill(); x.beginPath(); x.arc(172, 140, 26, 0, 7); x.fill();
    x.fillStyle = C.red; x.beginPath(); x.arc(150, 108, 12, 0, 7); x.fill();
    x.strokeStyle = C.green; x.lineWidth = 3; x.beginPath(); x.moveTo(150, 96); x.lineTo(153, 82); x.stroke();
    return c;
  }
  function tplBerry() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.red; x.beginPath(); x.ellipse(150, 170, 62, 72, 0, 0, 7); x.fill();
    x.beginPath(); x.moveTo(110, 160); x.lineTo(190, 160); x.lineTo(150, 250); x.closePath(); x.fill();
    x.fillStyle = C.green;
    for (var i = 0; i < 5; i++) { var a = (-Math.PI / 2) + (i - 2) * 0.5; x.beginPath(); x.moveTo(150, 122); x.lineTo(150 + Math.cos(a) * 36, 122 + Math.sin(a) * 30); x.lineTo(150 + Math.cos(a + 0.2) * 20, 122 + Math.sin(a + 0.2) * 22); x.closePath(); x.fill(); }
    x.fillStyle = C.cream;
    [[130, 170], [170, 170], [150, 192], [120, 200], [180, 200], [150, 212], [140, 226], [160, 226]].forEach(function (p) { x.save(); x.translate(p[0], p[1]); x.rotate(Math.PI / 4); x.fillRect(-3, -6, 6, 12); x.restore(); });
    return c;
  }
  function tplDonut() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.beginPath(); x.arc(150, 155, 72, 0, 7); x.fill();
    x.fillStyle = C.pink; x.beginPath(); x.arc(150, 150, 70, 0, 7); x.fill();
    [[95, 176], [120, 189], [150, 193], [180, 189], [205, 176]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 9, 0, 7); x.fill(); });
    x.fillStyle = C.cream; x.beginPath(); x.arc(150, 155, 26, 0, 7); x.fill();
    var sp = [[120, 120, C.blue], [165, 110, C.yellow], [190, 140, C.green], [110, 150, C.red], [150, 135, C.blue], [175, 170, C.yellow], [125, 170, C.green]];
    sp.forEach(function (s) { x.save(); x.translate(s[0], s[1]); x.rotate(0.6); x.fillStyle = s[2]; x.fillRect(-2, -7, 4, 14); x.restore(); });
    return c;
  }
  function tplTree() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.fillRect(138, 200, 24, 60);
    x.fillStyle = C.green; x.beginPath(); x.arc(150, 150, 60, 0, 7); x.fill();
    x.beginPath(); x.arc(110, 170, 40, 0, 7); x.fill(); x.beginPath(); x.arc(190, 170, 40, 0, 7); x.fill();
    x.fillStyle = C.red; [[120, 160], [175, 150], [150, 190], [135, 185], [185, 185]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 7, 0, 7); x.fill(); });
    return c;
  }
  function tplSun() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.ored;
    for (var i = 0; i < 12; i++) { x.save(); x.translate(150, 150); x.rotate(i * Math.PI / 6); x.fillRect(-6, -118, 12, 32); x.restore(); }
    x.fillStyle = C.yellow; x.beginPath(); x.arc(150, 150, 66, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(130, 140, 7, 0, 7); x.fill(); x.beginPath(); x.arc(170, 140, 7, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 4; x.lineCap = "round"; x.beginPath(); x.arc(150, 158, 20, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
    return c;
  }
  function tplMush() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.cream; x.beginPath(); x.moveTo(120, 170); x.lineTo(180, 170); x.lineTo(172, 250); x.lineTo(128, 250); x.closePath(); x.fill();
    x.fillStyle = C.red; x.beginPath(); x.arc(150, 160, 78, Math.PI, 0); x.fill(); x.fillRect(72, 158, 156, 14);
    x.fillStyle = C.cream; [[120, 120], [175, 125], [150, 95], [100, 150], [200, 150], [150, 150]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 10, 0, 7); x.fill(); });
    x.fillStyle = C.ink; x.beginPath(); x.arc(135, 200, 5, 0, 7); x.fill(); x.beginPath(); x.arc(165, 200, 5, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round"; x.beginPath(); x.arc(150, 212, 10, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
    return c;
  }
  function tplButterfly() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.pink; x.beginPath(); x.ellipse(105, 120, 42, 34, 0.3, 0, 7); x.fill(); x.beginPath(); x.ellipse(195, 120, 42, 34, -0.3, 0, 7); x.fill();
    x.fillStyle = C.blue; x.beginPath(); x.ellipse(110, 190, 36, 30, 0.2, 0, 7); x.fill(); x.beginPath(); x.ellipse(190, 190, 36, 30, -0.2, 0, 7); x.fill();
    x.fillStyle = C.yellow; x.beginPath(); x.arc(105, 118, 10, 0, 7); x.fill(); x.beginPath(); x.arc(195, 118, 10, 0, 7); x.fill();
    x.fillStyle = C.ink; x.fillRect(146, 100, 8, 110); x.beginPath(); x.arc(150, 100, 10, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 92); x.lineTo(135, 70); x.moveTo(150, 92); x.lineTo(165, 70); x.stroke();
    return c;
  }
  function tplDiamond() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.blue; x.beginPath(); x.moveTo(150, 70); x.lineTo(95, 140); x.lineTo(150, 250); x.lineTo(205, 140); x.closePath(); x.fill();
    x.fillStyle = C.teal; x.beginPath(); x.moveTo(150, 70); x.lineTo(110, 120); x.lineTo(150, 135); x.lineTo(190, 120); x.closePath(); x.fill();
    x.strokeStyle = C.cream; x.lineWidth = 3;
    x.beginPath(); x.moveTo(110, 120); x.lineTo(150, 250); x.moveTo(190, 120); x.lineTo(150, 250); x.moveTo(150, 135); x.lineTo(150, 250); x.stroke();
    x.beginPath(); x.moveTo(95, 140); x.lineTo(205, 140); x.stroke();
    return c;
  }
  /* ---------- 网上热门题材原创模板（网搜流行款，原创绘制） ---------- */
  function tplFrog() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.green;
    x.beginPath(); x.arc(150, 188, 82, 0, 7); x.fill();
    x.beginPath(); x.arc(115, 112, 30, 0, 7); x.fill(); x.beginPath(); x.arc(185, 112, 30, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(115, 110, 17, 0, 7); x.fill(); x.beginPath(); x.arc(185, 110, 17, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(115, 112, 8, 0, 7); x.fill(); x.beginPath(); x.arc(185, 112, 8, 0, 7); x.fill();
    x.fillStyle = C.pink; x.beginPath(); x.arc(95, 185, 9, 0, 7); x.fill(); x.beginPath(); x.arc(205, 185, 9, 0, 7); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 4; x.lineCap = "round"; x.beginPath(); x.arc(150, 188, 40, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
    return c;
  }
  function tplBow() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.pink;
    x.beginPath(); x.moveTo(150, 150); x.lineTo(60, 95); x.lineTo(60, 205); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(150, 150); x.lineTo(240, 95); x.lineTo(240, 205); x.closePath(); x.fill();
    x.fillStyle = C.red;
    x.beginPath(); x.moveTo(150, 150); x.lineTo(95, 118); x.lineTo(95, 182); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(150, 150); x.lineTo(205, 118); x.lineTo(205, 182); x.closePath(); x.fill();
    x.fillStyle = C.dred; x.beginPath(); x.arc(150, 150, 24, 0, 7); x.fill();
    x.fillStyle = C.pink; x.beginPath(); x.arc(150, 150, 11, 0, 7); x.fill();
    return c;
  }
  function tplCloud() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    var cols = [C.red, C.ored, C.yellow, C.green, C.blue, C.pink];
    for (var i = 0; i < cols.length; i++) {
      x.strokeStyle = cols[i]; x.lineWidth = 14;
      x.beginPath(); x.arc(150, 250, 150 - i * 16, Math.PI, 2 * Math.PI); x.stroke();
    }
    x.fillStyle = C.blue;
    x.beginPath(); x.arc(110, 205, 42, 0, 7); x.fill();
    x.beginPath(); x.arc(165, 195, 50, 0, 7); x.fill();
    x.beginPath(); x.arc(205, 208, 36, 0, 7); x.fill();
    x.beginPath(); x.arc(150, 220, 60, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(135, 205, 16, 0, 7); x.fill();
    return c;
  }
  function tplMoon() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.yellow; x.beginPath(); x.arc(150, 155, 95, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(192, 122, 84, 0, 7); x.fill();
    function star(cx, cy, r) {
      x.fillStyle = C.yellow; x.beginPath();
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 === 0 ? r : r * 0.45;
        var X = cx + Math.cos(a) * rad, Y = cy + Math.sin(a) * rad;
        i ? x.lineTo(X, Y) : x.moveTo(X, Y);
      }
      x.closePath(); x.fill();
    }
    star(78, 82, 26); star(228, 100, 20); star(92, 232, 18);
    return c;
  }
  function tplCoffee() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.strokeStyle = C.cream; x.lineWidth = 6; x.lineCap = "round";
    x.beginPath(); x.arc(132, 72, 16, 0.2 * Math.PI, 1.4 * Math.PI); x.stroke();
    x.beginPath(); x.arc(172, 66, 16, 0.2 * Math.PI, 1.4 * Math.PI); x.stroke();
    x.fillStyle = C.teal;
    x.beginPath(); x.moveTo(90, 120); x.lineTo(210, 120); x.lineTo(195, 242); x.lineTo(105, 242); x.closePath(); x.fill();
    x.fillStyle = C.tan; x.beginPath(); x.ellipse(150, 120, 60, 15, 0, 0, 7); x.fill();
    x.strokeStyle = C.teal; x.lineWidth = 16; x.beginPath(); x.arc(212, 172, 30, -0.5 * Math.PI, 0.5 * Math.PI); x.stroke();
    x.fillStyle = C.yellow;
    for (var i = 0; i < 3; i++) { x.beginPath(); x.arc(120 + i * 30, 182, 7, 0, 7); x.fill(); }
    return c;
  }
  function tplGhost() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.blue;
    x.beginPath();
    x.arc(150, 135, 82, Math.PI, 0, false);
    x.lineTo(232, 235);
    var n = 4, st = 164 / n;
    for (var i = 0; i < n; i++) {
      var bx = 232 - i * st;
      x.arc(bx - st / 2, 235, st / 2, 0, Math.PI, false);
    }
    x.closePath(); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(125, 135, 12, 0, 7); x.fill(); x.beginPath(); x.arc(175, 135, 12, 0, 7); x.fill();
    x.beginPath(); x.arc(150, 170, 11, 0, Math.PI); x.fill();
    x.fillStyle = C.pink; x.beginPath(); x.arc(105, 158, 9, 0, 7); x.fill(); x.beginPath(); x.arc(195, 158, 9, 0, 7); x.fill();
    return c;
  }
  function tplPenguin() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.ink; x.beginPath(); x.ellipse(150, 165, 78, 92, 0, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.ellipse(150, 188, 50, 66, 0, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(125, 120, 16, 0, 7); x.fill(); x.beginPath(); x.arc(175, 120, 16, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(125, 122, 8, 0, 7); x.fill(); x.beginPath(); x.arc(175, 122, 8, 0, 7); x.fill();
    x.fillStyle = C.ored; x.beginPath(); x.moveTo(150, 135); x.lineTo(135, 150); x.lineTo(165, 150); x.closePath(); x.fill();
    x.fillStyle = C.ored; x.beginPath(); x.ellipse(125, 252, 20, 12, 0, 0, 7); x.fill(); x.beginPath(); x.ellipse(175, 252, 20, 12, 0, 0, 7); x.fill();
    return c;
  }
  function tplMelon() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.green; x.beginPath(); x.moveTo(150, 55); x.lineTo(255, 240); x.lineTo(45, 240); x.closePath(); x.fill();
    x.fillStyle = C.red; x.beginPath(); x.moveTo(150, 90); x.lineTo(232, 235); x.lineTo(68, 235); x.closePath(); x.fill();
    x.fillStyle = C.ink;
    [[130, 160], [170, 160], [150, 185], [115, 200], [185, 200], [150, 215]].forEach(function (p) {
      x.save(); x.translate(p[0], p[1]); x.rotate(Math.PI / 4); x.fillRect(-3, -7, 6, 14); x.restore();
    });
    return c;
  }
  function tplSunflower() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.yellow;
    for (var i = 0; i < 12; i++) {
      var a = i * 2 * Math.PI / 12;
      x.save(); x.translate(150, 150); x.rotate(a);
      x.beginPath(); x.ellipse(0, -80, 17, 42, 0, 0, 7); x.fill();
      x.restore();
    }
    x.fillStyle = C.tan; x.beginPath(); x.arc(150, 150, 46, 0, 7); x.fill();
    x.fillStyle = C.dred;
    for (var j = 0; j < 10; j++) { var a2 = j * 2 * Math.PI / 10; x.beginPath(); x.arc(150 + Math.cos(a2) * 26, 150 + Math.sin(a2) * 26, 7, 0, 7); x.fill(); }
    return c;
  }
  function tplRocket() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.red; x.beginPath();
    x.moveTo(150, 40); x.quadraticCurveTo(200, 110, 185, 200); x.lineTo(115, 200); x.quadraticCurveTo(100, 110, 150, 40); x.closePath(); x.fill();
    x.fillStyle = C.blue; x.beginPath(); x.arc(150, 110, 24, 0, 7); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(142, 102, 8, 0, 7); x.fill();
    x.fillStyle = C.ored;
    x.beginPath(); x.moveTo(115, 175); x.lineTo(80, 240); x.lineTo(118, 215); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(185, 175); x.lineTo(220, 240); x.lineTo(182, 215); x.closePath(); x.fill();
    x.fillStyle = C.yellow; x.beginPath(); x.moveTo(125, 205); x.lineTo(150, 262); x.lineTo(175, 205); x.closePath(); x.fill();
    x.fillStyle = C.ored; x.beginPath(); x.moveTo(138, 206); x.lineTo(150, 242); x.lineTo(162, 206); x.closePath(); x.fill();
    return c;
  }
  function tplNote() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.blue;
    x.fillRect(120, 82, 22, 128);
    x.beginPath(); x.ellipse(108, 208, 38, 28, -0.3, 0, 7); x.fill();
    x.beginPath(); x.moveTo(142, 82); x.quadraticCurveTo(202, 96, 186, 152); x.quadraticCurveTo(172, 112, 142, 122); x.closePath(); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(100, 208, 14, 0, 7); x.fill();
    return c;
  }
  function tplCake() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.pink; x.beginPath(); x.moveTo(80, 160); x.lineTo(220, 160); x.lineTo(208, 240); x.lineTo(92, 240); x.closePath(); x.fill();
    x.fillStyle = C.red; x.beginPath(); x.moveTo(100, 110); x.lineTo(200, 110); x.lineTo(192, 162); x.lineTo(108, 162); x.closePath(); x.fill();
    x.fillStyle = C.cream; for (var i = 0; i < 5; i++) { var xx = 110 + i * 22; x.beginPath(); x.arc(xx, 112, 11, 0, Math.PI); x.fill(); }
    x.fillStyle = C.yellow; x.fillRect(145, 60, 10, 52);
    x.fillStyle = C.ored; x.beginPath(); x.arc(150, 55, 8, 0, 7); x.fill();
    x.fillStyle = C.blue; [[110, 198], [150, 204], [190, 198], [120, 182], [180, 182]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 6, 0, 7); x.fill(); });
    return c;
  }
  function tplOwl() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.tan; x.beginPath(); x.ellipse(150, 168, 80, 90, 0, 0, 7); x.fill();
    x.beginPath(); x.moveTo(95, 95); x.lineTo(110, 55); x.lineTo(128, 100); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(205, 95); x.lineTo(190, 55); x.lineTo(172, 100); x.closePath(); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.arc(120, 150, 32, 0, 7); x.fill(); x.beginPath(); x.arc(180, 150, 32, 0, 7); x.fill();
    x.fillStyle = C.ink; x.beginPath(); x.arc(120, 150, 15, 0, 7); x.fill(); x.beginPath(); x.arc(180, 150, 15, 0, 7); x.fill();
    x.fillStyle = C.yellow; x.beginPath(); x.arc(120, 150, 6, 0, 7); x.fill(); x.beginPath(); x.arc(180, 150, 6, 0, 7); x.fill();
    x.fillStyle = C.ored; x.beginPath(); x.moveTo(150, 165); x.lineTo(138, 186); x.lineTo(162, 186); x.closePath(); x.fill();
    x.fillStyle = C.cream; x.beginPath(); x.ellipse(150, 208, 36, 28, 0, 0, 7); x.fill();
    return c;
  }
  function tplCactus() {
    var c = tcv(), x = c.getContext("2d"); tbg(x);
    x.fillStyle = C.green;
    x.fillRect(130, 120, 40, 132);
    x.beginPath(); x.arc(150, 120, 20, Math.PI, 0); x.fill();
    x.fillRect(108, 160, 32, 16); x.beginPath(); x.arc(108, 168, 11, Math.PI, 0); x.fill(); x.fillRect(102, 140, 16, 30);
    x.fillRect(160, 160, 32, 16); x.beginPath(); x.arc(192, 168, 11, Math.PI, 0); x.fill(); x.fillRect(182, 140, 16, 30);
    x.fillStyle = C.pink; x.beginPath(); x.arc(150, 108, 14, 0, 7); x.fill();
    x.fillStyle = C.yellow; x.beginPath(); x.arc(150, 108, 6, 0, 7); x.fill();
    x.fillStyle = C.ored; x.beginPath(); x.moveTo(108, 250); x.lineTo(192, 250); x.lineTo(182, 292); x.lineTo(118, 292); x.closePath(); x.fill();
    return c;
  }

  var TEMPLATES = [
    { id: "robot", name: "机器人", cat: "人物", make: tplRobot },
    { id: "kid", name: "小孩", cat: "人物", make: tplKid },
    { id: "princess", name: "公主", cat: "人物", make: tplPrincess },
    { id: "hero", name: "超人", cat: "人物", make: tplHero },
    { id: "snow", name: "雪人", cat: "人物", make: tplSnow },
    { id: "cat", name: "小猫", cat: "动物", make: tplCat },
    { id: "fish", name: "小鱼", cat: "动物", make: tplFish },
    { id: "dog", name: "小狗", cat: "动物", make: tplDog },
    { id: "bear", name: "小熊", cat: "动物", make: tplBear },
    { id: "rabbit", name: "兔子", cat: "动物", make: tplRabbit },
    { id: "panda", name: "熊猫", cat: "动物", make: tplPanda },
    { id: "ice", name: "冰淇淋", cat: "食物", make: tplIce },
    { id: "cupcake", name: "杯子蛋糕", cat: "食物", make: tplCupcake },
    { id: "berry", name: "草莓", cat: "食物", make: tplBerry },
    { id: "donut", name: "甜甜圈", cat: "食物", make: tplDonut },
    { id: "tree", name: "小树", cat: "自然", make: tplTree },
    { id: "sun", name: "太阳", cat: "自然", make: tplSun },
    { id: "mush", name: "蘑菇", cat: "自然", make: tplMush },
    { id: "heart", name: "爱心", cat: "配饰", make: tplHeart },
    { id: "star", name: "星星", cat: "配饰", make: tplStar },
    { id: "bolt", name: "闪电", cat: "配饰", make: tplBolt },
    { id: "rainbow", name: "彩虹", cat: "配饰", make: tplRainbow },
    { id: "flower", name: "小花", cat: "配饰", make: tplFlower },
    { id: "diamond", name: "钻石", cat: "配饰", make: tplDiamond },
    { id: "butterfly", name: "蝴蝶", cat: "卡通", make: tplButterfly },
    { id: "smiley", name: "笑脸", cat: "卡通", make: tplSmiley },
    { id: "letterA", name: "字母 A", cat: "卡通", make: tplLetter("A") },
    { id: "letterB", name: "字母 B", cat: "卡通", make: tplLetter("B") },
    { id: "frog", name: "青蛙", cat: "动物", make: tplFrog },
    { id: "penguin", name: "企鹅", cat: "动物", make: tplPenguin },
    { id: "owl", name: "猫头鹰", cat: "动物", make: tplOwl },
    { id: "bow", name: "蝴蝶结", cat: "配饰", make: tplBow },
    { id: "moon", name: "月亮星星", cat: "配饰", make: tplMoon },
    { id: "note", name: "音符", cat: "配饰", make: tplNote },
    { id: "cloud", name: "彩虹云", cat: "自然", make: tplCloud },
    { id: "sunflower", name: "向日葵", cat: "自然", make: tplSunflower },
    { id: "cactus", name: "仙人掌", cat: "自然", make: tplCactus },
    { id: "coffee", name: "咖啡杯", cat: "食物", make: tplCoffee },
    { id: "melon", name: "西瓜", cat: "食物", make: tplMelon },
    { id: "cake", name: "生日蛋糕", cat: "食物", make: tplCake },
    { id: "ghost", name: "幽灵", cat: "卡通", make: tplGhost },
    { id: "rocket", name: "火箭", cat: "卡通", make: tplRocket }
  ];

  /* ---------- 基于「每格 RGBA 网格数组」的渲染/统计（精确分解 & 反向生成复用） ---------- */
  /* grid: size*size*4 的 Uint8 数组（每格已采样好的颜色）；空格 alpha<10 不渲染 */
  function renderBeadArtGrid(canvas, grid, size) {
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext("2d");
    var off = withSuper(W, H, function (o, OW, OH) {
      o.fillStyle = "#FFFFFF"; o.fillRect(0, 0, OW, OH);
      var cell = OW / size, pad = cell * 0.10;
      for (var row = 0; row < size; row++) {
        for (var col = 0; col < size; col++) {
          var idx = (row * size + col) * 4;
          if (grid[idx + 3] < 10) continue;
          var ci = nearest(grid[idx], grid[idx + 1], grid[idx + 2]);
          drawBead(o, col * cell, row * cell, cell, PALETTE[ci].hex, pad);
        }
      }
    });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W, H);
  }

  function blueprintLabels(ctx, margin, inner, size, cell) {
    if (margin <= 0) return;
    ctx.fillStyle = "#6E655A";
    ctx.font = "600 " + Math.max(9, Math.min(14, Math.floor(cell * 0.5))) + "px 'Outfit', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var c = 0; c < size; c++) {
      var label = size <= 26 ? String.fromCharCode(65 + c) : String(c + 1);
      ctx.fillText(label, margin + c * cell + cell / 2, margin / 2);
    }
    for (var rr = 0; rr < size; rr++) {
      ctx.fillText(String(rr + 1), margin / 2, margin + rr * cell + cell / 2);
    }
  }

  function renderBlueprintGrid(canvas, grid, size, margin) {
    margin = margin || 0;
    var total = canvas.width;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, total, total);
    var inner = total - margin * 2, cell = inner / size, r = cell * 0.40;
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        var idx = (row * size + col) * 4;
        if (grid[idx + 3] < 10) continue;
        var ci = nearest(grid[idx], grid[idx + 1], grid[idx + 2]);
        var cx = margin + col * cell + cell / 2, cy = margin + row * cell + cell / 2;
        ctx.fillStyle = PALETTE[ci].hex;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.strokeStyle = "rgba(36,30,24,0.16)"; ctx.lineWidth = 1;
    for (var i = 0; i <= size; i++) {
      var p = margin + i * cell;
      ctx.beginPath(); ctx.moveTo(p, margin); ctx.lineTo(p, margin + inner); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin, p); ctx.lineTo(margin + inner, p); ctx.stroke();
    }
    blueprintLabels(ctx, margin, inner, size, cell);
  }

  function estimateCountsFromGrid(grid, size) {
    var counts = new Array(PALETTE.length).fill(0);
    for (var i = 0; i < size * size; i++) {
      var idx = i * 4;
      if (grid[idx + 3] < 10) continue;
      counts[nearest(grid[idx], grid[idx + 1], grid[idx + 2])]++;
    }
    return PALETTE.map(function (p, i) {
      return { idx: i, name: p.name, hex: p.hex, count: counts[i] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  function gridToImage(grid, size) {
    var c = document.createElement("canvas");
    c.width = 300; c.height = 300;
    renderBeadArtGrid(c, grid, size);
    return c;
  }

  /* 把"矢量模板画布"转成带剪影轮廓、留白背景的拼豆点阵网格。
     复用现有模板艺术，无需重画：高分辨率采样 → 外背景洪水填充 → 剪影描墨边。 */
  function templateToGrid(make, size) {
    var K = 10, SS = size * K;
    var off = document.createElement("canvas");
    off.width = SS; off.height = SS;
    var octx = off.getContext("2d");
    octx.drawImage(make(), 0, 0, SS, SS);
    var od = octx.getImageData(0, 0, SS, SS).data;
    var grid = new Uint8Array(size * size * 4);
    var bg = [246, 241, 231]; // 奶油背景
    function isBg(r, g, b) { return Math.abs(r - bg[0]) < 16 && Math.abs(g - bg[1]) < 16 && Math.abs(b - bg[2]) < 16; }
    // 1) 逐格平均色
    var avg = new Int32Array(size * size * 3);
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        var x0 = Math.floor(col * SS / size), x1 = Math.floor((col + 1) * SS / size);
        var y0 = Math.floor(row * SS / size), y1 = Math.floor((row + 1) * SS / size);
        var r = 0, g = 0, b = 0, n = 0;
        for (var yy = y0; yy < y1; yy += 2) for (var xx = x0; xx < x1; xx += 2) {
          var i = (yy * SS + xx) * 4; r += od[i]; g += od[i + 1]; b += od[i + 2]; n++;
        }
        var k = (row * size + col) * 3;
        avg[k] = Math.round(r / n); avg[k + 1] = Math.round(g / n); avg[k + 2] = Math.round(b / n);
      }
    }
    // 2) 从边界洪水填充，标记外背景（与画布边缘连通的奶油色）
    var outer = new Uint8Array(size * size);
    var stack = [];
    function tryPush(rr, cc) {
      var k = rr * size + cc;
      if (!outer[k] && isBg(avg[k * 3], avg[k * 3 + 1], avg[k * 3 + 2])) { outer[k] = 1; stack.push(k); }
    }
    for (var c = 0; c < size; c++) {
      tryPush(0, c); tryPush(size - 1, c); tryPush(c, 0); tryPush(c, size - 1);
    }
    while (stack.length) {
      var kk = stack.pop(), rr = (kk / size) | 0, cc = kk % size;
      if (rr > 0) tryPush(rr - 1, cc);
      if (rr < size - 1) tryPush(rr + 1, cc);
      if (cc > 0) tryPush(rr, cc - 1);
      if (cc < size - 1) tryPush(rr, cc + 1);
    }
    // 3) 生成网格：外背景留空，邻接外背景的格描墨边，其余取最近色板
    var INK = 11;
    for (var row2 = 0; row2 < size; row2++) {
      for (var col2 = 0; col2 < size; col2++) {
        var k2 = row2 * size + col2, o = k2 * 4;
        if (outer[k2]) { grid[o + 3] = 0; continue; }
        var edge = (row2 > 0 && outer[(row2 - 1) * size + col2]) ||
                   (row2 < size - 1 && outer[(row2 + 1) * size + col2]) ||
                   (col2 > 0 && outer[k2 - 1]) ||
                   (col2 < size - 1 && outer[k2 + 1]);
        var ci;
        if (edge) ci = INK;
        else ci = nearest(avg[k2 * 3], avg[k2 * 3 + 1], avg[k2 * 3 + 2]);
        grid[o] = RGB[ci][0]; grid[o + 1] = RGB[ci][1]; grid[o + 2] = RGB[ci][2]; grid[o + 3] = 255;
      }
    }
    return grid;
  }

  return {
    PALETTE: PALETTE,
    renderBeadArt: renderBeadArt,
    estimateCounts: estimateCounts,
    makeSample: makeSample,
    renderBlueprint: renderBlueprint,
    renderProductPreview: renderProductPreview,
    TEMPLATES: TEMPLATES,
    renderBeadArtGrid: renderBeadArtGrid,
    renderBlueprintGrid: renderBlueprintGrid,
    estimateCountsFromGrid: estimateCountsFromGrid,
    gridToImage: gridToImage,
    templateToGrid: templateToGrid
  };
})();
