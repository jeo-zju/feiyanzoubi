const { ownerList } = require("../../services/api/gym");
const { ensureAppLogin } = require("../../utils/session");
const { startPageLoad, finishPageLoad, turnToPrevPage, turnToNextPage } = require("../../utils/pageState");

function sumLines(gyms) {
  let b = 0;
  let d = 0;
  gyms.forEach((g) => {
    if (g && g.lines) {
      b += Number(g.lines.boulder || 0);
      d += Number(g.lines.difficulty || 0);
    }
  });
  return { boulderLines: b, diffLines: d };
}

Page({
  data: {
    gyms: [],
    summary: { gymCount: 0, boulderLines: 0, diffLines: 0 },
    page: 1,
    pageSize: 5,
    hasNext: false,
    loading: false
  },
  async onShow() {
    await this.ensureLogin();
    this.load({ reset: true });
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
  async load({ reset }) {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    const openid = user.openid || "";
    if (!openid) return;
    const paging = startPageLoad(this, reset);
    if (!paging) return;
    const { page, pageSize } = paging;
    try {
      const res = await ownerList({ page, pageSize });
      const gyms = (res && res.gyms) || [];
      const lines = (res && res.summary) || sumLines(gyms);
      const total = Number(res && res.total);
      this.setData({
        gyms,
        hasNext: !!(res && res.hasNext),
        summary: {
          gymCount: Number.isFinite(total) ? total : gyms.length,
          boulderLines: Number(lines && lines.boulderLines) || 0,
          diffLines: Number(lines && lines.diffLines) || 0
        }
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      finishPageLoad(this);
    }
  }
});

