const circleApi = require("../../services/api/circle");
const gymApi = require("../../services/api/gym");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");
const cache = require("../../utils/cache");
const { resolveCloudAvatars } = require("../../utils/avatar");

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    circleId: "",
    circle: null,
    members: [],
    pendings: [],
    gyms: [],
    isAdmin: false,
    myMembership: null,
    myStatus: "",
    pendingCount: 0,
    canApply: false,
    loadError: false,
    memberSheetVisible: false,
    memberSheetView: "list",
    memberCard: null,
    pendingSheetVisible: false,
    gymSheetVisible: false,
    settingSheetVisible: false,
    linkGymSheetVisible: false,
    linkGymOptions: []
  },

  onLoad(options) {
    const circleId = safeText(options && options.circleId);
    this.setData({ circleId });
  },

  async onShow() {
    if (!this.data.circleId) return;
    await this.loadDetail();
  },

  noop() {},

  // #35: cloud:// 头像统一走 utils/avatar：转临时 https URL；转换失败的一律置空，
  // 由 wxml `avatarUrl || defaultAvatar` 兜底，杜绝 cloud:// 进 <image> 报 500
  async resolveAvatars(list) {
    return resolveCloudAvatars(list, "avatarUrl");
  },

  async loadDetail() {
    try {
      const r = await circleApi.detail({ circleId: this.data.circleId });
      const app = getApp();
      const me = (app && app.globalData && app.globalData.me) || (app && app.globalData && app.globalData.user) || {};
      const myOpenid = String(me.openid || me._openid || "" );
      const members = await this.resolveAvatars((r && r.members) || []);
      const pendings = await this.resolveAvatars((r && r.pendings) || []);
      const isAdmin = !!(r && r.isAdmin);
      const myStatus = (r && r.myMembership && safeText(r.myMembership.status)) || "";
      this.setData({
        myOpenid,
        circle: r && r.circle ? r.circle : null,
        members,
        pendings,
        gyms: (r && r.gyms) || [],
        isAdmin,
        myMembership: (r && r.myMembership) || null,
        myStatus,
        pendingCount: Number(r && r.pendingCount ? r.pendingCount : 0),
        canApply: !isAdmin && myStatus !== "accepted",
        loadError: false
      });
    } catch (e) {
      this.setData({ loadError: true, circle: null });
      wx.showToast({ title: e && e.message || "加载失败", icon: "none" });
    }
  },

  // 成员摘要 → 单层成员弹层
  openMemberSheet() { this.setData({ memberSheetVisible: true, memberSheetView: "list" }); },
  closeMemberSheet() { this.setData({ memberSheetVisible: false, memberSheetView: "list", memberCard: null }); },
  backToMemberList() { this.setData({ memberSheetView: "list", memberCard: null }); },

  // 待审批弹层（管理者）
  openPendingSheet() { this.setData({ pendingSheetVisible: true }); },
  closePendingSheet() { this.setData({ pendingSheetVisible: false }); },

  // #25: 点击成员行 → 在同一弹层内替换为名片视图（展示主卡 displayName/称呼/头像/岩友号）
  onTapMember(e) {
    const openid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.oid);
    if (!openid) return;
    const found = (this.data.members || []).find((m) => String(m.openid || "") === openid);
    if (!found) return;
    this.setData({ memberCard: found, memberSheetView: "card" });
  },

  async onTapApply() {
    if (!this.data.circleId) return;
    try {
      const r = await circleApi.apply({ circleId: this.data.circleId });
      try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
      const st = String(r && r.status || "");
      if (st === "pending" || st === "already_pending") wx.showToast({ title: "已申请", icon: "none" });
      else if (st === "already_member" || st === "already_admin") wx.showToast({ title: "已在圈内", icon: "none" });
      else wx.showToast({ title: "已申请", icon: "success" });
      await this.loadDetail();
    } catch (e) {
      wx.showToast({ title: e && e.message || "失败", icon: "none" });
    }
  },


  async onApprove(e) {
    const openid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.oid);
    if (!openid) return;
    try {
      await circleApi.approve({ circleId: this.data.circleId, openid });
      try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
      wx.showToast({ title: "已通过", icon: "success" });
      await this.loadDetail();
    } catch (e) {
      wx.showToast({ title: e && e.message || "失败", icon: "none" });
    }
  },

  async onReject(e) {
    const openid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.oid);
    if (!openid) return;
    try {
      await circleApi.reject({ circleId: this.data.circleId, openid });
      try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
      wx.showToast({ title: "已拒绝", icon: "none" });
      await this.loadDetail();
    } catch (e) {
      wx.showToast({ title: e && e.message || "失败", icon: "none" });
    }
  },

  async onRemoveMember(e) {
    const openid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.oid);
    if (!openid || !this.data.isAdmin) return;
    const self = this;
    wx.showModal({
      title: "移除该成员？",
      confirmText: "移除",
      confirmColor: "#F1A19A",
      async success(r) {
        if (!r.confirm) return;
        try {
          await circleApi.remove({ circleId: self.data.circleId, openid });
          try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
          wx.showToast({ title: "已移除", icon: "success" });
          await self.loadDetail();
        } catch (e) {
          wx.showToast({ title: e && e.message || "失败", icon: "none" });
        }
      }
    });
  },

  onUnlinkGym(e) {
    if (!this.data.isAdmin) return;
    const gid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.gid);
    if (!gid) return;
    const gymIds = Array.isArray(this.data.circle && this.data.circle.gymIds) ? this.data.circle.gymIds.slice() : [];
    const idx = gymIds.indexOf(gid);
    if (idx < 0) return;
    gymIds.splice(idx, 1);
    this.updateCircleGymIds(gymIds);
  },

  async openLinkGymSheet() {
    if (!this.data.isAdmin) return;
    try {
      const city = safeText(this.data.circle && this.data.circle.city);
      const cityKey = String(city || "").trim().toLowerCase();
      const cacheKey = `${cache.CACHE_KEYS.GYM_LIST_PREFIX}${cityKey}_n50`;
      const r = await cache.get(cacheKey, {
        ttlMin: 120,
        useL2: true,
        loader: async () => await gymApi.list({ city, keyword: "", page: 1, pageSize: 50 }, { loading: false })
      });
      const list = (r && r.gyms) || [];
      const existed = {};
      (this.data.gyms || []).forEach((g) => { existed[String(g._id)] = true; });
      const options = list.map((g) => ({
        _id: String(g._id || ""),
        name: safeText(g.name),
        linked: !!existed[String(g._id)]
      })).filter((o) => o._id);
      this.setData({ linkGymOptions: options, linkGymSheetVisible: true, gymSheetVisible: false });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  closeLinkGymSheet() { this.setData({ linkGymSheetVisible: false }); },

  toggleLinkGym(e) {
    if (!this.data.isAdmin) return;
    const id = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    const options = (this.data.linkGymOptions || []).map((o) => (String(o._id) === id ? { ...o, linked: !o.linked } : o));
    this.setData({ linkGymOptions: options });
  },

  async saveLinkGyms() {
    const gymIds = (this.data.linkGymOptions || []).filter((o) => !!o.linked).map((o) => String(o._id));
    this.setData({ linkGymSheetVisible: false });
    await this.updateCircleGymIds(gymIds);
  },

  async updateCircleGymIds(gymIds) {
    if (!this.data.isAdmin || !this.data.circleId) return;
    try {
      await circleApi.update({ circleId: this.data.circleId, gymIds });
      try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
      wx.showToast({ title: "已保存", icon: "success" });
      await this.loadDetail();
    } catch (e) {
      wx.showToast({ title: e && e.message || "失败", icon: "none" });
    }
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/index" }) }); },

  // #41: 补回设置/岩馆/退出/解散处理函数（wxml 已绑定但 js 缺失，入口点了无反应）
  openSettingSheet() { this.setData({ settingSheetVisible: true }); },
  closeSettingSheet() { this.setData({ settingSheetVisible: false }); },

  goEdit() {
    this.setData({ settingSheetVisible: false });
    wx.navigateTo({ url: `/pages/circle-edit/index?mode=edit&circleId=${this.data.circleId}` });
  },

  openGymSheet() {
    // 正文馆摘要行与设置弹层共用同一个馆列表弹层
    this.setData({ gymSheetVisible: true, settingSheetVisible: false });
  },
  openGymSheetFromSetting() {
    this.setData({ settingSheetVisible: false, gymSheetVisible: true });
  },
  closeGymSheet() { this.setData({ gymSheetVisible: false }); },

  onConfirmDisband() {
    if (!this.data.isAdmin) return;
    const self = this;
    wx.showModal({
      title: "解散岩友圈？",
      content: "解散后不可恢复，成员将看不到这个圈子",
      confirmText: "解散",
      confirmColor: "#F1A19A",
      async success(r) {
        if (!r.confirm) return;
        try {
          await circleApi.disband({ circleId: self.data.circleId });
          try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
          wx.showToast({ title: "已解散", icon: "success" });
          setTimeout(() => self.goBack(), 600);
        } catch (e) {
          wx.showToast({ title: (e && e.message) || "解散失败", icon: "none" });
        }
      }
    });
  },

  onConfirmLeave() {
    const self = this;
    wx.showModal({
      title: "退出岩友圈？",
      confirmText: "退出",
      confirmColor: "#F1A19A",
      async success(r) {
        if (!r.confirm) return;
        try {
          await circleApi.leave({ circleId: self.data.circleId });
          try { cache.invalidate(cache.CACHE_KEYS.MY_CIRCLES); } catch (_) {}
          wx.showToast({ title: "已退出", icon: "success" });
          setTimeout(() => self.goBack(), 600);
        } catch (e) {
          wx.showToast({ title: (e && e.message) || "退出失败", icon: "none" });
        }
      }
    });
  }
});
