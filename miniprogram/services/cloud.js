const { logCloudStart, logCloudSuccess, logCloudError, showErrorModal, errorToStack } = require("../utils/debugLog");

function createTraceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function callCloud(name, data, options) {
  const traceId = createTraceId();
  const loading = options && options.loading;
  const loadingTitle = (options && options.loadingTitle) || "加载中";
  const silent = options && options.silent;
  const startedAt = Date.now();

  if (loading) {
    try { wx.showLoading({ title: loadingTitle, mask: true }); } catch (_) {}
  }

  try {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      const err = new Error("当前微信基础库不支持云函数，请升级微信");
      err.code = "CLOUD_NOT_AVAILABLE";
      err.traceId = traceId;
      throw err;
    }
    logCloudStart(name, data || {}, traceId);
    const res = await wx.cloud.callFunction({ name, data: data || {} });
    const result = res && res.result ? res.result : res;
    const ok = !!(result && result.ok);
    const payload = result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
    const remoteTraceId = result && result.traceId ? result.traceId : traceId;

    if (!ok && result && result.error) {
      const err = new Error(result.error.message || "云函数错误");
      err.code = result.error.code || "CLOUD_ERROR";
      err.traceId = remoteTraceId;
      Object.keys(result.error || {}).forEach((key) => {
        if (key === "code" || key === "message") return;
        err[key] = result.error[key];
      });
      throw err;
    }
    if (!ok && result && result.ok === false) {
      const err = new Error("云函数返回失败（无具体错误信息）");
      err.code = "CLOUD_ERROR";
      err.traceId = remoteTraceId;
      throw err;
    }
    logCloudSuccess(name, payload, { traceId: remoteTraceId, durationMs: Date.now() - startedAt });
    return payload;
  } catch (err) {
    const duration = Date.now() - startedAt;
    logCloudError(name, err, { traceId: err && err.traceId ? err.traceId : traceId, durationMs: duration });
    const title = `云函数调用失败\n${name}`;
    const message = [
      err && err.message ? err.message : "未知错误",
      err && err.code ? `错误码：${err.code}` : ""
    ].filter(Boolean).join("\n");
    const subHint = (() => {
      const m = String(message).toLowerCase();
      if (/collection|数据库|db|权限|not\s*found|不存在|notexist/i.test(m)) {
        return "可能原因：\n1) 集合未创建，请先在云开发控制台初始化数据集合\n2) 新云函数尚未部署（需要部署 cloudfunctions 下对应云函数并安装依赖）\n3) 数据库权限未设置为「所有用户可读，仅创建者可读写」";
      }
      if (/init|cloud|env|environment/i.test(m) || !wx.cloud) {
        return "请确认微信开发者工具已选择对应的云开发环境，并检查 project.config.json 的 cloudfunctionRoot。";
      }
      return "请把上面的错误消息和追踪 ID 发给开发者排查。";
    })();
    if (!silent) {
      try {
        showErrorModal({
          title,
          message,
          traceId: (err && err.traceId) || traceId,
          subHint
        });
      } catch (_) {}
    }
    try { console.error(`[CLOUD FAIL] ${name}`, errorToStack(err), `duration=${duration}ms traceId=${(err && err.traceId) || traceId}`); } catch (_) {}
    throw err;
  } finally {
    if (loading) { try { wx.hideLoading(); } catch (_) {} }
  }
}

module.exports = {
  callCloud
};
