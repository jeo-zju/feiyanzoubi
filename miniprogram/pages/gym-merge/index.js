const { get, ownerList } = require("../../services/api/gym");
const { manageGym } = require("../../services/api/gymOwner");
const { ensureAdminPageAccess } = require("../../utils/session");
const { safeText } = require("../../utils/format");

const MERGE_RESULT_STORAGE_PREFIX = "gym_merge_result_";

function buildMergeSummary(summary) {
  const info = summary || {};
  return [
    `周期 ${Number(info.cycleCount || 0)} 个`,
    `打卡 ${Number(info.checkinCount || 0)} 条`,
    `评分 ${Number(info.hardnessRatingCount || 0)} 条`,
    `上墙 ${Number(info.wallCardCount || 0)} 条`,
    `评论 ${Number(info.commentCount || 0)} 条`
  ].join("，");
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

function formatCycleRange(start, end) {
  const left = safeText(start);
  const right = safeText(end) || "至今";
  if (!left) return "";
  return `${left} ~ ${right}`;
}

function buildCycleText(cycle) {
  const name = safeText(cycle && (cycle.name || cycle.sourceCycleName || cycle.targetCycleName)) || "未命名周期";
  const sourceRange = safeText(cycle && cycle.sourceRange);
  const targetRange = safeText(cycle && cycle.targetRange);
  const range = sourceRange || targetRange || formatCycleRange(cycle && cycle.start, cycle && cycle.end);
  return range ? `${name}（${range}）` : name;
}

function buildInitialMappings(preview) {
  const groups = (((preview || {}).cyclePlan || {}).conflictGroups || []).filter((item) => item && item.sourceCycleId);
  return groups.map((group) => {
    const options = (group.targetOptions || [])
      .filter((item) => item && item.targetCycleId)
      .map((item) => ({
        ...item,
        label: buildCycleText({ targetCycleName: item.targetCycleName, targetRange: item.targetRange })
      }));
    const preset = options.length === 1 ? options[0] : null;
    return {
      sourceCycleId: safeText(group.sourceCycleId),
      sourceCycleName: safeText(group.sourceCycleName),
      sourceRange: safeText(group.sourceRange),
      targetOptions: options,
      targetCycleId: preset ? safeText(preset.targetCycleId) : "",
      targetCycleName: preset ? safeText(preset.targetCycleName) : "",
      targetRange: preset ? safeText(preset.targetRange) : ""
    };
  });
}

function computeCanSubmit(preview, cycleMappings) {
  if (!preview) return false;
  if (preview.canMerge) return true;
  const groups = (((preview || {}).cyclePlan || {}).conflictGroups || []).filter((item) => item && item.sourceCycleId);
  if (!groups.length) return false;
  const selected = (cycleMappings || []).filter((item) => item && safeText(item.targetCycleId)).length;
  return selected === groups.length;
}

function includesKeyword(gym, keyword) {
  const text = safeText(keyword).toLowerCase();
  if (!text) return true;
  const fields = [
    safeText(gym && gym.name),
    safeText(gym && gym.city),
    safeText(gym && gym.address)
  ]
    .join(" ")
    .toLowerCase();
  return fields.includes(text);
}

function buildFilteredTargetGyms(targetGyms, keyword) {
  return (Array.isArray(targetGyms) ? targetGyms : []).filter((item) => includesKeyword(item, keyword));
}

Page({
  data: {
    sourceGymId: "",
    sourceGym: null,
    targetGyms: [],
    filteredTargetGyms: [],
    targetKeyword: "",
    targetGymId: "",
    targetGym: null,
    targetSheetVisible: false,
    preview: null,
    cycleMappings: [],
    mappingSummaryText: "尚未选择周期映射",
    canSubmit: false,
    loading: false,
    loadingPreview: false,
    submitting: false
  },
  async onLoad(query) {
    const user = await ensureAdminPageAccess();
    if (!user) return;
    const sourceGymId = query && query.sourceGymId ? String(query.sourceGymId) : "";
    if (!sourceGymId) {
      wx.showToast({ title: "缺少源岩馆", icon: "none" });
      return;
    }
    this.setData({ sourceGymId });
    await Promise.all([this.loadSourceGym(), this.loadTargetGyms()]);
  },
  redirectToGym(targetGymId, targetGymName, options = {}) {
    const id = safeText(targetGymId);
    if (!id) {
      wx.showToast({ title: options.fallbackTitle || "目标岩馆不存在", icon: "none" });
      return;
    }
    const title = options.silent ? "" : `已跳转到${safeText(targetGymName) || "目标岩馆"}`;
    if (title) wx.showToast({ title, icon: "none" });
    wx.redirectTo({ url: `/pages/gym-manage/index?gymId=${id}` });
  },
  async loadSourceGym() {
    try {
      const res = await get({ gymId: this.data.sourceGymId });
      const gym = (res && res.gym) || null;
      this.setData({ sourceGym: gym });
    } catch (e) {
      if (e && e.code === "GYM_MERGED") {
        try {
          const redirect = await manageGym({ action: "resolve_redirect", gymId: this.data.sourceGymId });
          this.redirectToGym(
            (redirect && redirect.targetGymId) || e.targetGymId,
            (redirect && redirect.targetGymName) || e.targetGymName,
            { fallbackTitle: "该岩馆已合并" }
          );
          return;
        } catch (e2) {}
      }
      wx.showToast({ title: (e && e.message) || "加载源岩馆失败", icon: "none" });
    }
  },
  async loadTargetGyms() {
    this.setData({ loading: true });
    try {
      const items = [];
      for (let page = 1; page <= 10; page++) {
        const res = await ownerList({ page, pageSize: 50 }, { loading: false });
        const part = (res && res.gyms) || [];
        if (part.length) items.push(...part);
        if (!(res && res.hasNext)) break;
      }
      const sourceGymId = String(this.data.sourceGymId || "");
      const unique = [];
      const seen = {};
      items.forEach((item) => {
        const id = item && item._id ? String(item._id) : "";
        if (!id || id === sourceGymId || seen[id]) return;
        seen[id] = true;
        unique.push(item);
      });
      this.setData({
        targetGyms: unique,
        filteredTargetGyms: buildFilteredTargetGyms(unique, this.data.targetKeyword)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "加载目标岩馆失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onTargetKeyword(e) {
    const keyword = safeText(e && e.detail && e.detail.value);
    this.setData({
      targetKeyword: keyword,
      filteredTargetGyms: buildFilteredTargetGyms(this.data.targetGyms, keyword)
    });
  },
  onOpenTargetSheet() {
    this.setData({ targetSheetVisible: true });
  },
  onCloseTargetSheet() {
    this.setData({ targetSheetVisible: false });
  },
  noop() {},
  onPickTarget(e) {
    const gymId = e && e.currentTarget && e.currentTarget.dataset ? String(e.currentTarget.dataset.id || "") : "";
    if (!gymId) return;
    const targetGym = (this.data.targetGyms || []).find((item) => item && String(item._id) === gymId) || null;
    this.setData({
      targetGymId: gymId,
      targetGym,
      targetSheetVisible: false,
      preview: null,
      cycleMappings: [],
      mappingSummaryText: "尚未选择周期映射",
      canSubmit: false
    });
  },
  async onPreviewMerge() {
    if (!this.data.sourceGymId) return;
    if (!this.data.targetGymId) {
      wx.showToast({ title: "请先选择目标岩馆", icon: "none" });
      return;
    }
    this.setData({ loadingPreview: true });
    try {
      const rawPreview = await manageGym({
        action: "preview_merge",
        sourceGymId: this.data.sourceGymId,
        targetGymId: this.data.targetGymId
      });
      const preview = {
        ...rawPreview,
        summary: {
          ...(rawPreview && rawPreview.summary ? rawPreview.summary : {}),
          sourceText: buildMergeSummary(rawPreview && rawPreview.summary && rawPreview.summary.source),
          targetText: buildMergeSummary(rawPreview && rawPreview.summary && rawPreview.summary.target)
        }
      };
      const cycleMappings = buildInitialMappings(preview);
      this.setData({
        preview,
        cycleMappings,
        mappingSummaryText: this.buildMappingSummaryText(cycleMappings),
        canSubmit: computeCanSubmit(preview, cycleMappings)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "合并预检查失败", icon: "none" });
    } finally {
      this.setData({ loadingPreview: false });
    }
  },
  onPickCycleMapping(e) {
    const index = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.index) : -1;
    const picked = e && e.detail && typeof e.detail.value === "number" ? e.detail.value : -1;
    const current = (this.data.cycleMappings || [])[index];
    if (!current) return;
    const options = (current.targetOptions || []).filter((item) => item && item.targetCycleId);
    if (!options.length) {
      wx.showToast({ title: "没有可选目标周期", icon: "none" });
      return;
    }
    if (picked < 0 || !options[picked]) return;
    const selected = options[picked];
    const next = (this.data.cycleMappings || []).slice();
    next[index] = {
      ...current,
      targetCycleId: safeText(selected.targetCycleId),
      targetCycleName: safeText(selected.targetCycleName),
      targetRange: safeText(selected.targetRange)
    };
    this.setData({
      cycleMappings: next,
      mappingSummaryText: this.buildMappingSummaryText(next),
      canSubmit: computeCanSubmit(this.data.preview, next)
    });
  },
  buildSelectedMappings() {
    return (this.data.cycleMappings || [])
      .filter((item) => item && item.sourceCycleId)
      .filter((item) => safeText(item.targetCycleId))
      .map((item) => ({
        sourceCycleId: safeText(item.sourceCycleId),
        targetCycleId: safeText(item.targetCycleId),
        sourceCycleName: safeText(item.sourceCycleName),
        targetCycleName: safeText(item.targetCycleName)
      }));
  },
  buildMappingSummaryText(cycleMappings) {
    const list = (Array.isArray(cycleMappings) ? cycleMappings : this.data.cycleMappings || [])
      .filter((item) => item && item.sourceCycleId)
      .filter((item) => safeText(item.targetCycleId))
      .map((item) => ({
        sourceCycleName: safeText(item.sourceCycleName),
        targetCycleName: safeText(item.targetCycleName)
      }));
    if (!list.length) return "尚未选择周期映射";
    return list.map((item) => `${safeText(item.sourceCycleName)} -> ${safeText(item.targetCycleName)}`).join("\n");
  },
  async onSubmitMerge() {
    if (!this.data.canSubmit || !this.data.targetGymId) {
      wx.showToast({ title: "请先完成预检查和周期映射", icon: "none" });
      return;
    }
    const preview = this.data.preview || {};
    const targetGym = this.data.targetGym || {};
    const sourceGym = this.data.sourceGym || {};
    const sourceName = safeText(sourceGym && (sourceGym.name || sourceGym.gymName || sourceGym.title));
    const mappings = this.buildSelectedMappings();
    const mappingText = mappings.length
      ? `\n周期映射：\n${mappings.map((item) => `${safeText(item.sourceCycleName)} -> ${safeText(item.targetCycleName)}`).join("\n")}`
      : "";
    const content =
      `源岩馆：${sourceName}\n目标岩馆：${safeText(targetGym.name)}\n` +
      `源数据：${buildMergeSummary(preview && preview.summary && preview.summary.source)}\n` +
      `目标数据：${buildMergeSummary(preview && preview.summary && preview.summary.target)}${mappingText}`;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "确认合并",
        content,
        confirmText: "开始合并",
        success: (res) => resolve(!!(res && res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;

    this.setData({ submitting: true });
    try {
      const result = await manageGym({
        action: "apply_merge",
        sourceGymId: this.data.sourceGymId,
        targetGymId: this.data.targetGymId,
        confirmName: sourceName,
        cycleMappings: mappings
      });
      const storageKey = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      wx.setStorageSync(`${MERGE_RESULT_STORAGE_PREFIX}${storageKey}`, {
        sourceGymId: this.data.sourceGymId,
        sourceGymName: sourceName,
        targetGymId: this.data.targetGymId,
        targetGymName: safeText(targetGym.name),
        movedCounts: (result && result.movedCounts) || {},
        cycleMappings: mappings,
        movedSummaryText: buildMovedSummary((result && result.movedCounts) || {})
      });
      wx.redirectTo({ url: `/pages/gym-merge-result/index?storageKey=${storageKey}` });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "合并失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
