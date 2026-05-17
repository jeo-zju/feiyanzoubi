const { login } = require("../../services/api/auth");

Page({
  data: {
    user: {
      nickName: "",
      avatarUrl: "",
      projectName: "Project"
    },
    defaultAvatar: "/images/avatar.png"
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
  }
});

