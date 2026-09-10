const giftApi = require("../../services/api/cardGift");
const { safeText } = require("../../utils/format");
const cache = require("../../utils/cache");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, flushCanvas } = require("../../utils/cardRenderer");
const { getWindowWidth } = require("../../utils/window");

function parseScene(scene) {
  const s = safeText(scene);
  if (!s) return {};
  const out = {};
  s.split("&").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i <= 0) return;
    const k = safeText(kv.slice(0, i));
    const v = safeText(kv.slice(i + 1));
    if (k) out[k] = v;
  });
  return out;
}

Page({
  data: {
    giftId: "",
    card: null,
    // 阶段：pending 可领取 | claimed 本机刚领取成功 | closed 已被领取/取消
    stage: "pending",
    statusText: "领取后名片会进入你的名片夹，可在「我的」里查看。",
    closedText: "",
    claimedCardId: "",
    claiming: false,
    loadError: false,
    loadErrorText: "",
    canvasW: 1080,
    canvasH: 720,
    canvasCssW: 0,
    canvasCssH: 0,
    defaultAvatar: "/images/avatar.png"
  },
  onLoad(options) {
    let giftId = safeText(options && options.giftId);
    if (!giftId && options && options.scene) {
      const scene = decodeURIComponent(options.scene);
      const q = parseScene(scene);
      giftId = safeText(q.giftId);
    }
    const cssW = Math.floor(getWindowWidth() * 0.92);
    const cssH = Math.floor((cssW * this.data.canvasH) / this.data.canvasW);
    this.setData({ giftId, canvasCssW: cssW, canvasCssH: cssH });
    if (giftId) this.loadGift(giftId);
    else this.setData({ loadError: true, loadErrorText: "缺少领取码" });
  },
  async loadGift(giftId) {
    this.setData({ loadError: false, loadErrorText: "" });
    try {
      const res = await giftApi.get({ giftId });
      const card = res && res.card ? res.card : null;
      if (!card) {
        this.setData({ loadError: true, loadErrorText: "名片信息缺失" });
        return;
      }
      const giftStatus = safeText(res && res.gift && res.gift.status);
      let stage = "pending";
      let statusText = this.data.statusText;
      let closedText = "";
      if (giftStatus === "claimed") {
        stage = "closed";
        statusText = "这张名片已被领取。";
        closedText = "已被领取";
      } else if (giftStatus === "cancelled") {
        stage = "closed";
        statusText = "这次赠送已取消。";
        closedText = "赠送已取消";
      }
      await new Promise((resolve) => {
        this.setData({ card, stage, statusText, closedText }, resolve);
      });
      await this.render();
    } catch (e) {
      const code = safeText(e && e.code);
      const text = (e && e.message) || "加载失败";
      // 无权限 / 不存在 / 网络失败分开呈现，均不给可点领取
      this.setData({
        loadError: true,
        loadErrorText: code === "FORBIDDEN" ? "你没有查看这张名片的权限" : text
      });
    }
  },
  onRetry() {
    if (this.data.giftId) this.loadGift(this.data.giftId);
  },
  async render() {
    const card = this.data.card;
    if (!card) return;
    const front = card.front || {};

    const ctx = wx.createCanvasContext("cardCanvas", this);
    const W = this.data.canvasW;
    const H = this.data.canvasH;

    ctx.setFillStyle("#0B0D15");
    const avatarSrc = front.avatarMode === "custom" ? front.avatarFileId : front.avatarUrl;
    const avatarPath = (await getImagePath(avatarSrc)) || (await getImagePath(this.data.defaultAvatar));

    const gyms = front.gyms || [];
    const gymsLabel = (Array.isArray(gyms) && gyms[0] && (gyms[0].city || gyms[0].name)) || "浪迹天涯";

    drawFrontCard(ctx, {
      W, H, front, me: {}, user: {}, gymsLabel, avatarPath, layout: "fixed",
      extra: {
        climbSkills: {},
        heightCm: "",
        armspanCm: "",
        rockId: "",
        wechatId: "",
        showWechat: false,
        xhsId: "",
        showXhs: false
      }
    });
    await flushCanvas(ctx);
  },
  async onClaim() {
    if (this.data.claiming) return;
    if (!this.data.giftId) return wx.showToast({ title: "缺少 giftId", icon: "none" });
    this.setData({ claiming: true });
    try {
      const res = await giftApi.claim({ giftId: this.data.giftId });
      const cardId = safeText(res && res.cardId);
      try {
        cache.invalidate(cache.CACHE_KEYS.CARD_SUMMARY);
        cache.invalidate(cache.CACHE_KEYS.ME_CARD_FINGERPRINT);
        cache.invalidate(cache.CACHE_KEYS.ME_CARD_IMG_PATH);
      } catch (_) {}
      // 同一操作槽变「查看名片」；保存/分享在 card-view 完成，不自动跳走
      this.setData({
        stage: "claimed",
        claimedCardId: cardId,
        statusText: "已领取，名片已放入你的名片夹。"
      });
      wx.showToast({ title: "已领取", icon: "success" });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "领取失败", icon: "none" });
    } finally {
      this.setData({ claiming: false });
    }
  },
  onViewCard() {
    const cardId = this.data.claimedCardId;
    if (!cardId) {
      this.goMe();
      return;
    }
    wx.navigateTo({ url: `/pages/card-view/index?cardId=${cardId}` });
  },
  goMe() {
    wx.switchTab({ url: "/pages/me/index" });
  }
});
