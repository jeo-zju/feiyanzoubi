const cardApi = require("../../services/api/card");
const userApi = require("../../services/api/user");
const { getImagePath } = require("../../utils/cardCanvas");
const { drawFrontCard, flushCanvas, RENDER_VERSION } = require("../../utils/cardRenderer");
const { ensureAppLogin, isAdminUser } = require("../../utils/session");
const { getWindowWidth } = require("../../utils/window");
const { DEFAULT_AVATAR, DEFAULT_AVATAR_CANVAS } = require("../../utils/constants");
const cache = require("../../utils/cache");

const CARD_PX_W = 960;
const CARD_PX_H = 606;
const CARD_RATIO = CARD_PX_W / CARD_PX_H;

// issue #23/#38/#40: 名片预览指纹 = 渲染版本 + 内容哈希。
// 旧指纹只含头像/称呼/签名等少数字段，导致：
// ①修改抱石能力、身高臂展、微信/小红书开关与内容、岩友号、城市后指纹不变，
//   持久化的旧名片 PNG 被复用（#40「改了资料名片不变化」）；
// ②名片绘制代码（布局/emoji/标签）更新后旧 PNG 仍被复用（#38 LEHRKS 旧布局）。
// 这里把画布上所有展示字段纳入哈希，并加入 RENDER_VERSION：
// 任何展示内容变化或渲染代码版本 bump 都必然失配 → 强制重绘。
function hashStub(s) {
  const v = String(s == null ? "" : s).slice(0, 120);
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function computeCardFingerprint(card, me) {
  const c = card || {};
  const m = me || {};
  const finalSlogan = (m.slogan || (c.oneLiner || (c.front && c.front.oneLiner) || ""));
  const skills = m.climbSkills || c.climbSkills || {};
  const skillSig = ["boulder", "lead", "toprope", "protector"]
    .map((k) => `${k}:${skills[k] == null ? "" : skills[k]}`)
    .join(",");
  const contentSig = [
    RENDER_VERSION,
    c.avatarMode || "",
    c.avatarUrl || "",
    c.avatarFileId || "",
    c.oneLiner || "",
    c.oneLinerStyle || "",
    c.displayName || m.nickName || "",
    c.title || "",
    c.mbti || "",
    (c.front && c.front.signature) || c.signature || (c.front && c.front.note) || c.note || "",
    m.avatarUrl || "",
    m.nickName || "",
    m.displayName || "",
    m.title || "",
    m.mbti || "",
    finalSlogan,
    skillSig,
    m.heightCm || m.height || "",
    m.armspanCm || m.armspan || "",
    m.rockId || "",
    m.city || "",
    m.wechatId || "",
    m.showWechat ? "1" : "0",
    m.xhsId || "",
    m.showXhs ? "1" : "0"
  ].map(hashStub).join(",");
  return [
    RENDER_VERSION,
    c.cardId || "",
    c._updateTime || c.updatedAt || 0,
    m._updateTime || m.updatedAt || 0,
    contentSig
  ].join("|");
}

Page({
  data: {
    user: { nickName: "", avatarUrl: "", projectName: "Project" },
    me: {},
    defaultAvatar: DEFAULT_AVATAR,
    canSeeToolbox: false,
    drawerOpen: false,
    version: "2.0.23",

    credit: { remaining: 0, limit: 10 },
    creditPercent: 0,

    profileTabs: [],
    myPrimaryCard: null,
    noCard: false,
    cardSyncing: false,
    myCardCssW: 0,
    myCardCssH: 0,
    myCardPreviewImage: "",
    footHeat: [],
    footSummary: { totalDays: 0, gymCount: 0, total: 0 }
  },

  onLoad() {
    this.computeMyCardSize();
    // issue #47: 开启右上角「分享到朋友圈」入口（onShareTimeline 已返回名片图作为预览）
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ["shareAppMessage", "shareTimeline"] });
    } catch (e) {}
  },

  onShareAppMessage() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    const nickName = (this.data.user && this.data.user.nickName) || "我";
    // issue #46: 转发预览优先用已渲染的名片图片，没有则回落默认头像，避免空白图
    const shareImg = this.data.myCardPreviewImage || "/images/avatar.png";
    if (cardId) {
      return {
        title: `${nickName}的攀岩名片`,
        path: `/pages/card-view/index?cardId=${cardId}`,
        imageUrl: shareImg
      };
    }
    return {
      title: "飞岩走壁｜攀岩人的日历与名片",
      path: "/pages/me/index",
      imageUrl: shareImg
    };
  },

  onShareTimeline() {
    const nickName = (this.data.user && this.data.user.nickName) || "我";
    const shareImg = this.data.myCardPreviewImage || "/images/avatar.png";
    return {
      title: `${nickName}的攀岩名片`,
      query: "",
      imageUrl: shareImg
    };
  },

  async onShow() {
    this._cardImgErrCount = 0;
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
        avatarUrl: me.avatarUrl || user.avatarUrl || "",
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
      // issue #13: 名片上的那句话（oneLiner）优先于用户资料 slogan 展示
      const cardOneLiner = (nextPrimaryCard && (nextPrimaryCard.oneLiner || (nextPrimaryCard.front && nextPrimaryCard.front.oneLiner))) || "";
      const me = this.data.me || {};
      this.setData({
        credit,
        creditPercent,
        myPrimaryCard: nextPrimaryCard,
        noCard: !nextPrimaryCard,
        me: Object.assign({}, me, { slogan: cardOneLiner || me.slogan || "" }),
        cardSyncing: false
      });
      try {
        const meData = this.data.me || {};
        const card = nextPrimaryCard || {};
        // issue #23: 内容哈希指纹（含头像/称呼/签名），头像调整后必失配 → 强制重绘
        const fp = computeCardFingerprint(card, meData);
        cache.set(cache.CACHE_KEYS.ME_CARD_FINGERPRINT, fp, 60 * 24, { saveL2: true });
        this._currentCardFingerprint = fp;
      } catch (_) {}
      this.renderMyCardSoon("summary");
    } catch (e) {
      console.warn("[me] loadCardSummary failed", e && e.message);
      this.setData({ cardSyncing: false, noCard: !this.data.myPrimaryCard });
    }
  },

  goGift() { wx.navigateTo({ url: "/pages/card-gift/index" }); },
  // issue #45: 点击「保存」直接保存名片到相册，不再跳转 card-view 预览页二次确认。
  // 复用 me 页已渲染好的 myCardPreviewImage（offscreen canvas 960x606 导出，尺寸完整），
  // 避免 card-view 页 canvas CSS 尺寸与 width 属性不一致导致导出图片只有放大的左上角
  async goSaveMyCard() {
    const cardId = this.data.myPrimaryCard && this.data.myPrimaryCard.cardId ? this.data.myPrimaryCard.cardId : "";
    if (!cardId) { wx.showToast({ title: "先创建你的名片", icon: "none" }); return; }
    let imgPath = this.data.myCardPreviewImage;
    // 预览图还没生成时，先触发一次渲染并等待结果
    if (!imgPath) {
      try {
        await this.renderMyCard();
        imgPath = this.data.myCardPreviewImage;
      } catch (e) {
        console.warn("[me] save: 渲染名片失败", e && e.message);
      }
    }
    if (!imgPath) { wx.showToast({ title: "名片生成中，请稍后再试", icon: "none" }); return; }

    const can = await new Promise((resolve) => {
      wx.getSetting({
        success: (s) => {
          const auth = (s && s.authSetting) || {};
          if (auth["scope.writePhotosAlbum"]) return resolve(true);
          wx.authorize({
            scope: "scope.writePhotosAlbum",
            success: () => resolve(true),
            fail: () => resolve(false)
          });
        },
        fail: () => resolve(false)
      });
    });
    if (!can) {
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
    }
    wx.saveImageToPhotosAlbum({
      filePath: imgPath,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: (err) => {
        console.warn("[me] saveImageToPhotosAlbum fail", err && err.errMsg);
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      }
    });
  },

  renderMyCardSoon(reason) {
    if (this.data.cardSyncing && reason !== "summary") return;
    if (!this.data.myPrimaryCard) {
      if (!this.data.cardSyncing) console.warn("[me] renderMyCardSoon: 无主卡 myPrimaryCard=null", reason);
      return;
    }
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
      const currentFp = this._currentCardFingerprint || computeCardFingerprint(primary, me);
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
        rockId: me.rockId || "",
        wechatId: me.wechatId || "",
        showWechat: !!me.showWechat,
        xhsId: me.xhsId || "",
        showXhs: !!me.showXhs
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
          fail: (err) => { console.warn("[me] canvasToTempFilePath fail", err && err.errMsg); resolve(""); }
        }, this);
      } catch (e) { console.warn("[me] canvasToTempFilePath throw", e && e.message); resolve(""); }
    });
    if (token !== this._cardPreviewToken) return;
    if (!tempPath) {
      // issue #36: 导出失败时记录日志并保留重试机会，避免静默卡死在骨架屏
      console.warn("[me] canvasToTempFilePath 未返回临时路径，本轮跳过渲染，等待下次进入页面重试");
      return;
    }
    try {
      // issue #36: wx.saveFile 已在新版基础库废弃（vConsole 持续告警且可能失败），
      // 改用 FileSystemManager.saveFile 持久化名片预览；失败时降级直接使用临时路径展示
      const savedPath = await new Promise((resolve) => {
        try {
          const fs = wx.getFileSystemManager();
          fs.saveFile({
            tempFilePath: tempPath,
            success: (r) => resolve(r && r.savedFilePath ? r.savedFilePath : ""),
            fail: (err) => {
              console.warn("[me] FileSystemManager.saveFile fail", err && err.errMsg);
              resolve("");
            }
          });
        } catch (e) {
          console.warn("[me] FileSystemManager.saveFile throw", e && e.message);
          resolve("");
        }
      });
      if (savedPath) {
        try {
          const isPersistedPath = (p) => {
            if (!p) return false;
            const s = String(p).toLowerCase();
            if (s.includes("__tmp__") || s.includes("/tmp_") || s.includes("\\tmp_")) return false;
            if (s.startsWith("http://") || s.startsWith("https://")) return false;
            return true;
          };
          if (isPersistedPath(savedPath)) {
            cache.set(cache.CACHE_KEYS.ME_CARD_IMG_PATH, savedPath, 60 * 24, { saveL2: true });
            const meNow = this.data.me || {};
            const primaryNow = this.data.myPrimaryCard || {};
            // issue #23: 与 loadCardSummary 同源的内容哈希指纹
            const fp = this._currentCardFingerprint || computeCardFingerprint(primaryNow, meNow);
            cache.set(cache.CACHE_KEYS.ME_CARD_FINGERPRINT, fp, 60 * 24, { saveL2: true });
          }
        } catch (e) {
          console.warn("[me] 持久化名片预览缓存失败", e && e.message);
        }
      }
    } catch (e) {
      console.warn("[me] 名片预览持久化异常，降级使用临时路径", e && e.message);
    }
    this._cardImgErrCount = 0;
    this.setData({ myCardPreviewImage: tempPath });
  },

  onCardPreviewImgError() {
    // issue #36: 限制重绘次数，避免「预览图报错 → 清缓存 → 重绘 → 再报错」死循环
    // 导致名片区域持续刷新、骨架屏常显；超过上限后本轮不再重绘，下次 onShow 重置
    const retryCount = this._cardImgErrCount || 0;
    if (retryCount >= 2) {
      console.warn("[me] 名片预览图连续加载失败，已停止本轮重绘循环");
      this.setData({ myCardPreviewImage: "" });
      return;
    }
    this._cardImgErrCount = retryCount + 1;
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
        setTimeout(() => { self.renderMyCard && self.renderMyCard(); }, 200);
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
