const circleApi = require("../../services/api/circle");
const gymApi = require("../../services/api/gym");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");
const cache = require("../../utils/cache");

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
    memberCardVisible: false,
    memberCard: null,
    gymSheetVisible: false,
    settingSheetVisible: false,
    linkGymSheetVisible: false,
    linkGymOptions: [],
    postsList: [],
    postsLoading: false,
    postSheetVisible: false,
    postContent: "",
    postImages: []
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

  // #25: cloud:// 云文件 ID 不能直接用于 <image>，批量转临时 URL
  async resolveAvatars(list) {
    if (!Array.isArray(list) || !list.length) return list;
    const cloudIds = list.map((m) => m && m.avatarUrl).filter((v) => v && v.indexOf("cloud://") === 0);
    if (!cloudIds.length) return list;
    let urlMap = {};
    try {
      const r = await wx.cloud.getTempFileURL({ fileList: cloudIds });
      ((r && r.fileList) || []).forEach((item) => {
        if (item && item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL;
      });
    } catch (e) {}
    return list.map((m) => {
      if (m && m.avatarUrl && urlMap[m.avatarUrl]) return Object.assign({}, m, { avatarUrl: urlMap[m.avatarUrl] });
      return m;
    });
  },

  async loadDetail() {
    try {
      const r = await circleApi.detail({ circleId: this.data.circleId });
      const app = getApp();
      const me = (app && app.globalData && app.globalData.me) || (app && app.globalData && app.globalData.user) || {};
      const myOpenid = String(me.openid || me._openid || "" );
      const members = await this.resolveAvatars((r && r.members) || []);
      const pendings = await this.resolveAvatars((r && r.pendings) || []);
      this.setData({
        myOpenid,
        circle: r && r.circle ? r.circle : null,
        members,
        pendings,
        gyms: (r && r.gyms) || [],
        isAdmin: !!(r && r.isAdmin),
        myMembership: (r && r.myMembership) || null,
        myStatus: (r && r.myMembership && safeText(r.myMembership.status)) || "",
        pendingCount: Number(r && r.pendingCount ? r.pendingCount : 0)
      });
    } catch (e) {
      wx.showToast({ title: e && e.message || "加载失败", icon: "none" });
    }
  },

  // #25: 点击成员行 → 名片弹窗（展示主卡 displayName/称呼/头像/岩友号）
  onTapMember(e) {
    const openid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.oid);
    if (!openid) return;
    const found = (this.data.members || []).find((m) => String(m.openid || "") === openid);
    if (!found) return;
    this.setData({ memberCard: found, memberCardVisible: true });
  },

  closeMemberCard() {
    this.setData({ memberCardVisible: false, memberCard: null });
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
      confirmColor: "#C65A5A",
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

  async loadPosts(reset) {
    if (this.data.postsLoading) return;
    try {
      this.setData({ postsLoading: true });
      const app = getApp();
      const me = (app && app.globalData && app.globalData.me) || null;
      const myOpenid = (me && me.openid) || (app && app.globalData && app.globalData.openid) || "";
      const r = await circleApi.listPosts({
        circleId: this.data.circleId,
        page: reset ? 1 : (this._postPage || 1),
        pageSize: 30
      });
      const raw = (r && r.posts) || [];
      const admin = !!this.data.isAdmin;
      const list = raw.map((p) => {
        const pid = String(p._openid || p.openid || "");
        const canDelete = admin || pid === myOpenid;
        const c = p.createdAt;
        let text = "";
        if (c) {
          try {
            const d = typeof c === "number" ? new Date(c) : c && c.getTime ? new Date(c.getTime()) : (c.toDate ? c.toDate() : new Date(c));
            if (d && d.getFullYear) {
              const m = d.getMonth() + 1;
              const dd = d.getDate();
              const hh = d.getHours();
              const mm = d.getMinutes();
              text = `${m}/${dd} ${hh < 10 ? "0" : ""}${hh}:${mm < 10 ? "0" : ""}${mm}`;
            }
          } catch (_) {}
        }
        return {
          _id: String(p._id || ""),
          openid: pid,
          nickName: safeText(p.nickName || ""),
          avatarUrl: p.avatarUrl || "",
          role: safeText(p.role || ""),
          content: safeText(p.content || ""),
          images: Array.isArray(p.images) ? p.images.slice(0, 9) : [],
          createdAtText: text,
          canDelete
        };
      }).filter((x) => x._id);
      this._postsLoaded = true;
      this._postPage = (this._postPage || 1) + 1;
      this.setData({ postsList: list, postsLoading: false });
    } catch (e) {
      this.setData({ postsLoading: false });
      wx.showToast({ title: (e && e.message) || "加载失败", icon: "none" });
    }
  },

  openPostSheet() {
    if (this.data.myStatus !== "accepted" && !this.data.isAdmin) {
      wx.showToast({ title: "加入后才能发帖", icon: "none" });
      return;
    }
    this.setData({ postSheetVisible: true, postContent: "", postImages: [] });
  },

  closePostSheet() {
    this.setData({ postSheetVisible: false });
  },

  onPostInput(e) {
    const v = (e && e.detail && e.detail.value) || "";
    this.setData({ postContent: safeText(v) });
  },

  async onPickPostImages() {
    const left = 9 - this.data.postImages.length;
    if (left <= 0) return;
    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: left,
          mediaType: ["image"],
          sizeType: ["compressed"],
          sourceType: ["album", "camera"],
          success: resolve,
          fail: reject
        });
      });
      const files = (res && res.tempFiles) || [];
      const paths = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const p = f && f.tempFilePath;
        if (!p) continue;
        try {
          const up = await wx.cloud.uploadFile({
            cloudPath: `circle-posts/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
            filePath: p
          });
          if (up && up.fileID) paths.push(up.fileID);
        } catch (_) {}
      }
      if (paths.length) {
        const merged = this.data.postImages.concat(paths).slice(0, 9);
        this.setData({ postImages: merged });
      }
    } catch (e) {}
  },

  onRemovePostImage(e) {
    const i = Number((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i) || 0);
    const arr = this.data.postImages.slice();
    if (i < 0 || i >= arr.length) return;
    arr.splice(i, 1);
    this.setData({ postImages: arr });
  },

  async onSubmitPost() {
    const content = safeText(this.data.postContent);
    const images = (this.data.postImages || []).slice();
    if (!content && !images.length) {
      wx.showToast({ title: "写点内容或加张图片吧", icon: "none" });
      return;
    }
    try {
      await circleApi.createPost({
        circleId: this.data.circleId,
        content,
        images
      });
      wx.showToast({ title: "已发布", icon: "success" });
      this.setData({ postSheetVisible: false, postContent: "", postImages: [] });
      this._postsLoaded = false;
      this._postPage = 1;
      this.loadPosts(true).catch(() => {});
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "发布失败", icon: "none" });
    }
  },

  onTapDeletePost(e) {
    const pid = safeText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pid);
    if (!pid) return;
    const self = this;
    wx.showModal({
      title: "删除这条动态？",
      confirmText: "删除",
      confirmColor: "#C65A5A",
      async success(r) {
        if (!r || !r.confirm) return;
        try {
          await circleApi.deletePost(pid);
          wx.showToast({ title: "已删除", icon: "success" });
          self._postsLoaded = false;
          self._postPage = 1;
          self.loadPosts(true).catch(() => {});
        } catch (err) {
          wx.showToast({ title: (err && err.message) || "删除失败", icon: "none" });
        }
      }
    });
  },

  onTapPostImage(e) {
    const src = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.src) || "";
    if (!src) return;
    const urls = [];
    (this.data.postsList || []).forEach((p) => {
      (p.images || []).forEach((im) => { if (im) urls.push(im); });
    });
    const show = urls.length ? urls : [src];
    try { wx.previewImage({ urls: show, current: src }); } catch (_) {}
  }
});
