const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

const MODE_OPTIONS = [
  { key: "boulder", label: "抱石" },
  { key: "difficulty", label: "难度" },
  { key: "lead", label: "先锋" }
];

function pretty(value) {
  try {
    return JSON.stringify(value == null ? null : value, null, 2);
  } catch (e) {
    return String(value == null ? "" : value);
  }
}

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

function makeDraft(queue) {
  const item = queue || {};
  const state = item.reviewState || "pending";
  const modes = uniqueModes(item.finalSupportedModes && item.finalSupportedModes.length ? item.finalSupportedModes : item.supportedModes);
  return {
    reviewState: state,
    reviewReason: item.reviewReason || "",
    reviewNote: item.reviewNote || "",
    finalSupportedModes: modes
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    error: "",
    query: "",
    searched: false,
    found: false,
    queue: null,
    gym: null,
    sourceRecords: [],
    rawQueueText: "",
    rawGymText: "",
    draft: makeDraft(null),
    stateTabs: [
      { key: "pending", label: "待审核" },
      { key: "approved", label: "已通过" },
      { key: "rejected", label: "已驳回" }
    ],
    modeOptions: MODE_OPTIONS
  },
  async onShow() {
    await ensureAdminPageAccess();
  },
  onQueryInput(e) {
    this.setData({ query: e && e.detail ? e.detail.value : "" });
  },
  applyDetail(res) {
    const queue = (res && res.queue) || null;
    this.setData({
      found: !!(res && res.found),
      queue,
      gym: (res && res.gym) || null,
      sourceRecords: Array.isArray(res && res.sourceRecords) ? res.sourceRecords : [],
      rawQueueText: pretty(res && res.rawQueue),
      rawGymText: pretty(res && res.rawGym),
      draft: makeDraft(queue),
      error: ""
    });
  },
  async onSearch() {
    const query = String(this.data.query || "").trim();
    if (!query) {
      wx.showToast({ title: "请输入审核记录 ID", icon: "none" });
      return;
    }
    this.setData({ loading: true, error: "", searched: true });
    try {
      const res = await backstageApi.getReviewDetail({ reviewId: query });
      this.applyDetail(res);
    } catch (e) {
      const error = (e && e.message) || "查询失败";
      this.setData({
        error,
        found: false,
        queue: null,
        gym: null,
        sourceRecords: [],
        rawQueueText: "",
        rawGymText: "",
        draft: makeDraft(null)
      });
      wx.showToast({ title: error, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onStateChange(e) {
    const reviewState = e && e.detail ? e.detail.value : "pending";
    this.setData({
      draft: {
        ...(this.data.draft || {}),
        reviewState
      }
    });
  },
  onDraftInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : "";
    if (!key) return;
    this.setData({
      draft: {
        ...(this.data.draft || {}),
        [key]: e && e.detail ? e.detail.value : ""
      }
    });
  },
  onToggleMode(e) {
    const mode = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.mode : "";
    if (!mode) return;
    const current = uniqueModes((this.data.draft && this.data.draft.finalSupportedModes) || []);
    const has = current.includes(mode);
    const next = has ? current.filter((item) => item !== mode) : current.concat(mode);
    this.setData({
      draft: {
        ...(this.data.draft || {}),
        finalSupportedModes: uniqueModes(next)
      }
    });
  },
  async onSave() {
    const queue = this.data.queue;
    if (!queue || !queue._id) return;

    const draft = this.data.draft || {};
    this.setData({ saving: true });
    try {
      await backstageApi.updateReviewDetail({
        reviewId: queue._id,
        reviewState: draft.reviewState || "pending",
        reviewReason: draft.reviewReason || "",
        reviewNote: draft.reviewNote || "",
        finalSupportedModes: draft.finalSupportedModes || []
      });
      const res = await backstageApi.getReviewDetail({ reviewId: queue._id }, { loading: false });
      this.applyDetail(res);
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  onCopyQueue() {
    if (!this.data.rawQueueText) {
      wx.showToast({ title: "暂无队列数据", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.rawQueueText });
  },
  onCopyGym() {
    if (!this.data.rawGymText) {
      wx.showToast({ title: "暂无岩馆数据", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.rawGymText });
  }
});
