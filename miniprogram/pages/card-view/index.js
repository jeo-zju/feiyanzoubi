const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");

function clamp(s, n) {
  const t = safeText(s);
  if (!t) return "";
  return t.length <= n ? t : t.slice(0, n);
}

function wrapLines(ctx, text, maxWidth) {
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
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: url,
      success: (r) => resolve(r && r.path ? r.path : ""),
      fail: () => resolve("")
    });
  });
}

Page({
  data: {
    cardId: "",
    card: null,
    canvasW: 1080,
    canvasH: 720,
    canvasCssW: 0,
    canvasCssH: 0,
    defaultAvatar: "/images/avatar.png"
  },
  onLoad(options) {
    const cardId = safeText(options && options.cardId);
    this.setData({ cardId });
    const sys = wx.getSystemInfoSync();
    const cssW = Math.floor((sys && sys.windowWidth ? sys.windowWidth : 375) * 0.92);
    const cssH = Math.floor((cssW * this.data.canvasH) / this.data.canvasW);
    this.setData({ canvasCssW: cssW, canvasCssH: cssH });
  },
  onShow() {
    if (this.data.cardId) this.load();
  },
  async load() {
    try {
      const res = await cardApi.get({ cardId: this.data.cardId });
      const card = res && res.card ? res.card : null;
      this.setData({ card });
      await this.renderFront();
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  async renderFront() {
    const card = this.data.card;
    if (!card) return;
    const front = card.front || {};

    const ctx = wx.createCanvasContext("cardCanvas", this);
    const W = this.data.canvasW;
    const H = this.data.canvasH;

    ctx.setFillStyle("#0B0D15");
    ctx.fillRect(0, 0, W, H);

    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(143,123,255,0.95)");
    g.addColorStop(1, "rgba(242,193,78,0.95)");
    ctx.setFillStyle(g);
    ctx.fillRect(0, 0, W, 78);

    ctx.setFillStyle("rgba(255,255,255,0.10)");
    ctx.fillRect(54, 120, W - 108, H - 210);

    const avatarSrc = front.avatarMode === "custom" ? front.avatarFileId : front.avatarUrl;
    const avatarPath = (await getImagePath(avatarSrc)) || (await getImagePath(this.data.defaultAvatar));
    const ax = 86;
    const ay = 156;
    const ar = 72;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
    ctx.clip();
    if (avatarPath) ctx.drawImage(avatarPath, ax, ay, ar * 2, ar * 2);
    ctx.restore();
    ctx.setStrokeStyle("rgba(242,193,78,0.85)");
    ctx.setLineWidth(6);
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar + 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(48);
    ctx.fillText(clamp(front.displayName || "岩友", 10), 190, 206);

    ctx.setFillStyle("rgba(255,255,255,0.92)");
    ctx.setFontSize(28);
    const meta = `${clamp(front.title, 12)}${front.mbti ? ` · ${clamp(front.mbti, 6)}` : ""}`;
    ctx.fillText(meta, 190, 250);

    const one = clamp(front.oneLiner, 40);
    ctx.setFillStyle("rgba(255,255,255,0.95)");
    ctx.setFontSize(34);
    const lines = wrapLines(ctx, one, W - 200);
    for (let i = 0; i < Math.min(2, lines.length); i++) {
      ctx.fillText(lines[i], 120, 352 + i * 46);
    }

    ctx.setFillStyle("rgba(255,255,255,0.65)");
    ctx.setFontSize(22);
    ctx.fillText("飞岩走壁 · 攀岩名片", 120, H - 88);
    ctx.fillText(front.oneLinerStyle === "humor" ? "风格：幽默" : "风格：鼓励", 120, H - 54);

    ctx.draw();
  },
  async renderBack() {
    const card = this.data.card;
    if (!card) return;
    const front = card.front || {};
    const back = card.back || {};

    const ctx = wx.createCanvasContext("cardCanvas", this);
    const W = this.data.canvasW;
    const H = this.data.canvasH;

    ctx.setFillStyle("#0B0D15");
    ctx.fillRect(0, 0, W, H);

    const photoPath = await getImagePath(back.photoFileId);
    if (photoPath) {
      ctx.drawImage(photoPath, 0, 0, W, H);
      ctx.setFillStyle("rgba(11,13,21,0.55)");
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "rgba(143,123,255,0.55)");
      g.addColorStop(1, "rgba(242,193,78,0.35)");
      ctx.setFillStyle(g);
      ctx.fillRect(0, 0, W, H);
    }

    ctx.setFillStyle("rgba(255,255,255,0.10)");
    ctx.fillRect(60, 80, W - 120, H - 160);

    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(40);
    ctx.fillText(clamp(front.displayName || "岩友", 10), 120, 156);

    ctx.setFillStyle("rgba(255,255,255,0.92)");
    ctx.setFontSize(28);
    ctx.fillText("背面故事", 120, 208);

    ctx.setFillStyle("rgba(255,255,255,0.95)");
    ctx.setFontSize(30);
    const lines = wrapLines(ctx, clamp(back.story, 220), W - 240);
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      ctx.fillText(lines[i], 120, 270 + i * 44);
    }

    ctx.setFillStyle("rgba(255,255,255,0.65)");
    ctx.setFontSize(22);
    ctx.fillText("飞岩走壁 · 攀岩名片", 120, H - 62);

    ctx.draw();
  },
  async ensureAlbumPermission() {
    const setting = await new Promise((resolve) => wx.getSetting({ success: resolve, fail: () => resolve(null) }));
    const auth = setting && setting.authSetting ? setting.authSetting : {};
    if (auth["scope.writePhotosAlbum"]) return true;
    const ok = await new Promise((resolve) =>
      wx.authorize({
        scope: "scope.writePhotosAlbum",
        success: () => resolve(true),
        fail: () => resolve(false)
      })
    );
    if (ok) return true;
    await new Promise((resolve) =>
      wx.showModal({
        title: "需要相册权限",
        content: "用来保存名片到相册",
        confirmText: "去设置",
        success: (r) => {
          if (!r.confirm) return resolve();
          wx.openSetting({ complete: resolve });
        },
        fail: resolve
      })
    );
    const setting2 = await new Promise((resolve) => wx.getSetting({ success: resolve, fail: () => resolve(null) }));
    const auth2 = setting2 && setting2.authSetting ? setting2.authSetting : {};
    return !!auth2["scope.writePhotosAlbum"];
  },
  async saveCurrent() {
    const can = await this.ensureAlbumPermission();
    if (!can) return wx.showToast({ title: "未获得相册权限", icon: "none" });
    const tempPath = await new Promise((resolve) => {
      wx.canvasToTempFilePath({
        canvasId: "cardCanvas",
        width: this.data.canvasW,
        height: this.data.canvasH,
        destWidth: this.data.canvasW,
        destHeight: this.data.canvasH,
        success: (r) => resolve(r && r.tempFilePath ? r.tempFilePath : ""),
        fail: () => resolve("")
      }, this);
    });
    if (!tempPath) return wx.showToast({ title: "生成图片失败", icon: "none" });
    await new Promise((resolve) =>
      wx.saveImageToPhotosAlbum({
        filePath: tempPath,
        success: () => {
          wx.showToast({ title: "已保存", icon: "success" });
          resolve();
        },
        fail: () => {
          wx.showToast({ title: "保存失败", icon: "none" });
          resolve();
        }
      })
    );
  },
  async saveFront() {
    await this.renderFront();
    setTimeout(() => this.saveCurrent(), 200);
  },
  async saveBack() {
    await this.renderBack();
    setTimeout(() => this.saveCurrent(), 200);
  }
});

