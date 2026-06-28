Page({
  goLogs() {
    wx.navigateTo({ url: "/pages/debug-logs/index" });
  },
  goOwner() {
    wx.navigateTo({ url: "/pages/owner/index" });
  },
  goReviewQueue() {
    wx.navigateTo({ url: "/pages/review-queue/index" });
  },
  goSync() {
    wx.navigateTo({ url: "/pages/backstage-sync/index" });
  },
  goHealth() {
    wx.navigateTo({ url: "/pages/backstage-health/index" });
  },
  }
});
