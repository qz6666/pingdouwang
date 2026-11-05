/**
 * 共享鉴权工具：从请求头解析并校验 Bearer Token，返回手机号（无效则为 null）。
 * 与 auth.js 使用同一 JWT_SECRET，避免重复实现。
 */
var jwt = require("jsonwebtoken");

var JWT_SECRET = process.env.JWT_SECRET || "pixelbean-dev-secret-change-me";

function getPhoneFromReq(req) {
  var h = (req && req.headers && req.headers.authorization) || "";
  var m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  try {
    var payload = jwt.verify(m[1], JWT_SECRET);
    return (payload && payload.phone) || null;
  } catch (e) {
    return null;
  }
}

module.exports = { getPhoneFromReq: getPhoneFromReq, JWT_SECRET: JWT_SECRET };
