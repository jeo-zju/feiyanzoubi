const cardApi = require("../../services/api/card");
const { safeText } = require("../../utils/format");

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
    titleIndex: 0,
    mbtiOptions: ["", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"],
    mbtiIndex: 0,
    styleTabs: [
      { key: "encourage", label: "鼓励" },
      { key: "humor", label: "幽默" }
    ],
    oneLinerStyle: "encourage",
    gymsText: "",
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
    this.setData({ mode, cardId });
    if (cardId) this.loadCard(cardId);
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
      const mbti = safeText(front.mbti);
      const mbtiIndex = this.data.mbtiOptions.indexOf(mbti);
      this.setData({
        front: { ...this.data.front, ...front },
        back: { ...this.data.back, ...back },
        gymsText,
        mbtiIndex: mbtiIndex >= 0 ? mbtiIndex : 0,
        oneLinerStyle: safeText(front.oneLinerStyle) === "humor" ? "humor" : "encourage"
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  onName(e) {
    this.setData({ front: { ...this.data.front, displayName: e.detail.value } });
  },
  onTitle(e) {
    this.setData({ front: { ...this.data.front, title: e.detail.value } });
  },
  onPickTitle(e) {
    const idx = Number(e.detail.value || 0);
    const t = this.data.titleOptions[idx] || "";
    this.setData({ titleIndex: idx, front: { ...this.data.front, title: t } });
  },
  onRandomTitle() {
    const n = this.data.titleOptions.length;
    if (!n) return;
    const idx = Math.floor(Math.random() * n);
    const t = this.data.titleOptions[idx] || "";
    this.setData({ titleIndex: idx, front: { ...this.data.front, title: t } });
  },
  onPickMbti(e) {
    const idx = Number(e.detail.value || 0);
    const v = this.data.mbtiOptions[idx] || "";
    this.setData({ mbtiIndex: idx, front: { ...this.data.front, mbti: v } });
  },
  onClearMbti() {
    this.setData({ mbtiIndex: 0, front: { ...this.data.front, mbti: "" } });
  },
  onWanderer(e) {
    const wanderer = !!(e && e.detail && e.detail.value);
    const front = { ...this.data.front, wanderer };
    if (wanderer) front.gyms = [];
    this.setData({ front, gymsText: wanderer ? "" : this.data.gymsText });
  },
  onGymsText(e) {
    this.setData({ gymsText: e.detail.value });
  },
  setAvatarWechat() {
    this.setData({ front: { ...this.data.front, avatarMode: "wechat", avatarFileId: "" } });
  },
  async pickAvatar() {
    try {
      const r = await this.chooseOneImage();
      if (!r) return;
      const fileID = await this.uploadToCloud(r);
      this.setData({ front: { ...this.data.front, avatarMode: "custom", avatarFileId: fileID } });
    } catch (e) {
      wx.showToast({ title: "上传失败", icon: "none" });
    }
  },
  async pickPhoto() {
    try {
      const r = await this.chooseOneImage();
      if (!r) return;
      const fileID = await this.uploadToCloud(r);
      this.setData({ back: { ...this.data.back, photoFileId: fileID } });
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
    this.setData({ back: { ...this.data.back, story: e.detail.value } });
  },
  onOneLiner(e) {
    this.setData({ front: { ...this.data.front, oneLiner: e.detail.value } });
  },
  onStyleChange(e) {
    const v = e && e.detail && e.detail.value ? e.detail.value : "encourage";
    this.setData({ oneLinerStyle: v, front: { ...this.data.front, oneLinerStyle: v } });
  },
  async onGenerate() {
    const story = safeText(this.data.back.story);
    if (!story) return wx.showToast({ title: "先写背面故事", icon: "none" });
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
      this.setData({ front: { ...this.data.front, oneLiner, oneLinerStyle: this.data.oneLinerStyle } });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "生成失败", icon: "none" });
    }
  },
  async onSave() {
    const front = { ...this.data.front };
    front.gyms = front.wanderer ? [] : parseGyms(this.data.gymsText);
    const back = { ...this.data.back };
    if (!safeText(back.story)) return wx.showToast({ title: "背面故事不能为空", icon: "none" });
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
  }
});
