const { logAppError, showErrorModal } = require("./utils/debugLog");
const { CACHE_KEYS, get: cacheGet, set: cacheSet, invalidate: cacheInvalidate, clearAll: cacheClearAll } = require("./utils/cache");

App({
  globalData: {
    _cache: { map: new Map(), lastOpenid: "" },
    _winSizeCached: null
  },
  globalConstants: {
    STORAGE_KEYS: CACHE_KEYS,
    CACHE_KEYS
  },

  cacheGet(key, options) {
    try { return cacheGet(key, options || {}); } catch (e) {
      try { console.warn("[app] cacheGet fallback err", e && e.message); } catch (_) {}
      if (options && typeof options.loader === "function") return options.loader();
      throw e;
    }
  },
  cacheSet(key, value, ttlMin, options) {
    try { return cacheSet(key, value, ttlMin, options || {}); } catch (_) { return false; }
  },
  cacheInvalidate(prefixOrKey) {
    try { return cacheInvalidate(prefixOrKey); } catch (_) { return false; }
  },
  cacheClearAll() {
    try { return cacheClearAll(); } catch (_) { return false; }
  },

  prewarmOtherTabs() {
    const self = this;
    setTimeout(() => {
      try {
        const calendarApi = require("./services/api/calendar");
        const cardApi = require("./services/api/card");
        const friendshipApi = require("./services/api/friendship");
        Promise.all([
          Promise.resolve()
            .then(() => calendarApi.mine({ includeSummary: true, tab: "upcoming", page: 1, pageSize: 1 }, { loading: false, silent: true }))
            .then((res) => { if (res) self.cacheSet(CACHE_KEYS.CALENDAR_SUMMARY, res, 5, { saveL2: false }); })
            .catch(() => {}),
          Promise.resolve()
            .then(() => cardApi.listMy({}, { loading: false, silent: true }))
            .then((res) => { if (res) self.cacheSet(CACHE_KEYS.CARD_SUMMARY, res, 30, { saveL2: true }); })
            .catch(() => {}),
          Promise.resolve()
            .then(() => friendshipApi.list({ pageSize: 20 }, { loading: false, silent: true }))
            .then((res) => { if (res) self.cacheSet(CACHE_KEYS.FRIEND_COMBINED, res, 3, { saveL2: false }); })
            .catch(() => {})
        ]).catch(() => {});
      } catch (_) {}
    }, 50);
  },

  onLaunch() {
    if (!wx.cloud) {
      const err = new Error("当前基础库不支持 wx.cloud，请升级微信客户端到最新版本");
      err.code = "CLOUD_UNAVAILABLE";
      logAppError("云能力不可用", err);
      try {
        showErrorModal({
          title: "微信基础库过低",
          message: err.message,
          subHint: "请在微信 → 我 → 设置 → 关于微信 里升级到最新版本后重试。"
        });
      } catch (_) {}
      return;
    }
    try {
      wx.cloud.init({
        env: wx.cloud.DYNAMIC_CURRENT_ENV,
        traceUser: true
      });
      this._cloudReady = true;
    } catch (initErr) {
      this._cloudReady = false;
      const wrapErr = initErr instanceof Error ? initErr : new Error(String(initErr || "wx.cloud.init 初始化失败"));
      wrapErr.code = wrapErr.code || "CLOUD_INIT_FAIL";
      logAppError("云开发初始化失败", wrapErr);
      try {
        showErrorModal({
          title: "云开发初始化失败",
          message: wrapErr.message || "无法连接到云开发环境",
          traceId: wrapErr.traceId || "onLaunch_init",
          subHint: "请确认：\n1) 微信开发者工具右上角已选择云开发环境\n2) project.config.json 中 cloudfunctionRoot 指向 cloudfunctions\n3) 网络连接正常（4G/Wi-Fi 都试下）"
        });
      } catch (_) {}
    }
    try {
      let lastOpenid = "";
      try { lastOpenid = String(wx.getStorageSync(CACHE_KEYS.LAST_OPENID) || ""); } catch (_) {}
      this.globalData._cache = { map: new Map(), lastOpenid };
      if (!this.globalData._winSizeCached) {
        try {
          const sys = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync && wx.getSystemInfoSync());
          if (sys && typeof sys.windowWidth === "number") {
            this.globalData._winSizeCached = sys.windowWidth;
          }
        } catch (_) {}
      }
    } catch (_) {}
  },

  onError(error) {
    try { logAppError("小程序运行错误", error, { page: this.getCurrentPagePath() }); } catch (_) {}
  },

  onUnhandledRejection(res) {
    const reason = res && Object.prototype.hasOwnProperty.call(res, "reason") ? res.reason : res;
    try { logAppError("Promise 未处理异常", reason, { page: this.getCurrentPagePath() }); } catch (_) {}
  },

  onPageNotFound(res) {
    try {
      const err = new Error(res && res.path ? res.path : "未知页面");
      logAppError("页面不存在", err, res || {});
    } catch (_) {}
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
