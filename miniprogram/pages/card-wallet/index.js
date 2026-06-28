const cardApi = require("../../services/api/card");
const cardManageApi = require("../../services/api/cardManage");
const { safeText } = require("../../utils/format");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, flushCanvas } = require("../../utils/cardRenderer");
const { getWindowWidth } = require("../../utils/window");

Page({
  data: {
    credit: { remaining: 0, limit: 10 },
    receivedCount: 0,
    sentCount: 0,
    receivedCards: [],
    sentCards: [],
    activeTab: "received",
    defaultAvatar: "/images/avatar.png",
    canvasW: 1080,
    canvasH: 720,
    canvasCssW: 320,
    canvasCssH: 213
  },
  onLoad(options) {
    const tab = safeText(options && options.tab);
    this.setData({
      activeTab: tab === "sent" ? "sent" : "received"
    });
    const cssW = Math.floor(getWindowWidth() * 0.9);
    const cssH = Math.floor((cssW * this.data.canvasH) / this.data.canvasW);
    this.setData({ canvasCssW: cssW, canvasCssH: cssH });
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const res = await cardApi.listMy({ full: true });
      this.setData({
        credit: (res && res.credit) || { remaining: 0, limit: 10 },
        receivedCount: Number(res && res.receivedCount ? res.receivedCount : 0),
        sentCount: Number(res && res.sentCount ? res.sentCount : 0),
        receivedCards: (res && res.receivedCards) || [],
        sentCards: (res && res.sentCards) || (res && res.myCreatedGiftedCards) || []
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  onSwitchTab(e) {
    const tab = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab);
    if (!tab || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab === "sent" ? "sent" : "received" });
  },
  async onSetPrimary(e) {
    const cardId = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!cardId) return;
    try {
      await cardManageApi.setPrimary({ cardId });
      wx.showToast({ title: "已设置", icon: "success" });
      this.load();
    } catch (e2) {
      wx.showToast({ title: e2 && e2.message ? e2.message : "设置失败", icon: "none" });
    }
  },
  async onRemove(e) {
    const cardId = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!cardId) return;
    wx.showModal({
      title: "删除名片",
      content: "删除后不可恢复，确定继续？",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await cardManageApi.removeReceived({ cardId });
          wx.showToast({ title: "已删除", icon: "success" });
          this.load();
        } catch (e2) {
          wx.showToast({ title: e2 && e2.message ? e2.message : "删除失败", icon: "none" });
        }
      }
    });
  },
  computeGymsLabel(front) {
    const data = front && typeof front === "object" ? front : {};
    if (data.wanderer) return "浪迹天涯";
    const gyms = Array.isArray(data.gyms) ? data.gyms : [];
    const names = gyms.map((item) => safeText(item && (item.name || item.gymName || item.title))).filter(Boolean);
    return names.length ? `常去：${names.join("、")}` : "浪迹天涯";
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
  async renderCardTempFile(cardId) {
    const res = await cardApi.get({ cardId });
    const card = res && res.card ? res.card : null;
    if (!card) return "";
    const front = card.front || {};
    const back = card.back || {};
    const ctx = wx.createCanvasContext("walletCardCanvas", this);
    const avatarSrc = front.avatarMode === "custom" ? front.avatarFileId : front.avatarUrl;
    const avatarPath = (await getImagePath(avatarSrc)) || (await getImagePath(this.data.defaultAvatar));
    const photoPath = await getImagePath((front && front.photoFileId) || back.photoFileId);
    const gymsLabel = this.computeGymsLabel(front);
    drawFrontCard(ctx, {
      W: this.data.canvasW,
      H: this.data.canvasH,
      front,
      avatarPath,
      photoPath,
      gymsLabel,
      layout: "fixed"
    });
    await flushCanvas(ctx);
    return await new Promise((resolve) => {
      wx.canvasToTempFilePath(
        {
          canvasId: "walletCardCanvas",
          width: this.data.canvasW,
          height: this.data.canvasH,
          destWidth: this.data.canvasW,
          destHeight: this.data.canvasH,
          success: (r) => resolve((r && r.tempFilePath) || ""),
          fail: () => resolve("")
        },
        this
      );
    });
  },
  async onSave(e) {
    const cardId = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!cardId) return;
    const can = await this.ensureAlbumPermission();
    if (!can) return wx.showToast({ title: "未获得相册权限", icon: "none" });
    try {
      wx.showLoading({ title: "保存中", mask: true });
      const tempPath = await this.renderCardTempFile(cardId);
      if (!tempPath) throw new Error("生成图片失败");
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
    } catch (e2) {
      wx.showToast({ title: e2 && e2.message ? e2.message : "保存失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  }
});
