const { ownerList } = require("../../services/api/gym");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const { buildCacheKey, readCache, writeCache } = require("../../utils/pageCache");
const { startPageLoad, finishPageLoad, turnToPrevPage, turnToNextPage } = require("../../utils/pageState");

const OWNER_CACHE_MAX_AGE = 3 * 60 * 1000;

function sumLines(gyms) {
  let b = 0;
  let d = 0;
  let l = 0;
  gyms.forEach((g) => {
    if (g && g.lines) {
      b += Number(g.lines.boulder || 0);
      d += Number(g.lines.difficulty || 0);
      l += Number(g.lines.lead || 0);
    }
  });
  return { boulderLines: b, diffLines: d, leadLines: l };
}

Page({
  data: {
    gyms: [],
    summary: { gymCount: 0, boulderLines: 0, diffLines: 0, leadLines: 0 },
    page: 1,
    pageSize: 5,
    hasNext: false,
    loading: false
  },
  async onShow() {
    await this.ensureLogin();
    const hasCache = this.applyOwnerCache({ reset: true });
    this.load({ reset: true, silent: hasCache, hasCache });
  },
  async ensureLogin() {
    try {
      await ensureAppLogin();
    } catch (e) {}
  },
  onPrev() {
    turnToPrevPage(this, this.load);
  },
  onNext() {
    turnToNextPage(this, this.load);
  },
  onAdd() {
    wx.navigateTo({ url: "/pages/gym-manage/index" });
  },
  onTapGym(e) {
    const gym = e.detail.gym;
    if (!gym || !gym._id) return;
    wx.navigateTo({ url: `/pages/gym-manage/index?gymId=${gym._id}` });
  },
  getOwnerCacheKey(page, pageSize) {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    return buildCacheKey("owner_list", {
      openid: safeText(user.openid),
      page,
      pageSize
    });
  },
  applyOwnerCache({ reset }) {
    const page = reset ? 1 : Number(this.data.page || 1);
    const pageSize = Number(this.data.pageSize || 5);
    const cached = readCache(this.getOwnerCacheKey(page, pageSize), { maxAge: OWNER_CACHE_MAX_AGE });
    if (!cached || !cached.data) return false;
    this.setData({
      page,
      gyms: Array.isArray(cached.data.gyms) ? cached.data.gyms : [],
      hasNext: !!cached.data.hasNext,
        summary: cached.data.summary || { gymCount: 0, boulderLines: 0, diffLines: 0, leadLines: 0 }
    });
    return true;
  },
  async load({ reset, silent, hasCache }) {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    const openid = user.openid || "";
    if (!openid) return;
    const paging = startPageLoad(this, reset);
    if (!paging) return;
    const { page, pageSize } = paging;
    try {
      const res = await ownerList({ page, pageSize }, { loading: !silent });
      const gyms = (res && res.gyms) || [];
      const lines = (res && res.summary) || sumLines(gyms);
      const total = Number(res && res.total);
      const nextState = {
        gyms,
        hasNext: !!(res && res.hasNext),
        summary: {
          gymCount: Number.isFinite(total) ? total : gyms.length,
          boulderLines: Number(lines && lines.boulderLines) || 0,
          diffLines: Number(lines && lines.diffLines) || 0,
          leadLines: Number(lines && lines.leadLines) || 0
        }
      };
      this.setData(nextState);
      writeCache(this.getOwnerCacheKey(page, pageSize), nextState);
    } catch (e) {
      if (!hasCache) wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      finishPageLoad(this);
    }
  }
});

