const { ensureAdminPageAccess } = require("../../utils/session");
const { safeText } = require("../../utils/format");

const STORAGE_PREFIX = "gym_merge_result_";

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (e) {
    return null;
  }
}

// 只列真实返回的迁移项；缺失字段不补 0
const MOVED_FIELDS = [
  { key: "cycles", label: "周期" },
  { key: "mappedCycles", label: "映射周期" },
  { key: "checkins", label: "打卡" },
  { key: "dailyProgress", label: "日进度" },
  { key: "cycleProgress", label: "周期进度" },
  { key: "hardnessRatings", label: "评分" },
  { key: "wallCards", label: "上墙" },
  { key: "comments", label: "评论" }
];

function buildMovedRows(movedCounts) {
  const info = movedCounts || {};
  return MOVED_FIELDS.filter((field) => {
    const raw = info[field.key];
    if (raw === undefined || raw === null || raw === "") return false;
    return Number.isFinite(Number(raw));
  }).map((field) => ({
    key: field.key,
    label: field.label,
    value: Number(info[field.key])
  }));
}

function normalizeMappings(mappings) {
  return (Array.isArray(mappings) ? mappings : [])
    .filter((item) => item && item.sourceCycleId)
    .map((item) => ({
      sourceCycleId: safeText(item.sourceCycleId),
      sourceCycleName: safeText(item.sourceCycleName) || "未命名源周期",
      targetCycleName: safeText(item.targetCycleName) || "未命名目标周期"
    }));
}

Page({
  data: {
    payload: null,
    movedRows: [],
    mappings: [],
    mappingsOpen: false,
    canGoBack: false
  },
  async onLoad(query) {
    const user = await ensureAdminPageAccess();
    if (!user) return;
    const storageKey = safeText(query && query.storageKey);
    const inlinePayload = safeJsonParse(query && query.payload);
    const payload = inlinePayload || (storageKey ? wx.getStorageSync(`${STORAGE_PREFIX}${storageKey}`) : null) || null;
    if (!payload) {
      wx.showToast({ title: "缺少合并结果", icon: "none" });
      return;
    }
    if (storageKey) wx.removeStorageSync(`${STORAGE_PREFIX}${storageKey}`);
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    this.setData({
      payload,
      movedRows: buildMovedRows(payload && payload.movedCounts),
      mappings: normalizeMappings(payload && payload.cycleMappings),
      canGoBack: pages.length > 1
    });
  },
  onToggleMappings() {
    this.setData({ mappingsOpen: !this.data.mappingsOpen });
  },
  onOpenTargetGym() {
    const payload = this.data.payload || {};
    const targetGymId = safeText(payload.targetGymId);
    if (!targetGymId) {
      wx.showToast({ title: "目标岩馆不存在", icon: "none" });
      return;
    }
    wx.redirectTo({ url: `/pages/gym-manage/index?gymId=${targetGymId}` });
  },
  onBack() {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.redirectTo({ url: "/pages/owner/index" });
    }
  }
});
