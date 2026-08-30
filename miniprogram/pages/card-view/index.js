const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, drawBackCard, flushCanvas } = require("../../utils/cardRenderer");
const { getWindowWidth } = require("../../utils/window");
const { addLog } = require("../../utils/debugLog");

// #region debug-point A:report-helper
let _viewDebugPortDown = false;
function reportDebug(location, hypothesisId, msg, data) {
  const payload = {
    sessionId: "card-face-overwrite",
    runId: "pre-fix",
    hypothesisId,
    location,
    msg: `[DEBUG] ${msg}`,
    data,
    ts: Date.now()
  };
  const fallbackLog = () => {
    addLog({
      type: "info",
      category: "debug",
      title: `[DEBUG] ${msg}`,
      summary: location,
      detail: payload,
      page: "pages/card-view/index"
    });
  };
  if (_viewDebugPortDown) { fallbackLog(); return; }
  try {
    wx.request({
      url: "http://127.0.0.1:7777/event",
      method: "POST",
      data: payload,
      timeout: 250,
      success: () => {},
      fail: () => {
        _viewDebugPortDown = true;
        fallbackLog();
      }
    });
  } catch (e) {
    _viewDebugPortDown = true;
    addLog({
      type: "info",
      category: "debug",
      title: `[DEBUG] ${msg}`,
      summary: location,
      detail: payload,
      page: "pages/card-view/index"
    });
  }
}
// #endregion

Page({
  data: {
    cardId: "",
    card: null,
    canvasW: 1080,
    canvasH: 720,
    canvasCssW: 0,
    canvasCssH: 0,
    defaultAvatar: "/images/avatar.png",
    isMine: false
  },
  onLoad(options) {
    const cardId = safeText(options && options.cardId);
    this.setData({ cardId });
    const cssW = Math.floor(getWindowWidth() * 0.92);
    const cssH = Math.floor((cssW * this.data.canvasH) / this.data.canvasW);
    this.setData({ canvasCssW: cssW, canvasCssH: cssH });
    // #region debug-point A:on-load
    reportDebug("card-view:onLoad", "A", "card-view onLoad", { cardId, cssW, cssH });
    // #endregion
  },
  onShow() {
    // #region debug-point A:on-show
    reportDebug("card-view:onShow", "A", "card-view onShow", { cardId: this.data.cardId });
    // #endregion
    if (this.data.cardId) this.load();
  },
  async load() {
    try {
      const res = await cardApi.get({ cardId: this.data.cardId });
      const card = res && res.card ? res.card : null;
      let isMine = false;
      if (card) {
        const app = getApp();
        const me = (app && app.globalData && app.globalData.me) || null;
        const myOpenid = (me && me.openid) || (app && app.globalData && app.globalData.openid) || "";
        if (myOpenid) {
          const createdBy = String(card.createdByOpenid || card._openid || card.createdBy || "");
          const owner = String(card.ownerOpenid || "");
          isMine = createdBy === myOpenid || owner === myOpenid;
        }
      }
      this.setData({ card, isMine });
      // #region debug-point B:load-card
      reportDebug("card-view:load", "B", "card-view load card", {
        cardId: this.data.cardId,
        hasFront: !!(card && card.front),
        hasBack: !!(card && card.back),
        hasStory: !!safeText(card && card.back && card.back.story),
        hasPhoto: !!safeText(card && card.back && card.back.photoFileId),
        isMine
      });
      // #endregion
      await this.renderFront();
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  onOpenMenu() {
    const self = this;
    wx.showActionSheet({
      itemList: ["删除这张名片"],
      itemColor: "#C65A5A",
      success(r) {
        if (!r || r.tapIndex !== 0) return;
        self.onConfirmRemove();
      }
    });
  },

  async onConfirmRemove() {
    const self = this;
    const cardId = this.data.cardId;
    if (!cardId) return;
    let hasActiveGift = false;
    let hasWallPlacements = false;
    try {
      const r = await cardApi.removeCreated(cardId, true);
      hasActiveGift = !!(r && r.hasActiveGift);
      hasWallPlacements = !!(r && r.hasWallPlacements);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "检查失败", icon: "none" });
      return;
    }

    let title = "删除这张名片？";
    let content = "删除后无法恢复。";
    if (hasActiveGift && hasWallPlacements) {
      title = "确认删除？";
      content = "删除后墙上会下掉该卡，未领取赠送会取消，操作不可撤销。";
    } else if (hasWallPlacements) {
      title = "确认删除？";
      content = "删除后墙上会下掉该卡，操作不可撤销。";
    } else if (hasActiveGift) {
      title = "确认删除？";
      content = "删除后未领取赠送会取消，操作不可撤销。";
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        confirmText: "删除",
        confirmColor: "#C65A5A",
        success(res) { resolve(!!(res && res.confirm)); },
        fail() { resolve(false); }
      });
    });
    if (!confirmed) return;

    try {
      await cardApi.removeCreated(cardId, false);
      wx.showToast({ title: "已删除", icon: "success" });
      try {
        const cache = require("../../utils/cache");
        cache.invalidate(cache.CACHE_KEYS.ME_PROFILE);
      } catch (_) {}
      setTimeout(() => {
        wx.switchTab({
          url: "/pages/me/index",
          fail() { wx.navigateBack({ fail() {} }); }
        });
      }, 450);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "删除失败", icon: "none" });
    }
  },
  async renderFront() {
    const card = this.data.card;
    if (!card) return;
    const front = card.front || {};
    // #region debug-point C:render-front
    reportDebug("card-view:renderFront", "C", "card-view renderFront", {
      cardId: this.data.cardId,
      displayName: safeText(front.displayName),
      title: safeText(front.title),
      hasOneLiner: !!safeText(front.oneLiner)
    });
    // #endregion

    const ctx = wx.createCanvasContext("cardCanvas", this);
    const W = this.data.canvasW;
    const H = this.data.canvasH;

    ctx.setFillStyle("#0B0D15");
    const avatarSrc = front.avatarMode === "custom" ? front.avatarFileId : front.avatarUrl;
    const avatarPath = (await getImagePath(avatarSrc)) || (await getImagePath(this.data.defaultAvatar));
    drawFrontCard(ctx, { W, H, front, avatarPath, layout: "fixed" });
    await flushCanvas(ctx);
  },
  async renderBack() {
    const card = this.data.card;
    if (!card) return;
    const front = card.front || {};
    const back = card.back || {};
    // #region debug-point D:render-back
    reportDebug("card-view:renderBack", "D", "card-view renderBack", {
      cardId: this.data.cardId,
      hasStory: !!safeText(back.story),
      hasPhoto: !!safeText(back.photoFileId),
      displayName: safeText(front.displayName)
    });
    // #endregion

    const ctx = wx.createCanvasContext("cardCanvas", this);
    const W = this.data.canvasW;
    const H = this.data.canvasH;

    const photoPath = await getImagePath(back.photoFileId);
    drawBackCard(ctx, { W, H, front, back, photoPath, layout: "fixed" });
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
  async saveFront() {
    await this.renderFront();
    await this.saveCurrent();
  },
  async saveBack() {
    await this.renderBack();
    await this.saveCurrent();
  }
});
