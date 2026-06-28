const { list } = require("../../services/api/gym");
const { formatDate, monthLabel } = require("../../utils/date");
const { safeText } = require("../../utils/format");
const { buildCacheKey, readCache, writeCache } = require("../../utils/pageCache");
const { startPageLoad, finishPageLoad, turnToPrevPage, turnToNextPage } = require("../../utils/pageState");

const HOME_CACHE_MAX_AGE = 5 * 60 * 1000;
const MODE_LABELS = {
  boulder: "抱石",
  difficulty: "难度",
  lead: "先锋"
};

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = safeText(item).toLowerCase();
    if (!mode || !MODE_LABELS[mode] || seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

Page({
  data: {
    city: "",
    keyword: "",
    mode: "",
    modeTabs: [
      { key: "", label: "全部" },
      { key: "boulder", label: "抱石" },
      { key: "difficulty", label: "难度" },
      { key: "lead", label: "先锋" }
    ],
    page: 1,
    pageSize: 5,
    gyms: [],
    hasNext: false,
    loading: false
  },
  onShow() {
    const next = {};
    try {
      const city = wx.getStorageSync("home_city");
      const keyword = wx.getStorageSync("home_keyword");
      const mode = wx.getStorageSync("home_mode");
      if (city != null) next.city = String(city || "");
      if (keyword != null) next.keyword = String(keyword || "");
      if (mode != null) next.mode = String(mode || "");
    } catch (e) {}
    const run = () => {
      const hasCache = this.applyGymsCache({ reset: true });
      this.loadGyms({ reset: true, silent: hasCache, hasCache });
    };
    if (Object.keys(next).length) this.setData(next, run);
    else run();
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
  onModeChange(e) {
    const mode = e && e.detail ? String(e.detail.value || "") : "";
    this.setData({ mode }, () => this.loadGyms({ reset: true }));
    try {
      wx.setStorageSync("home_mode", mode);
    } catch (e2) {}
  },
  onPrev() {
    turnToPrevPage(this, this.loadGyms);
  },
  onNext() {
    turnToNextPage(this, this.loadGyms);
  },
  onTapGym(e) {
    const gym = e.detail.gym;
    if (!gym || !gym._id) return;
    wx.navigateTo({ url: `/pages/checkin/index?gymId=${gym._id}` });
  },
  getGymsCacheKey(page, pageSize) {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    return buildCacheKey("home_gyms", {
      openid: safeText(user.openid),
      city: safeText(this.data.city),
      keyword: safeText(this.data.keyword),
      page,
      pageSize
    });
  },
  applyGymsCache({ reset }) {
    const page = reset ? 1 : Number(this.data.page || 1);
    const pageSize = Number(this.data.pageSize || 5);
    const cached = readCache(this.getGymsCacheKey(page, pageSize), { maxAge: HOME_CACHE_MAX_AGE });
    if (!cached || !cached.data) return false;
    const gyms = Array.isArray(cached.data.gyms) ? cached.data.gyms : [];
    this.setData({
      page,
      gyms,
      hasNext: !!cached.data.hasNext
    });
    return true;
  },
  async loadGyms({ reset, silent, hasCache }) {
    const paging = startPageLoad(this, reset);
    if (!paging) return;
    const { page, pageSize } = paging;
    try {
      const city = safeText(this.data.city);
      const keyword = safeText(this.data.keyword);
      const res = await list(
        { city, keyword, mode: safeText(this.data.mode), page, pageSize },
        { loading: !silent }
      );
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
      const nextState = { gyms, hasNext: !!(res && res.hasNext) };
      this.setData(nextState);
      writeCache(this.getGymsCacheKey(page, pageSize), nextState);
    } catch (e) {
      if (!hasCache) wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      finishPageLoad(this);
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
    if (g.lines && typeof g.lines.lead === "number") g.leadLabel = `${g.lines.lead}`;
    g.supportedModes = uniqueModes(g.supportedModes);
    g.supportedModeLabels = g.supportedModes.map((mode) => MODE_LABELS[mode]);
    return g;
  }
});

