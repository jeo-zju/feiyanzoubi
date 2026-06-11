const { logAppError } = require("./utils/debugLog");

App({
  onLaunch() {
    this.globalData = {};
    if (!wx.cloud) {
      logAppError("云能力不可用", new Error("当前基础库不支持 wx.cloud"));
      return;
    }
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true
    });
  },
  onError(error) {
    logAppError("小程序运行错误", error, { page: this.getCurrentPagePath() });
  },
  onUnhandledRejection(res) {
    const reason = res && Object.prototype.hasOwnProperty.call(res, "reason") ? res.reason : res;
    logAppError("Promise 未处理异常", reason, { page: this.getCurrentPagePath() });
  },
  onPageNotFound(res) {
    logAppError("页面不存在", new Error(res && res.path ? res.path : "未知页面"), res || {});
  },
  getCurrentPagePath() {
    try {
      const pages = getCurrentPages();
      const current = pages && pages.length ? pages[pages.length - 1] : null;
      return current && current.route ? `/${current.route}` : "";
    } catch (e) {
      return "";
    }
  }
});
