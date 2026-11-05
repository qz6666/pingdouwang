/* ============================================================
 *  像素豆 PixelBean · 登录/注册后端（Node/Express + JWT + SQLite）
 * ------------------------------------------------------------
 *  接口（前端走这些）：
 *    POST /api/auth/send-code  {phone}              → 发送 6 位验证码
 *    POST /api/auth/register   {phone, code, password}  → 注册并签发 JWT
 *    POST /api/auth/login      {phone, password}    → 登录并签发 JWT
 *    GET  /api/me              (Bearer Token)        → 当前登录手机号
 *
 *  设计说明：
 *   - 本文件只负责「接口路由」，不含 cors / 静态托管 / listen。
 *   - cors 与 express.json 由合并入口 index.js 在顶层统一挂载。
 *   - 仅当「作为主模块独立运行」（node auth.js）时，才托管前端静态站并 listen。
 *   - 健康检查 /api/health 由 api.js 提供，这里不再重复定义。
 *
 *  生产环境落地清单（见文件底部注释）：
 *    1) 短信：把 sendSMS 换成阿里云/腾讯云/Twilio 等真实发送
 *    2) 存储：本就用 SQLite（better-sqlite3，见 db.js），无需再换
 *    3) 验证码：已在 SQLite 带过期时间；上线前加热点/频率限制
 *    4) 密钥：JWT_SECRET 务必走环境变量，绝不硬编码
 *    5) 部署：把合并服务（index.js）托管到公网，ALLOWED_ORIGIN 设前端域名
 * ============================================================ */

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const db = require("./db");
const sec = require("./security");
const captcha = require("./captcha");

const JWT_SECRET = process.env.JWT_SECRET || "pixelbean-dev-secret-change-me";
const IS_PROD = process.env.NODE_ENV === "production";

/* 图形验证码开关：默认「生产开 / 开发关」，可显式覆盖
 *   CAPTCHA_ENABLED=true  → 强制开启（含开发环境）
 *   CAPTCHA_ENABLED=false → 强制关闭
 */
const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== "false" && (IS_PROD || process.env.CAPTCHA_ENABLED === "true");

/* ---------------- 工具 ---------------- */
const PHONE_RE = /^1[3-9]\d{9}$/;
const CODE_RE = /^\d{6}$/;
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function sendSMS(phone, code) {
  // ===== 生产环境：在此调用短信服务商 API =====
  // 例如阿里云短信、腾讯云 SMS、Twilio 等；不要把验证码返回给前端。
  console.log(`[SMS 模拟发送] 手机号 ${phone} 的验证码是 ${code}（有效期 5 分钟）`);
}

/* ---------------- 应用（纯路由，不含 cors/static/listen） ---------------- */
const app = express();
app.use(express.json());

/* 1) 发送验证码 */
app.post("/api/auth/send-code", (req, res) => {
  const phone = (req.body && req.body.phone || "").trim();
  if (!PHONE_RE.test(phone)) return res.status(400).json({ message: "手机号格式不正确" });
  // 人机校验：滑块拼图（优先）或图形验证码，防机器人刷短信
  if (CAPTCHA_ENABLED) {
    const cid = (req.body && req.body.captchaId) || "";
    if (req.body && req.body.captchaType === "slider") {
      // 滑块拼图：前端回传拼图块落点百分比与拖拽时长（先于冷却校验，确保时长/对齐校验生效）
      const xp = Number(req.body.captchaXPercent);
      const dur = req.body.captchaDurationMs != null ? Number(req.body.captchaDurationMs) : null;
      if (!captcha.verifySlider(cid, xp, dur)) {
        return res.status(400).json({ message: "请拖动滑块将拼图对齐缺口" });
      }
    } else {
      const ctext = ((req.body && req.body.captchaText) || "").trim();
      if (!captcha.verify(cid, ctext)) {
        return res.status(400).json({ message: "图形验证码不正确，请刷新后重试" });
      }
    }
  }
  // 单手机号 60s 冷却，防刷短信（人机校验通过后才计冷却）
  const cd = sec.checkSendCooldown(phone);
  if (cd > 0) return res.status(429).json({ message: "验证码已发送，请 " + cd + " 秒后再试" });
  db.pruneCodes();
  const code = genCode();
  db.setCode(phone, code, Date.now() + 5 * 60 * 1000);
  sendSMS(phone, code);
  sec.markSent(phone);
  // 开发模式把验证码回传前端，方便本地测试；生产模式绝不返回
  const body = { ok: true };
  if (!IS_PROD) body.devCode = code;
  res.json(body);
});

/* 0) 获取图形验证码（注册/发码前展示，防机器） */
app.get("/api/auth/captcha", (req, res) => {
  if (!CAPTCHA_ENABLED) return res.status(404).json({ message: "图形验证码未启用" });
  const d = captcha.create();
  const body = { id: d.id, svg: d.svg };
  if (!IS_PROD) body.text = d.text; // 仅开发模式透出，便于自动化测试；生产绝不返回
  res.json(body);
});

/* 0.5) 获取滑块拼图验证码（拖动对齐缺口，体验优于输字符） */
app.get("/api/auth/captcha-slider", (req, res) => {
  if (!CAPTCHA_ENABLED) return res.status(404).json({ message: "滑块验证未启用" });
  const d = captcha.createSlider();
  res.json({ id: d.id, svg: d.svg });
});

/* 0.6) 即时校验滑块落点（拖动结束即反馈；发码时后端仍会再次校验，防绕过） */
app.post("/api/auth/verify-slider", (req, res) => {
  if (!CAPTCHA_ENABLED) return res.status(404).json({ message: "滑块验证未启用" });
  const id = (req.body && req.body.captchaId) || "";
  const xp = Number((req.body && req.body.xPercent));
  const dur = req.body && req.body.durationMs != null ? Number(req.body.durationMs) : null;
  if (captcha.verifySlider(id, xp, dur)) return res.json({ ok: true });
  return res.status(400).json({ ok: false, message: "未对齐，请拖动拼图到缺口处" });
});

/* 2) 注册（手机号 + 验证码 + 密码） */
app.post("/api/auth/register", async (req, res) => {
  const phone = (req.body && req.body.phone || "").trim();
  const code = (req.body && req.body.code || "").trim();
  const password = req.body && req.body.password || "";
  if (!PHONE_RE.test(phone)) return res.status(400).json({ message: "手机号格式不正确" });
  if (!CODE_RE.test(code)) return res.status(400).json({ message: "请输入 6 位验证码" });
  if (!password || password.length < 6) return res.status(400).json({ message: "密码至少 6 位" });

  const rec = db.getCode(phone);
  if (!rec || rec.code !== code) return res.status(400).json({ message: "验证码错误或已失效" });
  if (Date.now() > rec.exp) return res.status(400).json({ message: "验证码已过期，请重新获取" });
  db.deleteCode(phone);

  if (db.getUserByPhone(phone)) {
    return res.status(409).json({ message: "该手机号已注册，请直接登录" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  db.createUser(phone, passwordHash, Date.now());

  const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ ok: true, token, phone });
});

/* 3) 登录（手机号 + 密码） */
app.post("/api/auth/login", async (req, res) => {
  const phone = (req.body && req.body.phone || "").trim();
  const password = req.body && req.body.password || "";
  // 登录失败锁定：连续 5 次错误锁定 15 分钟
  const lock = sec.loginLockInfo(phone);
  if (lock.locked) {
    return res.status(429).json({ message: "账号已临时锁定，请 " + Math.ceil(lock.remaining / 1000) + " 秒后再试" });
  }
  const user = db.getUserByPhone(phone);
  if (!user) return res.status(401).json({ message: "账号不存在，请先注册" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    sec.recordLoginFailure(phone);
    return res.status(401).json({ message: "密码错误" });
  }
  sec.clearLoginFailure(phone);
  const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ ok: true, token, phone });
});

/* 4) 获取当前登录信息（需 Bearer Token） */
app.get("/api/me", (req, res) => {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ message: "未登录" });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    res.json({ ok: true, phone: payload.phone });
  } catch (e) {
    res.status(401).json({ message: "登录已过期，请重新登录" });
  }
});

/* 作为主模块独立运行时：托管前端并监听端口 */
if (require.main === module) {
  app.use(express.static(path.join(__dirname, "..", "deploy")));
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`像素豆认证服务已启动: http://localhost:${PORT}`);
    console.log(`静态站点目录: ${path.join(__dirname, "..", "deploy")}`);
    console.log(`模式: ${IS_PROD ? "生产(prod)" : "开发(dev，验证码会回传前端便于测试)"}`);
  });
}

module.exports = app;
