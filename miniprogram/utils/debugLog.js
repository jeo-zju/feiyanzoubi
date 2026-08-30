const STORAGE_KEY = "debug_logs_v1";
const MAX_LOGS = 200;

let cache = null;
let _modalLock = false;

function nowId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function errorToStack(err) {
  if (!err) return "";
  if (err instanceof Error) {
    return [
      err.name ? `[${err.name}]` : "",
      err.message ? err.message : "",
      err.code ? `(code: ${err.code})` : "",
      err.traceId ? `(traceId: ${err.traceId})` : "",
      err.stack ? `\n${err.stack}` : ""
    ].filter(Boolean).join(" ");
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch (_) {
    return String(err);
  }
}

function safeClone(value, depth) {
  if (depth <= 0) return "[MaxDepth]";
  if (value == null) return value;
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message || "",
      code: value.code || "",
      traceId: value.traceId || "",
      stack: value.stack || ""
    };
  }
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => safeClone(item, depth - 1));
  if (typeof value === "object") {
    const out = {};
    Object.keys(value)
      .slice(0, 20)
      .forEach((key) => {
        out[key] = safeClone(value[key], depth - 1);
      });
    return out;
  }
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  return value;
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(safeClone(value, 3), null, 2);
  } catch (e) {
    return String(value);
  }
}

function shortText(text, limit) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function load() {
  if (cache) return cache;
  try {
    const logs = wx.getStorageSync(STORAGE_KEY);
    cache = Array.isArray(logs) ? logs : [];
  } catch (e) {
    cache = [];
  }
  return cache;
}

function persist(logs) {
  cache = Array.isArray(logs) ? logs.slice(0, MAX_LOGS) : [];
  try {
    wx.setStorageSync(STORAGE_KEY, cache);
  } catch (e) {}
}

function addLog(entry) {
  const current = load().slice(0);
  const detail = stringify(entry && entry.detail);
  const next = [
    {
      id: nowId(),
      time: Date.now(),
      type: entry && entry.type ? entry.type : "info",
      category: entry && entry.category ? entry.category : "app",
      title: entry && entry.title ? entry.title : "调试日志",
      summary: shortText(entry && entry.summary ? entry.summary : detail, 160),
      detail,
      traceId: entry && entry.traceId ? String(entry.traceId) : "",
      code: entry && entry.code ? String(entry.code) : "",
      durationMs: entry && Number.isFinite(entry.durationMs) ? Number(entry.durationMs) : 0,
      page: entry && entry.page ? String(entry.page) : ""
    }
  ].concat(current);
  persist(next);
}

function getLogs() {
  return load().slice(0);
}

function clearLogs() {
  persist([]);
}

function formatTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function summarizeCloudPayload(data) {
  if (data == null) return "";
  if (typeof data === "string") return shortText(data, 120);
  if (typeof data === "object") {
    const keys = Object.keys(data).slice(0, 8);
    const preview = {};
    keys.forEach((key) => {
      const value = data[key];
      if (typeof value === "string") preview[key] = shortText(value, 40);
      else if (typeof value === "number" || typeof value === "boolean" || value == null) preview[key] = value;
      else if (Array.isArray(value)) preview[key] = `[Array(${value.length})]`;
      else if (typeof value === "object") preview[key] = "[Object]";
    });
    return stringify(preview);
  }
  return String(data);
}

function logCloudStart(name, data, traceId) {
  addLog({
    type: "info",
    category: "cloud",
    title: `调用云函数 ${name}`,
    summary: summarizeCloudPayload(data),
    detail: { phase: "start", name, data, traceId },
    traceId
  });
}

function logCloudSuccess(name, result, meta) {
  addLog({
    type: "success",
    category: "cloud",
    title: `云函数成功 ${name}`,
    summary: summarizeCloudPayload(result),
    detail: { phase: "success", name, result, meta },
    traceId: meta && meta.traceId ? meta.traceId : "",
    durationMs: meta && meta.durationMs ? meta.durationMs : 0
  });
}

function logCloudError(name, err, meta) {
  try { console.error(`[CLOUD ERR] ${name}`, errorToStack(err), meta || ""); } catch (_) {}
  addLog({
    type: "error",
    category: "cloud",
    title: `云函数失败 ${name}`,
    summary: err && err.message ? err.message : "调用失败",
    detail: { phase: "error", name, error: safeClone(err, 4), meta },
    traceId: (err && err.traceId) || (meta && meta.traceId) || "",
    code: err && err.code ? err.code : "",
    durationMs: meta && meta.durationMs ? meta.durationMs : 0
  });
}

function logAppError(title, error, extra) {
  try { console.error(`[APP ERR] ${title}`, errorToStack(error), extra || ""); } catch (_) {}
  addLog({
    type: "error",
    category: "app",
    title,
    summary: error && error.message ? error.message : stringify(error),
    detail: { error: safeClone(error, 4), extra: safeClone(extra, 3) },
    traceId: extra && extra.traceId ? extra.traceId : "",
    page: extra && extra.page ? extra.page : ""
  });
}

function showErrorModal(options) {
  if (_modalLock) {
    try { console.error("[MODAL QUEUED]", options && options.title, options && options.message); } catch (_) {}
    return;
  }
  _modalLock = true;
  const title = (options && options.title) ? String(options.title) : "错误";
  const msgRaw = (options && options.message) ? String(options.message) : "";
  const traceId = (options && options.traceId) ? String(options.traceId) : "";
  const subHint = options && options.subHint ? String(options.subHint) : "";
  const contentLines = [msgRaw, subHint, traceId ? `追踪 ID:\n${traceId}` : ""].filter(Boolean);
  const content = contentLines.join("\n\n") || "未知错误";
  const onConfirmCb = options && typeof options.onConfirm === "function" ? options.onConfirm : null;
  const onCancelCb = options && typeof options.onCancel === "function" ? options.onCancel : null;
  try {
    wx.showModal({
      title,
      content,
      showCancel: !!(options && options.showCancel),
      cancelText: (options && options.cancelText) || "关闭",
      confirmText: (options && options.confirmText) || "我知道了",
      confirmColor: "#7C6EE6",
      success(res) {
        try {
          if (res.confirm && onConfirmCb) onConfirmCb();
          if (!res.confirm && onCancelCb) onCancelCb();
        } catch (_) {}
      },
      complete() {
        setTimeout(() => { _modalLock = false; }, 80);
      }
    });
  } catch (e) {
    _modalLock = false;
    try { console.error("[MODAL FAIL]", errorToStack(e)); } catch (_) {}
  }
}

module.exports = {
  addLog,
  getLogs,
  clearLogs,
  formatTime,
  logCloudStart,
  logCloudSuccess,
  logCloudError,
  logAppError,
  errorToStack,
  showErrorModal
};
