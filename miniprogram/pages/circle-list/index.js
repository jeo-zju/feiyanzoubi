const circleApi = require("../../services/api/circle");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    city: "",
    gymId: "",
    gymName: "",
    list: [],
    membershipMap: {},
    total: 0,
    loading: false
  },

  onLoad(options) {
    const city = decodeURIComponent(safeText(options && options.city));
    const gymId = safeText(options && options.gymId);
    const gymName = decodeURIComponent(safeText(options && options.gymName));
    this.setData({
      city,
      gymId,
      gymName: gymName || (gymId ? "该岩馆" : "")
    });
  },

  async onShow() {
    await this.loadList(true);
  },

  noop() {},

  async loadList() {
    if (this.data.loading) return;
    try {
      this.setData({ loading: true });
      const res = await circleApi.list({
        city: this.data.city,
        gymId: this.data.gymId,
        page: 1,
        pageSize: 100
      });
      const list = Array.isArray(res && res.list) ? res.list : [];
      const total = Number(res && res.total ? res.total : list.length);
      const membershipMap = (res && res.myMembershipMap) || {};
      this.setData({ list, total, membershipMap, loading: false });
    } catch (e) {
      console.warn("[circle-list] load fail", e && e.message);
      this.setData({ loading: false, list: [], total: 0, membershipMap: {} });
    }
  },

  membershipOf(circleId) {
    const map = this.data.membershipMap || {};
    return map[String(circleId)] || null;
  },

  async onTapApply(e) {
    const circleId = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!circleId) return;
    try {
      const r = await circleApi.apply({ circleId });
      const st = String(r && r.status || "");
      if (st === "pending" || st === "already_pending") wx.showToast({ title: "已申请", icon: "none" });
      else if (st === "already_member" || st === "already_admin") wx.showToast({ title: "已在圈内", icon: "none" });
      else wx.showToast({ title: "已申请", icon: "success" });
      await this.loadList();
    } catch (e) {
      wx.showToast({ title: e && e.message || "申请失败", icon: "none" });
    }
  },

  onTapCard(e) {
    const circleId = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!circleId) return;
    wx.navigateTo({ url: `/pages/circle-detail/index?circleId=${circleId}` });
  },

  onCreate() {
    const params = [];
    if (this.data.city) params.push(`city=${encodeURIComponent(this.data.city)}`);
    if (this.data.gymId) params.push(`gymId=${this.data.gymId}`);
    wx.navigateTo({ url: `/pages/circle-edit/index?${params.join("&")}` });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/index" }) });
  }
});
