App({
  onLaunch() {
    this.globalData = {};
    if (!wx.cloud) {
      return;
    }
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true
    });
  },
});
