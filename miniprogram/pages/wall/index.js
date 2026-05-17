const wallApi = require("../../services/api/wall");
const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");

Page({
  data: {
    gymId: "",
    gym: {},
    capacity: 100,
    total: 0,
    cards: [],
    defaultAvatar: "/images/avatar.png"
  },
  onLoad(options) {
    const gymId = safeText(options && options.gymId);
    this.setData({ gymId });
  },
  onShow() {
    if (this.data.gymId) this.load();
  },
  async load() {
    try {
      const meta = await wallApi.get({ gymId: this.data.gymId });
      const list = await wallApi.listCards({ gymId: this.data.gymId });
      this.setData({
        gym: (meta && meta.gym) || {},
        capacity: Number(meta && meta.capacity ? meta.capacity : 100),
        total: Number(meta && meta.total ? meta.total : 0),
        cards: (list && list.cards) || []
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  async onHang() {
    try {
      const mine = await cardApi.listMy({ full: true });
      const primary = mine && mine.myPrimaryCard ? mine.myPrimaryCard : null;
      const gifted = (mine && mine.myCreatedGiftedCards) || [];
      const options = [];
      const ids = [];
      if (primary && primary.cardId) {
        options.push(`我的主卡：${primary.displayName || "岩友"} / ${primary.title || ""}`);
        ids.push(primary.cardId);
      }
      gifted.slice(0, 6).forEach((c) => {
        options.push(`我送出的：${c.displayName || "岩友"} / ${c.title || ""}`);
        ids.push(c.cardId);
      });
      if (!ids.length) return wx.showToast({ title: "先做一张名片", icon: "none" });

      wx.showActionSheet({
        itemList: options,
        success: async (r) => {
          const idx = Number(r.tapIndex);
          const cardId = ids[idx];
          if (!cardId) return;
          await wallApi.hang({ gymId: this.data.gymId, cardId });
          wx.showToast({ title: "已上墙", icon: "success" });
          this.load();
        }
      });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "上墙失败", icon: "none" });
    }
  }
});
