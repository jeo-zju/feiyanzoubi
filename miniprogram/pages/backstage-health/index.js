const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

Page({
  data: {
    healthLoading: false,
    healthError: "",
    healthChecks: []
  },
  async onShow() {
    const user = await ensureAdminPageAccess();
    if (!user) return;
    if (!this.data.healthChecks.length && !this.data.healthLoading) {
      this.onCheckHealth();
    }
  },
  async onCheckHealth() {
    this.setData({ healthLoading: true, healthError: "", healthChecks: [] });
    try {
      const res = await backstageApi.healthCheck();
      this.setData({
        healthChecks: Array.isArray(res && res.checks) ? res.checks : []
      });
    } catch (e) {
      const message = e && e.message ? e.message : "检查失败";
      this.setData({ healthError: message });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ healthLoading: false });
    }
  }
});
