const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

function pretty(value) {
  try {
    return JSON.stringify(value == null ? null : value, null, 2);
  } catch (e) {
    return String(value == null ? "" : value);
  }
}

Page({
  data: {
    loading: false,
    error: "",
    context: null,
    user: null,
    rawUserText: "",
    managedGyms: [],
    managedGymCount: 0
  },
  async onShow() {
    const user = await ensureAdminPageAccess();
    if (!user) return;
    if (!this.data.user && !this.data.loading) {
      this.loadData();
    }
  },
  async loadData() {
    this.setData({ loading: true, error: "" });
    try {
      const res = await backstageApi.authDebug();
      this.setData({
        context: (res && res.context) || null,
        user: (res && res.user) || null,
        rawUserText: pretty(res && res.rawUser),
        managedGyms: Array.isArray(res && res.managedGyms) ? res.managedGyms : [],
        managedGymCount: Number((res && res.managedGymCount) || 0)
      });
    } catch (e) {
      const error = (e && e.message) || "读取失败";
      this.setData({ error });
      wx.showToast({ title: error, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onRefresh() {
    this.loadData();
  },
  onCopyUser() {
    if (!this.data.rawUserText) {
      wx.showToast({ title: "暂无数据", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.rawUserText });
  }
});
