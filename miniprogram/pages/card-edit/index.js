const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");
const { syncAppLogin } = require("../../utils/session");
const { getImagePath } = require("../../utils/cardCanvas");
const { TITLE_OPTIONS, ONE_LINER_OPTIONS, getDefaultCardPreview } = require("../../utils/cardDefaults");
const { drawFrontCard, flushCanvas } = require("../../utils/cardRenderer");
const { getWindowWidth } = require("../../utils/window");

const DEFAULT_AVATAR = "/images/avatar.png";
const DEFAULT_AVATAR_CANVAS = "../../images/avatar.png";
const BANK_CARD_RATIO = 85.6 / 53.98;
const CARD_PX_W = 1080;
const CARD_PX_H = Math.round(CARD_PX_W / BANK_CARD_RATIO);

function parseGyms(text) {
  const t = safeText(text);
  if (!t) return [];
  return t
    .split(/[,，]/)
    .map((x) => safeText(x))
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => ({ gymId: "", name, city: "" }));
}

function fileExt(path) {
  const p = safeText(path);
  const m = p.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "jpg";
}

function isRemotePath(path) {
  return /^(cloud|https?):/.test(safeText(path));
}

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    mode: "self",
    cardId: "",
    titleOptions: TITLE_OPTIONS,
    mbtiOptions: ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"],
    styleTabs: [
      { key: "encourage", label: "鼓励" },
      { key: "humor", label: "幽默" }
    ],
    oneLinerStyle: "encourage",
    gymsText: "",
    storyPlaceholder: "",
    storyRequiredToast: "",
    cardCssW: 320,
    cardCssH: Math.floor(320 / BANK_CARD_RATIO),
    cardPxW: CARD_PX_W,
    cardPxH: CARD_PX_H,
    previewImage: "",
    showPlaceholder: true,
    previewGymsLabel: "浪迹天涯",
    defaultPreview: {
      displayName: "岩友",
      title: "长臂猿",
      gymLabel: "浪迹天涯",
      oneLiner: "再试一次就过"
    },
    pickerVisible: false,
    pickerType: "",
    filteredTitles: [],
    slangOptions: ONE_LINER_OPTIONS,
    front: {
      displayName: "",
      title: "",
      mbti: "",
      gyms: [],
      wanderer: false,
      avatarMode: "wechat",
      avatarFileId: "",
      oneLiner: "",
      oneLinerStyle: "encourage"
    },
    back: {
      story: ""
    }
  },
  onLoad(options) {
    const mode = options && options.mode === "giftDraft" ? "giftDraft" : "self";
    const cardId = safeText(options && options.cardId);
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    const userNickName = safeText(user.nickName);
    const userAvatarUrl = safeText(user.avatarUrl);
    const userOpenid = safeText(user.openid);
    const defaultPreview = getDefaultCardPreview({ openid: userOpenid, nickName: userNickName });

    const winW = getWindowWidth();
    const rpx2px = (rpx) => (rpx * winW) / 750;
    const pagePad = rpx2px(24 * 2);
    const cardBdPad = rpx2px(22 * 2);
    const cssW = Math.floor(Math.max(240, winW - pagePad - cardBdPad));
    const cssH = Math.floor(cssW / BANK_CARD_RATIO);
    this.setData({
      mode,
      cardId,
      userNickName,
      userOpenid,
      userAvatarUrl,
      defaultPreview,
      cardCssW: cssW,
      cardCssH: cssH,
      cardPxW: CARD_PX_W,
      cardPxH: CARD_PX_H,
      previewImage: "",
      previewGymsLabel: defaultPreview.gymLabel || "浪迹天涯",
      showPlaceholder: !cardId
    });
    this.applyModeCopy(mode);
    this.setData({ filteredTitles: this.data.titleOptions.slice(0) });
    if (cardId) return this.loadCard(cardId);
    this.applyDefaultsIfNew();
  },
  onReady() {
    if (!this.data.showPlaceholder) this.renderPreviewSoon();
  },
  onShow() {
    if (!this.data.showPlaceholder) this.renderPreviewSoon();
  },
  applyModeCopy(mode) {
    const isGift = mode === "giftDraft";
    this.setData({
      storyPlaceholder: isGift ? "比如：他每次都能把最阴的脚点踩出声音" : "比如：脚点很稳，但嘴比手快",
      storyRequiredToast: isGift ? "先写一个 TA 的特点" : "先写一点素材"
    });
  },
  applyDefaultsIfNew() {
    const front = { ...this.data.front };
    const defaults = getDefaultCardPreview({
      openid: this.data.userOpenid,
      nickName: this.data.userNickName
    });
    if (!safeText(front.displayName)) front.displayName = defaults.displayName;
    if (!safeText(front.title)) front.title = defaults.title;
    front.wanderer = true;
    front.gyms = [];
    if (safeText(this.data.userAvatarUrl)) front.avatarUrl = safeText(this.data.userAvatarUrl);
    front.avatarMode = "wechat";
    front.avatarFileId = "";
    front.oneLinerStyle = "humor";
    if (!safeText(front.oneLiner)) front.oneLiner = defaults.oneLiner;
    const back = { ...this.data.back };
    if (this.data.mode === "self") {
      if (!safeText(back.story)) back.story = defaults.oneLiner;
    } else {
      back.story = "";
    }
    this.setData(
      {
        front,
        back,
        gymsText: "",
        oneLinerStyle: "humor",
        previewGymsLabel: defaults.gymLabel || "浪迹天涯"
      },
      () => {}
    );
  },
  randomTitle() {
    const list = Array.isArray(this.data.titleOptions) ? this.data.titleOptions : [];
    const n = list.length;
    if (!n) return "";
    const idx = Math.floor(Math.random() * n);
    return safeText(list[idx]);
  },
  computeGymsLabel(front, gymsText) {
    const f = front && typeof front === "object" ? front : {};
    if (f.wanderer) return "浪迹天涯";
    const gyms = parseGyms(gymsText).map((g) => safeText(g && g.name)).filter(Boolean);
    if (!gyms.length) return "";
    return `常去：${gyms.join("、")}`;
  },
  async loadCard(cardId) {
    try {
      const res = await cardApi.get({ cardId });
      const card = res && res.card ? res.card : null;
      if (!card) return;
      const front = card.front && typeof card.front === "object" ? card.front : {};
      const back = card.back && typeof card.back === "object" ? card.back : {};
      const gyms = Array.isArray(front.gyms) ? front.gyms : [];
      const gymsText = gyms.map((g) => safeText(g && (g.name || g.gymName || g.title))).filter(Boolean).join("，");
      this.setData({
        front: { ...this.data.front, ...front },
        back: { ...this.data.back, ...back },
        gymsText,
        oneLinerStyle: safeText(front.oneLinerStyle) === "encourage" ? "encourage" : "humor",
        previewGymsLabel: this.computeGymsLabel({ ...this.data.front, ...front }, gymsText) || this.data.defaultPreview.gymLabel,
        showPlaceholder: false
      }, () => this.renderPreviewSoon());
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  revealPreviewAndRender() {
    if (this.data.showPlaceholder) {
      this.setData({ showPlaceholder: false }, () => this.renderPreviewSoon());
      return;
    }
    this.renderPreviewSoon();
  },
  onUnload() {
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = null;
    this._previewToken = 0;
  },
  renderPreviewSoon() {
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      if (wx.nextTick) wx.nextTick(() => this.renderPreview());
      else this.renderPreview();
    }, 120);
  },
  async renderPreview() {
    const token = (this._previewToken || 0) + 1;
    this._previewToken = token;

    const front = this.data.front && typeof this.data.front === "object" ? this.data.front : {};
    const back = this.data.back && typeof this.data.back === "object" ? this.data.back : {};
    const defaults = getDefaultCardPreview({
      openid: this.data.userOpenid,
      nickName: this.data.userNickName
    });
    const previewFront = {
      ...front,
      displayName: safeText(front.displayName) || defaults.displayName,
      title: safeText(front.title) || defaults.title,
      mbti: safeText(front.mbti),
      oneLiner: safeText(front.oneLiner) || defaults.oneLiner,
      oneLinerStyle: safeText(front.oneLinerStyle) || (this.data.oneLinerStyle === "humor" ? "humor" : "encourage"),
      wanderer: typeof front.wanderer === "boolean" ? front.wanderer : true
    };
    const previewBack = { ...back, story: safeText(back.story) || "给朋友打保护比自己爬更紧张，但嘴还是很硬。" };
    const W = this.data.cardPxW || CARD_PX_W;
    const H = this.data.cardPxH || CARD_PX_H;

    const ctx = wx.createCanvasContext("previewCanvas", this);

    const avatarSrc = previewFront.avatarMode === "custom" ? previewFront.avatarFileId : previewFront.avatarUrl;
    let avatarPath =
      (await getImagePath(avatarSrc)) ||
      (await getImagePath(previewFront.avatarUrl)) ||
      (await getImagePath(DEFAULT_AVATAR_CANVAS)) ||
      (await getImagePath(DEFAULT_AVATAR));
    if (!avatarPath) avatarPath = DEFAULT_AVATAR_CANVAS;
    if (!avatarPath) avatarPath = DEFAULT_AVATAR;

    const photoPath = await getImagePath(front.photoFileId || previewBack.photoFileId);

    if (token !== this._previewToken) return;

    const gymsLabel = this.computeGymsLabel(previewFront, this.data.gymsText) || defaults.gymLabel;
    this.setData({ previewGymsLabel: gymsLabel });
    this.drawPreviewFront(ctx, W, H, previewFront, gymsLabel, avatarPath, photoPath);

    await flushCanvas(ctx);
    if (token !== this._previewToken) return;

    const tempPath = await new Promise((resolve) => {
      wx.canvasToTempFilePath(
        {
          canvasId: "previewCanvas",
          width: W,
          height: H,
          destWidth: W,
          destHeight: H,
          fileType: "png",
          quality: 1,
          success: (r) => resolve(r && r.tempFilePath ? r.tempFilePath : ""),
          fail: () => resolve("")
        },
        this
      );
    });
    if (token !== this._previewToken) return;
    if (!tempPath) {
      this.setData({ previewImage: "" });
      return;
    }

    const ok = await new Promise((resolve) => {
      wx.getImageInfo({
        src: tempPath,
        success: (r) => resolve(!!(r && r.width >= 600 && r.height >= 300)),
        fail: () => resolve(false)
      });
    });
    if (token !== this._previewToken) return;
    if (!ok) {
      this.setData({ previewImage: "" });
      setTimeout(() => {
        if (token === this._previewToken) this.renderPreviewSoon();
      }, 180);
      return;
    }
    this.setData({ previewImage: tempPath });
  },
  drawPreviewFront(ctx, W, H, front, gymsLabel, avatarPath, photoPath) {
    drawFrontCard(ctx, { W, H, front, gymsLabel, avatarPath, photoPath, layout: "responsive" });
  },
  async persistCard(options = {}) {
    const { navigateBack = false, successToast = true } = options;
    let front = { ...this.data.front };
    front.gyms = front.wanderer ? [] : parseGyms(this.data.gymsText);
    const back = { ...this.data.back };
    back.photoFileId = safeText(front.photoFileId || back.photoFileId);
    if (!safeText(back.story)) throw new Error(this.data.storyRequiredToast || "内容不能为空");
    const defaults = getDefaultCardPreview({
      openid: this.data.userOpenid,
      nickName: this.data.userNickName
    });
    if (!safeText(front.displayName)) front.displayName = defaults.displayName;
    if (!safeText(front.title)) front.title = defaults.title;
    if (!safeText(front.oneLiner)) front.oneLiner = defaults.oneLiner;

    front = await this.syncProfileFromCard(front);
    const payload = {
      mode: this.data.mode,
      cardId: this.data.cardId || "",
      card: { front, back }
    };
    const res = await cardApi.upsert(payload);
    const id = safeText(res && res.cardId);
    if (id) this.setData({ cardId: id });

    try {
      wx.setStorageSync(this.data.mode === "giftDraft" ? "giftDraftCardId" : "myPrimaryCardId", id);
    } catch (e) {}

    if (successToast) wx.showToast({ title: "已保存", icon: "success" });
    if (navigateBack) setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
    return id;
  },
  onName(e) {
    this.setData({ front: { ...this.data.front, displayName: e.detail.value } }, () => this.revealPreviewAndRender());
  },
  onTitle(e) {
    this.setData({ front: { ...this.data.front, title: e.detail.value } }, () => this.revealPreviewAndRender());
  },
  openTitlePicker() {
    this.setData({
      pickerVisible: true,
      pickerType: "title",
      filteredTitles: this.data.titleOptions.slice(0)
    });
  },
  openNameEditor() {
    this.setData({ pickerVisible: true, pickerType: "name" });
  },
  useWechatNickName() {
    const nickName = safeText(this.data.userNickName);
    if (!nickName) {
      wx.showToast({ title: "暂无微信昵称", icon: "none" });
      return;
    }
    this.setData(
      {
        front: { ...this.data.front, displayName: nickName },
        pickerVisible: false,
        pickerType: ""
      },
      () => this.revealPreviewAndRender()
    );
  },
  openStoryEditor() {
    this.setData({ pickerVisible: true, pickerType: "story" });
  },
  openAvatarEditor() {
    this.setData({ pickerVisible: true, pickerType: "avatar" });
  },
  openMbtiPicker() {
    this.setData({ pickerVisible: true, pickerType: "mbti" });
  },
  openGymsEditor() {
    this.setData({ pickerVisible: true, pickerType: "gyms" });
  },
  closePicker() {
    this.setData({ pickerVisible: false, pickerType: "" });
  },
  noop() {},
  pickRandomTitle() {
    const t = this.randomTitle();
    if (!t) return;
    const front = { ...this.data.front, title: t };
    this.setData({ front, pickerVisible: false, pickerType: "" }, () => this.revealPreviewAndRender());
  },
  selectTitle(e) {
    const v = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v);
    if (!v) return;
    const front = { ...this.data.front, title: v };
    this.setData({ front, pickerVisible: false, pickerType: "" }, () => this.revealPreviewAndRender());
  },
  selectMbti(e) {
    const v = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v);
    if (!v) return;
    this.setData({ front: { ...this.data.front, mbti: v }, pickerVisible: false, pickerType: "" }, () => this.revealPreviewAndRender());
  },
  onClearMbti() {
    this.setData({ front: { ...this.data.front, mbti: "" } }, () => this.revealPreviewAndRender());
  },
  onWanderer(e) {
    const wanderer = !!(e && e.detail && e.detail.value);
    const front = { ...this.data.front, wanderer };
    if (wanderer) front.gyms = [];
    const gymsText = wanderer ? "" : this.data.gymsText;
    this.setData({ front, gymsText }, () => this.revealPreviewAndRender());
  },
  onGymsText(e) {
    const gymsText = e.detail.value;
    this.setData({ gymsText }, () => this.revealPreviewAndRender());
  },
  onChooseWechatAvatar(e) {
    const avatarUrl = safeText(e && e.detail ? e.detail.avatarUrl : "");
    if (!avatarUrl) return;
    const front = {
      ...this.data.front,
      avatarMode: "wechat",
      avatarFileId: "",
      avatarUrl
    };
    this.setData({ front, userAvatarUrl: avatarUrl, pickerVisible: false, pickerType: "" }, () => this.revealPreviewAndRender());
  },
  async pickAvatar() {
    try {
      const r = await this.chooseOneImage();
      if (!r) return;
      const fileID = await this.uploadToCloud(r);
      const front = { ...this.data.front, avatarMode: "custom", avatarFileId: fileID };
      this.setData({ front, pickerVisible: false, pickerType: "" }, () => this.revealPreviewAndRender());
    } catch (e) {
      wx.showToast({ title: "上传失败", icon: "none" });
    }
  },
  async pickPhoto() {
    try {
      const r = await this.chooseOneImage();
      if (!r) return;
      const fileID = await this.uploadToCloud(r);
      const front = { ...this.data.front, photoFileId: fileID };
      const back = { ...this.data.back, photoFileId: fileID };
      this.setData({ front, back }, () => this.revealPreviewAndRender());
    } catch (e) {
      wx.showToast({ title: "上传失败", icon: "none" });
    }
  },
  chooseOneImage() {
    return new Promise((resolve, reject) => {
      if (wx.chooseMedia) {
        wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          success: (res) => {
            const f = res && res.tempFiles && res.tempFiles[0] ? res.tempFiles[0] : null;
            resolve(f && f.tempFilePath ? f.tempFilePath : "");
          },
          fail: reject
        });
        return;
      }
      wx.chooseImage({
        count: 1,
        success: (res) => resolve(res && res.tempFilePaths && res.tempFilePaths[0] ? res.tempFilePaths[0] : ""),
        fail: reject
      });
    });
  },
  uploadToCloud(tempPath) {
    return new Promise((resolve, reject) => {
      const ext = fileExt(tempPath);
      const cloudPath = `cards/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (res) => resolve(res && res.fileID ? res.fileID : ""),
        fail: reject
      });
    });
  },
  async resolveProfileAvatarUrl(front) {
    if (!front || front.avatarMode !== "wechat") {
      return safeText(front && (front.avatarFileId || front.avatarUrl || this.data.userAvatarUrl));
    }
    const avatarUrl = safeText(front.avatarUrl || this.data.userAvatarUrl);
    if (!avatarUrl) return "";
    if (avatarUrl.startsWith("/")) return "";
    if (isRemotePath(avatarUrl)) return avatarUrl;
    const ext = fileExt(avatarUrl);
    const cloudPath = `avatars/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: avatarUrl,
        success: (res) => resolve(safeText(res && res.fileID)),
        fail: reject
      });
    });
  },
  async syncProfileFromCard(front) {
    if (this.data.mode !== "self") return front;
    const nickName = safeText(front && front.displayName);
    if (!nickName) return front;
    const avatarUrl = await this.resolveProfileAvatarUrl(front);
    const user = await syncAppLogin({
      nickName,
      avatarUrl
    });
    const nextNickName = safeText(user && user.nickName) || nickName;
    const nextAvatarUrl = safeText(user && user.avatarUrl) || avatarUrl;
    const nextFront = {
      ...front,
      displayName: nextNickName
    };
    if (nextAvatarUrl) {
      if (nextFront.avatarMode === "wechat") nextFront.avatarUrl = nextAvatarUrl;
      if (nextFront.avatarMode === "custom" && !safeText(nextFront.avatarFileId)) nextFront.avatarFileId = nextAvatarUrl;
    }
    this.setData({
      userNickName: nextNickName,
      userAvatarUrl: nextAvatarUrl,
      defaultPreview: getDefaultCardPreview({
        openid: this.data.userOpenid,
        nickName: nextNickName
      }),
      front: {
        ...this.data.front,
        displayName: nextFront.displayName,
        avatarUrl: nextFront.avatarUrl,
        avatarFileId: nextFront.avatarFileId
      }
    });
    return nextFront;
  },
  onStory(e) {
    const story = e.detail.value;
    this.setData({ back: { ...this.data.back, story } }, () => this.revealPreviewAndRender());
  },
  onOneLiner(e) {
    this.setData({ front: { ...this.data.front, oneLiner: e.detail.value } }, () => this.revealPreviewAndRender());
  },
  onStyleChange(e) {
    const v = e && e.detail && e.detail.value ? e.detail.value : "encourage";
    this.setData({ oneLinerStyle: v, front: { ...this.data.front, oneLinerStyle: v } }, () => this.revealPreviewAndRender());
  },
  async onGenerate() {
    const story = safeText(this.data.back.story);
    if (!story) return wx.showToast({ title: this.data.storyRequiredToast || "先写点内容", icon: "none" });
    try {
      const payload = {
        story,
        style: this.data.oneLinerStyle,
        displayName: safeText(this.data.front.displayName),
        title: safeText(this.data.front.title),
        mbti: safeText(this.data.front.mbti),
        gyms: this.data.front.wanderer ? [] : parseGyms(this.data.gymsText)
      };
      const res = await cardApi.generateOneLiner(payload);
      const oneLiner = safeText(res && res.oneLiner);
      if (!oneLiner) throw new Error("没有生成到可用文案");
      this.setData({ front: { ...this.data.front, oneLiner, oneLinerStyle: this.data.oneLinerStyle } }, () => this.revealPreviewAndRender());
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "生成失败", icon: "none" });
    }
  },
  async onSave() {
    try {
      await this.persistCard({ navigateBack: true, successToast: true });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "保存失败", icon: "none" });
    }
  },
  goSavePreview() {
    const cardId = this.data.cardId;
    if (!cardId) return wx.showToast({ title: "先保存名片", icon: "none" });
    wx.navigateTo({ url: `/pages/card-view/index?cardId=${cardId}` });
  }
});
