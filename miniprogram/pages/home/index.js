const { list } = require("../../services/api/gym");
const { formatDate, monthLabel } = require("../../utils/date");
const { safeText } = require("../../utils/format");

Page({
  data: {
    city: "",
    keyword: "",
    page: 1,
    pageSize: 5,
    gyms: [],
    hasNext: false,
    loading: false
  },
  onShow() {
    try {
      const city = wx.getStorageSync("home_city");
      const keyword = wx.getStorageSync("home_keyword");
      const next = {};
      if (city != null) next.city = String(city || "");
      if (keyword != null) next.keyword = String(keyword || "");
      if (Object.keys(next).length) this.setData(next);
    } catch (e) {}
    this.loadGyms({ reset: true });
  },
  onCityInput(e) {
    const city = e.detail.value;
    this.setData({ city });
    try {
      wx.setStorageSync("home_city", city);
    } catch (e2) {}
  },
  onKeywordInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    try {
      wx.setStorageSync("home_keyword", keyword);
    } catch (e2) {}
  },
  onSearch() {
    this.loadGyms({ reset: true });
  },
  onPrev() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.loadGyms({ reset: false });
  },
  onNext() {
    if (!this.data.hasNext) return;
    this.setData({ page: this.data.page + 1 });
    this.loadGyms({ reset: false });
  },
  onTapGym(e) {
    const gym = e.detail.gym;
    if (!gym || !gym._id) return;
    wx.navigateTo({ url: `/pages/checkin/index?gymId=${gym._id}` });
  },
  async loadGyms({ reset }) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    const pageSize = this.data.pageSize;

    this.setData({ loading: true, page });
    try {
      const city = safeText(this.data.city);
      const keyword = safeText(this.data.keyword);
      const res = await list({ city, keyword, page, pageSize });
      let gyms = ((res && res.gyms) || []).map((g) => this.decorateGym(g));
      try {
        const lastGymId = wx.getStorageSync("lastGymId");
        const id = lastGymId ? String(lastGymId) : "";
        if (id) {
          const idx = gyms.findIndex((g) => g && String(g._id) === id);
          if (idx > 0) {
            const head = gyms[idx];
            gyms = [head].concat(gyms.slice(0, idx), gyms.slice(idx + 1));
          }
        }
      } catch (e2) {}
      this.setData({ gyms, hasNext: !!(res && res.hasNext) });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  decorateGym(gym) {
    const g = { ...(gym || {}) };
    const cycle = g.currentCycle || g.cycle || null;
    if (cycle && cycle.name) g.cycleLabel = `周期 ${cycle.name}`;
    if (cycle && cycle.startDate) g.cycleLabel = `周期 ${monthLabel(cycle.startDate)}`;
    const last = g.userLastCheckinAt || g.lastCheckinAt || "";
    const visits = typeof g.userVisitCount === "number" ? g.userVisitCount : typeof g.visitCount === "number" ? g.visitCount : null;
    if (last) g.lastVisitLabel = `上次 ${formatDate(last)}`;
    if (visits != null) g.visitLabel = `来访 ${visits} 次`;
    if (g.lines && typeof g.lines.boulder === "number") g.boulderLabel = `${g.lines.boulder}`;
    if (g.lines && typeof g.lines.difficulty === "number") g.diffLabel = `${g.lines.difficulty}`;
    return g;
  }
});

