/* ============================================================
 *  像素豆 PixelBean · 图形验证码（纯 JS + SVG，无原生依赖）
 * ------------------------------------------------------------
 *  用途：注册/获取短信验证码前的「人機识别」，防止机器人批量刷短信、批量注册。
 *  实现：服务端生成 4 位字符 → 以 SVG 返回前端图片；服务端用内存 Map 暂存
 *        { id: { text, exp } }，5 分钟过期，校验成功后一次性消费（防重放）。
 *  说明：内存存储，主进程重启即清空——对短时验证码场景可接受；若需跨进程共享，
 *        后续可把 store 迁到 Redis / SQLite（接口签名不变）。
 * ============================================================ */
const crypto = require("crypto");

/* 字符集：去掉易混的 0/O/1/I/L */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WIDTH = 120;
const HEIGHT = 44;
const LEN = 4;
const TTL = 5 * 60 * 1000;

const COLORS = ["#E5484D", "#1FA89A", "#F4A041", "#3B6FE0", "#7B4FE0"];

const store = new Map(); // id -> { text, exp }（文字码）
const sliderStore = new Map(); // id -> { targetPct, verified }（滑块拼图）

function randInt(n) { return Math.floor(Math.random() * n); }
function pick(s) { return s[randInt(s.length)]; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function create() {
  // 清理过期项，避免内存泄漏
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.exp < now) store.delete(k);
  }
  let text = "";
  for (let i = 0; i < LEN; i++) text += pick(CHARS);
  const id = crypto.randomBytes(12).toString("hex");
  store.set(id, { text, exp: now + TTL });
  return { id, svg: render(text), text }; // text 仅开发模式由路由透出，生产不返回
}

/* 校验：通过即消费（删除），防止同一验证码反复使用 */
function verify(id, input) {
  if (!id || !input) return false;
  const rec = store.get(id);
  if (!rec) return false;
  if (rec.exp < Date.now()) {
    store.delete(id);
    return false;
  }
  const ok = String(input).trim().toUpperCase() === rec.text;
  if (ok) store.delete(id);
  return ok;
}

function render(text) {
  const parts = [];
  // 背景
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#F6F1E7"/>`);
  // 干扰线
  for (let i = 0; i < 4; i++) {
    const c = COLORS[randInt(COLORS.length)];
    const x1 = randInt(WIDTH), y1 = randInt(HEIGHT);
    const x2 = randInt(WIDTH), y2 = randInt(HEIGHT);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1" opacity="0.35"/>`);
  }
  // 噪点
  for (let i = 0; i < 24; i++) {
    parts.push(`<circle cx="${randInt(WIDTH)}" cy="${randInt(HEIGHT)}" r="1" fill="#6E655A" opacity="0.25"/>`);
  }
  // 字符（随机颜色 / 旋转 / 位置抖动）
  const step = WIDTH / (LEN + 1);
  for (let i = 0; i < LEN; i++) {
    const ch = text[i];
    const color = COLORS[randInt(COLORS.length)];
    const x = step * (i + 1);
    const y = HEIGHT / 2 + (randInt(10) - 5);
    const rot = randInt(40) - 20;
    const size = 26 + randInt(6);
    parts.push(
      `<text x="${x}" y="${y}" font-family="monospace" font-size="${size}" font-weight="700" ` +
      `fill="${color}" text-anchor="middle" dominant-baseline="central" ` +
      `transform="rotate(${rot} ${x} ${y})">${ch}</text>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${parts.join("")}</svg>`;
}

module.exports = { create, verify, TTL, createSlider, verifySlider };

/* ============================================================
 *  滑块拼图验证码（纯 JS + SVG，拖动「拼图块」对齐缺口）
 * ------------------------------------------------------------
 *  体验优于输字符的图形码；同样服务端校验「对齐位置」，防机器人直接刷短信。
 *  安全说明：拼图位置由服务端存储，前端只回传「滑块落点百分比」；
 *          服务端比对落点是否在缺口容差内（TOL_PCT），并校验拖拽时长，
 *          避免脚本瞬时提交。内存存储，主进程重启即清空（短时场景可接受）。
 * ============================================================ */
const SLIDER_W = 300;
const SLIDER_H = 200;
const SLIDER_TTL = 5 * 60 * 1000;
const TOL_PCT = 6;        // 落点容差：缺口中心的 ±6%
const MIN_DUR = 200;      // 最短拖拽时长（ms），低于则视为机器瞬时提交
const GAP_SIZE = 54;      // 缺口（拼图块）尺寸
const PIECE_H = 54;
const PIECE_W = 54;

function createSlider() {
  // 过期清理
  const now = Date.now();
  for (const [k, v] of sliderStore) if (v.exp < now) sliderStore.delete(k);
  // 缺口中心 x：保留边距，避免贴边
  const margin = GAP_SIZE / 2 + 30;
  const targetPx = margin + Math.random() * (SLIDER_W - margin * 2);
  const targetPct = +((targetPx / SLIDER_W) * 100).toFixed(2);
  const id = crypto.randomBytes(12).toString("hex");
  sliderStore.set(id, { targetPct, verified: false, exp: now + SLIDER_TTL });
  return { id, svg: renderSlider(targetPx, targetPct) };
}

/* 校验滑块落点：xPercent 为「拼图块中心相对轨道宽度的百分比」 */
function verifySlider(id, xPercent, durationMs) {
  if (id == null || xPercent == null || !isFinite(xPercent)) return false;
  const rec = sliderStore.get(id);
  if (!rec) return false;
  if (rec.exp < Date.now()) { sliderStore.delete(id); return false; }
  if (Math.abs(xPercent - rec.targetPct) > TOL_PCT) return false;      // 未对齐缺口
  if (durationMs != null && isFinite(durationMs) && durationMs < MIN_DUR) return false; // 瞬时提交
  sliderStore.delete(id); // 一次性消费，防重放
  return true;
}

function renderSlider(targetPx, targetPct) {
  const gx = targetPx - GAP_SIZE / 2;            // 缺口左上 x
  const gy = (SLIDER_H - GAP_SIZE) / 2;          // 居中
  const px = 0, py = gy;                          // 拼图块初始贴左
  function piece(cx, cy, fill, op, extra) {
    return `<g transform="translate(${cx} ${cy})">
      <rect x="0" y="0" width="${PIECE_W}" height="${PIECE_H}" rx="11" ry="11"
        fill="${fill}" fill-opacity="${op}" stroke="#3a2f25" stroke-width="2" ${extra || ""}/>
    </g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIDER_W} ${SLIDER_H}" preserveAspectRatio="xMidYMid meet" data-targetpct="${targetPct}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FBE3CF"/><stop offset="0.5" stop-color="#F6C9A0"/><stop offset="1" stop-color="#E89B6B"/>
    </linearGradient>
    <clipPath id="hole"><rect x="${gx}" y="${gy}" width="${GAP_SIZE}" height="${GAP_SIZE}" rx="11" ry="11"/></clipPath>
  </defs>
  <rect width="${SLIDER_W}" height="${SLIDER_H}" fill="url(#bg)"/>
  <g clip-path="url(#hole)">
    <rect x="0" y="0" width="${SLIDER_W}" height="${SLIDER_H}" fill="#9c6b45" opacity="0.55"/>
  </g>
  <circle cx="46" cy="42" r="20" fill="#ffffff" opacity="0.30"/>
  <circle cx="252" cy="150" r="26" fill="#ffffff" opacity="0.22"/>
  <rect x="120" y="40" width="70" height="14" rx="7" fill="#ffffff" opacity="0.28"/>
  ${piece(gx, gy, "#ffffff", 0.6, "pointer-events:none")}
  ${piece(px, py, "#ffffff", 0.92, 'class="slider-piece"')}
</svg>`;
}

