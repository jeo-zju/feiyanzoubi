const giftApi = require("../../services/api/cardGift");
const shareApi = require("../../services/api/share");
const { safeText } = require("../../utils/format");
const cache = require("../../utils/cache");

Page({
  data: {
    draftCardId: "",
    giftId: "",
    qrFileId: ""
  },
  onShow() {
    let draftCardId = "";
    try {
      draftCardId = safeText(wx.getStorageSync("giftDraftCardId"));
    } catch (e) {}
    this.setData({ draftCardId });
  },
  goMake() {
    wx.showToast({ title: "赠礼草稿制作中", icon: "none" });
  },
  goSaveDraft() {
    const id = this.data.draftCardId;
    if (!id) return;
    wx.navigateTo({ url: `/pages/card-view/index?cardId=${id}` });
  },
  async onCreateLink(e) {
    if (!this.data.draftCardId) return wx.showToast({ title: "先做草稿", icon: "none" });
    try {
      const res = await giftApi.createLink({ cardId: this.data.draftCardId });
      const giftId = safeText(res && res.giftId);
      const page = safeText(res && res.page) || "pages/card-claim/index";
      const scene = safeText(res && res.scene) || `giftId=${giftId}`;
      this.setData({ giftId, qrFileId: "" });

      const qr = await shareApi.render({ page, scene });
      const qrFileId = qr && qr.fileID ? qr.fileID : "";
      try { cache.invalidate(cache.CACHE_KEYS.CARD_SUMMARY); } catch (_) {}
      this.setData({ qrFileId });
    } catch (e2) {
      wx.showToast({ title: e2 && e2.message ? e2.message : "生成失败", icon: "none" });
    }
  },
  onCopyGiftId() {
    const id = safeText(this.data.giftId);
    if (!id) return;
    wx.setClipboardData({ data: id });
  },
  onShareAppMessage() {
    const giftId = safeText(this.data.giftId);
    if (!giftId) {
      return { title: "送你一张攀岩名片", path: "/pages/me/index" };
    }
    return {
      title: "送你一张攀岩名片（点开领取）",
      path: `/pages/card-claim/index?giftId=${giftId}`
    };
  }
});
