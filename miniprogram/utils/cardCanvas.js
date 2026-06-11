const { safeText } = require("./format");

function clampText(s, n) {
  const t = safeText(s);
  if (!t) return "";
  return t.length <= n ? t : t.slice(0, n);
}

function wrapCanvasText(ctx, text, maxWidth) {
  const t = safeText(text);
  if (!t) return [];
  const chars = t.split("");
  const lines = [];
  let line = "";
  for (let i = 0; i < chars.length; i++) {
    const next = line + chars[i];
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = chars[i];
  }
  if (line) lines.push(line);
  return lines;
}

function isCloudFileId(v) {
  const s = safeText(v);
  return s.startsWith("cloud://");
}

async function toTempUrl(fileIdOrUrl) {
  const v = safeText(fileIdOrUrl);
  if (!v) return "";
  if (!isCloudFileId(v)) return v;
  try {
    const r = await wx.cloud.getTempFileURL({ fileList: [v] });
    const item = r && r.fileList && r.fileList[0] ? r.fileList[0] : null;
    return item && item.tempFileURL ? item.tempFileURL : "";
  } catch (e) {
    return "";
  }
}

async function getImagePath(fileIdOrUrl) {
  const url = await toTempUrl(fileIdOrUrl);
  if (!url) return "";
  const s = String(url);
  if (s.startsWith("wxfile://")) return s;
  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) return s;
  if (!/^https?:\/\//.test(s)) return s;
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: url,
      success: (r) => resolve(r && r.path ? r.path : ""),
      fail: () => resolve("")
    });
  });
}

module.exports = {
  clampText,
  wrapCanvasText,
  getImagePath
};
