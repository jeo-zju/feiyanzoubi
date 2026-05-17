const cardApi = require("../../services/api/card");
const cardManageApi = require("../../services/api/cardManage");
const { safeText } = require("../../utils/format");

Page({
  data: {
    credit: { remaining: 0, limit: 10 },
    receivedCount: 0,
    receivedCards: []
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
        receivedCards: (res && res.receivedCards) || []
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
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
  }
});

