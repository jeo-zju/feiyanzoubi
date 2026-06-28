const { summary } = require("../../services/api/stats");
const { safeText } = require("../../utils/format");
const { buildCacheKey, readCache, writeCache } = require("../../utils/pageCache");
const { startPageLoad, finishPageLoad, turnToPrevPage, turnToNextPage } = require("../../utils/pageState");

const STATS_DAYS = 30;
const STATS_CACHE_MAX_AGE = 3 * 60 * 1000;

Page({
  data: {
    chartPoints: [],
    summaryText: "",
    recent: [],
    page: 1,
    pageSize: 5,
    hasNext: false,
    loading: false
  },
  onShow() {
    const hasCache = this.applySummaryCache({ reset: true });
    this.load({ reset: true, silent: hasCache, hasCache });
  },
  onPrev() {
    turnToPrevPage(this, this.load);
  },
  onNext() {
    turnToNextPage(this, this.load);
  },
  getSummaryCacheKey(page, pageSize) {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    return buildCacheKey("stats_summary", {
      openid: safeText(user.openid),
      days: STATS_DAYS,
      page,
      pageSize
    });
  },
  normalizeSummaryResponse(res) {
    const chartPoints = Array.isArray(res && res.chartPoints)
      ? res.chartPoints.map((p) => {
          const v = p && typeof p === "object" && p.value != null ? p.value : p;
          const n = Number(v || 0);
          return Number.isFinite(n) ? n : 0;
        })
      : [];
    const summaryText = (res && res.summaryText) || "";
    const recent = ((res && res.recent) || []).map((r) => ({
      id: r._id || `${r.date}_${r.gymId}_${r.mode}`,
      gymName: r.gymName || "",
      date: r.date || "",
      delta: r.delta || 0,
      modeText: r.mode === "boulder" ? "抱石" : "难度"
    }));
    return {
      chartPoints,
      summaryText,
      recent,
      hasNext: !!(res && res.hasNext)
    };
  },
  applySummaryCache({ reset }) {
    const page = reset ? 1 : Number(this.data.page || 1);
    const pageSize = Number(this.data.pageSize || 5);
    const cached = readCache(this.getSummaryCacheKey(page, pageSize), { maxAge: STATS_CACHE_MAX_AGE });
    if (!cached || !cached.data) return false;
    this.setData({
      page,
      chartPoints: Array.isArray(cached.data.chartPoints) ? cached.data.chartPoints : [],
      summaryText: cached.data.summaryText || "",
      recent: Array.isArray(cached.data.recent) ? cached.data.recent : [],
      hasNext: !!cached.data.hasNext
    });
    return true;
  },
  async load({ reset, silent, hasCache }) {
    const paging = startPageLoad(this, reset);
    if (!paging) return;
    const { page, pageSize } = paging;
    try {
      const res = await summary(
        {
          days: STATS_DAYS,
          page,
          pageSize
        },
        { loading: !silent }
      );
      const nextState = this.normalizeSummaryResponse(res);
      this.setData(nextState);
      writeCache(this.getSummaryCacheKey(page, pageSize), nextState);
    } catch (e) {
      if (!hasCache) wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      finishPageLoad(this);
    }
  }
});

