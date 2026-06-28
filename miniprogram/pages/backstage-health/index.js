const backstageApi = require("../../services/api/backstage");

Page({
  data: {
    healthLoading: false,
    healthError: "",
    healthChecks: []
  },
  onShow() {
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
