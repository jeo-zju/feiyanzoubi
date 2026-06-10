const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");

const DEFAULT_AVATAR = "/images/avatar.png";
const DEFAULT_AVATAR_CANVAS = "../../images/avatar.png";
const BANK_CARD_RATIO = 85.6 / 53.98;
const CARD_PX_W = 1080;
const CARD_PX_H = Math.round(CARD_PX_W / BANK_CARD_RATIO);

function clamp(s, n) {
  const t = safeText(s);
  if (!t) return "";
  return t.length <= n ? t : t.slice(0, n);
}

function wrapLines(ctx, text, maxWidth) {
  const t = safeText(text);
  if (!t) return [];
  const chars = t.split("");
  const lines = [];
  let line = "";
  for (let i = 0; i < chars.length; i++) {
    const next = line + chars[i];
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = chars[i];
  }
  if (line) lines.push(line);
  return lines;
}

function isCloudFileId(v) {
  const s = safeText(v);
  return s.startsWith("cloud://");
}

async function toTempUrl(fileIdOrUrl) {
  const v = safeText(fileIdOrUrl);
  if (!v) return "";
  if (!isCloudFileId(v)) return v;
  try {
    const r = await wx.cloud.getTempFileURL({ fileList: [v] });
    const item = r && r.fileList && r.fileList[0] ? r.fileList[0] : null;
    return item && item.tempFileURL ? item.tempFileURL : "";
  } catch (e) {
    return "";
  }
}

async function getImagePath(fileIdOrUrl) {
  const url = await toTempUrl(fileIdOrUrl);
  if (!url) return "";
  const s = String(url);
  if (s.startsWith("wxfile://")) return s;
  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) return s;
  if (!/^https?:\/\//.test(s)) return s;
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: url,
      success: (r) => resolve(r && r.path ? r.path : ""),
      fail: () => resolve("")
    });
  });
}

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

function previewText(s, maxLen) {
  const t = safeText(s);
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

function pickOne(list) {
  const arr = Array.isArray(list) ? list : [];
  const n = arr.length;
  if (!n) return "";
  return safeText(arr[Math.floor(Math.random() * n)]);
}

Page({
  data: {
    mode: "self",
    cardId: "",
    titleOptions: [
      "长臂猿",
      "理论攀岩者",
      "小短手",
      "小短腿",
      "脚点哲学家",
      "热身冠军",
      "落点收藏家",
      "复盘型选手",
      "保护点强迫症",
      "岩点谈判专家",
      "只会横移的",
      "观众席 MVP"
    ],
    mbtiOptions: ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"],
    styleTabs: [
      { key: "encourage", label: "鼓励" },
      { key: "humor", label: "幽默" }
    ],
    oneLinerStyle: "encourage",
    gymsText: "",
    moreOpen: false,
    previewSide: "front",
    gymsLabel: "",
    storyPreview: "",
    storyTitle: "",
    storyPlaceholder: "",
    storyEmptyHint: "",
    storyRequiredToast: "",
    previewAvatar: DEFAULT_AVATAR,
    cardCssW: 320,
    cardCssH: Math.floor(320 / BANK_CARD_RATIO),
    cardPxW: CARD_PX_W,
    cardPxH: CARD_PX_H,
    previewImage: "",
    showPlaceholder: true,
    pickerVisible: false,
    pickerType: "",
    filteredTitles: [],
    slangOptions: ["顶绳热身", "别问，问就是脚点没擦", "再试一次就过", "今天状态在线", "这个点太滑了", "手套忘带了", "走线有点骚", "我不累，我只是缺氧", "先休息三分钟", "这条线有点恶意", "落点不讲武德", "我会，但今天不想"],
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
      photoFileId: "",
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

    const sys = wx.getSystemInfoSync();
    const winW = sys && sys.windowWidth ? sys.windowWidth : 375;
    const rpx2px = (rpx) => (rpx * winW) / 750;
    const pagePad = rpx2px(24 * 2);
    const cardBdPad = rpx2px(22 * 2);
    const cssW = Math.floor(Math.max(240, winW - pagePad - cardBdPad));
    const cssH = Math.floor(cssW / BANK_CARD_RATIO);
    this.setData({
      mode,
      cardId,
      userNickName,
      userAvatarUrl,
      cardCssW: cssW,
      cardCssH: cssH,
      cardPxW: CARD_PX_W,
      cardPxH: CARD_PX_H,
      previewImage: "",
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
      storyTitle: isGift ? "写一个 TA 让你印象深刻的点" : "来点攀岩黑话",
      storyPlaceholder: isGift ? "比如：他每次都能把最阴的脚点踩出声音" : "不想写也行，我先给你来一句（可改）",
      storyEmptyHint: isGift ? "（写一个 TA 的特点就行）" : "（你可以随便改，也可以不改）",
      storyRequiredToast: isGift ? "先写一个 TA 的特点" : "先写点内容"
    });
  },
  applyDefaultsIfNew() {
    const front = { ...this.data.front };
    if (!safeText(front.displayName) && safeText(this.data.userNickName)) front.displayName = safeText(this.data.userNickName);
    if (!safeText(front.title)) front.title = this.randomTitle();
    front.wanderer = true;
    front.gyms = [];
    if (safeText(this.data.userAvatarUrl)) front.avatarUrl = safeText(this.data.userAvatarUrl);
    front.avatarMode = "wechat";
    front.avatarFileId = "";
    front.oneLinerStyle = "humor";
    const back = { ...this.data.back };
    if (this.data.mode === "self") {
      if (!safeText(back.story)) back.story = pickOne(this.data.slangOptions);
    } else {
      back.story = "";
    }
    this.setData(
      {
        front,
        back,
        gymsText: "",
        oneLinerStyle: "humor",
        previewAvatar: this.computePreviewAvatar(front),
        gymsLabel: this.computeGymsLabel(front, ""),
        storyPreview: previewText(back.story, 120)
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
  computePreviewAvatar(front) {
    const f = front && typeof front === "object" ? front : {};
    if (f.avatarMode === "custom" && safeText(f.avatarFileId)) return safeText(f.avatarFileId);
    if (safeText(f.avatarUrl)) return safeText(f.avatarUrl);
    if (safeText(this.data.userAvatarUrl)) return safeText(this.data.userAvatarUrl);
    return DEFAULT_AVATAR;
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
        gymsLabel: this.computeGymsLabel({ ...this.data.front, ...front }, gymsText),
        storyPreview: previewText(back && back.story, 120),
        previewAvatar: this.computePreviewAvatar({ ...this.data.front, ...front }),
        showPlaceholder: false
      }, () => this.renderPreviewSoon());
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  toggleMore() {
    this.setData({ moreOpen: !this.data.moreOpen });
  },
  togglePreviewSide() {
    this.setData({ previewSide: this.data.previewSide === "front" ? "back" : "front" }, () => {
      if (!this.data.showPlaceholder) this.renderPreviewSoon();
    });
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
    const previewFront = {
      ...front,
      displayName: safeText(front.displayName) || "岩点测试员",
      title: safeText(front.title) || "长臂猿",
      mbti: safeText(front.mbti) || "ENTP",
      oneLiner: safeText(front.oneLiner) || "用脚点谈判，用手点签字。",
      oneLinerStyle: safeText(front.oneLinerStyle) || (this.data.oneLinerStyle === "humor" ? "humor" : "encourage"),
      wanderer: typeof front.wanderer === "boolean" ? front.wanderer : true
    };
    const previewBack = { ...back, story: safeText(back.story) || "给朋友打保护比自己爬更紧张，但嘴还是很硬。" };
    const side = this.data.previewSide === "back" ? "back" : "front";
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

    let photoPath = "";
    if (side === "back") photoPath = await getImagePath(previewBack.photoFileId);

    if (token !== this._previewToken) return;

    const gymsLabel = this.computeGymsLabel(previewFront, this.data.gymsText) || "浪迹天涯";
    if (side === "front") this.drawPreviewFront(ctx, W, H, previewFront, gymsLabel, avatarPath);
    else this.drawPreviewBack(ctx, W, H, previewFront, previewBack, photoPath);

    await new Promise((resolve) => ctx.draw(false, resolve));
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
  drawPreviewFront(ctx, W, H, front, gymsLabel, avatarPath) {
    ctx.setFillStyle("#0B0D15");
    ctx.fillRect(0, 0, W, H);

    const barH = Math.max(56, Math.floor(H * 0.14));
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(143,123,255,0.95)");
    g.addColorStop(1, "rgba(242,193,78,0.95)");
    ctx.setFillStyle(g);
    ctx.fillRect(0, 0, W, barH);

    const pad = Math.floor(W * 0.06);
    const cardY = barH + Math.floor(H * 0.08);
    ctx.setFillStyle("rgba(255,255,255,0.10)");
    ctx.fillRect(pad, cardY, W - pad * 2, H - cardY - pad);

    const ar = Math.floor(H * 0.17);
    const ax = pad + Math.floor(W * 0.03);
    const ay = cardY + Math.floor(H * 0.08);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
    ctx.clip();
    if (avatarPath) ctx.drawImage(avatarPath, ax, ay, ar * 2, ar * 2);
    ctx.restore();

    ctx.setStrokeStyle("rgba(242,193,78,0.85)");
    ctx.setLineWidth(Math.max(4, Math.floor(H * 0.012)));
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar + Math.floor(H * 0.008), 0, Math.PI * 2);
    ctx.stroke();

    const tx = ax + ar * 2 + Math.floor(W * 0.05);
    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(Math.floor(H * 0.11));
    ctx.fillText(clamp(front.displayName || "岩友", 10), tx, ay + Math.floor(H * 0.13));

    ctx.setFillStyle("rgba(255,255,255,0.92)");
    ctx.setFontSize(Math.floor(H * 0.06));
    const meta = `${clamp(front.title, 12)}${front.mbti ? ` · ${clamp(front.mbti, 6)}` : ""}`;
    ctx.fillText(meta, tx, ay + Math.floor(H * 0.24));

    ctx.setFillStyle("rgba(242,193,78,0.95)");
    ctx.setFontSize(Math.floor(H * 0.055));
    ctx.fillText(clamp(gymsLabel, 14), tx, ay + Math.floor(H * 0.33));

    const one = clamp(front.oneLiner, 40);
    ctx.setFillStyle("rgba(255,255,255,0.95)");
    ctx.setFontSize(Math.floor(H * 0.075));
    const lines = wrapLines(ctx, one, W - pad * 2 - Math.floor(W * 0.08));
    const ox = pad + Math.floor(W * 0.06);
    const oy = ay + ar * 2 + Math.floor(H * 0.06);
    const lh = Math.floor(H * 0.10);
    for (let i = 0; i < Math.min(2, lines.length); i++) {
      ctx.fillText(lines[i], ox, oy + i * lh);
    }

    ctx.setFillStyle("rgba(255,255,255,0.65)");
    ctx.setFontSize(Math.floor(H * 0.05));
    ctx.fillText("飞岩走壁 · 攀岩名片", ox, H - Math.floor(H * 0.12));
    ctx.fillText(front.oneLinerStyle === "humor" ? "风格：幽默" : "风格：鼓励", ox, H - Math.floor(H * 0.06));
  },
  drawPreviewBack(ctx, W, H, front, back, photoPath) {
    ctx.setFillStyle("#0B0D15");
    ctx.fillRect(0, 0, W, H);

    if (photoPath) {
      ctx.drawImage(photoPath, 0, 0, W, H);
      ctx.setFillStyle("rgba(11,13,21,0.55)");
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "rgba(143,123,255,0.55)");
      g.addColorStop(1, "rgba(242,193,78,0.35)");
      ctx.setFillStyle(g);
      ctx.fillRect(0, 0, W, H);
    }

    const pad = Math.floor(W * 0.06);
    ctx.setFillStyle("rgba(255,255,255,0.10)");
    ctx.fillRect(pad, pad, W - pad * 2, H - pad * 2);

    const tx = pad + Math.floor(W * 0.06);
    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(Math.floor(H * 0.10));
    ctx.fillText(clamp(front.displayName || "岩友", 10), tx, pad + Math.floor(H * 0.18));

    ctx.setFillStyle("rgba(255,255,255,0.92)");
    ctx.setFontSize(Math.floor(H * 0.065));
    ctx.fillText("背面故事", tx, pad + Math.floor(H * 0.30));

    ctx.setFillStyle("rgba(255,255,255,0.95)");
    ctx.setFontSize(Math.floor(H * 0.07));
    const lines = wrapLines(ctx, clamp(back.story, 220), W - tx * 2);
    const startY = pad + Math.floor(H * 0.42);
    const lh = Math.floor(H * 0.105);
    const maxLines = Math.max(6, Math.floor((H - startY - Math.floor(H * 0.20)) / lh));
    for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
      ctx.fillText(lines[i], tx, startY + i * lh);
    }

    ctx.setFillStyle("rgba(255,255,255,0.65)");
    ctx.setFontSize(Math.floor(H * 0.05));
    ctx.fillText("飞岩走壁 · 攀岩名片", tx, H - Math.floor(H * 0.08));
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
  openMbtiPicker() {
    this.setData({ pickerVisible: true, pickerType: "mbti" });
  },
  closePicker() {
    this.setData({ pickerVisible: false, pickerType: "" });
  },
  noop() {},
  pickRandomTitle() {
    const t = this.randomTitle();
    if (!t) return;
    const front = { ...this.data.front, title: t };
    this.setData({ front, pickerVisible: false, pickerType: "", previewAvatar: this.computePreviewAvatar(front) }, () => this.revealPreviewAndRender());
  },
  selectTitle(e) {
    const v = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v);
    if (!v) return;
    const front = { ...this.data.front, title: v };
    this.setData({ front, pickerVisible: false, pickerType: "", previewAvatar: this.computePreviewAvatar(front) }, () => this.revealPreviewAndRender());
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
    this.setData({ front, gymsText, gymsLabel: this.computeGymsLabel(front, gymsText) }, () => this.revealPreviewAndRender());
  },
  onGymsText(e) {
    const gymsText = e.detail.value;
    this.setData({ gymsText, gymsLabel: this.computeGymsLabel(this.data.front, gymsText) }, () => this.revealPreviewAndRender());
  },
  setAvatarWechat() {
    const front = { ...this.data.front, avatarMode: "wechat", avatarFileId: "" };
    if (safeText(this.data.userAvatarUrl) && !safeText(front.avatarUrl)) front.avatarUrl = safeText(this.data.userAvatarUrl);
    this.setData({ front, previewAvatar: this.computePreviewAvatar(front) }, () => this.revealPreviewAndRender());
  },
  async pickAvatar() {
    try {
      const r = await this.chooseOneImage();
      if (!r) return;
      const fileID = await this.uploadToCloud(r);
      const front = { ...this.data.front, avatarMode: "custom", avatarFileId: fileID };
      this.setData({ front, previewAvatar: this.computePreviewAvatar(front) }, () => this.revealPreviewAndRender());
    } catch (e) {
      wx.showToast({ title: "上传失败", icon: "none" });
    }
  },
  async pickPhoto() {
    try {
      const r = await this.chooseOneImage();
      if (!r) return;
      const fileID = await this.uploadToCloud(r);
      this.setData({ back: { ...this.data.back, photoFileId: fileID } }, () => this.revealPreviewAndRender());
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
  onStory(e) {
    const story = e.detail.value;
    this.setData({ back: { ...this.data.back, story }, storyPreview: previewText(story, 120) }, () => this.revealPreviewAndRender());
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
      this.setData({ front: { ...this.data.front, oneLiner, oneLinerStyle: this.data.oneLinerStyle } }, () => this.revealPreviewAndRender());
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "生成失败", icon: "none" });
    }
  },
  async onSave() {
    const front = { ...this.data.front };
    front.gyms = front.wanderer ? [] : parseGyms(this.data.gymsText);
    const back = { ...this.data.back };
    if (!safeText(back.story)) return wx.showToast({ title: this.data.storyRequiredToast || "内容不能为空", icon: "none" });
    if (!safeText(front.displayName)) front.displayName = "岩友";
    if (!safeText(front.title)) front.title = "新手上路";

    try {
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

      wx.showToast({ title: "已保存", icon: "success" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
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
