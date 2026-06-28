const cardApi = require("../../services/api/card");
const giftApi = require("../../services/api/cardGift");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const { getDefaultCardPreview } = require("../../utils/cardDefaults");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, flushCanvas } = require("../../utils/cardRenderer");
const { buildCacheKey, readCache, writeCache } = require("../../utils/pageCache");
const { getWindowWidth } = require("../../utils/window");

const ME_CACHE_MAX_AGE = 2 * 60 * 1000;
const BANK_CARD_RATIO = 85.6 / 53.98;
const SHARE_CARD_W = 1080;
const SHARE_CARD_H = Math.round(SHARE_CARD_W / BANK_CARD_RATIO);
const DEFAULT_AVATAR_CANVAS = "../../images/avatar.png";

Page({
  data: {
    user: {
      nickName: "",
      avatarUrl: "",
      projectName: ""
    },
    defaultAvatar: "/images/avatar.png",
    credit: { remaining: 0, limit: 10 },
    creditPercent: 0,
    myPrimaryCard: null,
    myPrimaryCardDetail: null,
    flipped: false,
    receivedCount: 0,
    myCardCssH: 0,
    shareCanvasW: SHARE_CARD_W,
    shareCanvasH: SHARE_CARD_H,
    shareCanvasCssW: 320,
    shareCanvasCssH: Math.floor(320 / BANK_CARD_RATIO),
    sharePickerVisible: false,
    shareGiftId: "",
    sharePreviewImage: "",
    myCardPreviewImage: "",
    myCardView: {
      displayName: "岩友",
      title: "长臂猿",
      mbti: "",
      gymLabel: "浪迹天涯",
      oneLiner: "再试一次就过",
      avatarUrl: "",
      avatarMode: "wechat",
      avatarFileId: ""
    },
    emptyCardPreview: {
      displayName: "岩友",
      title: "长臂猿",
      gymLabel: "浪迹天涯",
      oneLiner: "再试一次就过"
    }
  },
  onLoad() {
    this.computeMyCardSize();
  },
  async onShow() {
    this.computeMyCardSize();
    await this.ensureLogin();
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    const preview = getDefaultCardPreview(user);
    this.setData({
      user: {
        nickName: user.nickName || "",
        avatarUrl: user.avatarUrl || "",
        projectName: user.projectName || ""
      },
      emptyCardPreview: preview
    });
    this.syncMyCardView();
    const hasCache = this.applyCardSummaryCache();
    if (hasCache) this.syncMyCardView();
    await this.loadCardSummary({ silent: hasCache, hasCache });
  },
  computeMyCardSize() {
    const BANK_CARD_RATIO = 85.6 / 53.98;
    const winW = getWindowWidth();
    const rpx2px = (rpx) => (rpx * winW) / 750;
    const pagePad = rpx2px(24 * 2);
    const cardBdPad = rpx2px(22 * 2);
    const w = Math.floor(Math.max(240, winW - pagePad - cardBdPad));
    const h = Math.floor(w / BANK_CARD_RATIO);
    if (h !== this.data.myCardCssH || w !== this.data.shareCanvasCssW) {
      this.setData({
        myCardCssH: h,
        shareCanvasCssW: w,
        shareCanvasCssH: h
      });
    }
  },
  async ensureLogin() {
    try {
      await ensureAppLogin();
    } catch (e) {}
  },
  goOwner() {
    wx.navigateTo({ url: "/pages/owner/index" });
  },
  goBackstage() {
    wx.navigateTo({ url: "/pages/backstage/index" });
  },
  getSummaryCacheKey() {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    return buildCacheKey("me_card_summary", {
      openid: safeText(user.openid)
    });
  },
  normalizeCardSummary(res) {
    const credit = (res && res.credit) || { remaining: 0, limit: 10 };
    const remaining = Number(credit && credit.remaining ? credit.remaining : 0);
    const limit = Number(credit && credit.limit ? credit.limit : 0);
    const creditPercent = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining * 100) / limit))) : 0;
    return {
      credit,
      creditPercent,
      myPrimaryCard: (res && res.myPrimaryCard) || null,
      receivedCount: Number(res && res.receivedCount ? res.receivedCount : 0),
      myPrimaryCardDetail: null,
      myCardPreviewImage: "",
      myCardView: this.buildMyCardView((res && res.myPrimaryCard) || null, null),
      flipped: false
    };
  },
  buildMyCardView(primary, detail) {
    const preview = this.data.emptyCardPreview || {};
    const user = this.data.user || {};
    const front = detail && detail.front ? detail.front : null;
    const summary = primary && typeof primary === "object" ? primary : {};
    return {
      displayName: safeText((front && front.displayName) || summary.displayName || preview.displayName) || "岩友",
      title: safeText((front && front.title) || summary.title || preview.title) || "长臂猿",
      mbti: safeText((front && front.mbti) || summary.mbti),
      gymLabel:
        safeText((front && this.computeGymsLabel(front)) || summary.gymLabel || preview.gymLabel) || "浪迹天涯",
      oneLiner: safeText((front && front.oneLiner) || summary.oneLiner || preview.oneLiner) || "再试一次就过",
      avatarUrl: safeText((front && front.avatarUrl) || summary.avatarUrl || user.avatarUrl),
      avatarMode: safeText((front && front.avatarMode) || summary.avatarMode) || "wechat",
      avatarFileId: safeText((front && front.avatarFileId) || summary.avatarFileId)
    };
  },
  syncMyCardView() {
    this.setData({
      myCardView: this.buildMyCardView(this.data.myPrimaryCard, this.data.myPrimaryCardDetail)
    });
  },
  applyCardSummaryCache() {
    const cached = readCache(this.getSummaryCacheKey(), { maxAge: ME_CACHE_MAX_AGE });
    if (!cached || !cached.data) return false;
    this.setData(this.normalizeCardSummary(cached.data));
    return true;
  },
  afterViewReady() {
    return new Promise((resolve) => {
      if (typeof wx.nextTick === "function") {
        wx.nextTick(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  },
  async loadCardSummary({ silent, hasCache } = {}) {
    try {
      const res = await cardApi.listMy({}, { loading: !silent });
      const nextState = this.normalizeCardSummary(res);
      this.setData(nextState);
      writeCache(this.getSummaryCacheKey(), res || {});
      this.syncMyCardView();
      if (nextState.myPrimaryCard && nextState.myPrimaryCard.cardId) {
        try {
          await this.ensurePrimaryCardDetail();
        } catch (e) {}
      }
    } catch (e) {
      if (!hasCache) wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  goEditMyCard() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    wx.navigateTo({ url: `/pages/card-edit/index?mode=self${cardId ? `&cardId=${cardId}` : ""}` });
  },
  goGift() {
    this.openShareActions();
  },
  goWallet() {
    wx.navigateTo({ url: "/pages/card-wallet/index" });
  },
  goSaveMyCard() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    if (!cardId) return;
    wx.navigateTo({ url: `/pages/card-view/index?cardId=${cardId}` });
  },
  noop() {},
  closeSharePicker() {
    this.setData({ sharePickerVisible: false });
  },
  async ensurePrimaryCardDetail() {
    const primary = this.data.myPrimaryCard;
    if (!primary || !primary.cardId) return null;
    const detail = this.data.myPrimaryCardDetail;
    if (detail && safeText(detail._id || detail.cardId) === primary.cardId) {
      return this.data.myPrimaryCardDetail;
    }
    const res = await cardApi.get({ cardId: primary.cardId });
    const card = res && res.card ? res.card : null;
    if (card) {
      this.setData({ myPrimaryCardDetail: card });
      this.syncMyCardView();
    }
    return card;
  },
  buildDefaultCardData() {
    const preview = this.data.emptyCardPreview || {};
    const avatarUrl = safeText(this.data.user && this.data.user.avatarUrl);
    return {
      front: {
        displayName: safeText(preview.displayName) || "岩友",
        title: safeText(preview.title) || "长臂猿",
        mbti: "",
        gyms: [],
        wanderer: true,
        avatarMode: "wechat",
        avatarFileId: "",
        avatarUrl,
        oneLiner: safeText(preview.oneLiner) || "再试一次就过",
        oneLinerStyle: "humor"
      },
      back: {
        photoFileId: "",
        story: safeText(preview.oneLiner) || "再试一次就过"
      }
    };
  },
  async ensurePrimaryCardExists() {
    const primary = this.data.myPrimaryCard;
    if (primary && primary.cardId) return primary.cardId;
    const card = this.buildDefaultCardData();
    const res = await cardApi.upsert({ mode: "self", card });
    const cardId = safeText(res && res.cardId);
    await this.loadCardSummary({ silent: true, hasCache: true });
    return cardId;
  },
  async syncPrimaryCardPreview() {
    this.syncMyCardView();
  },
  renderPrimaryCardPreviewSoon() {
    if (this._mePreviewTimer) clearTimeout(this._mePreviewTimer);
    this._mePreviewTimer = setTimeout(() => {
      this._mePreviewTimer = null;
      if (wx.nextTick) wx.nextTick(() => this.renderPrimaryCardPreview());
      else this.renderPrimaryCardPreview();
    }, 120);
  },
  async renderPrimaryCardPreview() {
    const token = (this._mePreviewToken || 0) + 1;
    this._mePreviewToken = token;
    const tempPath = await this.renderCardToCanvas("myCardCanvas", true, { hideFooter: true });
    if (token !== this._mePreviewToken) return;
    if (!tempPath) {
      this.setData({ myCardPreviewImage: "" });
      return;
    }
    const ok = await new Promise((resolve) => {
      wx.getImageInfo({
        src: tempPath,
        success: (r) => resolve(!!(r && r.width >= 600 && r.height >= 300)),
        fail: () => resolve(false)
      });
    });
    if (token !== this._mePreviewToken) return;
    if (!ok) {
      this.setData({ myCardPreviewImage: "" });
      setTimeout(() => {
        if (token === this._mePreviewToken) this.renderPrimaryCardPreviewSoon();
      }, 180);
      return;
    }
    this.setData({ myCardPreviewImage: tempPath });
  },
  async renderCardToCanvas(canvasId, needTempFile, options) {
    let card = null;
    const primary = this.data.myPrimaryCard;
    if (primary && primary.cardId) {
      card = await this.ensurePrimaryCardDetail();
    }
    if (!card) card = this.buildDefaultCardData();
    const front = card.front || {};
    const back = card.back || {};
    const ctx = wx.createCanvasContext(canvasId, this);
    const avatarSrc = front.avatarMode === "custom" ? front.avatarFileId : front.avatarUrl;
    let avatarPath =
      (await getImagePath(avatarSrc)) ||
      (await getImagePath(front.avatarUrl)) ||
      (await getImagePath(DEFAULT_AVATAR_CANVAS)) ||
      (await getImagePath(this.data.defaultAvatar));
    if (!avatarPath) avatarPath = DEFAULT_AVATAR_CANVAS;
    const photoPath = await getImagePath((front && front.photoFileId) || back.photoFileId);
    const gymsLabel = this.computeGymsLabel(front);
    drawFrontCard(ctx, {
      W: this.data.shareCanvasW,
      H: this.data.shareCanvasH,
      front,
      avatarPath,
      photoPath,
      gymsLabel,
      layout: "responsive",
      showFooterBrand: !(options && options.hideFooter),
      showFooterStyle: !(options && options.hideFooter)
    });
    await flushCanvas(ctx);
    if (!needTempFile) return "drawn";
    const tempPath = await new Promise((resolve) => {
      wx.canvasToTempFilePath(
        {
          canvasId,
          width: this.data.shareCanvasW,
          height: this.data.shareCanvasH,
          destWidth: this.data.shareCanvasW,
          destHeight: this.data.shareCanvasH,
          fileType: "png",
          quality: 1,
          success: (r) => resolve(r && r.tempFilePath ? r.tempFilePath : ""),
          fail: () => resolve("")
        },
        this
      );
    });
    return tempPath;
  },
  computeGymsLabel(front) {
    const data = front && typeof front === "object" ? front : {};
    if (data.wanderer) return "浪迹天涯";
    const gyms = Array.isArray(data.gyms) ? data.gyms : [];
    const names = gyms.map((item) => safeText(item && (item.name || item.gymName || item.title))).filter(Boolean);
    return names.length ? `常去：${names.join("、")}` : "浪迹天涯";
  },
  async renderSharePreview() {
    const tempPath = await this.renderCardToCanvas("shareCanvas", true);
    if (tempPath) this.setData({ sharePreviewImage: tempPath });
    return tempPath;
  },
  async ensureAlbumPermission() {
    const setting = await new Promise((resolve) => wx.getSetting({ success: resolve, fail: () => resolve(null) }));
    const auth = setting && setting.authSetting ? setting.authSetting : {};
    if (auth["scope.writePhotosAlbum"]) return true;
    const ok = await new Promise((resolve) =>
      wx.authorize({
        scope: "scope.writePhotosAlbum",
        success: () => resolve(true),
        fail: () => resolve(false)
      })
    );
    if (ok) return true;
    await new Promise((resolve) =>
      wx.showModal({
        title: "需要相册权限",
        content: "用来保存名片到相册",
        confirmText: "去设置",
        success: (r) => {
          if (!r.confirm) return resolve();
          wx.openSetting({ complete: resolve });
        },
        fail: resolve
      })
    );
    const setting2 = await new Promise((resolve) => wx.getSetting({ success: resolve, fail: () => resolve(null) }));
    const auth2 = setting2 && setting2.authSetting ? setting2.authSetting : {};
    return !!auth2["scope.writePhotosAlbum"];
  },
  async onSavePreviewImage() {
    const can = await this.ensureAlbumPermission();
    if (!can) return wx.showToast({ title: "未获得相册权限", icon: "none" });
    const tempPath = this.data.sharePreviewImage || (await this.renderSharePreview());
    if (!tempPath) return wx.showToast({ title: "生成图片失败", icon: "none" });
    await new Promise((resolve) =>
      wx.saveImageToPhotosAlbum({
        filePath: tempPath,
        success: () => {
          wx.showToast({ title: "已保存", icon: "success" });
          resolve();
        },
        fail: () => {
          wx.showToast({ title: "保存失败", icon: "none" });
          resolve();
        }
      })
    );
    this.closeSharePicker();
  },
  async openShareActions() {
    try {
      wx.showLoading({ title: "准备中", mask: true });
      const cardId = await this.ensurePrimaryCardExists();
      const previewImage = await this.renderSharePreview();
      if (!previewImage) throw new Error("生成图片失败");
      const res = await giftApi.createLink({ cardId });
      this.setData({
        shareGiftId: safeText(res && res.giftId),
        sharePickerVisible: true
      });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "准备失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },
  onShareAppMessage() {
    const giftId = safeText(this.data.shareGiftId);
    return {
      title: "送你一张攀岩名片（点开领取）",
      path: giftId ? `/pages/card-claim/index?giftId=${giftId}` : "/pages/me/index",
      imageUrl: safeText(this.data.sharePreviewImage) || ""
    };
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
  onUnload() {
    if (this._mePreviewTimer) clearTimeout(this._mePreviewTimer);
    this._mePreviewTimer = null;
    this._mePreviewToken = 0;
  }
});

