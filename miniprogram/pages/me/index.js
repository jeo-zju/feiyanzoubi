const { login } = require("../../services/api/auth");
const cardApi = require("../../services/api/card");

Page({
  data: {
    user: {
      nickName: "",
      avatarUrl: "",
      projectName: "Project"
    },
    defaultAvatar: "/images/avatar.png",
    openid: "",
    credit: { remaining: 0, limit: 10 },
    myPrimaryCard: null,
    myPrimaryCardDetail: null,
    flipped: false,
    receivedCount: 0,
    receivedThumbs: []
  },
  async onShow() {
    await this.ensureLogin();
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    this.setData({
      user: {
        nickName: user.nickName || "",
        avatarUrl: user.avatarUrl || "",
        projectName: user.projectName || "Project"
      }
    });
    await this.loadCardSummary();
  },
  async ensureLogin() {
    const app = getApp();
    if (app && app.globalData && app.globalData.user && app.globalData.user.openid) return;
    try {
      const res = await login(null);
      if (app && app.globalData) app.globalData.user = res && res.user ? res.user : res;
    } catch (e) {}
  },
  async onSync() {
    try {
      const profile = await wx.getUserProfile({ desc: "用于展示头像昵称" });
      const userInfo = profile && profile.userInfo ? profile.userInfo : null;
      const res = await login(userInfo);
      const app = getApp();
      if (app && app.globalData) app.globalData.user = res && res.user ? res.user : res;
      wx.showToast({ title: "已同步", icon: "none" });
      await this.onShow();
    } catch (e) {
      wx.showToast({ title: "未授权", icon: "none" });
    }
  },
  goOwner() {
    wx.navigateTo({ url: "/pages/owner/index" });
  },
  goLogs() {
    wx.navigateTo({ url: "/pages/logs/index" });
  },
  async loadCardSummary() {
    try {
      const res = await cardApi.listMy({});
      this.setData({
        openid: (res && res.openid) || "",
        credit: (res && res.credit) || { remaining: 0, limit: 10 },
        myPrimaryCard: (res && res.myPrimaryCard) || null,
        receivedCount: Number(res && res.receivedCount ? res.receivedCount : 0),
        receivedThumbs: (res && res.receivedThumbs) || [],
        myPrimaryCardDetail: null,
        flipped: false
      });
    } catch (e) {}
  },
  goEditMyCard() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    wx.navigateTo({ url: `/pages/card-edit/index?mode=self${cardId ? `&cardId=${cardId}` : ""}` });
  },
  goGift() {
    wx.navigateTo({ url: "/pages/card-gift/index" });
  },
  goWallet() {
    wx.navigateTo({ url: "/pages/card-wallet/index" });
  },
  async onFlip() {
    const primary = this.data.myPrimaryCard;
    if (!primary || !primary.cardId) return;
    if (!this.data.flipped && !this.data.myPrimaryCardDetail) {
      try {
        const res = await cardApi.get({ cardId: primary.cardId });
        this.setData({ myPrimaryCardDetail: res && res.card ? res.card : null });
      } catch (e) {}
    }
    this.setData({ flipped: !this.data.flipped });
  },
  onCopyOpenid() {
    const openid = this.data.openid || "";
    if (!openid) return;
    wx.setClipboardData({ data: openid });
  }
});

