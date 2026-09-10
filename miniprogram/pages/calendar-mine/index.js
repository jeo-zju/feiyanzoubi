const { callCloud } = require("../../services/cloud");
const { ensureAppLogin } = require("../../utils/session");
const { decorate } = require("../../utils/plan");

Page({
  data: {
    tab: "upcoming",
    tabs: [
      { key: "upcoming", label: "即将参加" },
      { key: "host", label: "我发起的" },
      { key: "past", label: "已结束" }
    ],
    list: [],
    loading: false,
    error: "",
    cursor: "",
    hasMore: false
  },

  onShow() {
    this.load(true);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.load(false);
  },

  async onPullDownRefresh() {
    try {
      await this.load(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  pickTab(e) {
    this.setData({ tab: e.detail.value });
    this.load(true);
  },

  // 当前用户在本条约爬中的状态：取消不伪装成结束，待确认单独标出
  resolveStatus(p, tab) {
    if (p.status === "cancelled") return { statusKey: "cancelled", statusText: "已取消" };
    if (p.myStatus === "host") return { statusKey: "host", statusText: "我发起的" };
    if (p.myStatus === "pending") return { statusKey: "pending", statusText: "等待确认" };
    if (p.myStatus === "none") return { statusKey: "none", statusText: "" };
    if (tab === "past") return { statusKey: "ended", statusText: "已结束" };
    return { statusKey: "joined", statusText: "已确认参加" };
  },

  async load(reset) {
    if (!reset && this.data.loading) return;
    const token = (this._token = (this._token || 0) + 1);
    const cursor = reset ? "" : this.data.cursor;
    this.setData({
      loading: true,
      error: "",
      ...(reset ? { list: [], cursor: "", hasMore: false } : {})
    });
    try {
      await ensureAppLogin();
      const tab = this.data.tab;
      const r = await callCloud("calendar_plan_publish", { action: "mine_list", tab, cursor }, { silent: true });
      if (token !== this._token) return;
      const mapped = (r.list || []).map((p, idx) => {
        const s = this.resolveStatus(p, tab);
        return {
          ...decorate(p),
          ...s,
          // 即将参加列表第一条已确认活动轻强调（不复制成“下一场”面板）
          isNext: tab === "upcoming" && idx === 0 && s.statusKey === "joined"
        };
      });
      this.setData({
        list: (reset ? [] : this.data.list).concat(mapped),
        cursor: r.cursor || "",
        hasMore: !!r.hasMore
      });
    } catch (_) {
      if (token === this._token) this.setData({ error: "约爬加载失败，请重试" });
    } finally {
      if (token === this._token) this.setData({ loading: false });
    }
  },

  retry() {
    this.load(!this.data.list.length);
  },

  open(e) {
    wx.navigateTo({
      url: "/pages/plan-detail/index?planId=" + encodeURIComponent(e.currentTarget.dataset.id)
    });
  },

  discover() {
    wx.switchTab({ url: "/pages/home/index" });
  }
});
