const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

const MODE_OPTIONS = [
  { key: "boulder", label: "抱石" },
  { key: "difficulty", label: "难度" },
  { key: "lead", label: "先锋" }
];

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = String(item || "").trim().toLowerCase();
    if (!mode || !MODE_OPTIONS.some((option) => option.key === mode) || seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

function modeText(list) {
  return uniqueModes(list)
    .map((mode) => MODE_OPTIONS.find((option) => option.key === mode))
    .filter(Boolean)
    .map((option) => option.label)
    .join(" / ");
}

function decorateItem(item) {
  const next = { ...(item || {}) };
  next.reviewType = String(next.reviewType || "gym_mode_review");
  next.isCycleSubmission = next.reviewType === "gym_cycle_submission";
  next.supportedModes = uniqueModes(next.supportedModes);
  next.finalSupportedModes = uniqueModes(next.finalSupportedModes);
  next.draftModes = uniqueModes(next.finalSupportedModes.length ? next.finalSupportedModes : next.supportedModes);
  next.supportedModesText = modeText(next.supportedModes);
  next.finalSupportedModesText = modeText(next.finalSupportedModes);
  next.modeConfidenceText = next.modeConfidence ? `${Math.round(Number(next.modeConfidence || 0) * 100)}%` : "-";
  next.noteDraft = next.reviewNote || "";
  return next;
}

Page({
  data: {
    items: [],
    page: 1,
    pageSize: 20,
    hasNext: false,
    loading: false,
    keyword: "",
    state: "pending",
    stateTabs: [
      { key: "pending", label: "待审核" },
      { key: "all", label: "全部" },
      { key: "approved", label: "已通过" },
      { key: "rejected", label: "已驳回" }
    ],
    modeOptions: MODE_OPTIONS
  },
  async onShow() {
    const user = await ensureAdminPageAccess();
    if (!user) return;
    this.loadList({ reset: true });
  },
  onStateChange(e) {
    const state = e && e.detail ? e.detail.value : "pending";
    this.setData({ state }, () => this.loadList({ reset: true }));
  },
  onKeywordInput(e) {
    this.setData({ keyword: e && e.detail ? e.detail.value : "" });
  },
  onSearch() {
    this.loadList({ reset: true });
  },
  async loadList({ reset } = {}) {
    if (this.data.loading) return;
    const page = reset ? 1 : Number(this.data.page || 1);
    this.setData({ loading: true });
    try {
      const res = await backstageApi.listReviewQueue({
        page,
        pageSize: this.data.pageSize,
        state: this.data.state,
        keyword: this.data.keyword
      });
      const rows = Array.isArray(res && res.items) ? res.items.map(decorateItem) : [];
      this.setData({
        items: reset ? rows : (this.data.items || []).concat(rows),
        page: Number(res && res.page) || page,
        hasNext: !!(res && res.hasNext)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onMore() {
    if (!this.data.hasNext) return;
    this.setData({ page: Number(this.data.page || 1) + 1 }, () => this.loadList({ reset: false }));
  },
  onToggleMode(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const mode = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.mode : "";
    if (!id || !mode) return;
    const items = (this.data.items || []).map((item) => {
      if (String(item._id) !== String(id)) return item;
      const current = uniqueModes(item.draftModes);
      const has = current.includes(mode);
      const nextModes = has ? current.filter((entry) => entry !== mode) : current.concat(mode);
      return { ...item, draftModes: uniqueModes(nextModes) };
    });
    this.setData({ items });
  },
  onNoteInput(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const value = e && e.detail ? e.detail.value : "";
    const items = (this.data.items || []).map((item) =>
      String(item._id) === String(id)
        ? {
            ...item,
            noteDraft: value
          }
        : item
    );
    this.setData({ items });
  },
  async onApprove(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const item = (this.data.items || []).find((entry) => String(entry._id) === String(id));
    if (!item) return;
    if (item.isCycleSubmission) {
      try {
        await backstageApi.reviewQueueItem({
          id,
          decision: "approved",
          note: item.noteDraft || ""
        });
        wx.showToast({ title: "已通过", icon: "success" });
        this.loadList({ reset: true });
      } catch (e) {
        wx.showToast({ title: (e && e.message) || "提交失败", icon: "none" });
      }
      return;
    }
    const modes = uniqueModes(item.draftModes);
    if (!modes.length) {
      wx.showToast({ title: "请至少选择一种模式", icon: "none" });
      return;
    }
    try {
      await backstageApi.reviewQueueItem({
        id,
        decision: "approved",
        supportedModes: modes,
        note: item.noteDraft || ""
      });
      wx.showToast({ title: "已通过", icon: "success" });
      this.loadList({ reset: true });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "提交失败", icon: "none" });
    }
  },
  async onReject(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    if (!id) return;
    const current = (this.data.items || []).find((entry) => String(entry._id) === String(id));
    try {
      await backstageApi.reviewQueueItem({
        id,
        decision: "rejected",
        note: (current && current.noteDraft) || ""
      });
      wx.showToast({ title: "已驳回", icon: "success" });
      this.loadList({ reset: true });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "提交失败", icon: "none" });
    }
  }
});
