const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");
const debugLog = require("../../utils/debugLog");

const MODE_LABELS = {
  boulder: "抱石",
  difficulty: "难度",
  lead: "先锋"
};

const DEFAULT_CITIES = ["杭州市", "北京市", "上海市", "广州市", "深圳市", "成都市", "重庆市", "武汉市", "南京市"];
const DEFAULT_KEYWORDS = ["攀岩", "攀岩馆", "抱石馆", "攀岩训练馆"];

function safeText(v) {
  return v == null ? "" : String(v).trim();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function formatModes(modes) {
  const labels = (Array.isArray(modes) ? modes : [])
    .map((mode) => MODE_LABELS[String(mode || "").trim().toLowerCase()] || "")
    .filter(Boolean);
  return labels.join(" / ");
}

function formatWriteAction(action) {
  const key = safeText(action).toLowerCase();
  if (key === "insert") return "新增";
  if (key === "update") return "更新";
  if (key === "skip") return "跳过";
  return "未知";
}

function formatWriteReason(reason) {
  const key = safeText(reason).toLowerCase();
  if (!key) return "";
  if (key === "deleted_match") return "命中已删除岩馆";
  if (key === "merged_target_update") return "命中已合并目标馆";
  return key;
}

function countKeywords(value) {
  return String(value || "")
    .split(/\r?\n|,|，|;/)
    .map((item) => safeText(item))
    .filter(Boolean).length;
}

function buildSyncState(result) {
  const data = result || {};
  const stats = data.stats || {};
  const requests = Array.isArray(data.requests) ? data.requests : [];
  const items = (Array.isArray(data.items) ? data.items : []).map((item) => ({
    ...(item || {}),
    supportedModesText: formatModes(item && item.supportedModes)
  }));
  const writeResults = (Array.isArray(data.writeResults) ? data.writeResults : []).map((item) => ({
    ...(item || {}),
    actionText: formatWriteAction(item && item.action),
    reasonText: formatWriteReason(item && item.reason)
  }));
  return {
    syncResult: data,
    syncStats: {
      requests: Number(stats.requests) || 0,
      fetched: Number(stats.fetched) || 0,
      unique: Number(stats.unique) || 0,
      filteredIrrelevant: Number(stats.filteredIrrelevant) || 0,
      inserted: Number(stats.inserted) || 0,
      updated: Number(stats.updated) || 0,
      skipped: Number(stats.skipped) || 0,
      sourceSaved: Number(stats.sourceSaved) || 0,
      reviewQueued: Number(stats.reviewQueued) || 0,
      skipReasons: stats.skipReasons || {}
    },
    syncRequests: requests,
    syncItems: items,
    syncWriteResults: writeResults
  };
}

Page({
  data: {
    cityOptions: DEFAULT_CITIES,
    cityIndex: 0,
    keywordText: DEFAULT_KEYWORDS.join("\n"),
    keywordCount: DEFAULT_KEYWORDS.length,
    keywordCollapsed: true,
    pageLimitText: "2",
    pageSizeText: "10",
    syncLoading: false,
    syncError: "",
    syncResult: null,
    syncStats: {
      requests: 0,
      fetched: 0,
      unique: 0,
      filteredIrrelevant: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      sourceSaved: 0,
      reviewQueued: 0,
      skipReasons: {}
    },
    syncRequests: [],
    syncItems: [],
    syncWriteResults: []
  },
  async onShow() {
    await ensureAdminPageAccess();
  },
  onCityChange(e) {
    const cityIndex = clampInt(e && e.detail ? e.detail.value : 0, 0, this.data.cityOptions.length - 1, 0);
    this.setData({ cityIndex });
  },
  onKeywordInput(e) {
    const keywordText = e && e.detail ? e.detail.value : "";
    this.setData({ keywordText, keywordCount: countKeywords(keywordText) });
  },
  onToggleKeywordPanel() {
    this.setData({ keywordCollapsed: !this.data.keywordCollapsed });
  },
  onPageLimitInput(e) {
    this.setData({ pageLimitText: e && e.detail ? e.detail.value : "" });
  },
  onPageSizeInput(e) {
    this.setData({ pageSizeText: e && e.detail ? e.detail.value : "" });
  },
  async onRunSyncPreview() {
    const city = this.data.cityOptions[this.data.cityIndex] || "";
    const keywords = String(this.data.keywordText || "")
      .split(/\r?\n|,|，|;/)
      .map((item) => safeText(item))
      .filter(Boolean);
    const pageLimit = clampInt(this.data.pageLimitText, 1, 5, 1);
    const pageSize = clampInt(this.data.pageSizeText, 1, 20, 10);
    if (!city) {
      wx.showToast({ title: "请先选择城市", icon: "none" });
      return;
    }
    if (!keywords.length) {
      wx.showToast({ title: "请先填写关键词", icon: "none" });
      return;
    }
    this.setData({
      syncLoading: true,
      syncError: "",
      syncResult: null,
      syncRequests: [],
      syncItems: [],
      syncWriteResults: [],
      syncStats: { requests: 0, fetched: 0, unique: 0, filteredIrrelevant: 0, inserted: 0, updated: 0, skipped: 0, sourceSaved: 0, reviewQueued: 0, skipReasons: {} }
    });
    try {
      const res = await backstageApi.syncGyms({
        provider: "tencent",
        dryRun: true,
        city,
        keywords,
        pageLimit,
        pageSize
      });
      this.setData(buildSyncState(res));
      debugLog.addLog({
        type: "success",
        category: "app",
        title: "后台岩馆同步预览成功",
        summary: `${city}，关键词 ${keywords.length} 个，去重后 ${Number(res && res.stats && res.stats.unique) || 0} 条`,
        detail: res
      });
    } catch (e) {
      const message = e && e.message ? e.message : "同步预览失败";
      this.setData({ syncError: message });
      debugLog.logAppError("后台岩馆同步预览失败", e, { page: "pages/backstage-sync/index" });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ syncLoading: false });
    }
  },
  async onRunSyncWrite() {
    const city = this.data.cityOptions[this.data.cityIndex] || "";
    const keywords = String(this.data.keywordText || "")
      .split(/\r?\n|,|，|;/)
      .map((item) => safeText(item))
      .filter(Boolean);
    const pageLimit = clampInt(this.data.pageLimitText, 1, 5, 1);
    const pageSize = clampInt(this.data.pageSizeText, 1, 20, 10);
    if (!city) {
      wx.showToast({ title: "请先选择城市", icon: "none" });
      return;
    }
    if (!keywords.length) {
      wx.showToast({ title: "请先填写关键词", icon: "none" });
      return;
    }
    const confirmed = await new Promise((resolve) =>
      wx.showModal({
        title: "写入正式馆表",
        content: "会把本次结果写入来源记录和 RockGyms，是否继续？",
        success: (res) => resolve(!!(res && res.confirm)),
        fail: () => resolve(false)
      })
    );
    if (!confirmed) return;
    this.setData({
      syncLoading: true,
      syncError: ""
    });
    try {
      const res = await backstageApi.syncGyms({
        provider: "tencent",
        dryRun: false,
        write: true,
        city,
        keywords,
        pageLimit,
        pageSize
      });
      this.setData(buildSyncState(res));
      debugLog.addLog({
        type: "success",
        category: "app",
        title: "后台岩馆同步写入成功",
        summary: `新增 ${Number(res && res.stats && res.stats.inserted) || 0} 条，更新 ${Number(res && res.stats && res.stats.updated) || 0} 条，跳过 ${Number(res && res.stats && res.stats.skipped) || 0} 条`,
        detail: res
      });
      wx.showToast({ title: "写入完成", icon: "success" });
    } catch (e) {
      const message = e && e.message ? e.message : "写入失败";
      this.setData({ syncError: message });
      debugLog.logAppError("后台岩馆同步写入失败", e, { page: "pages/backstage-sync/index" });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      this.setData({ syncLoading: false });
    }
  },
  onCopySyncResult() {
    if (!this.data.syncResult) {
      wx.showToast({ title: "暂无结果", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: JSON.stringify(this.data.syncResult, null, 2)
    });
  },
  onCopyGymName(e) {
    const name = safeText(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.name : "");
    if (!name) {
      wx.showToast({ title: "暂无馆名", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: name,
      success: () => {
        wx.showToast({ title: "馆名已复制", icon: "success" });
      }
    });
  }
});
