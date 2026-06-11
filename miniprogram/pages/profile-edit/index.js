const { safeText } = require("../../utils/format");
const { syncAppLogin } = require("../../utils/session");

const DEFAULT_AVATAR = "/images/avatar.png";

function fileExt(path) {
  const p = safeText(path);
  const match = p.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? match[1].toLowerCase() : "png";
}

function isRemotePath(path) {
  return /^(cloud|https?):/.test(safeText(path));
}

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    nickName: "",
    avatarUrl: "",
    initialNickName: "",
    initialAvatarUrl: "",
    avatarChanged: false,
    canSave: false,
    saving: false
  },
  onLoad() {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    const nickName = safeText(user.nickName);
    const avatarUrl = safeText(user.avatarUrl);
    this.setData(
      {
        nickName,
        avatarUrl,
        initialNickName: nickName,
        initialAvatarUrl: avatarUrl
      },
      () => this.updateCanSave()
    );
  },
  updateCanSave() {
    const nickName = safeText(this.data.nickName);
    const avatarUrl = safeText(this.data.avatarUrl);
    const changed = nickName !== safeText(this.data.initialNickName) || avatarUrl !== safeText(this.data.initialAvatarUrl);
    this.setData({
      canSave: !!nickName && changed
    });
  },
  onNicknameInput(e) {
    this.setData(
      {
        nickName: safeText(e && e.detail ? e.detail.value : "")
      },
      () => this.updateCanSave()
    );
  },
  onChooseAvatar(e) {
    const avatarUrl = safeText(e && e.detail ? e.detail.avatarUrl : "");
    if (!avatarUrl) return;
    this.setData(
      {
        avatarUrl,
        avatarChanged: true
      },
      () => this.updateCanSave()
    );
  },
  async uploadAvatar(tempPath) {
    const ext = fileExt(tempPath);
    const cloudPath = `avatars/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (res) => resolve(safeText(res && res.fileID)),
        fail: reject
      });
    });
  },
  async resolveAvatarUrl() {
    const avatarUrl = safeText(this.data.avatarUrl);
    if (!avatarUrl) return "";
    if (!this.data.avatarChanged) return avatarUrl;
    if (avatarUrl.startsWith("/")) return "";
    if (isRemotePath(avatarUrl)) return avatarUrl;
    return this.uploadAvatar(avatarUrl);
  },
  async onSave() {
    if (this.data.saving) return;
    const nickName = safeText(this.data.nickName);
    if (!nickName) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    if (!this.data.canSave) {
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    try {
      const avatarUrl = await this.resolveAvatarUrl();
      const user = await syncAppLogin({
        nickName,
        avatarUrl
      });
      const nextNickName = safeText(user && user.nickName, nickName);
      const nextAvatarUrl = safeText(user && user.avatarUrl, avatarUrl);
      this.setData(
        {
          nickName: nextNickName,
          avatarUrl: nextAvatarUrl,
          initialNickName: nextNickName,
          initialAvatarUrl: nextAvatarUrl,
          avatarChanged: false
        },
        () => this.updateCanSave()
      );
      wx.showToast({ title: "已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "保存失败", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  }
});
