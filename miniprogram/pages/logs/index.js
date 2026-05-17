const { formatDate } = require("../../utils/date");
const { callCloud } = require("../../services/cloud");

Page({
  data: {
    logs: []
  },
  onShow() {
    this.load();
  },
  load() {
    const app = getApp();
    const raw = (app && app.globalData && app.globalData.logs) || [];
    const logs = raw.map((l) => ({
      ...l,
      atText: `${formatDate(l.at)} ${new Date(l.at).toTimeString().slice(0, 8)}`
    }));
    this.setData({ logs });
  },
  onRefresh() {
    this.load();
  },
  onClear() {
    const app = getApp();
    if (app && app.globalData) app.globalData.logs = [];
    this.load();
  },
  onCopyAll() {
    const text = (this.data.logs || [])
      .map((l) => `${l.atText}\t${l.type}\t${l.name}\t${l.traceId}\t${l.ms}ms`)
      .join("\n");
    wx.setClipboardData({ data: text || "" });
  },
  async onProbe() {
    try {
      const res = await callCloud("debug_probe", {}, { loading: true, loadingTitle: "探测数据" });
      const text = JSON.stringify(res || {}, null, 2);
      wx.setClipboardData({ data: text });
      wx.showToast({ title: "已复制探测结果", icon: "success" });
      this.load();
    } catch (e) {
      wx.showToast({ title: "探测失败", icon: "none" });
      this.load();
    }
  },
  onCopyItem(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : -1);
    const item = idx >= 0 ? (this.data.logs || [])[idx] : null;
    if (!item) return;
    const payload = {
      at: item.atText,
      type: item.type,
      name: item.name,
      traceId: item.traceId,
      ms: item.ms,
      data: item.data,
      result: item.result,
      error: item.error
    };
    wx.setClipboardData({ data: JSON.stringify(payload, null, 2) });
    wx.showToast({ title: "已复制日志详情", icon: "success" });
  }
});

