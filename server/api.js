"use strict";
/* ========== 像素豆 PixelBean · 数据后端 ==========
   可独立运行（node api.js，默认端口 4000），也可被 index.js 合并到单端口部署。
   接口：
     GET  /api/health   健康检查
     GET  /api/palette  返回 12 色官方色板
     POST /api/process  接收像素数组，返回主色 + 色板匹配 + 用豆量
     GET/POST/DELETE /api/kb   成品分解记录（持久化到 SQLite）
     GET/DELETE /api/my/works  我的作品（需登录，按当前用户隔离）

   设计说明：
   - 本文件只负责「接口路由」，不含 cors / 静态托管 / listen。
   - cors 与 express.json 由合并入口 index.js 在顶层统一挂载（避免重复 CORS 头）。
   - 仅当「作为主模块独立运行」（node api.js）时，才托管前端静态站并 listen。
   - 被 index.js require 时，只导出路由 app，由 index.js 统一托管前端与监听端口。
*/
var path = require("path");
var express = require("express");
var engine = require("./pixelbean-engine");
var db = require("./db");
var token = require("./token");

var app = express();
// 仅解析 body；cors 放在合并入口，避免挂载后被重复添加
app.use(express.json({ limit: "10mb" }));

var ROOT = path.join(__dirname, "..", "deploy");

app.get("/api/health", function (req, res) {
  var h = db.healthCheck();
  res.json({ ok: h.ok, ts: Date.now(), engine: "pixelbean", db: h });
});

app.get("/api/palette", function (req, res) {
  res.json({ palette: engine.PALETTE });
});

app.post("/api/process", function (req, res) {
  try {
    var b = req.body || {};
    if (!Array.isArray(b.grid)) {
      return res.status(400).json({ error: "缺少 grid 像素数组（size×size 的扁平 RGBA）" });
    }
    var result = engine.process({
      sample: b.sample,
      grid: b.grid,
      gridW: b.gridW,
      gridH: b.gridH,
      k: b.k || 8,
      size: b.size || 29
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 知识库接口：成品分解记录（持久化到 SQLite） ---------- */
app.get("/api/kb", function (req, res) {
  res.json({ items: db.listKB() });
});

app.post("/api/kb", function (req, res) {
  try {
    var b = req.body || {};
    if (!b.scheme || !Array.isArray(b.scheme)) {
      return res.status(400).json({ error: "缺少 scheme（用豆量方案）" });
    }
    // 若带有效登录态，作品归属当前用户；否则作为匿名作品（仍进公开展示库）
    var userId = null;
    var phone = token.getPhoneFromReq(req);
    if (phone) {
      var u = db.getUserByPhone(phone);
      if (u) userId = u.id;
    }
    var id = db.addKB({
      source: b.source, subject: b.subject, size: b.size,
      thumb: b.thumb, colors: b.colors, scheme: b.scheme, grid: b.grid,
      user_id: userId
    });
    res.json({ ok: true, id: id, owned: !!userId, total: db.listKB().length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

app.delete("/api/kb/:id", function (req, res) {
  var removed = db.deleteKBItem(req.params.id);
  res.json({ ok: true, removed: removed });
});

/* ---------- 我的作品：登录用户专属（需 Bearer Token） ---------- */
app.get("/api/my/works", function (req, res) {
  var phone = token.getPhoneFromReq(req);
  if (!phone) return res.status(401).json({ error: "请先登录" });
  var u = db.getUserByPhone(phone);
  if (!u) return res.status(401).json({ error: "账号不存在" });
  try {
    var page = clampInt(req.query.page, 1, 1, 100000);
    var size = clampInt(req.query.size, 24, 1, 60);
    var items = db.listMyWorks(u.id, size, (page - 1) * size);
    var total = db.countMyWorks(u.id);
    res.json({ ok: true, page: page, size: size, total: total, pages: Math.ceil(total / size) || 1, items: items });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

app.delete("/api/my/works/:id", function (req, res) {
  var phone = token.getPhoneFromReq(req);
  if (!phone) return res.status(401).json({ error: "请先登录" });
  var u = db.getUserByPhone(phone);
  if (!u) return res.status(401).json({ error: "账号不存在" });
  var removed = db.deleteMyWork(req.params.id, u.id);
  res.json({ ok: true, removed: removed });
});

/* ---------- 展示库接口：公开、分页、可搜索/排序（无需鉴权） ---------- */
function clampInt(v, def, min, max) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = def;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}
app.get("/api/gallery", function (req, res) {
  try {
    var page = clampInt(req.query.page, 1, 1, 100000);
    var size = clampInt(req.query.size, 24, 1, 60);
    var q = (req.query.q || "").trim();
    var sort = req.query.sort === "popular" ? "popular" : "latest";
    var items = db.listGallery(size, (page - 1) * size, q, sort);
    var total = db.countGallery(q);
    res.json({ ok: true, page: page, size: size, total: total, pages: Math.ceil(total / size) || 1, items: items });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

app.get("/api/gallery/:id", function (req, res) {
  try {
    var it = db.getGalleryItem(req.params.id);
    if (!it) return res.status(404).json({ error: "作品不存在" });
    db.incViews(req.params.id); // 打开详情即记一次浏览
    it.views = (it.views || 0) + 1;
    res.json({ ok: true, item: it });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* 作为主模块独立运行时：托管前端并监听端口 */
if (require.main === module) {
  app.use(express.static(ROOT, { extensions: ["html"] }));
  var PORT = process.env.PORT || 4000;
  app.listen(PORT, function () {
    console.log("PixelBean 数据后端已启动：http://localhost:" + PORT);
    console.log("静态根目录：" + ROOT);
  });
}

module.exports = app;
