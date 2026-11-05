"use strict";
/* ========== 像素豆 PixelBean · 合并部署入口（单进程单端口） ==========
   同时托管：前端静态站 + 数据接口(/api/kb,/api/process,/api/palette,/api/health)
                    + 认证接口(/api/auth/*,/api/me)
   前端与后端同源 → 浏览器 fetch("/api/kb") 直接命中，无需 CORS、无需 localStorage 兜底。

   运行：
     node index.js
   端口：process.env.PORT（默认 4000）
   跨域：process.env.ALLOWED_ORIGIN（逗号分隔的允许源，默认 *；生产设成你的域名）

   稳定运营增强：
     - 安全响应头 + 限流（防滥用 / 防短信轰炸）
     - 定时在线备份 SQLite（缓解免费实例/无持久磁盘的数据丢失风险）
     - SIGINT/SIGTERM 优雅关闭（先停接收、落盘关闭，避免 WAL 损坏）

   适合部署到 Railway / Render / Fly.io / 任意 VPS：
   一个 Web 服务、一个端口即可，SQLite 文件落在 server/data/（容器化时挂卷持久化）。
*/
var express = require("express");
var cors = require("cors");
var path = require("path");
var fs = require("fs");

var apiApp = require("./api");    // 数据接口（纯路由）
var authApp = require("./auth");  // 认证接口（纯路由）
var adminApp = require("./admin"); // 管理后台接口（纯路由）
var db = require("./db");
var sec = require("./security");

var ROOT = path.join(__dirname, "..", "deploy");
var DATA_DIR = path.join(__dirname, "data");
var BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (e) {}

var app = express();

/* 跨域 */
var ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(",") }));

/* 安全响应头（前端大量内联脚本，故不启用严格 CSP，以免破坏页面） */
app.use(function (req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "no-referrer-when-downgrade");
  res.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

/* 限流：发验证码每 IP 每小时最多 10 次（防短信轰炸）；通用 API 每 IP 每分钟最多 300 次 */
app.use("/api/auth/send-code", sec.rateLimit({ windowMs: 3600 * 1000, max: 10 }));
app.use("/api", sec.rateLimit({ windowMs: 60 * 1000, max: 300 }));

app.use(express.json({ limit: "10mb" }));

/* 先挂认证接口，再挂数据接口；两者路径不冲突 */
app.use(authApp);
app.use(apiApp);
app.use("/api/admin", adminApp); // 管理后台（x-admin-token 鉴权）

/* 管理备份端点（需设置 ADMIN_TOKEN 才启用；用 x-admin-token 头鉴权） */
app.post("/api/admin/backup", function (req, res) {
  var t = process.env.ADMIN_TOKEN;
  if (!t) return res.status(403).json({ error: "未启用备份端点（请在环境变量设置 ADMIN_TOKEN）" });
  var h = req.headers["x-admin-token"] || "";
  if (h !== t) return res.status(401).json({ error: "未授权" });
  var ts = new Date().toISOString().replace(/[:.]/g, "-");
  var dest = path.join(BACKUP_DIR, "pixelbean-" + ts + ".db");
  db.backupNow(dest).then(function () {
    res.json({ ok: true, file: path.relative(__dirname, dest) });
  }).catch(function (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  });
});

/* 最后托管前端静态站（同源） */
app.use(express.static(ROOT, { extensions: ["html"] }));

var PORT = process.env.PORT || 4000;
var server = app.listen(PORT, function () {
  console.log("PixelBean 合并服务已启动：http://localhost:" + PORT);
  console.log("同源托管：前端 + 数据接口(/api/kb 等) + 认证接口(/api/auth/*)");
  console.log("ALLOWED_ORIGIN=" + ALLOWED_ORIGIN + "  NODE_ENV=" + (process.env.NODE_ENV || "development"));
});

/* ---- 定时在线备份（缓解免费实例 / 无持久磁盘的数据丢失风险） ---- */
var BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || "21600000", 10); // 默认 6 小时
function runBackup() {
  var ts = new Date().toISOString().replace(/[:.]/g, "-");
  var dest = path.join(BACKUP_DIR, "pixelbean-" + ts + ".db");
  db.backupNow(dest).then(function () {
    console.log("[backup] 完成 -> " + dest);
  }).catch(function (e) {
    console.error("[backup] 失败:", e && e.message);
  });
}
var backupTimer = setInterval(runBackup, BACKUP_INTERVAL_MS);

/* ---- 优雅关闭：先停接收、落盘关闭数据库，避免 WAL 损坏 ---- */
function shutdown(sig) {
  console.log("[shutdown] 收到 " + sig + "，正在优雅关闭...");
  clearInterval(backupTimer);
  server.close(function () {
    try { db.closeDb(); } catch (e) {}
    console.log("[shutdown] 已关闭");
    process.exit(0);
  });
  // 兜底：10 秒内未结束则强制退出
  setTimeout(function () { process.exit(1); }, 10000).unref();
}
process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });
