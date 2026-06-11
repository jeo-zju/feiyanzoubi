const cardApi = require("../../services/api/card");
const { ensureAppLogin } = require("../../utils/session");
const { getWindowWidth } = require("../../utils/window");

Page({
  data: {
    user: {
      nickName: "",
      avatarUrl: "",
      projectName: "Project"
    },
    defaultAvatar: "/images/avatar.png",
    credit: { remaining: 0, limit: 10 },
    creditPercent: 0,
    myPrimaryCard: null,
    myPrimaryCardDetail: null,
    flipped: false,
    receivedCount: 0,
    receivedThumbs: [],
    myCardCssW: 0,
    myCardCssH: 0
  },
  onLoad() {
    this.computeMyCardSize();
  },
  async onShow() {
    this.computeMyCardSize();
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
  computeMyCardSize() {
    const BANK_CARD_RATIO = 85.6 / 53.98;
    const winW = getWindowWidth();
    const rpx2px = (rpx) => (rpx * winW) / 750;
    const pagePad = rpx2px(24 * 2);
    const cardBdPad = rpx2px(22 * 2);
    const w = Math.floor(Math.max(240, winW - pagePad - cardBdPad));
    const h = Math.floor(w / BANK_CARD_RATIO);
    if (w !== this.data.myCardCssW || h !== this.data.myCardCssH) this.setData({ myCardCssW: w, myCardCssH: h });
  },
  async ensureLogin() {
    try {
      await ensureAppLogin();
    } catch (e) {}
  },
  goProfileEdit() {
    wx.navigateTo({ url: "/pages/profile-edit/index" });
  },
  goOwner() {
    wx.navigateTo({ url: "/pages/owner/index" });
  },
  goDebugLogs() {
    wx.navigateTo({ url: "/pages/debug-logs/index" });
  },
  async loadCardSummary() {
    try {
      const res = await cardApi.listMy({});
      const credit = (res && res.credit) || { remaining: 0, limit: 10 };
      const remaining = Number(credit && credit.remaining ? credit.remaining : 0);
      const limit = Number(credit && credit.limit ? credit.limit : 0);
      const creditPercent = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining * 100) / limit))) : 0;
      this.setData({
        credit,
        creditPercent,
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
  goSaveMyCard() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    if (!cardId) return;
    wx.navigateTo({ url: `/pages/card-view/index?cardId=${cardId}` });
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
});

