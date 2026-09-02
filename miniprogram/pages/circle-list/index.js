const circleApi = require("../../services/api/circle");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    city: "",
    gymId: "",
    gymName: "",
    title: "岩友圈",
    list: [],
    membershipMap: {},
    total: 0,
    loading: false
  },

  // 两种入口语义：
  // - mine（无筛选参数，来自「我的-岩友圈-去列表」）：只展示当前用户已加入/待审批的圈（circleApi.myList）
  // - explore（带 city/gymId/gymName，来自首页「更多岩友圈」）：展示可加入的全量圈（circleApi.list）
  onLoad(options) {
    const city = decodeURIComponent(safeText(options && options.city));
    const gymId = safeText(options && options.gymId);
    const gymName = decodeURIComponent(safeText(options && options.gymName));
    const mine = !(gymId || city || gymName);
    this._mode = mine ? "mine" : "explore";
    let title = "岩友圈";
    if (mine) {
      title = "我的岩友圈";
    } else {
      const label = gymName || (gymId ? "该岩馆" : "");
      if (label) title = `岩友圈 · ${label}`;
    }
    this.setData({
      city,
      gymId,
      gymName: gymName || (gymId ? "该岩馆" : ""),
      title
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
      let list = [];
      let total = 0;
      let membershipMap = {};
      if (this._mode === "mine") {
        // #24: 「我的岩友圈」只显示已加入/待审批，改用 myList
        const res = await circleApi.myList();
        list = Array.isArray(res && res.list) ? res.list : [];
        total = list.length;
        list.forEach((c) => {
          const id = String(c && c._id || "");
          if (!id) return;
          membershipMap[id] = { role: safeText(c.myRole), status: safeText(c.myStatus) };
        });
      } else {
        const res = await circleApi.list({
          city: this.data.city,
          gymId: this.data.gymId,
          page: 1,
          pageSize: 100
        });
        list = Array.isArray(res && res.list) ? res.list : [];
        total = Number(res && res.total ? res.total : list.length);
        membershipMap = (res && res.myMembershipMap) || {};
      }
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
