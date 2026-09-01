const calendarApi = require("../../services/api/calendar");
const gymApi = require("../../services/api/gym");
const friendshipApi = require("../../services/api/friendship");
const cardApi = require("../../services/api/card");
const userApi = require("../../services/api/user");
const circleApi = require("../../services/api/circle");
const { ensureAppLogin, isAdminUser } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const { parseYMD } = require("../../utils/date");
const { DEFAULT_AVATAR, CIRCLE_COLORS } = require("../../utils/constants");
const { CACHE_KEYS } = require("../../utils/cache");

const WEEK_LABELS = ["今天", "周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CITY_PRESETS = ["杭州", "上海", "北京", "深圳", "广州", "成都", "南京", "武汉"];
const CALENDAR_DAYS = 14;
const CIRCLE_HOME_LIMIT = 2;

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function formatYMD(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayYMD() {
  const d = new Date();
  return formatYMD(d);
}
function addDays(ymd, days) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return formatYMD(d);
}
function monthLabel(ymd) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${Number(m[2])}月${Number(m[3])}日 → 未来${CALENDAR_DAYS}天`;
}
function toGymOptions(gymList) {
  const src = Array.isArray(gymList) ? gymList : [];
  return src.map((g) => ({
    _id: String(g && g._id ? g._id : ""),
    name: safeText(g && (g.name || g.gymName)) || "未命名岩馆"
  })).filter((g) => g._id);
}
function buildCityOptions() {
  const list = CITY_PRESETS.map((name) => ({ name, custom: false }));
  list.push({ name: "自定义城市…", custom: true });
  return list;
}

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    circleColors: CIRCLE_COLORS,
    weekLabels: WEEK_LABELS.slice(0, 7),
    visibility: "public",
    city: "",
    gymId: "",
    gymFilterLabel: "全部岩馆",
    calendarLabel: "",
    dateCells: [],
    notiDot: false,
    user: {},
    me: {},
    credit: { remaining: 0, limit: 10 },
    creditPercent: 0,
    stats: { thisMonthPlans: 0, checkinRate: 0, friends: 0, received: 0 },
    myPrimaryCard: null,
    receivedThumbs: [],
    gymList: [],
    _gymOptionsCache: [],
    canSeeToolbox: false,
    cityPickerVisible: false,
    gymPickerVisible: false,
    circlePickerVisible: false,
    cityOptions: buildCityOptions(),
    gymOptions: [],
    gymKeyword: "",
    _gymPickerState: { page: 0, hasMore: false, loading: false },
    selectedCircleId: "",
    selectedCircleLabel: "全部岩友圈",
    myCircleList: [],
    circleList: [],
    circleTotal: 0,
    circleHasMore: false,
    _circleMembershipMap: {}
  },

  noop() {},

  onLoad() {
    this.buildCalendarBase();
  },

  onShareAppMessage() {
    return {
      title: "飞岩走壁｜攀岩人的日历与名片",
      path: "/pages/home/index",
      imageUrl: "/images/avatar.png"
    };
  },

  onShareTimeline() {
    return {
      title: "飞岩走壁｜攀岩人的日历与名片",
      query: "",
      imageUrl: "/images/avatar.png"
    };
  },

  async onShow() {
    const app = getApp();
    try { await ensureAppLogin(); } catch (e) { console.warn("[home] ensureAppLogin failed", e && e.message); }
    try {
      const user = (app && app.globalData && app.globalData.user) || {};
      const openid = String(user && user.openid ? user.openid : "");
      if (openid && app && app.globalData && app.globalData._cache) {
        const last = String(app.globalData._cache.lastOpenid || "");
        if (last && last !== openid) {
          try { app.cacheClearAll(); } catch (_) {}
        }
        if (openid) {
          try { app.globalData._cache.lastOpenid = openid; } catch (_) {}
          try { wx.setStorageSync(CACHE_KEYS.LAST_OPENID, openid); } catch (_) {}
        }
      }
    } catch (_) {}
    const user = (app && app.globalData && app.globalData.user) || {};
    let me = (app && app.globalData && app.globalData.me) || {};
    try {
      const cached = await app.cacheGet(CACHE_KEYS.ME_PROFILE, {
        ttlMin: 60,
        loader: async () => {
          const r = await userApi.getMe();
          return r && r.me ? r.me : null;
        },
        useL2: true
      });
      if (cached) {
        me = cached;
        if (app && app.globalData) app.globalData.me = cached;
      }
    } catch (e) {
      console.warn("[home] getMe cache fallback", e && e.message);
      try {
        const r = await userApi.getMe();
        if (r && r.me) { me = r.me; if (app && app.globalData) app.globalData.me = r.me; }
      } catch (e2) { console.warn("[home] getMe failed", e2 && e2.message); }
    }
    let storedCity = "";
    try { storedCity = String(wx.getStorageSync("home_city") || ""); } catch (_) {}
    const city = safeText(this.data.city) || safeText(me.city) || safeText(user.city) || safeText(storedCity) || "杭州";
    this.setData({
      user: {
        nickName: user.nickName || me.nickName || "",
        avatarUrl: user.avatarUrl || me.avatarUrl || "",
        projectName: user.projectName || "Project",
        rockId: user.rockId || me.rockId || ""
      },
      me,
      city
    });
    try { this.setData({ canSeeToolbox: !!isAdminUser(user) }); } catch (e) {}
    // issue #11: 首次进入全量加载；后续切 tab 回首页只加载缓存，避免每次弹“加载中”
    const firstLoad = !this._homeLoadedOnce;
    this._homeLoadedOnce = true;
    this.loadAllHome(firstLoad);
  },

  buildCalendarBase() {
    const today = todayYMD();
    const start = today;
    const cells = [];
    for (let i = 0; i < CALENDAR_DAYS; i++) {
      const d = addDays(start, i);
      const isToday = i === 0;
      const label = isToday
        ? String(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getDate())
        : (() => {
            const dayNum = Number(d.slice(8, 10));
            const prev = addDays(d, -1);
            const sameMonth = d.slice(0, 7) === prev.slice(0, 7);
            return sameMonth ? String(dayNum) : `${Number(d.slice(5, 7))}/${dayNum}`;
          })();
      cells.push({ date: d, label, isToday, total: 0, heatCls: "" });
    }
    this.setData({ dateCells: cells, calendarLabel: monthLabel(start) });
  },

  async loadAllHome(force) {
    // issue #11: force=true 全量刷新（首次进入/手动点刷新）；否则仅加载缓存数据，不弹加载中
    const isForce = force !== false;
    try { await this.loadGymList(isForce); } catch (e) { console.warn("[home] preloadGymList failed", e && e.message); }
    const safe = async (name, fn) => { try { await fn(); } catch (e) { console.warn("[home] loadAllHome", name, "failed", e && e.message); } };
    const groupIndependent = Promise.all([
      safe("friend", () => this.loadFriendCombined(isForce)),
      safe("cardSummary", () => this.loadCardSummary(isForce)),
      safe("calendarStats", () => this.loadCalendarStats(isForce)),
      safe("myCircles", () => this.loadMyCircles(isForce))
    ]);
    const groupCalendar = safe("calendar", () => this.loadCalendar(isForce));
    await Promise.all([groupIndependent, groupCalendar]);
    if (this.data.gymId) {
      await safe("gymCircles", () => this.loadGymCircles(isForce));
    }
    try { wx.setStorageSync("home_city", safeText(this.data.city)); } catch (_) {}
    try {
      const app = getApp();
      if (app && typeof app.prewarmOtherTabs === "function") {
        setTimeout(() => { try { app.prewarmOtherTabs(); } catch (_) {} }, 50);
      }
    } catch (_) {}
  },

  // issue #11: 手动刷新——发布日历右侧小图标点击，全量重新加载
  onTapRefresh() {
    this.loadAllHome(true);
  },

  async loadFriendCombined(force) {
    const app = getApp();
    try {
      const r = await app.cacheGet(CACHE_KEYS.FRIEND_COMBINED, {
        ttlMin: 3,
        forceRefresh: !!force,
        loader: async () => {
          return await friendshipApi.list({ pageSize: 20 });
        },
        useL2: false
      });
      const notiDot = ((r && r.incoming) || []).length > 0;
      const accepted = (r && r.accepted) || [];
      const legacy = (r && r.legacyFollow) || [];
      let friendCount = accepted.length + legacy.length;
      const me = this.data.me || {};
      if (!friendCount && me.acceptedCount != null) friendCount = Number(me.acceptedCount || 0);
      this.setData({
        notiDot,
        "stats.friends": friendCount
      });
    } catch (e) {
      console.warn("[home] loadFriendCombined failed", e && e.message);
      try {
        const r = await friendshipApi.list({ pageSize: 20 });
        const accepted = (r && r.accepted) || [];
        const legacy = (r && r.legacyFollow) || [];
        this.setData({
          notiDot: ((r && r.incoming) || []).length > 0,
          "stats.friends": accepted.length + legacy.length
        });
      } catch (e2) {
        const me = this.data.me || {};
        if (me.acceptedCount != null) this.setData({ "stats.friends": Number(me.acceptedCount || 0) });
      }
    }
  },

  async loadMyCircles(force) {
    const app = getApp();
    try {
      const cached = await app.cacheGet(CACHE_KEYS.MY_CIRCLES, {
        ttlMin: 30,
        forceRefresh: !!force,
        loader: async () => {
          const r = await circleApi.myList();
          return (r && r.list) || [];
        },
        useL2: true
      });
      this.setData({ myCircleList: Array.isArray(cached) ? cached : [] });
    } catch (e) {
      console.warn("[home] loadMyCircles failed", e && e.message);
      try {
        const r = await circleApi.myList();
        this.setData({ myCircleList: (r && r.list) || [] });
      } catch (_) {
        this.setData({ myCircleList: [] });
      }
    }
  },

  async loadGymCircles(force) {
    if (!safeText(this.data.gymId)) {
      this.setData({ circleList: [], circleTotal: 0, circleHasMore: false, _circleMembershipMap: {} });
      return;
    }
    try {
      const app = getApp();
      const cacheKey = `${CACHE_KEYS.MY_CIRCLES}_gym_${safeText(this.data.gymId)}`;
      const cached = await app.cacheGet(cacheKey, {
        ttlMin: 5,
        forceRefresh: !!force,
        loader: async () => {
          const params = {
            city: safeText(this.data.city),
            gymId: safeText(this.data.gymId),
            page: 1,
            pageSize: CIRCLE_HOME_LIMIT + 1
          };
          return await circleApi.list(params);
        },
        useL2: false
      });
      const list = Array.isArray(cached && cached.list) ? cached.list : [];
      const total = Number(cached && cached.total ? cached.total : list.length);
      const hasMore = list.length > CIRCLE_HOME_LIMIT;
      const showList = list.slice(0, CIRCLE_HOME_LIMIT);
      const membershipMap = (cached && cached.myMembershipMap) || {};
      this.setData({
        circleList: showList,
        circleTotal: total,
        circleHasMore: hasMore,
        _circleMembershipMap: membershipMap
      });
    } catch (e) {
      console.warn("[home] loadGymCircles failed", e && e.message);
      this.setData({ circleList: [], circleTotal: 0, circleHasMore: false, _circleMembershipMap: {} });
    }
  },

  getCircleMembership(circleId) {
    const map = this.data._circleMembershipMap || {};
    return map[String(circleId)] || null;
  },

  onTapCircleFilter() {
    this.setData({ circlePickerVisible: true });
  },
  onCloseCirclePicker() {
    this.setData({ circlePickerVisible: false });
  },
  onPickCircle(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || "";
    const name = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || "全部岩友圈";
    this.setData({
      selectedCircleId: id,
      selectedCircleLabel: id ? name : "全部岩友圈",
      circlePickerVisible: false
    });
    this.loadCalendar(true);
  },

  async onTapCircleApply(e) {
    const circleId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.cid;
    if (!circleId) return;
    try {
      const r = await circleApi.apply({ circleId });
      const st = String(r && r.status || "");
      if (st === "pending" || st === "already_pending") {
        wx.showToast({ title: "已申请", icon: "none" });
      } else if (st === "already_member" || st === "already_admin") {
        wx.showToast({ title: "已在圈内", icon: "none" });
      } else {
        wx.showToast({ title: "已申请", icon: "success" });
      }
      await this.loadGymCircles(true);
    } catch (e) {
      console.warn("[home] apply circle fail", e && e.message);
      wx.showToast({ title: e && e.message || "申请失败", icon: "none" });
    }
  },

  onTapCircleCard(e) {
    const circleId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.cid;
    if (!circleId) return;
    wx.navigateTo({ url: `/pages/circle-detail/index?circleId=${circleId}` });
  },

  goCreateCircle() {
    const params = [];
    if (safeText(this.data.city)) params.push(`city=${encodeURIComponent(safeText(this.data.city))}`);
    if (safeText(this.data.gymId)) params.push(`gymId=${this.data.gymId}`);
    wx.navigateTo({ url: `/pages/circle-edit/index?${params.join("&")}` });
  },

  goMoreCircles() {
    const params = [];
    if (safeText(this.data.city)) params.push(`city=${encodeURIComponent(safeText(this.data.city))}`);
    if (safeText(this.data.gymId)) params.push(`gymId=${this.data.gymId}`);
    params.push(`gymName=${encodeURIComponent(safeText(this.data.gymFilterLabel))}`);
    wx.navigateTo({ url: `/pages/circle-list/index?${params.join("&")}` });
  },

  async loadCalendar(force) {
    try {
      const cells = this.data.dateCells || [];
      if (!cells.length) return;
      const params = {
        city: safeText(this.data.city),
        visibility: this.data.visibility,
        startDate: cells[0].date,
        endDate: cells[cells.length - 1].date
      };
      if (this.data.gymId) params.gymId = this.data.gymId;
      const app = getApp();
      const cacheKey = `${CACHE_KEYS.CALENDAR_SUMMARY}_home_${safeText(this.data.city)}_${this.data.visibility}`;
      const res = await app.cacheGet(cacheKey, {
        ttlMin: 1,
        forceRefresh: !!force,
        loader: async () => await calendarApi.queryCalendar(params),
        useL2: false
      });
      const aggArr = (res && res.dateAgg) || [];
      const agg = {};
      aggArr.forEach((a) => { agg[a.date] = a; });
      const updated = cells.map((c) => {
        const a = agg[c.date] || { total: 0 };
        const total = Number(a.total || 0);
        let heat = 0;
        if (total >= 10) heat = 3;
        else if (total >= 4) heat = 2;
        else if (total >= 1) heat = 1;
        return { ...c, total, heatCls: heat > 0 ? `heat--${heat}` : "" };
      });
      this.setData({ dateCells: updated });
    } catch (e) { console.warn("[home] loadCalendar failed", e && e.message); }
  },

  async loadCardSummary(force) {
    const app = getApp();
    try {
      const res = await app.cacheGet(CACHE_KEYS.CARD_SUMMARY, {
        ttlMin: 30,
        forceRefresh: !!force,
        loader: async () => await cardApi.listMy({}),
        useL2: true
      });
      const credit = (res && res.credit) || { remaining: 0, limit: 10 };
      const remaining = Number(credit && credit.remaining ? credit.remaining : 0);
      const limit = Number(credit && credit.limit ? credit.limit : 0);
      const creditPercent = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining * 100) / limit))) : 0;
      const receivedCount = Number(res && res.receivedCount ? res.receivedCount : 0);
      this.setData({
        credit,
        creditPercent,
        myPrimaryCard: (res && res.myPrimaryCard) || null,
        receivedThumbs: (res && res.receivedThumbs) || [],
        "stats.received": receivedCount
      });
    } catch (e) {
      console.warn("[home] loadCardSummary failed", e && e.message);
      try {
        const res = await cardApi.listMy({});
        const credit = (res && res.credit) || { remaining: 0, limit: 10 };
        const remaining = Number(credit && credit.remaining ? credit.remaining : 0);
        const limit = Number(credit && credit.limit ? credit.limit : 0);
        const creditPercent = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining * 100) / limit))) : 0;
        const receivedCount = Number(res && res.receivedCount ? res.receivedCount : 0);
        this.setData({
          credit,
          creditPercent,
          myPrimaryCard: (res && res.myPrimaryCard) || null,
          receivedThumbs: (res && res.receivedThumbs) || [],
          "stats.received": receivedCount
        });
      } catch (_) {}
    }
  },

  async loadCalendarStats(force) {
    const app = getApp();
    try {
      // 【约束】参数必须与 pages/calendar-mine/index.js loadAll 中完全一致，否则缓存串数据
      const params = { includeSummary: true, tab: "upcoming", page: 1, pageSize: 1 };
      const res = await app.cacheGet(CACHE_KEYS.CALENDAR_SUMMARY, {
        ttlMin: 30,
        forceRefresh: !!force,
        loader: async () => await calendarApi.mine(params, { loading: false, silent: true }),
        useL2: true
      });
      const summary = (res && res.summary) || {};
      this.setData({
        "stats.thisMonthPlans": Number(summary.thisMonthPlans || 0),
        "stats.checkinRate": Number(summary.thisMonthCheckinRate || 0)
      });
    } catch (e) {
      console.warn("[home] loadCalendarStats failed", e && e.message);
      try {
        const res = await calendarApi.mine({ includeSummary: true, tab: "upcoming", page: 1, pageSize: 1 }, { loading: false, silent: true });
        const summary = (res && res.summary) || {};
        this.setData({
          "stats.thisMonthPlans": Number(summary.thisMonthPlans || 0),
          "stats.checkinRate": Number(summary.thisMonthCheckinRate || 0)
        });
      } catch (_) {}
    }
  },

  async loadGymList(force) {
    const app = getApp();
    const cityKey = String(safeText(this.data.city) || "").trim().toLowerCase();
    const cacheKey = `${CACHE_KEYS.GYM_LIST_PREFIX}${cityKey}`;
    try {
      const res = await app.cacheGet(cacheKey, {
        ttlMin: 120,
        forceRefresh: !!force,
        loader: async () => await gymApi.list(
          { city: safeText(this.data.city), keyword: "", page: 1, pageSize: 20 },
          { loading: false }
        ),
        useL2: true
      });
      const list = (res && res.gyms) || [];
      const options = toGymOptions(list);
      this.setData({
        gymList: list,
        _gymOptionsCache: options,
        gymOptions: options
      });
    } catch (e) {
      console.warn("[home] loadGymList failed", e && e.message);
      try {
        const res = await gymApi.list(
          { city: safeText(this.data.city), keyword: "", page: 1, pageSize: 20 },
          { loading: false }
        );
        const list = (res && res.gyms) || [];
        const options = toGymOptions(list);
        this.setData({
          gymList: list,
          _gymOptionsCache: options,
          gymOptions: options
        });
      } catch (_) {
        this.setData({ gymList: [], _gymOptionsCache: [], gymOptions: [] });
      }
    }
  },

  onSwitchVisibility(e) {
    const v = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v;
    if (!v || v === this.data.visibility) return;
    this.setData({ visibility: v });
    this.loadCalendar(true);
  },

  onTapCity() {
    this.setData({ cityPickerVisible: true });
  },
  onCloseCityPicker() {
    this.setData({ cityPickerVisible: false });
  },
  onPickCity(e) {
    const city = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.city;
    const custom = !!(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.custom);
    if (custom) {
      this.setData({ cityPickerVisible: false });
      const self = this;
      wx.showModal({
        title: "输入城市",
        editable: true,
        placeholderText: "如：苏州",
        success(r) {
          if (r.confirm && safeText(r.content)) {
            const newCity = safeText(r.content);
            self.setData({
              city: newCity,
              gymId: "",
              gymFilterLabel: "全部岩馆",
              gymList: [],
              _gymOptionsCache: [],
              gymOptions: [],
              gymKeyword: "",
              _gymPickerState: { page: 0, hasMore: false, loading: false }
            });
            self.loadAllHome();
          }
        }
      });
      return;
    }
    if (!city) return;
    this.setData({
      city: city,
      gymId: "",
      gymFilterLabel: "全部岩馆",
      gymList: [],
      _gymOptionsCache: [],
      gymOptions: [],
      gymKeyword: "",
      _gymPickerState: { page: 0, hasMore: false, loading: false },
      cityPickerVisible: false,
      circleList: [],
      circleTotal: 0,
      circleHasMore: false
    });
    this.loadAllHome();
  },

  async onTapGymFilter() {
    // issue #9: 不闪现旧缓存（可能只有 7 条），直接 loading + 重新拉全量
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
    this.onGymPickerLoadMore();
  },
  async onGymPickerLoadMore() {
    const st = this.data._gymPickerState || {};
    if (st.loading || !st.hasMore) return;
    await this.loadGymPicker(false);
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
      const list = (res && res.gyms) || [];
      const hasMore = !!(res && res.hasNext);
      const options = toGymOptions(list);
      const merged = reset ? options : (this.data.gymOptions || []).concat(options);
      this.setData({
        gymOptions: merged,
        "_gymPickerState.page": page,
        "_gymPickerState.hasMore": hasMore,
        "_gymPickerState.loading": false
      });
      if (reset && !keyword) {
        this.setData({ _gymOptionsCache: merged, gymList: list });
      }
    } catch (e) {
      if (token !== this._gymPickerToken) return;
      console.warn("[home] loadGymPicker failed", e && e.message);
      this.setData({ "_gymPickerState.loading": false });
    }
  },
  onPickGym(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || "";
    const name = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || "全部岩馆";
    this.setData({
      gymId: id,
      gymFilterLabel: id ? name : "全部岩馆",
      gymPickerVisible: false
    });
    this.loadCalendar(true);
    this.loadGymCircles(true);
  },

  onTapDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    const params = [`date=${date}`];
    if (safeText(this.data.city)) params.push(`city=${encodeURIComponent(safeText(this.data.city))}`);
    if (this.data.gymId) params.push(`gymId=${this.data.gymId}`);
    params.push(`visibility=${this.data.visibility}`);
    wx.navigateTo({ url: `/pages/calendar-timeline/index?${params.join("&")}` });
  },

  onTapCheckin() {
    // issue #18: 未选岩馆时直接拦截，禁止进入下一步；已选岩馆时直接进入对应岩馆打卡页，不再弹选项
    const gymId = safeText(this.data.gymId);
    if (!gymId) {
      wx.showToast({ title: "请先选择岩馆再打卡", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/checkin/index?gymId=${gymId}` });
  },

  onTapPublish() {
    const params = [];
    if (safeText(this.data.city)) params.push(`city=${encodeURIComponent(safeText(this.data.city))}`);
    if (this.data.gymId) params.push(`gymId=${this.data.gymId}`);
    wx.navigateTo({ url: `/pages/calendar-publish/index?${params.join("&")}` });
  },

  goMe() { wx.switchTab({ url: "/pages/me/index", fail: () => wx.navigateTo({ url: "/pages/me/index" }) }); },
  goMine() { wx.switchTab({ url: "/pages/calendar-mine/index", fail: () => wx.navigateTo({ url: "/pages/calendar-mine/index" }) }); },
  goFriendList() { wx.navigateTo({ url: "/pages/friend-list/index" }); },
  goMyCard() { try { wx.switchTab({ url: "/pages/me/index" }); } catch (_) {} },
  goCheckin() { this.onTapCheckin(); },
  goNearestGym() { this.goGymMerge(); },
  goOwner() { wx.navigateTo({ url: "/pages/owner/index" }); },
  goGymMerge() { wx.navigateTo({ url: "/pages/gym-merge/index" }); },
  onTapGym(e) {
    const gid = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.gid;
    if (!gid) return;
    wx.navigateTo({ url: `/pages/wall/index?gymId=${gid}` });
  }
});
