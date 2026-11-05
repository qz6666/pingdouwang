"use strict";
/* ============================================================
 *  像素豆 PixelBean · 轻量安全模块（单进程内存实现）
 * ------------------------------------------------------------
 *  单进程够用；若以后水平扩展为多副本，需把这里的存储换成
 *  Redis 等共享存储（接口形态保持一致即可无缝替换）。
 *
 *  提供：
 *    rateLimit(opts)            通用滑动窗口限流中间件
 *    checkSendCooldown/markSent 单手机号发码冷却（60s/次）
 *    recordLoginFailure/clearLoginFailure/loginLockInfo  登录失败锁定
 * ============================================================ */
var WINDOW_MS = 60 * 1000;

/* ---------------- 通用限流：滑动窗口（按 key 计数） ---------------- */
var buckets = new Map(); // key -> { count, resetAt }
function rateLimit(opts) {
  var windowMs = (opts && opts.windowMs) || WINDOW_MS;
  var max = (opts && opts.max) || 200;
  var keyFn = opts && opts.keyFn;
  return function (req, res, next) {
    var base = keyFn ? keyFn(req) : (req.ip || req.socket.remoteAddress || "anon");
    var key = "rl:" + base;
    var now = Date.now();
    var b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      var retry = Math.ceil((b.resetAt - now) / 1000);
      res.set("Retry-After", String(retry));
      return res.status(429).json({ message: "请求过于频繁，请 " + retry + " 秒后再试" });
    }
    next();
  };
}

/* ---------------- 单手机号发送验证码冷却（默认 60s 一次） ---------------- */
var sendCooldown = new Map(); // phone -> 解锁时间戳
function checkSendCooldown(phone, cooldownMs) {
  var cd = cooldownMs || 60 * 1000;
  var until = sendCooldown.get(phone) || 0;
  var now = Date.now();
  if (now < until) return Math.ceil((until - now) / 1000);
  return 0;
}
function markSent(phone, cooldownMs) {
  sendCooldown.set(phone, Date.now() + (cooldownMs || 60 * 1000));
}

/* ---------------- 登录失败锁定 ---------------- */
var MAX_FAIL = 5;
var LOCK_MS = 15 * 60 * 1000; // 锁定 15 分钟
var fails = new Map();         // phone -> { count, lockedUntil }
function recordLoginFailure(phone) {
  var r = fails.get(phone) || { count: 0, lockedUntil: 0 };
  r.count++;
  if (r.count >= MAX_FAIL) r.lockedUntil = Date.now() + LOCK_MS;
  fails.set(phone, r);
  return r;
}
function clearLoginFailure(phone) { fails.delete(phone); }
function loginLockInfo(phone) {
  var r = fails.get(phone);
  if (!r) return { locked: false, remaining: 0, fails: 0 };
  var now = Date.now();
  if (r.lockedUntil && now > r.lockedUntil) {
    fails.delete(phone);
    return { locked: false, remaining: 0, fails: 0 };
  }
  return {
    locked: !!(r.lockedUntil && now < r.lockedUntil),
    remaining: r.lockedUntil ? Math.max(0, r.lockedUntil - now) : 0,
    fails: r.count
  };
}

module.exports = {
  rateLimit: rateLimit,
  checkSendCooldown: checkSendCooldown,
  markSent: markSent,
  recordLoginFailure: recordLoginFailure,
  clearLoginFailure: clearLoginFailure,
  loginLockInfo: loginLockInfo,
  MAX_FAIL: MAX_FAIL,
  LOCK_MS: LOCK_MS
};
