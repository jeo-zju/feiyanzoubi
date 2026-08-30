const cardApi = require("../../services/api/card");
const userApi = require("../../services/api/user");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, flushCanvas } = require("../../utils/cardRenderer");
const { ensureAppLogin, isAdminUser } = require("../../utils/session");
const { getWindowWidth } = require("../../utils/window");
const { DEFAULT_AVATAR, DEFAULT_AVATAR_CANVAS } = require("../../utils/constants");
const cache = require("../../utils/cache");

const CARD_PX_W = 960;
const CARD_PX_H = 606;
const CARD_RATIO = CARD_PX_W / CARD_PX_H;

Page({
  data: {
    user: { nickName: "", avatarUrl: "", projectName: "Project" },
    me: {},
    defaultAvatar: DEFAULT_AVATAR,
    canSeeToolbox: false,
    drawerOpen: false,

    credit: { remaining: 0, limit: 10 },
    creditPercent: 0,

    profileTabs: [],
    myPrimaryCard: null,
    cardSyncing: false,
    myCardCssW: 0,
    myCardCssH: 0,
    myCardPreviewImage: "",
    footHeat: [],
    footSummary: { totalDays: 0, gymCount: 0, total: 0 }
  },

  onLoad() { this.computeMyCardSize(); },

  async onShow() {
    this.setData({ cardSyncing: true });
    this.computeMyCardSize();
    await this.ensureLogin();
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    let me = (app && app.globalData && app.globalData.me) || {};
    try {
      const profileRes = await cache.get(cache.CACHE_KEYS.ME_PROFILE, {
        ttlMin: 60,
        useL2: true,
        loader: async () => {
          const r = await userApi.getMe();
          return r && r.me ? r.me : null;
        }
      });
      if (profileRes) {
        me = profileRes;
        if (app && app.globalData) app.globalData.me = profileRes;
      }
    } catch (e) {
      try {
        const r = await userApi.getMe();
        if (r && r.me) { me = r.me; if (app && app.globalData) app.globalData.me = r.me; }
      } catch (_) {}
    }
    this.setData({
      user: {
        nickName: user.nickName || me.nickName || "",
        avatarUrl: user.avatarUrl || me.avatarUrl || "",
        projectName: user.projectName || "Project"
      },
      me,
      canSeeToolbox: !!isAdminUser(user)
    });
    await Promise.all([this.loadCardSummary()]);
  },

  computeMyCardSize() {
    const app = getApp();
    let winW = null;
    try {
      if (app && app.globalData && typeof app.globalData._winSizeCached === "number" && app.globalData._winSizeCached > 0) {
        winW = app.globalData._winSizeCached;
      }
    } catch (_) {}
    if (!winW) {
      winW = getWindowWidth();
      try {
        if (app && app.globalData && typeof winW === "number" && winW > 0) {
          app.globalData._winSizeCached = winW;
        }
      } catch (_) {}
    }
    const rpx2px = (rpx) => (rpx * winW) / 750;
    const pagePad = rpx2px(24 * 2);
    const cardBdPad = rpx2px(22 * 2);
    const w = Math.floor(Math.max(240, winW - pagePad - cardBdPad));
    const h = Math.floor(w / CARD_RATIO);
    if (w !== this.data.myCardCssW || h !== this.data.myCardCssH) {
      this.setData({ myCardCssW: w, myCardCssH: h }, () => {
        if (this.data.me && !this.data.cardSyncing) this.renderMyCardSoon("resize");
      });
    }
  },

  async ensureLogin() { try { await ensureAppLogin(); } catch (e) {} },

  goProfileEdit() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/profile-edit/index" }); } catch (_) {} },
  goOwner() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/owner/index" }); } catch (_) {} },
  goBackstage() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/backstage/index" }); } catch (_) {} },
  goDebugLogs() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/debug-logs/index" }); } catch (_) {} },
  goGymMerge() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/gym-merge/index" }); } catch (_) {} },
  goFriendList() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/friend-list/index" }); } catch (_) {} },
  goCircleList() { this.setData({ drawerOpen: false }); try { wx.navigateTo({ url: "/pages/circle-list/index" }); } catch (_) {} },

  onOpenDrawer() { this.setData({ drawerOpen: true }); },
  onCloseDrawer() { this.setData({ drawerOpen: false }); },
  noop() {},

  async loadCardSummary() {
    try {
      const res = await cache.get(cache.CACHE_KEYS.CARD_SUMMARY, {
        ttlMin: 30,
        useL2: true,
        loader: async () => await cardApi.listMy({})
      });
      const credit = (res && res.credit) || { remaining: 0, limit: 10 };
      const remaining = Number(credit && credit.remaining ? credit.remaining : 0);
      const limit = Number(credit && credit.limit ? credit.limit : 0);
      const creditPercent = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining * 100) / limit))) : 0;
      const nextPrimaryCard = (res && res.myPrimaryCard) || null;
      this.setData({
        credit,
        creditPercent,
        myPrimaryCard: nextPrimaryCard,
        cardSyncing: false
      });
      try {
        const me = this.data.me || {};
        const fp = [
          nextPrimaryCard && nextPrimaryCard.cardId ? nextPrimaryCard.cardId : "",
          nextPrimaryCard && nextPrimaryCard._updateTime ? nextPrimaryCard._updateTime : (nextPrimaryCard && nextPrimaryCard.updatedAt ? nextPrimaryCard.updatedAt : ""),
          me._updateTime ? me._updateTime : (me.updatedAt ? me.updatedAt : ""),
          nextPrimaryCard ? JSON.stringify(nextPrimaryCard).length : 0
        ].join("|");
        cache.set(cache.CACHE_KEYS.ME_CARD_FINGERPRINT, fp, 60 * 24, { saveL2: true });
        this._currentCardFingerprint = fp;
      } catch (_) {}
      this.renderMyCardSoon("summary");
    } catch (e) {
      this.setData({ cardSyncing: false });
    }
  },

  goGift() { wx.navigateTo({ url: "/pages/card-gift/index" }); },
  goSaveMyCard() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    if (!cardId) { wx.showToast({ title: "先创建你的名片", icon: "none" }); return; }
    wx.navigateTo({ url: `/pages/card-view/index?cardId=${cardId}` });
  },

  renderMyCardSoon(reason) {
    if (this.data.cardSyncing && reason !== "summary") return;
    if (!this.data.myPrimaryCard) return;
    if (this._cardPreviewTimer) clearTimeout(this._cardPreviewTimer);
    this._cardPreviewTimer = setTimeout(() => { this._cardPreviewTimer = null; this.renderMyCard(); }, 60);
  },

  async renderMyCard() {
    if (!this.data.myPrimaryCard) return;
    const token = (this._cardPreviewToken || 0) + 1;
    this._cardPreviewToken = token;

    try {
      const me = this.data.me || {};
      const primary = this.data.myPrimaryCard || {};
      let currentFp = this._currentCardFingerprint || "";
      if (!currentFp) {
        currentFp = [
          primary && primary.cardId ? primary.cardId : "",
          primary && primary._updateTime ? primary._updateTime : (primary && primary.updatedAt ? primary.updatedAt : ""),
          me._updateTime ? me._updateTime : (me.updatedAt ? me.updatedAt : ""),
          primary ? JSON.stringify(primary).length : 0
        ].join("|");
      }
      if (currentFp) {
        try {
          const savedFp = await cache.get(cache.CACHE_KEYS.ME_CARD_FINGERPRINT, { useL2: true });
          const savedPath = await cache.get(cache.CACHE_KEYS.ME_CARD_IMG_PATH, { useL2: true });
          const isTemp = (p) => {
            if (!p) return true;
            const s = String(p).toLowerCase();
            return s.includes("__tmp__") || s.includes("/tmp_") || s.includes("\\tmp_") || (s.startsWith("http://") && s.includes("tmp"));
          };
          if (savedFp && savedPath && savedFp === currentFp && !isTemp(savedPath)) {
            const exists = await new Promise((resolve) => {
              try {
                wx.getImageInfo({
                  src: savedPath,
                  success: () => resolve(true),
                  fail: () => resolve(false)
                });
              } catch (_) { resolve(false); }
            });
            if (exists && token === this._cardPreviewToken) {
              this.setData({ myCardPreviewImage: savedPath });
              return;
            } else if (!exists) {
              try {
                cache.invalidate(cache.CACHE_KEYS.ME_CARD_IMG_PATH);
                cache.invalidate(cache.CACHE_KEYS.ME_CARD_FINGERPRINT);
              } catch (_) {}
            }
          } else if (savedFp === currentFp && isTemp(savedPath)) {
            try {
              cache.invalidate(cache.CACHE_KEYS.ME_CARD_IMG_PATH);
              cache.invalidate(cache.CACHE_KEYS.ME_CARD_FINGERPRINT);
            } catch (_) {}
          }
        } catch (_) {}
      }
    } catch (_) {}

    const primary = this.data.myPrimaryCard || {};
    const ctx = wx.createCanvasContext("myCardPreviewCanvas", this);
    const W = CARD_PX_W;
    const H = CARD_PX_H;
    const avatarSrc =
      (primary.avatarMode === "custom" ? primary.avatarFileId : primary.avatarUrl) ||
      this.data.me.avatarUrl ||
      this.data.user.avatarUrl || "";
    let avatarPath = DEFAULT_AVATAR_CANVAS;
    try {
      avatarPath =
        (avatarSrc ? (await getImagePath(avatarSrc)) : "") ||
        (primary.avatarUrl ? (await getImagePath(primary.avatarUrl)) : "") ||
        (await getImagePath(DEFAULT_AVATAR_CANVAS)) ||
        (await getImagePath(DEFAULT_AVATAR)) ||
        DEFAULT_AVATAR_CANVAS;
    } catch (_) {}
    if (!avatarPath) avatarPath = DEFAULT_AVATAR_CANVAS;

    const me = this.data.me || {};
    const user = this.data.user || {};
    const gymsLabel = me.city ? me.city : "浪迹天涯";
    drawFrontCard(ctx, {
      W, H, front: primary, me, user, gymsLabel, avatarPath, layout: "fixed",
      extra: {
        climbSkills: me.climbSkills || {},
        heightCm: me.heightCm || me.height || "",
        armspanCm: me.armspanCm || me.armspan || "",
        rockId: me.rockId || ""
      }
    });
    try { await flushCanvas(ctx); } catch (_) {}
    if (token !== this._cardPreviewToken) return;
    const tempPath = await new Promise((resolve) => {
      try {
        wx.canvasToTempFilePath({
          canvasId: "myCardPreviewCanvas",
          width: W,
          height: H,
          destWidth: W,
          destHeight: H,
          fileType: "png",
          quality: 1,
          success: (r) => resolve(r && r.tempFilePath ? r.tempFilePath : ""),
          fail: () => resolve("")
        }, this);
      } catch (_) { resolve(""); }
    });
    if (token !== this._cardPreviewToken) return;
    if (tempPath) {
      try {
        const savedPath = await new Promise((resolve) => {
          try {
            wx.saveFile({
              tempFilePath: tempPath,
              success: (r) => resolve(r && r.savedFilePath ? r.savedFilePath : ""),
              fail: () => resolve("")
            });
          } catch (_) { resolve(""); }
        });
        if (savedPath) {
          try {
            const isTemp = (p) => {
              if (!p) return true;
              const s = String(p).toLowerCase();
              return s.includes("__tmp__") || s.includes("/tmp_") || s.includes("\\tmp_") || (s.startsWith("http://") && s.includes("tmp"));
            };
            if (!isTemp(savedPath)) {
              cache.set(cache.CACHE_KEYS.ME_CARD_IMG_PATH, savedPath, 60 * 24, { saveL2: true });
              const me = this.data.me || {};
              const primaryCard = this.data.myPrimaryCard || {};
              const fp = this._currentCardFingerprint || [
                primaryCard && primaryCard.cardId ? primaryCard.cardId : "",
                primaryCard && primaryCard._updateTime ? primaryCard._updateTime : (primaryCard && primaryCard.updatedAt ? primaryCard.updatedAt : ""),
                me._updateTime ? me._updateTime : (me.updatedAt ? me.updatedAt : ""),
                primaryCard ? JSON.stringify(primaryCard).length : 0
              ].join("|");
              cache.set(cache.CACHE_KEYS.ME_CARD_FINGERPRINT, fp, 60 * 24, { saveL2: true });
            }
          } catch (_) {}
        }
      } catch (_) {}
    }
    this.setData({ myCardPreviewImage: tempPath || "" });
  },

  onCardPreviewImgError() {
    try {
      cache.invalidate(cache.CACHE_KEYS.ME_CARD_IMG_PATH);
      cache.invalidate(cache.CACHE_KEYS.ME_CARD_FINGERPRINT);
    } catch (_) {}
    this.setData({ myCardPreviewImage: "" });
    try {
      if (this._cardPreviewToken) this._cardPreviewToken = (this._cardPreviewToken || 0) + 1;
    } catch (_) {}
    try {
      const self = this;
      if (this.data.me && this.data.myPrimaryCard) {
        setTimeout(() => { self.renderMyCard && self.renderMyCard(); }, 50);
      }
    } catch (_) {}
  },

  async loadFootprint() {
    try {
      const res = await userApi.getMe();
      const plans = ((res && res.me && res.me.plans) || []).slice(0, 14);
      const heat = [];
      for (let i = 0; i < 14; i++) heat.push({ idx: i, heat: 0 });
      const gyms = new Set();
      let total = 0;
      plans.forEach((p) => {
        if (p && p.gymId) gyms.add(p.gymId);
        if (p && p.status !== "cancelled") total += 1;
      });
      const days = new Set((plans || []).map((p) => (p && p.date ? p.date : ""))).size;
      this.setData({
        footHeat: heat,
        footSummary: { totalDays: days, gymCount: gyms.size, total }
      });
    } catch (e) {}
  },

  onUnload() {
    if (this._cardPreviewTimer) clearTimeout(this._cardPreviewTimer);
    this._cardPreviewTimer = null;
    this._cardPreviewToken = 0;
  }
});
