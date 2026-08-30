const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

function pretty(value) {
  try {
    return JSON.stringify(value == null ? null : value, null, 2);
  } catch (e) {
    return String(value == null ? "" : value);
  }
}

function makeDraft(user) {
  const item = user || {};
  return {
    nickName: item.nickName || "",
    projectName: item.projectName || "",
    role: item.role || ""
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    error: "",
    query: "",
    searched: false,
    found: false,
    user: null,
    stats: null,
    rawUserText: "",
    draft: makeDraft(null)
  },
  async onShow() {
    await ensureAdminPageAccess();
  },
  onQueryInput(e) {
    this.setData({ query: e && e.detail ? e.detail.value : "" });
  },
  applyUserDetail(res) {
    const user = (res && res.user) || null;
    this.setData({
      found: !!(res && res.found),
      user,
      stats: (res && res.stats) || null,
      rawUserText: pretty(res && res.rawUser),
      draft: makeDraft(user),
      error: ""
    });
  },
  async onSearch() {
    const query = String(this.data.query || "").trim();
    if (!query) {
      wx.showToast({ title: "请输入用户 ID / openid / uid", icon: "none" });
      return;
    }

    this.setData({ loading: true, error: "", searched: true });
    try {
      const res = await backstageApi.getUserDetail({ keyword: query });
      this.applyUserDetail(res);
    } catch (e) {
      const error = (e && e.message) || "查询失败";
      this.setData({
        error,
        found: false,
        user: null,
        stats: null,
        rawUserText: "",
        draft: makeDraft(null)
      });
      wx.showToast({ title: error, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onDraftInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : "";
    if (!key) return;
    this.setData({
      draft: {
        ...(this.data.draft || {}),
        [key]: e && e.detail ? e.detail.value : ""
      }
    });
  },
  async onSave() {
    const user = this.data.user;
    if (!user || !user._id) return;

    const draft = this.data.draft || {};
    this.setData({ saving: true });
    try {
      await backstageApi.updateUserProfile({
        userId: user._id,
        nickName: draft.nickName || "",
        projectName: draft.projectName || "",
        role: draft.role || ""
      });
      const detailRes = await backstageApi.getUserDetail({ userId: user._id }, { loading: false });
      this.applyUserDetail(detailRes);

      const nextUser = (detailRes && detailRes.user) || user;

      const app = getApp();
      const appUser = app && app.globalData ? app.globalData.user : null;
      if (appUser && nextUser.openid && String(appUser.openid) === String(nextUser.openid)) {
        app.globalData.user = {
          ...appUser,
          nickName: nextUser.nickName || "",
          projectName: nextUser.projectName || "",
          role: nextUser.role || ""
        };
      }

      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  onCopyRaw() {
    if (!this.data.rawUserText) {
      wx.showToast({ title: "暂无数据", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.rawUserText });
  }
});
