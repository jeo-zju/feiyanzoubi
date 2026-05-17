const giftApi = require("../../services/api/cardGift");
const shareApi = require("../../services/api/share");
const { safeText } = require("../../utils/format");

Page({
  data: {
    draftCardId: "",
    toOpenid: "",
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
    wx.navigateTo({ url: "/pages/card-edit/index?mode=giftDraft" });
  },
  onToOpenid(e) {
    this.setData({ toOpenid: e.detail.value });
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
      this.setData({ qrFileId });
    } catch (e2) {
      wx.showToast({ title: e2 && e2.message ? e2.message : "生成失败", icon: "none" });
    }
  },
  async onCreateDirect() {
    if (!this.data.draftCardId) return wx.showToast({ title: "先做草稿", icon: "none" });
    const toOpenid = safeText(this.data.toOpenid);
    if (!toOpenid) return wx.showToast({ title: "请输入对方ID", icon: "none" });
    try {
      await giftApi.createDirect({ cardId: this.data.draftCardId, toOpenid });
      wx.showToast({ title: "已赠送", icon: "success" });
      this.setData({ giftId: "", qrFileId: "", toOpenid: "", draftCardId: "" });
      try {
        wx.removeStorageSync("giftDraftCardId");
      } catch (e) {}
    } catch (e2) {
      wx.showToast({ title: e2 && e2.message ? e2.message : "赠送失败", icon: "none" });
    }
  }
});

