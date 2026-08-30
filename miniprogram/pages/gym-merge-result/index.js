const { get } = require("../../services/api/gym");
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

function buildMovedSummary(movedCounts) {
  const info = movedCounts || {};
  return [
    `周期 ${Number(info.cycles || 0)} 个`,
    `映射周期 ${Number(info.mappedCycles || 0)} 个`,
    `打卡 ${Number(info.checkins || 0)} 条`,
    `日进度 ${Number(info.dailyProgress || 0)} 条`,
    `周期进度 ${Number(info.cycleProgress || 0)} 条`,
    `评分 ${Number(info.hardnessRatings || 0)} 条`,
    `上墙 ${Number(info.wallCards || 0)} 条`,
    `评论 ${Number(info.comments || 0)} 条`
  ].join("，");
}

function buildMappingSummaryText(mappings) {
  const list = Array.isArray(mappings) ? mappings : [];
  if (!list.length) return "本次没有手动周期映射。";
  return list
    .map((item) => `${safeText(item.sourceCycleName) || "未命名源周期"} -> ${safeText(item.targetCycleName) || "未命名目标周期"}`)
    .join("\n");
}

function formatDateTime(ts) {
  const value = Number(ts || 0) || 0;
  if (!value) return "";
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function normalizeMergeHistory(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.sourceGymId)
    .map((item) => ({
      sourceGymId: safeText(item.sourceGymId),
      sourceGymName: safeText(item.sourceGymName) || "未命名岩馆",
      mergedAtText: formatDateTime(item.mergedAt),
      cycleMappingCount: Number(item.cycleMappingCount || 0) || 0,
      mappedCycleCount: Number(item.mappedCycleCount || 0) || 0
    }));
}

function buildModesText(modes) {
  const labels = {
    boulder: "抱石",
    difficulty: "难度",
    lead: "先锋"
  };
  const out = (Array.isArray(modes) ? modes : [])
    .map((item) => labels[safeText(item).toLowerCase()] || safeText(item))
    .filter(Boolean);
  return out.length ? out.join(" / ") : "未设置";
}

function getCurrentCycleText(gym) {
  const current = gym && (gym.currentCycle || gym.cycle);
  if (!current) return "暂无当前周期";
  const name = safeText(current.name || current.cycle_name) || "未命名周期";
  const start = safeText(current.startDate || current.start_date);
  const end = safeText(current.endDate || current.end_date) || "至今";
  return start ? `${name}（${start} ~ ${end}）` : name;
}

Page({
  data: {
    payload: null,
    targetGym: null,
    movedSummaryText: "",
    mappingSummaryText: "",
    modesText: "未设置",
    currentCycleText: "暂无当前周期",
    mergeHistory: [],
    loading: false
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
    this.setData({
      payload,
      movedSummaryText: buildMovedSummary(payload && payload.movedCounts),
      mappingSummaryText: buildMappingSummaryText(payload && payload.cycleMappings),
      mergeHistory: normalizeMergeHistory(payload && payload.mergeHistory)
    });
    await this.loadTargetGym();
  },
  async loadTargetGym() {
    const payload = this.data.payload || {};
    const targetGymId = safeText(payload.targetGymId);
    if (!targetGymId) return;
    this.setData({ loading: true });
    try {
      const res = await get({ gymId: targetGymId });
      const gym = (res && res.gym) || null;
      this.setData({
        targetGym: gym,
        modesText: buildModesText(gym && gym.supportedModes),
        currentCycleText: getCurrentCycleText(gym)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "加载目标馆失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onOpenTargetGym() {
    const payload = this.data.payload || {};
    const targetGymId = safeText(payload.targetGymId);
    if (!targetGymId) return;
    wx.redirectTo({ url: `/pages/gym-manage/index?gymId=${targetGymId}` });
  },
  onBackOwner() {
    wx.redirectTo({ url: "/pages/owner/index" });
  },
  onMergeAgain() {
    const payload = this.data.payload || {};
    const targetGymId = safeText(payload.targetGymId);
    if (!targetGymId) return;
    wx.redirectTo({ url: `/pages/gym-merge/index?sourceGymId=${targetGymId}` });
  }
});
