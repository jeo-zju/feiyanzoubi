const giftApi = require("../../services/api/cardGift");
const { safeText } = require("../../utils/format");
const cache = require("../../utils/cache");

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
    card: null
  },
  onLoad(options) {
    let giftId = safeText(options && options.giftId);
    if (!giftId && options && options.scene) {
      const scene = decodeURIComponent(options.scene);
      const q = parseScene(scene);
      giftId = safeText(q.giftId);
    }
    this.setData({ giftId });
    if (giftId) this.loadGift(giftId);
  },
  async loadGift(giftId) {
    try {
      const res = await giftApi.get({ giftId });
      this.setData({ card: res && res.card ? res.card : null });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "加载失败", icon: "none" });
    }
  },
  async onClaim() {
    if (!this.data.giftId) return wx.showToast({ title: "缺少 giftId", icon: "none" });
    try {
      const res = await giftApi.claim({ giftId: this.data.giftId });
      const cardId = safeText(res && res.cardId);
      try {
        cache.invalidate(cache.CACHE_KEYS.CARD_SUMMARY);
        cache.invalidate(cache.CACHE_KEYS.ME_CARD_FINGERPRINT);
        cache.invalidate(cache.CACHE_KEYS.ME_CARD_IMG_PATH);
      } catch (_) {}
      wx.showToast({ title: "已领取", icon: "success" });
      setTimeout(() => {
        if (cardId) {
          wx.navigateTo({ url: `/pages/card-view/index?cardId=${cardId}` });
          return;
        }
        wx.switchTab({ url: "/pages/me/index" });
      }, 600);
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "领取失败", icon: "none" });
    }
  }
});
