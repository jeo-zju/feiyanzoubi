const debugLog = require("../../utils/debugLog");

function buildViewModel(log) {
  const item = log || {};
  return {
    id: item.id || "",
    timeText: debugLog.formatTime(item.time),
    type: item.type || "info",
    category: item.category || "app",
    title: item.title || "调试日志",
    summary: item.summary || "",
    detail: item.detail || "",
    traceId: item.traceId || "",
    code: item.code || "",
    durationText: item.durationMs ? `${item.durationMs}ms` : "",
    page: item.page || "",
    typeText:
      item.type === "error"
        ? "错误"
        : item.type === "success"
          ? "成功"
          : "信息"
  };
}

Page({
  data: {
    logs: [],
    total: 0,
    errorCount: 0,
    cloudCount: 0
  },
  onShow() {
    this.refreshLogs();
  },
  refreshLogs() {
    const logs = debugLog.getLogs();
    this.setData({
      logs: logs.map(buildViewModel),
      total: logs.length,
      errorCount: logs.filter((item) => item && item.type === "error").length,
      cloudCount: logs.filter((item) => item && item.category === "cloud").length
    });
  },
  onRefresh() {
    this.refreshLogs();
    wx.showToast({ title: "已刷新", icon: "none" });
  },
  onClear() {
    wx.showModal({
      title: "清空日志",
      content: "确认清空本地调试日志吗？",
      success: (res) => {
        if (!res.confirm) return;
        debugLog.clearLogs();
        this.refreshLogs();
        wx.showToast({ title: "已清空", icon: "none" });
      }
    });
  },
  onCopyAll() {
    const text = this.data.logs
      .map((item) => {
        return [
          `[${item.timeText}] ${item.typeText} ${item.title}`,
          item.traceId ? `traceId: ${item.traceId}` : "",
          item.code ? `code: ${item.code}` : "",
          item.page ? `page: ${item.page}` : "",
          item.durationText ? `duration: ${item.durationText}` : "",
          item.summary ? `summary: ${item.summary}` : "",
          item.detail ? `detail:\n${item.detail}` : ""
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n----------------\n\n");
    if (!text) {
      wx.showToast({ title: "暂无日志", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: text });
  },
  onCopyItem(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.logs.find((log) => log.id === id);
    if (!item) return;
    const text = [
      `[${item.timeText}] ${item.typeText} ${item.title}`,
      item.traceId ? `traceId: ${item.traceId}` : "",
      item.code ? `code: ${item.code}` : "",
      item.page ? `page: ${item.page}` : "",
      item.durationText ? `duration: ${item.durationText}` : "",
      item.summary ? `summary: ${item.summary}` : "",
      item.detail ? `detail:\n${item.detail}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    wx.setClipboardData({ data: text });
  }
});
