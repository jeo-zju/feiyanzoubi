const { logCloudStart, logCloudSuccess, logCloudError } = require("../utils/debugLog");

function createTraceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function callCloud(name, data, options) {
  const traceId = createTraceId();
  const loading = options && options.loading;
  const loadingTitle = (options && options.loadingTitle) || "加载中";
  const startedAt = Date.now();

  if (loading) {
    wx.showLoading({ title: loadingTitle, mask: true });
  }

  try {
    logCloudStart(name, data || {}, traceId);
    const res = await wx.cloud.callFunction({
      name,
      data: data || {}
    });
    const result = res && res.result ? res.result : res;
    const ok = !!(result && result.ok);
    const payload = result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
    const remoteTraceId = result && result.traceId ? result.traceId : traceId;

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
    logCloudSuccess(name, payload, { traceId: remoteTraceId, durationMs: Date.now() - startedAt });
    return payload;
  } catch (err) {
    logCloudError(name, err, { traceId: err && err.traceId ? err.traceId : traceId, durationMs: Date.now() - startedAt });
    throw err;
  } finally {
    if (loading) wx.hideLoading();
  }
}

module.exports = {
  callCloud
};

