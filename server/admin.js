"use strict";
/* ========== 像素豆 PixelBean · 管理后台接口 ==========
   受 ADMIN_TOKEN 保护（与 /api/admin/backup 同一套鉴权）：
   必须设置环境变量 ADMIN_TOKEN，且请求头 x-admin-token 与之相等。
   提供：仪表盘统计 / 用户列表 / 作品列表 / 验证码列表 / 删除操作。
   挂载于 index.js 的 /api/admin 前缀下（本文件只定义路由，不含监听）。
*/
var express = require("express");
var db = require("./db");

var router = express.Router();

/* 鉴权中间件：复用管理令牌约定 */
function requireAdmin(req, res, next) {
  var t = process.env.ADMIN_TOKEN;
  if (!t) {
    return res.status(403).json({ error: "未启用管理后台（请在环境变量设置 ADMIN_TOKEN）" });
  }
  var h = (req.headers["x-admin-token"] || "").toString();
  if (h !== t) {
    return res.status(401).json({ error: "未授权：令牌无效" });
  }
  next();
}

/* 手机号脱敏：138****0000，既便于运营核对又避免明文泄露 */
function maskPhone(p) {
  if (!p || p.length < 7) return p || "";
  return p.slice(0, 3) + "****" + p.slice(-4);
}

function fmtBytes(n) {
  if (!n) return "0 B";
  var u = ["B", "KB", "MB", "GB"];
  var i = Math.floor(Math.log(n) / Math.log(1024));
  i = Math.min(i, u.length - 1);
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + u[i];
}

function pager(req) {
  var page = parseInt(req.query.page || "1", 10) || 1;
  if (page < 1) page = 1;
  var size = parseInt(req.query.size || "20", 10) || 20;
  if (size > 100) size = 100;
  return { page: page, size: size, offset: (page - 1) * size, q: (req.query.q || "").trim() };
}

/* ---------- 仪表盘统计 ---------- */
router.get("/stats", requireAdmin, function (req, res) {
  try {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var users = db.countUsers("");
    var kb = db.countKB("");
    var newToday = db.countUsersSince(now.getTime());
    var codes = db.listCodes().length;
    var dbSize = db.dbFileSize();
    res.json({
      ok: true,
      users: users,
      kb: kb,
      newToday: newToday,
      codes: codes,
      dbSize: dbSize,
      dbSizeText: fmtBytes(dbSize),
      ts: Date.now()
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 用户列表（分页 + 搜索） ---------- */
router.get("/users", requireAdmin, function (req, res) {
  try {
    var p = pager(req);
    var rows = db.listUsers(p.size, p.offset, p.q).map(function (r) {
      return { id: r.id, phone: maskPhone(r.phone), created_at: r.created_at };
    });
    var total = db.countUsers(p.q);
    res.json({ ok: true, page: p.page, size: p.size, total: total, pages: Math.ceil(total / p.size) || 1, items: rows });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 作品列表（分页 + 搜索） ---------- */
router.get("/kb", requireAdmin, function (req, res) {
  try {
    var p = pager(req);
    var rows = db.searchKB(p.q, p.size, p.offset);
    var total = db.countKB(p.q);
    res.json({ ok: true, page: p.page, size: p.size, total: total, pages: Math.ceil(total / p.size) || 1, items: rows });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 验证码列表（当前有效） ---------- */
router.get("/codes", requireAdmin, function (req, res) {
  try {
    var now = Date.now();
    var rows = db.listCodes().map(function (r) {
      return { phone: maskPhone(r.phone), code: r.code, exp: r.exp, remaining: Math.max(0, r.exp - now) };
    });
    res.json({ ok: true, total: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 删除作品 ---------- */
router.delete("/kb/:id", requireAdmin, function (req, res) {
  try {
    var removed = db.deleteKBItem(req.params.id);
    res.json({ ok: true, removed: removed });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 删除用户（连带其验证码） ---------- */
router.delete("/user/:id", requireAdmin, function (req, res) {
  try {
    var removed = db.deleteUser(parseInt(req.params.id, 10));
    res.json({ ok: true, removed: removed });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 清除某手机号验证码 ---------- */
router.delete("/codes/:phone", requireAdmin, function (req, res) {
  try {
    var phone = decodeURIComponent(req.params.phone);
    db.deleteCode(phone);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

module.exports = router;
