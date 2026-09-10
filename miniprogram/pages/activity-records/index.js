const calendarApi = require("../../services/api/calendar");
const { summary } = require("../../services/api/stats");
const { ensureAppLogin } = require("../../utils/session");
const { CACHE_KEYS } = require("../../utils/cache");

const CALENDAR_MINE_TIMELINE_KEY = `${CACHE_KEYS.CALENDAR_SUMMARY}_timeline_v2`;

function _ymdCmpDesc(a, b) {
  if (!a || !b) return 0;
  return a < b ? 1 : (a > b ? -1 : 0);
}

function _rebuildActivityList(ctx) {
  const list = [];

  (ctx._myPlans || []).forEach((p) => {
    list.push({
      key: `p_${p.id}`,
      gymName: p.gymName,
      date: p.date,
      subText: p.note ? `${p.rangeText || ""} · ${p.note}` : (p.rangeText || "约爬"),
      badgeType: p.status === "cancelled" ? "plan-cancel" : (p._isPast ? "plan-done" : "plan-ongoing"),
      badgeText: p.status === "cancelled" ? "已取消" : (p._isPast ? "已结束" : "计划中"),
      rightText: `${p.joinedCount || 1}人`
    });
  });

  (ctx._checkins || []).forEach((c) => {
    list.push({
      key: `c_${c.id}`,
      gymName: c.gymName,
      date: c.date,
      subText: c.modeText,
      badgeType: "checkin",
      badgeText: "已打卡",
      rightText: `+${c.delta}`
    });
  });

  (ctx._joined || []).forEach((j) => {
    list.push({
      key: `j_${j.id}`,
      gymName: j.gymName,
      date: j.date,
      subText: j.note ? `${j.rangeText || ""} · ${j.note}` : (j.rangeText || "约爬"),
      badgeType: "joined",
      badgeText: "已报名",
      rightText: `${j.joinedCount || 1}人`
    });
  });

  list.sort((a, b) => {
    const c = _ymdCmpDesc(a.date, b.date);
    if (c !== 0) return c;
    const order = { checkin: 0, "plan-ongoing": 1, joined: 2, "plan-done": 3, "plan-cancel": 4 };
    return (order[a.badgeType] || 9) - (order[b.badgeType] || 9);
  });

  ctx._allActivity = list;
  ctx._showActivityPage(1);
}

const ACTIVITY_PAGE_SIZE = 7;

Page({
  data: {
    userName: "我",
    summary: {
      thisMonthPlans: 0,
      thisMonthCheckinRate: 0,
      topGym: {},
      topGymName: "",
      totalPartners: 0
    },
    stats: {
      recent: [],
      page: 1,
      pageSize: 5,
      hasNext: false,
      loading: false
    },
    activityList: [],
    activityTotal: 0,
    activityPage: 1,
    activityPageSize: ACTIVITY_PAGE_SIZE,
    activityPageCount: 1,
    moreStatsVisible: false
  },

  async onLoad() {
    try { await ensureAppLogin(); } catch (e) {}
    this._myPlans = [];
    this._checkins = [];
    this._joined = [];
    Promise.resolve().then(() => this.loadAll()).catch(() => {});
    Promise.resolve().then(() => this.loadStats({ reset: true })).catch(() => {});
    Promise.resolve().then(() => this.loadJoined()).catch(() => {});
  },

  onShareAppMessage() {
    return {
      title: "我的攀岩日历",
      path: "/pages/calendar-mine/index",
      imageUrl: "/images/avatar.png"
    };
  },

  onShareTimeline() {
    return {
      title: "我的攀岩日历",
      query: "",
      imageUrl: "/images/avatar.png"
    };
  },

  onShow() {
    if (this._onShowRunning) return;
    this._onShowRunning = true;
    Promise.resolve()
      .then(() => this.loadAll(true, true).catch(() => {}))
      .then(() => this.loadStats({ reset: true, forceRefresh: true }).catch(() => {}))
      .then(() => this.loadJoined().catch(() => {}))
      .finally(() => { this._onShowRunning = false; });
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        Promise.resolve().then(() => this.loadAll(true, true)).catch(() => {}),
        Promise.resolve().then(() => this.loadStats({ reset: true, silent: true, forceRefresh: true })).catch(() => {}),
        Promise.resolve().then(() => this.loadJoined()).catch(() => {})
      ]);
    } finally { try { wx.stopPullDownRefresh(); } catch (_) {} }
  },

  async loadAll(silent, forceRefresh) {
    const app = getApp();
    try {
      const res = await app.cacheGet(CALENDAR_MINE_TIMELINE_KEY, {
        ttlMin: 5,
        forceRefresh: !!forceRefresh,
        useL2: false,
        loader: async () => {
          return await calendarApi.mine({ includeSummary: true, tab: "upcoming", page: 1, pageSize: 50 });
        }
      });
      const s = (res && res.summary) || {};
      const upcoming = (res && res.upcoming) || [];
      const past = (res && res.past) || [];
      const rateRaw = Number(s.thisMonthCheckinRate || 0);
      const thisMonthCheckinRate = rateRaw <= 1 ? Math.round(rateRaw * 100) : Math.round(rateRaw);
      const tg = s.topGym || {};
      const g = app && app.globalData && app.globalData.me;
      const userName = (g && (g.displayName || g.nickName)) ? (g.displayName || g.nickName) : "我";

      const now = new Date();
      const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      this._myPlans = []
        .concat((upcoming || []).map((p) => ({
          id: p._id || "",
          gymName: (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "攀岩",
          date: p.date || "",
          rangeText: `${p.startTime || ""}-${p.endTime || ""}`,
          note: p.note || "",
          joinedCount: Number(p.joinedCount || 1),
          status: p.status || "",
          _isPast: (p.date || "") < todayYmd
        })))
        .concat((past || []).map((p) => ({
          id: p._id || "",
          gymName: (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "攀岩",
          date: p.date || "",
          rangeText: `${p.startTime || ""}-${p.endTime || ""}`,
          note: p.note || "",
          joinedCount: Number(p.joinedCount || 1),
          status: p.status || "",
          _isPast: true
        })));

      this.setData({
        summary: {
          ...s,
          thisMonthPlans: Number(s.thisMonthPlans || 0),
          thisMonthCheckinRate,
          topGym: tg,
          topGymName: tg.name || tg.gymName || "",
          totalPartners: Number(s.totalPartners || 0)
        },
        userName
      });
      _rebuildActivityList(this);
    } catch (e) {
      if (!silent) { try { wx.showToast({ title: e && e.message || "加载失败", icon: "none" }); } catch (_) {} }
    }
  },

  async loadStats({ reset, silent, forceRefresh }) {
    const app = getApp();
    if (!silent) { try { this.setData({ "stats.loading": true }); } catch (_) {} }
    try {
      const res = await app.cacheGet(CACHE_KEYS.STATS_30DAY, {
        ttlMin: 60,
        forceRefresh: !!forceRefresh,
        useL2: true,
        loader: async () => {
          return await summary({ days: 30, page: 1, pageSize: this.data.stats.pageSize });
        }
      });
      this._checkins = ((res && res.recent) || []).map((r) => ({
        id: (r && r._id) ? r._id : `${r && r.date ? r.date : ""}_${r && r.gymId ? r.gymId : ""}_${Math.random().toString(36).slice(2)}`,
        gymName: (r && r.gymName) ? r.gymName : "",
        date: (r && r.date) ? r.date : "",
        delta: (r && r.delta) ? Number(r.delta || 0) : 0,
        modeText: (r && r.mode === "boulder") ? "抱石" : (r && r.mode === "lead" ? "先锋" : (r && r.mode === "toprope" ? "顶绳" : "攀岩"))
      }));
      const routeCount30d = (Array.isArray(res.chartPoints) ? res.chartPoints : [])
        .reduce((sum, v) => sum + (Number(v) || 0), 0);
      this.setData({
        stats: {
          ...this.data.stats,
          recent: this._checkins.slice(),
          loading: false
        },
        routeCount30d
      });
      _rebuildActivityList(this);
    } catch (e) {
      try { this.setData({ "stats.loading": false }); } catch (_) {}
      if (!silent) { try { wx.showToast({ title: "加载失败", icon: "none" }); } catch (_) {} }
    }
  },

  async loadJoined() {
    try {
      const r = await calendarApi.mine({ tab: "joined", page: 1, pageSize: 20 });
      this._joined = ((r && r.joined) || []).map((p) => ({
        id: p._id || "",
        gymName: (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "攀岩",
        date: p.date || "",
        rangeText: `${p.startTime || ""}-${p.endTime || ""}`,
        note: p.note || "",
        joinedCount: Number(p.joinedCount || 1)
      }));
      _rebuildActivityList(this);
    } catch (e) {
      this._joined = [];
    }
  },

  _showActivityPage(p) {
    const all = this._allActivity || [];
    const pageCount = Math.max(1, Math.ceil(all.length / ACTIVITY_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, p), pageCount);
    const start = (safePage - 1) * ACTIVITY_PAGE_SIZE;
    const shown = all.slice(start, start + ACTIVITY_PAGE_SIZE);
    this.setData({
      activityList: shown,
      activityTotal: all.length,
      activityPage: safePage,
      activityPageCount: pageCount
    });
  },

  onActivityPrev() {
    if (this.data.activityPage <= 1) return;
    this._showActivityPage(this.data.activityPage - 1);
  },

  onActivityNext() {
    if (this.data.activityPage >= this.data.activityPageCount) return;
    this._showActivityPage(this.data.activityPage + 1);
  },

  noop() {},

  openMoreStats() {
    this.setData({ moreStatsVisible: true });
  },

  closeMoreStats() {
    this.setData({ moreStatsVisible: false });
  },

  goCheckin() {
    wx.navigateTo({ url: "/pages/checkin/index" });
  }
});
