"use strict";
/* ========== 像素豆 PixelBean · SQLite 数据层 ==========
   用 better-sqlite3 提供单一、可查询、带事务的持久化，
   替代原先的 JSON 文件存储（bead-kb.json / users.json）与内存验证码。
   api.js（知识库）与 auth.js（用户/验证码）共用本模块指向的同一 .db 文件。
   运行环境：Node 22+（better-sqlite3 预编译二进制）。
*/
var path = require("path");
var fs = require("fs");
var Database = require("better-sqlite3");

var DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
var DB_FILE = path.join(DATA_DIR, "pixelbean.db");

var db = new Database(DB_FILE);
// 多进程（api.js + auth.js）共享同一文件：WAL 让读不阻塞写；busy_timeout 防写冲突
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

/* ---------- 表结构 ---------- */
db.exec([
  "CREATE TABLE IF NOT EXISTS users (",
  "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
  "  phone TEXT UNIQUE NOT NULL,",
  "  password_hash TEXT NOT NULL,",
  "  created_at INTEGER NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS kb_items (",
  "  id TEXT PRIMARY KEY,",
  "  ts INTEGER NOT NULL,",
  "  source TEXT NOT NULL DEFAULT '',",
  "  subject TEXT NOT NULL DEFAULT '',",
  "  size INTEGER NOT NULL DEFAULT 29,",
  "  thumb TEXT NOT NULL DEFAULT '',",
  "  colors TEXT NOT NULL DEFAULT '[]',",
  "  scheme TEXT NOT NULL DEFAULT '[]',",
  "  grid TEXT",
  ");",
  "CREATE TABLE IF NOT EXISTS codes (",
  "  phone TEXT PRIMARY KEY,",
  "  code TEXT NOT NULL,",
  "  exp INTEGER NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_kb_ts ON kb_items(ts DESC);"
].join("\n"));

/* 展示库增强：浏览量字段（已存在的库文件通过 ALTER 补齐，重复列忽略） */
try {
  db.exec("ALTER TABLE kb_items ADD COLUMN views INTEGER NOT NULL DEFAULT 0");
} catch (e) { /* 列已存在则忽略 */ }

/* 用户中心：作品归属字段（可空，演示/匿名作品为 NULL，仍公开进展示库） */
try {
  db.exec("ALTER TABLE kb_items ADD COLUMN user_id INTEGER");
} catch (e) { /* 列已存在则忽略 */ }

function safeParseJSON(s, fallback) {
  try { return s == null ? fallback : JSON.parse(s); } catch (e) { return fallback; }
}

/* ---------- 用户（auth.js 用） ---------- */
var stmts = {
  getUserByPhone: db.prepare("SELECT * FROM users WHERE phone = ?"),
  insertUser: db.prepare("INSERT INTO users (phone, password_hash, created_at) VALUES (?, ?, ?)"),
  setCode: db.prepare("INSERT INTO codes (phone, code, exp) VALUES (@phone, @code, @exp) ON CONFLICT(phone) DO UPDATE SET code=@code, exp=@exp"),
  getCode: db.prepare("SELECT code, exp FROM codes WHERE phone = ?"),
  deleteCode: db.prepare("DELETE FROM codes WHERE phone = ?"),
  pruneCodes: db.prepare("DELETE FROM codes WHERE exp < ?")
};

function getUserByPhone(phone) { return stmts.getUserByPhone.get(phone); }
function createUser(phone, passwordHash, createdAt) {
  var info = stmts.insertUser.run(phone, passwordHash, createdAt);
  return info.lastInsertRowid;
}
function setCode(phone, code, exp) { stmts.setCode.run({ phone: phone, code: code, exp: exp }); }
function getCode(phone) { return stmts.getCode.get(phone); }
function deleteCode(phone) { stmts.deleteCode.run(phone); }
function pruneCodes() { stmts.pruneCodes.run(Date.now()); }

/* ---------- 知识库（api.js 用） ---------- */
var kbStmts = {
  list: db.prepare("SELECT * FROM kb_items ORDER BY ts DESC"),
  get: db.prepare("SELECT * FROM kb_items WHERE id = ?"),
  insert: db.prepare([
    "INSERT INTO kb_items (id, ts, source, subject, size, thumb, colors, scheme, grid, user_id)",
    "VALUES (@id, @ts, @source, @subject, @size, @thumb, @colors, @scheme, @grid, @user_id)"
  ].join(" ")),
  del: db.prepare("DELETE FROM kb_items WHERE id = ?")
};

function rowToKB(r) {
  if (!r) return null;
  return {
    id: r.id, ts: r.ts, source: r.source, subject: r.subject, size: r.size,
    thumb: r.thumb, colors: safeParseJSON(r.colors, []),
    scheme: safeParseJSON(r.scheme, []),
    grid: r.grid == null ? null : safeParseJSON(r.grid, null)
  };
}
function listKB() { return kbStmts.list.all().map(rowToKB); }
function getKB(id) { return rowToKB(kbStmts.get.get(id)); }
function addKB(rec) {
  var id = rec.id || ("kb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  kbStmts.insert.run({
    id: id, ts: rec.ts || Date.now(),
    source: rec.source || "未命名成品",
    subject: rec.subject || "未识别",
    size: rec.size || 29,
    thumb: typeof rec.thumb === "string" ? rec.thumb : "",
    colors: JSON.stringify(Array.isArray(rec.colors) ? rec.colors : []),
    scheme: JSON.stringify(Array.isArray(rec.scheme) ? rec.scheme : []),
    grid: Array.isArray(rec.grid) ? JSON.stringify(rec.grid) : null,
    user_id: rec.user_id != null ? rec.user_id : null
  });
  return id;
}
function deleteKBItem(id) { return kbStmts.del.run(id).changes; }

/* 我的作品：仅当前用户可见/可删 */
var myListStmt = db.prepare("SELECT id, ts, source, subject, size, thumb, colors, scheme, views FROM kb_items WHERE user_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?");
var myCountStmt = db.prepare("SELECT COUNT(*) c FROM kb_items WHERE user_id = ?");
var myDeleteStmt = db.prepare("DELETE FROM kb_items WHERE id = ? AND user_id = ?");
var ownerStmt = db.prepare("SELECT user_id FROM kb_items WHERE id = ?");

function listMyWorks(userId, limit, offset) {
  return myListStmt.all(userId, limit, offset).map(rowToGallery);
}
function countMyWorks(userId) { return myCountStmt.get(userId).c; }
function deleteMyWork(id, userId) { return myDeleteStmt.run(id, userId).changes; }
function getWorkOwner(id) { var r = ownerStmt.get(id); return r ? r.user_id : null; }

/* ---------- 管理后台（admin.js 用） ---------- */
var userListStmt = db.prepare("SELECT id, phone, created_at FROM users WHERE (? = '' OR phone LIKE '%' || ? || '%') ORDER BY id DESC LIMIT ? OFFSET ?");
var userCountStmt = db.prepare("SELECT COUNT(*) c FROM users WHERE (? = '' OR phone LIKE '%' || ? || '%')");
var userCountSinceStmt = db.prepare("SELECT COUNT(*) c FROM users WHERE created_at >= ?");
var userDelStmt = db.prepare("DELETE FROM users WHERE id = ?");
var kbSearchList = db.prepare("SELECT id, ts, source, subject, size, thumb, colors, scheme FROM kb_items WHERE (? = '' OR source LIKE '%' || ? || '%' OR subject LIKE '%' || ? || '%') ORDER BY ts DESC LIMIT ? OFFSET ?");
var kbSearchCount = db.prepare("SELECT COUNT(*) c FROM kb_items WHERE (? = '' OR source LIKE '%' || ? || '%' OR subject LIKE '%' || ? || '%')");

function listUsers(limit, offset, q) {
  q = q || "";
  return userListStmt.all(q, q, limit, offset).map(function (r) {
    return { id: r.id, phone: r.phone, created_at: r.created_at };
  });
}
function countUsers(q) { q = q || ""; return userCountStmt.get(q, q).c; }
function countUsersSince(ts) { return userCountSinceStmt.get(ts || 0).c; }
function deleteUser(id) { return userDelStmt.run(id).changes; }
function searchKB(q, limit, offset) {
  q = q || "";
  return kbSearchList.all(q, q, q, limit, offset).map(function (r) {
    return {
      id: r.id, ts: r.ts, source: r.source, subject: r.subject, size: r.size, thumb: r.thumb,
      colorsCount: safeParseJSON(r.colors, []).length,
      schemeCount: safeParseJSON(r.scheme, []).length
    };
  });
}
function countKB(q) { q = q || ""; return kbSearchCount.get(q, q, q).c; }
function listCodes() { return db.prepare("SELECT phone, code, exp FROM codes").all(); }
function dbFileSize() { try { return fs.statSync(DB_FILE).size; } catch (e) { return 0; } }

/* ---------- 展示库（api.js /api/gallery 用） ---------- */
var galleryListStmt = db.prepare("SELECT id, ts, source, subject, size, thumb, colors, scheme, views FROM kb_items WHERE (? = '' OR source LIKE '%' || ? || '%' OR subject LIKE '%' || ? || '%') ORDER BY ts DESC LIMIT ? OFFSET ?");
var galleryCountStmt = db.prepare("SELECT COUNT(*) c FROM kb_items WHERE (? = '' OR source LIKE '%' || ? || '%' OR subject LIKE '%' || ? || '%')");
var galleryGetStmt = db.prepare("SELECT id, ts, source, subject, size, thumb, colors, scheme, views FROM kb_items WHERE id = ?");
var galleryIncStmt = db.prepare("UPDATE kb_items SET views = views + 1 WHERE id = ?");

function galleryOrderBy(sort) {
  // 仅允许固定值，避免 SQL 注入
  return sort === "popular" ? "views DESC, ts DESC" : "ts DESC";
}
function listGallery(limit, offset, q, sort) {
  q = q || "";
  var orderBy = galleryOrderBy(sort);
  // 用参数重建带 ORDER BY 的语句（prepare 缓存按 orderBy 区分）
  var stmt = orderBy === "views DESC, ts DESC"
    ? db.prepare("SELECT id, ts, source, subject, size, thumb, colors, scheme, views FROM kb_items WHERE (? = '' OR source LIKE '%' || ? || '%' OR subject LIKE '%' || ? || '%') ORDER BY views DESC, ts DESC LIMIT ? OFFSET ?")
    : galleryListStmt;
  return stmt.all(q, q, q, limit, offset).map(rowToGallery);
}
function countGallery(q) { q = q || ""; return galleryCountStmt.get(q, q, q).c; }
function getGalleryItem(id) { return rowToGallery(galleryGetStmt.get(id)); }
function incViews(id) { return galleryIncStmt.run(id).changes; }
function rowToGallery(r) {
  if (!r) return null;
  return {
    id: r.id, ts: r.ts, source: r.source, subject: r.subject, size: r.size,
    thumb: r.thumb,
    colors: safeParseJSON(r.colors, []),
    scheme: safeParseJSON(r.scheme, []),
    views: r.views || 0
  };
}

/* ---------- 备份 / 关闭 / 健康检查（稳定运营） ---------- */
// better-sqlite3 在线备份：不阻塞读写，把当前库复制到目标文件
function backupNow(destPath) {
  return db.backup(destPath);
}
function closeDb() {
  if (db && db.open) {
    try { db.close(); } catch (e) { /* ignore */ }
  }
}
// 返回 { ok, users, kb }；连接异常时 ok=false
function healthCheck() {
  try {
    db.prepare("SELECT 1").get();
    var users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
    var kb = db.prepare("SELECT COUNT(*) c FROM kb_items").get().c;
    return { ok: true, users: users, kb: kb };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = {
  db: db,
  // users
  getUserByPhone: getUserByPhone,
  createUser: createUser,
  setCode: setCode,
  getCode: getCode,
  deleteCode: deleteCode,
  pruneCodes: pruneCodes,
  // kb
  listKB: listKB,
  getKB: getKB,
  addKB: addKB,
  deleteKBItem: deleteKBItem,
  // my-works
  listMyWorks: listMyWorks,
  countMyWorks: countMyWorks,
  deleteMyWork: deleteMyWork,
  getWorkOwner: getWorkOwner,
  // admin
  listUsers: listUsers,
  countUsers: countUsers,
  countUsersSince: countUsersSince,
  deleteUser: deleteUser,
  searchKB: searchKB,
  countKB: countKB,
  listCodes: listCodes,
  dbFileSize: dbFileSize,
  // gallery
  listGallery: listGallery,
  countGallery: countGallery,
  getGalleryItem: getGalleryItem,
  incViews: incViews,
  // stable-ops
  backupNow: backupNow,
  closeDb: closeDb,
  healthCheck: healthCheck
};
