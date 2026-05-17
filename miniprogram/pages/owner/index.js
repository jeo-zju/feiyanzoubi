const { ownerList } = require("../../services/api/gym");
const { login } = require("../../services/api/auth");

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
    const app = getApp();
    if (app && app.globalData && app.globalData.user && app.globalData.user.openid) return;
    try {
      const res = await login(null);
      if (app && app.globalData) app.globalData.user = res && res.user ? res.user : res;
    } catch (e) {}
  },
  onPrev() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.load({ reset: false });
  },
  onNext() {
    if (!this.data.hasNext) return;
    this.setData({ page: this.data.page + 1 });
    this.load({ reset: false });
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
    if (this.data.loading) return;
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    const openid = user.openid || "";
    if (!openid) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true, page });
    try {
      const res = await ownerList({ page, pageSize: this.data.pageSize });
      const gyms = (res && res.gyms) || [];
      const lines = sumLines(gyms);
      this.setData({
        gyms,
        hasNext: !!(res && res.hasNext),
        summary: { gymCount: gyms.length, ...lines }
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});

