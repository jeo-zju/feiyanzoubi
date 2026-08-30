const circleApi = require("../../services/api/circle");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    city: "",
    gymId: "",
    gymName: "",
    page: 1,
    total: 0,
    totalPages: 0,
    current: null,
    myMembership: null,
    listAll: [],
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

  async loadList(reset) {
    if (this.data.loading) return;
    try {
      this.setData({ loading: true });
      const res = await circleApi.list({
        city: this.data.city,
        gymId: this.data.gymId,
        page: 1,
        pageSize: 100
      });
      const listAll = Array.isArray(res && res.list) ? res.list : [];
      const total = Number(res && res.total ? res.total : listAll.length);
      const totalPages = Math.max(1, listAll.length);
      const membershipMap = (res && res.myMembershipMap) || {};
      const page = reset ? 1 : Math.min(this.data.page, listAll.length || 1);
      const current = listAll[page - 1] || null;
      const myMembership = current ? (membershipMap[String(current._id)] || null) : null;
      this.setData({
        listAll,
        total,
        totalPages,
        page,
        current,
        myMembership,
        loading: false
      });
    } catch (e) {
      console.warn("[circle-list] load fail", e && e.message);
      this.setData({ loading: false, listAll: [], total: 0, totalPages: 1, page: 1, current: null, myMembership: null });
    }
  },

  onPrev() {
    if (this.data.page <= 1) return;
    const page = this.data.page - 1;
    const current = this.data.listAll[page - 1] || null;
    this.setData({ page, current, myMembership: null });
    this.refreshMembership();
  },

  onNext() {
    if (this.data.page >= this.data.totalPages) return;
    const page = this.data.page + 1;
    const current = this.data.listAll[page - 1] || null;
    this.setData({ page, current, myMembership: null });
    this.refreshMembership();
  },

  async refreshMembership() {
    const current = this.data.current;
    if (!current) return;
    try {
      const res = await circleApi.list({
        city: this.data.city,
        gymId: this.data.gymId,
        page: 1,
        pageSize: 1
      });
      const map = (res && res.myMembershipMap) || {};
      if (map[String(current._id)]) {
        this.setData({ myMembership: map[String(current._id)] });
      }
    } catch (e) {}
  },

  async onTapApply() {
    const current = this.data.current;
    if (!current) return;
    try {
      const r = await circleApi.apply({ circleId: String(current._id) });
      const st = String(r && r.status || "");
      if (st === "pending" || st === "already_pending") wx.showToast({ title: "已申请", icon: "none" });
      else if (st === "already_member" || st === "already_admin") wx.showToast({ title: "已在圈内", icon: "none" });
      else wx.showToast({ title: "已申请", icon: "success" });
      await this.loadList(false);
    } catch (e) {
      wx.showToast({ title: e && e.message || "申请失败", icon: "none" });
    }
  },

  onTapCard() {
    const current = this.data.current;
    if (!current) return;
    wx.navigateTo({ url: `/pages/circle-detail/index?circleId=${current._id}` });
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
