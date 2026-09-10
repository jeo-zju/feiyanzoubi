// 一次性脚本：生成 TabBar 2px 线性图标（默认灰 #969D90 / 选中酸橙绿 #D2EF72）
// 81x81 RGBA PNG，仅用 node 内置模块。运行：node deploy-tools/scripts/gen-tab-icons.js
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const SIZE = 81;
const HALF = 2.7; // 笔触半宽（约 2px 逻辑 @3x）

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function pushSeg(segs, x1, y1, x2, y2) { segs.push([x1, y1, x2, y2]); }
function polyline(segs, pts) {
  for (let i = 0; i < pts.length - 1; i++) pushSeg(segs, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
}
function circle(segs, cx, cy, r, n) {
  n = n || 48;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  polyline(segs, pts);
}
function arc(segs, cx, cy, rx, ry, a0, a1, n) {
  n = n || 40;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  polyline(segs, pts);
}
function roundedRect(segs, x0, y0, x1, y1, r) {
  const pts = [];
  const steps = 12;
  const corners = [
    [x1 - r, y0 + r, -Math.PI / 2, 0],
    [x1 - r, y1 - r, 0, Math.PI / 2],
    [x0 + r, y1 - r, Math.PI / 2, Math.PI],
    [x0 + r, y0 + r, Math.PI, Math.PI * 1.5]
  ];
  for (const c of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = c[2] + (c[3] - c[2]) * (i / steps);
      pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  }
  pts.push(pts[0]);
  polyline(segs, pts);
}

function homeSegs() {
  const s = [];
  polyline(s, [[11, 43], [40.5, 13], [70, 43]]);
  polyline(s, [[22, 40], [22, 67], [59, 67], [59, 40]]);
  return s;
}
function calendarSegs() {
  const s = [];
  roundedRect(s, 13, 21, 68, 68, 7);
  pushSeg(s, 13, 34, 68, 34);
  pushSeg(s, 25, 12, 25, 26);
  pushSeg(s, 56, 12, 56, 26);
  return s;
}
function userSegs() {
  const s = [];
  circle(s, 40.5, 28, 11);
  arc(s, 40.5, 84, 27, 26, (205 * Math.PI) / 180, (335 * Math.PI) / 180);
  return s;
}

function render(segs, rgb) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5, py = y + 0.5;
      let d = Infinity;
      for (const sg of segs) d = Math.min(d, segDist(px, py, sg[0], sg[1], sg[2], sg[3]));
      let a = HALF + 0.5 - d;
      a = Math.max(0, Math.min(1, a));
      const i = (y * SIZE + x) * 4;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const GRAY = [150, 157, 144];
const LIME = [210, 239, 114];
const outDir = path.resolve(__dirname, "..", "..", "miniprogram", "images", "icons");
const targets = [
  ["home.png", homeSegs(), GRAY],
  ["home-active.png", homeSegs(), LIME],
  ["calendar.png", calendarSegs(), GRAY],
  ["calendar-active.png", calendarSegs(), LIME],
  ["usercenter.png", userSegs(), GRAY],
  ["usercenter-active.png", userSegs(), LIME]
];
for (const t of targets) {
  const png = encodePng(render(t[1], t[2]));
  fs.writeFileSync(path.join(outDir, t[0]), png);
  console.log(t[0], png.length, "bytes");
}
