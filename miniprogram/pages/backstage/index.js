const { ensureAdminPageAccess } = require("../../utils/session");

Page({
  async onShow() {
    await ensureAdminPageAccess();
  },
  goLogs() {
    wx.navigateTo({ url: "/pages/debug-logs/index" });
  },
  goOwner() {
    wx.navigateTo({ url: "/pages/owner/index" });
  },
  goReviewQueue() {
    wx.navigateTo({ url: "/pages/review-queue/index" });
  },
  goAuthDebug() {
    wx.navigateTo({ url: "/pages/backstage-auth/index" });
  },
  goDataDebug() {
    wx.navigateTo({ url: "/pages/backstage-data/index" });
  },
  goGymAuthDebug() {
    wx.navigateTo({ url: "/pages/backstage-gym-auth/index" });
  },
  goUserDetail() {
    wx.navigateTo({ url: "/pages/backstage-user-detail/index" });
  },
  goReviewDetail() {
    wx.navigateTo({ url: "/pages/backstage-review-detail/index" });
  },
  goUserAdmin() {
    wx.navigateTo({ url: "/pages/user-admin/index" });
  },
  goSync() {
    wx.navigateTo({ url: "/pages/backstage-sync/index" });
  },
  goDemo() {
    wx.navigateTo({ url: "/pages/backstage-demo/index" });
  },
  goHealth() {
    wx.navigateTo({ url: "/pages/backstage-health/index" });
  }
});
