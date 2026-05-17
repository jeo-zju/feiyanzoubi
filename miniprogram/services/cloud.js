function createTraceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pushLog(entry) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return;
    if (!Array.isArray(app.globalData.logs)) app.globalData.logs = [];
    app.globalData.logs.unshift(entry);
    if (app.globalData.logs.length > 200) app.globalData.logs.length = 200;
  } catch (e) {}
}

async function callCloud(name, data, options) {
  const traceId = createTraceId();
  const loading = options && options.loading;
  const loadingTitle = (options && options.loadingTitle) || "加载中";
  const startAt = Date.now();

  if (loading) {
    wx.showLoading({ title: loadingTitle, mask: true });
  }

  try {
    const res = await wx.cloud.callFunction({
      name,
      data: data || {}
    });
    const result = res && res.result ? res.result : res;
    const ok = !!(result && result.ok);
    const payload = result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
    const remoteTraceId = result && result.traceId ? result.traceId : traceId;

    pushLog({
      type: ok ? "info" : "error",
      name,
      traceId: remoteTraceId,
      ms: Date.now() - startAt,
      at: Date.now(),
      data: data || {},
      result
    });

    if (!ok && result && result.error) {
      const err = new Error(result.error.message || "云函数错误");
      err.code = result.error.code || "CLOUD_ERROR";
      err.traceId = remoteTraceId;
      throw err;
    }
    if (!ok && result && result.ok === false) {
      const err = new Error("云函数错误");
      err.code = "CLOUD_ERROR";
      err.traceId = remoteTraceId;
      throw err;
    }
    return payload;
  } catch (e) {
    pushLog({
      type: "error",
      name,
      traceId,
      ms: Date.now() - startAt,
      at: Date.now(),
      data: data || {},
      error: { message: e && e.message ? e.message : String(e) }
    });
    throw e;
  } finally {
    if (loading) wx.hideLoading();
  }
}

module.exports = {
  callCloud
};

