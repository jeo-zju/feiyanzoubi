const { summary } = require("../../services/api/stats");
const { startPageLoad, finishPageLoad, turnToPrevPage, turnToNextPage } = require("../../utils/pageState");

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
    this.load({ reset: true });
  },
  onPrev() {
    turnToPrevPage(this, this.load);
  },
  onNext() {
    turnToNextPage(this, this.load);
  },
  async load({ reset }) {
    const paging = startPageLoad(this, reset);
    if (!paging) return;
    const { page, pageSize } = paging;
    try {
      const res = await summary({
        days: 30,
        page,
        pageSize
      });
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
      const hasNext = !!(res && res.hasNext);
      this.setData({ chartPoints, summaryText, recent, hasNext });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      finishPageLoad(this);
    }
  }
});

