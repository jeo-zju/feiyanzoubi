const calendarApi = require("../../services/api/calendar");
const gymApi = require("../../services/api/gym");
const friendshipApi = require("../../services/api/friendship");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");
const { resolveCloudAvatars } = require("../../utils/avatar");

const WEEK_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CITY_PRESETS = ["杭州", "上海", "北京", "深圳", "广州", "成都", "南京", "武汉"];

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function parseYMD(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function weekdayOf(ymd) {
  const d = parseYMD(ymd);
  return d ? d.getDay() : 0;
}
function hmToMinutes(hm) {
  const m = String(hm || "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}
function toGymOptions(gymList) {
  const src = Array.isArray(gymList) ? gymList : [];
  return src.map((g) => ({
    _id: String(g && g._id ? g._id : ""),
    name: safeText(g && (g.name || g.gymName)) || "未命名岩馆"
  })).filter((g) => g._id);
}

const START_HOUR = 10;
const END_HOUR = 22;
const PX_PER_HOUR = 120; // rpx，每个 tick 高度 = PX_PER_HOUR，和 WXSS 的 120rpx 保持一致
const COL_WIDTH = 200;

Page({
  data: {
    date: "",
    dateLabel: "",
    weekLabel: "",
    city: "",
    circleId: "",
    gymId: "",
    gymLabel: "全部岩馆",
    visibility: "public",
    visibilityTabs: [
      { key: "public", label: "公开日历" },
      { key: "friends", label: "岩友" },
      { key: "circle", label: "岩友圈" }
    ],
    cityOptions: CITY_PRESETS.map((name) => ({ name, custom: false }))
      .concat([{ name: "自定义城市…", custom: true }]),
    cityPickerVisible: false,
    gymPickerVisible: false,
    gymOptions: [],
    gymKeyword: "",
    _gymPickerState: { page: 0, hasMore: false, loading: false },
    userCount: 0,
    userList: [],
    plans: [],
    colList: [],
    colsWidth: 0,
    colWidth: COL_WIDTH,
    hourTicks: [],
    friendIds: [],
    defaultAvatar: DEFAULT_AVATAR,
    // 点时间块/头像只出识别摘要，报名/退出/移除统一进 plan-detail
    selectedPlan: null
  },

  onLoad(options) {
    const date = safeText(options && options.date) || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    })();
    const city = decodeURIComponent(safeText(options && options.city));
    const gymId = safeText(options && options.gymId);
    const visibility = ["public", "friends", "circle"].indexOf(safeText(options && options.visibility)) >= 0
      ? safeText(options && options.visibility)
      : "public";
    const d = parseYMD(date);
    const dateLabel = d ? `${d.getMonth() + 1}月${d.getDate()}日` : date;
    const weekLabel = WEEK_NAMES[weekdayOf(date)] || "";
    const hourTicks = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      hourTicks.push({ h, label: `${pad2(h)}:00` });
    }
    wx.setNavigationBarTitle({ title: `${dateLabel} · ${weekLabel}` });
    this.setData({
      date,
      dateLabel,
      weekLabel,
      city,
      circleId: safeText(options && options.circleId),
      gymId,
      gymLabel: gymId ? "选中岩馆" : "全部岩馆",
      visibility,
      hourTicks
    });
  },

  async onShow() {
    try { await ensureAppLogin(); } catch (e) {}
    if (this.data.gymId) {
      try {
        const g = await gymApi.get({ gymId: this.data.gymId });
        const name = g && g.gym && (g.gym.name || g.gym.gymName) ? g.gym.name || g.gym.gymName : "选中岩馆";
        this.setData({ gymLabel: name });
      } catch (e) {}
    }
    this.loadFriends();
    this.loadTimeline();
  },

  noop() {},

  async loadFriends() {
    try {
      const r = await friendshipApi.list({ pageSize: 100 });
      const ids = new Set();
      ((r && r.accepted) || []).forEach((x) => { if (x.openid) ids.add(x.openid); });
      ((r && r.legacyFollow) || []).forEach((x) => { if (x.openid) ids.add(x.openid); });
      this.setData({ friendIds: Array.from(ids) });
    } catch (e) {}
  },

  // cloud:// 头像统一走 utils/avatar：转临时 https URL；失败置空走默认头像
  async resolveAvatars(list) {
    return resolveCloudAvatars(list, "avatarUrl");
  },

  async loadTimeline() {
    try {
      const params = {
        date: this.data.date,
        city: this.data.city,
        visibility: this.data.visibility,
        circleId: this.data.circleId || ""
      };
      if (this.data.gymId) params.filterGymId = this.data.gymId;
      const res = await calendarApi.queryTimeline(params);
      const rawPlans = (res && res.plans) || [];
      const userList = ((res && res.userList) || []).map((u) => ({
        _openid: u._openid,
        nickName: u.nickName || "",
        avatarUrl: u.avatarUrl || "",
        displayName: u.displayName || "",
        title: u.title || "",
        rockId: u.rockId || "",
        city: u.city || ""
      }));
      const friendSet = new Set(this.data.friendIds || []);
      const app = getApp();
      const myUid = (app && app.globalData && app.globalData.openid) || "";
      const userColMap = {};
      userList.forEach((u, i) => { userColMap[u._openid] = i; });

      const colBars = {};
      userList.forEach((u) => { colBars[u._openid] = []; });

      const visiblePlans = [];
      rawPlans.forEach((p) => {
        const uid = p._openid || p.openid || p.uid || "";
        const gymName = (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "";
        const startMin = hmToMinutes(p.startTime);
        const endMin = hmToMinutes(p.endTime);
        const startOffset = Math.max(0, startMin - START_HOUR * 60);
        const clampedEnd = Math.min(END_HOUR * 60, endMin);
        const topPx = Math.round((startOffset / 60) * PX_PER_HOUR);
        const hMin = Math.max(30, clampedEnd - (START_HOUR * 60 + startOffset));
        const hPx = Math.max(80, Math.round((hMin / 60) * PX_PER_HOUR));
        const rangeText = `${p.startTime}-${p.endTime}`;
        const snap = p.userSnapshot || {};
        // 云函数已按 owner id 查 RockUsers 做 hydration：实时资料优先、计划快照兜底
        const oi = p.ownerInfo || {};
        const rawPlanId = String(p._id || "");
        const plan = {
          id: rawPlanId || `${uid}_${p.date}_${p.startTime}_${p.endTime}`,
          rawPlanId,
          uid,
          date: p.date,
          displayName: oi.displayName || snap.displayName || snap.nickName || "",
          nickName: oi.nickName || snap.nickName || "",
          avatarUrl: oi.avatarUrl || snap.avatarUrl || "",
          title: oi.title || snap.title || "",
          rangeText,
          gymName,
          outdoorName: p.outdoorName || "",
          note: p.note || "",
          needPartner: !!p.needPartner,
          skillTags: p.skillTags || [],
          skillText: (p.skillTags || []).join("、"),
          topPx,
          hPx,
          isFriend: friendSet.has(uid) || (p.visibility === "friends"),
          isMe: uid === myUid,
          joinedCount: Number(p.joinedCount || 1)
        };
        visiblePlans.push(plan);
        if (userColMap[uid] == null) {
          userColMap[uid] = userList.length;
          colBars[uid] = [];
          userList.push({
            _openid: uid,
            nickName: plan.nickName,
            avatarUrl: plan.avatarUrl,
            displayName: plan.displayName,
            title: plan.title,
            rockId: plan.rockId || "",
            city: plan.city || ""
          });
        }
        // 短时段（<104rpx）不硬塞馆名，点击摘要看完整区间
        colBars[uid].push({
          id: plan.id,
          topPx: plan.topPx,
          hPx: plan.hPx,
          rangeText: plan.rangeText,
          gymName: plan.gymName || plan.outdoorName,
          showGym: hPx >= 104
        });
      });

      const resolvedUsers = await this.resolveAvatars(userList);
      const resolvedPlans = await this.resolveAvatars(visiblePlans);

      const colList = resolvedUsers.map((u, i) => ({
        uid: u._openid,
        colIdx: i,
        avatarUrl: u.avatarUrl || "",
        displayName: u.displayName || "",
        nickName: u.nickName || "",
        bars: (colBars[u._openid] || []).slice().sort((a, b) => a.topPx - b.topPx)
      }));

      this.setData({
        plans: resolvedPlans,
        userList: resolvedUsers,
        userCount: resolvedUsers.length,
        colList,
        colsWidth: colList.length * COL_WIDTH
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  onVisibilityChange(e) {
    const next = safeText(e && e.detail && e.detail.value);
    if (!next || next === this.data.visibility) return;
    this.setData({ visibility: next }, () => this.loadTimeline());
  },

  // ---------- 城市筛选 ----------
  onTapCity() {
    this.setData({ cityPickerVisible: true });
  },
  onCloseCityPicker() {
    this.setData({ cityPickerVisible: false });
  },
  onPickCity(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (ds.custom) {
      this.setData({ cityPickerVisible: false });
      const self = this;
      wx.showModal({
        title: "输入城市",
        editable: true,
        placeholderText: "如：苏州",
        success(r) {
          if (r.confirm && safeText(r.content)) {
            self.applyCity(safeText(r.content));
          }
        }
      });
      return;
    }
    const city = safeText(ds.city);
    if (!city) return;
    this.applyCity(city);
  },
  applyCity(city) {
    if (city === this.data.city) {
      this.setData({ cityPickerVisible: false });
      return;
    }
    this.setData({
      city,
      cityPickerVisible: false,
      gymId: "",
      gymLabel: "全部岩馆",
      gymOptions: [],
      gymKeyword: "",
      _gymPickerState: { page: 0, hasMore: false, loading: false }
    });
    this.loadTimeline();
  },

  // ---------- 岩馆筛选（搜索 + 分页，与日历页同一交互） ----------
  async onTapGymFilter() {
    this.setData({
      gymKeyword: "",
      gymOptions: [],
      gymPickerVisible: true,
      "_gymPickerState.page": 0,
      "_gymPickerState.hasMore": false,
      "_gymPickerState.loading": true
    });
    await this.loadGymPicker(true);
  },
  onCloseGymPicker() {
    if (this._gymKeywordTimer) {
      clearTimeout(this._gymKeywordTimer);
      this._gymKeywordTimer = null;
    }
    this.setData({ gymPickerVisible: false });
  },
  onGymKeywordInput(e) {
    const keyword = safeText(e && e.detail && e.detail.value);
    this.setData({ gymKeyword: keyword, gymOptions: [], "_gymPickerState.loading": true });
    if (this._gymKeywordTimer) clearTimeout(this._gymKeywordTimer);
    const self = this;
    this._gymKeywordTimer = setTimeout(() => {
      self._gymKeywordTimer = null;
      self.loadGymPicker(true);
    }, 300);
  },
  onGymPickerScrollLower() {
    const st = this.data._gymPickerState || {};
    if (st.loading || !st.hasMore) return;
    this.loadGymPicker(false);
  },
  async loadGymPicker(reset) {
    const st = this.data._gymPickerState || { page: 0, hasMore: false, loading: false };
    if (!reset && (st.loading || !st.hasMore)) return;
    const keyword = safeText(this.data.gymKeyword);
    const page = reset ? 1 : Math.max(1, Number(st.page || 0) + 1);
    this._gymPickerToken = (this._gymPickerToken || 0) + 1;
    const token = this._gymPickerToken;
    this.setData({ "_gymPickerState.loading": true });
    try {
      const res = await gymApi.list(
        { city: safeText(this.data.city), keyword, page, pageSize: 20 },
        { loading: false }
      );
      if (token !== this._gymPickerToken) return;
      const options = toGymOptions((res && res.gyms) || []);
      const merged = reset ? options : (this.data.gymOptions || []).concat(options);
      this.setData({
        gymOptions: merged,
        "_gymPickerState.page": page,
        "_gymPickerState.hasMore": !!(res && res.hasNext),
        "_gymPickerState.loading": false
      });
    } catch (e) {
      if (token !== this._gymPickerToken) return;
      this.setData({ "_gymPickerState.loading": false });
    }
  },
  onPickGym(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = safeText(ds.id);
    const name = id ? safeText(ds.name) || "选中岩馆" : "全部岩馆";
    this.setData({
      gymId: id,
      gymLabel: name,
      gymPickerVisible: false
    });
    this.loadTimeline();
  },

  // ---------- 时间块摘要：只识别，不复制报名管理 ----------
  openPlanSheet(plan) {
    if (!plan) return;
    this.setData({ selectedPlan: plan });
  },
  onClosePlan() {
    this.setData({ selectedPlan: null });
  },
  onTapBar(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || "";
    const found = (this.data.plans || []).find((p) => p.id === id);
    this.openPlanSheet(found);
  },
  onTapAvatar(e) {
    const uid = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.uid) || "";
    if (!uid) return;
    const found = (this.data.plans || []).find((p) => p.uid === uid);
    this.openPlanSheet(found);
  },
  onViewPlan() {
    const p = this.data.selectedPlan;
    if (!p) return;
    // rawPlanId 即计划记录 _id；timeline 返回的均为当前用户可见计划，
    // plan-detail 按同一可见性规则校验（旧单向关注数据可能返回无权限文案，属预期兜底）
    if (!p.rawPlanId) {
      wx.showToast({ title: "该约爬信息过旧，无法打开", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/plan-detail/index?planId=${encodeURIComponent(p.rawPlanId)}` });
  }
});
