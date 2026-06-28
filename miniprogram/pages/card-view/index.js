const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, flushCanvas } = require("../../utils/cardRenderer");
const { getWindowWidth } = require("../../utils/window");

function computeGymsLabel(front) {
  const data = front && typeof front === "object" ? front : {};
  if (data.wanderer) return "浪迹天涯";
  const gyms = Array.isArray(data.gyms) ? data.gyms : [];
  const names = gyms.map((item) => safeText(item && (item.name || item.gymName || item.title))).filter(Boolean);
  return names.length ? `常去：${names.join("、")}` : "浪迹天涯";
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
    const cssW = Math.floor(getWindowWidth() * 0.92);
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
      await this.renderCard();
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  async renderCard() {
    const card = this.data.card;
    if (!card) return;
    const front = card.front || {};
    const back = card.back || {};

    const ctx = wx.createCanvasContext("cardCanvas", this);
    const W = this.data.canvasW;
    const H = this.data.canvasH;

    const avatarSrc = front.avatarMode === "custom" ? front.avatarFileId : front.avatarUrl;
    const avatarPath = (await getImagePath(avatarSrc)) || (await getImagePath(this.data.defaultAvatar));
    const photoPath = await getImagePath((front && front.photoFileId) || back.photoFileId);
    const gymsLabel = computeGymsLabel(front);
    drawFrontCard(ctx, { W, H, front, avatarPath, photoPath, gymsLabel, layout: "fixed" });
    await flushCanvas(ctx);
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
  async onSaveCard() {
    await this.renderCard();
    await this.saveCurrent();
  }
});
