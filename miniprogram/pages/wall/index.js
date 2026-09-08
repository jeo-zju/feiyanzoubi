const wallApi = require("../../services/api/wall");
const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");
const { cloudIdsToTempUrl } = require("../../utils/avatar");

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
  // #35: 名片快照 avatarFileId / avatarUrl 都可能是 cloud:// fileID，统一转临时 URL；
  // 转换失败的 cloud:// 一律置空（wxml 走默认头像），杜绝 cloud:// 进 <image> 报 500
  async resolveCardAvatars(cards) {
    if (!Array.isArray(cards) || !cards.length) return cards;
    const ids = [];
    cards.forEach((c) => {
      const s = c && c.snapshot;
      if (!s) return;
      [s.avatarFileId, s.avatarUrl].forEach((v) => {
        if (v && String(v).indexOf("cloud://") === 0 && ids.indexOf(v) < 0) ids.push(String(v));
      });
    });
    const urlMap = await cloudIdsToTempUrl(ids);
    return cards.map((c) => {
      const s = c && c.snapshot;
      if (!s) return c;
      const fix = (v) => {
        if (!v || String(v).indexOf("cloud://") !== 0) return v;
        if (urlMap[v]) return urlMap[v];
        console.warn("[wall] 名片头像转换失败，兜底默认头像", String(v).slice(0, 90));
        return "";
      };
      return Object.assign({}, c, {
        snapshot: Object.assign({}, s, {
          avatarFileId: fix(s.avatarFileId),
          avatarUrl: fix(s.avatarUrl)
        })
      });
    });
  },
  async load() {
    try {
      const meta = await wallApi.get({ gymId: this.data.gymId });
      const list = await wallApi.listCards({ gymId: this.data.gymId });
      this.setData({
        gym: (meta && meta.gym) || {},
        capacity: Number(meta && meta.capacity ? meta.capacity : 100),
        total: Number(meta && meta.total ? meta.total : 0),
        cards: await this.resolveCardAvatars((list && list.cards) || [])
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
