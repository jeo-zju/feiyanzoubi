const calendarApi = require("../../services/api/calendar");
const { summary } = require("../../services/api/stats");
const { ensureAppLogin } = require("../../utils/session");
const { CACHE_KEYS } = require("../../utils/cache");

const TRACK_COUNT = 5;
const TRACK_STEP_RPX = 90;
const TRACK_TOP_PAD_RPX = 80;
const TIMELINE_DAYS = 28;
const CALENDAR_MINE_TIMELINE_KEY = `${CACHE_KEYS.CALENDAR_SUMMARY}_timeline_v1`;

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function todayYMD() {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${utc8.getFullYear()}-${pad2(utc8.getMonth() + 1)}-${pad2(utc8.getDate())}`;
}
function addDays(ymd, days) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function diffDays(a, b) {
  const ma = String(a).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const mb = String(b).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ma || !mb) return 0;
  const ta = new Date(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3])).getTime();
  const tb = new Date(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3])).getTime();
  return Math.round((ta - tb) / 86400000);
}
function parseYMD(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function shortGymName(name) {
  const s = String(name || "未命名").trim();
  if (!s) return "未命名";
  if (s.length <= 6) return s;
  return s.slice(0, 5) + "…";
}
function buildXLabels(startDate, totalDays) {
  const arr = [];
  const labelEvery = Math.max(1, Math.floor(totalDays / 4));
  for (let i = 0; i < totalDays; i += labelEvery) {
    const d = addDays(startDate, i);
    const dt = parseYMD(d);
    if (!dt) continue;
    arr.push({
      idx: i,
      pct: Math.round((i / (totalDays - 1)) * 10000) / 100,
      label: `${dt.getMonth() + 1}/${dt.getDate()}`
    });
  }
  if (arr.length && arr[arr.length - 1].idx !== totalDays - 1) {
    const d = addDays(startDate, totalDays - 1);
    const dt = parseYMD(d);
    if (dt) {
      arr.push({
        idx: totalDays - 1,
        pct: 100,
        label: `${dt.getMonth() + 1}/${dt.getDate()}`
      });
    }
  }
  return arr;
}

Page({
  data: {
    userName: "我",
    trackCount: TRACK_COUNT,
    todayPct: 50,
    startDate: "",
    endDate: "",
    events: [],
    xLabels: [],
    summary: {
      thisMonthPlans: 0,
      thisMonthCheckinRate: 0,
      topGym: {},
      topGymName: "",
      totalPartners: 0
    },
    stats: {
      chartPoints: [],
      summaryText: "",
      recent: [],
      page: 1,
      pageSize: 5,
      hasNext: false,
      loading: false
    },
    mineTab: "checkins",
    mineTabs: [
      { key: "myPlans", label: "我发布的" },
      { key: "checkins", label: "我打卡的" },
      { key: "joined", label: "我报名的" }
    ],
    myPlansList: [],
    joinedList: []
  },

  async onLoad() {
    try { await ensureAppLogin(); } catch (e) {}
    try { await this.loadAll(); } catch (_) {}
    try { await this.loadStats({ reset: true }); } catch (_) {}
  },

  onShow() {
    if (this._onShowRunning) return;
    this._onShowRunning = true;
    Promise.resolve()
      .then(() => this.loadAll().catch(() => {}))
      .then(() => this.loadStats({ reset: true }).catch(() => {}))
      .finally(() => { this._onShowRunning = false; });
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        Promise.resolve().then(() => this.loadAll(true, true)).catch(() => {}),
        Promise.resolve().then(() => this.loadStats({ reset: true, silent: true, forceRefresh: true })).catch(() => {})
      ]);
    } finally { try { wx.stopPullDownRefresh(); } catch (_) {} }
  },

  async loadAll(silent, forceRefresh) {
    const app = getApp();
    try {
      // 注意：本页 calendarApi.mine 需要 pageSize=50 以获取 upcoming 列表，首页用 pageSize=1
      // 因此本页使用独立的缓存 key，与首页不冲突
      const res = await app.cacheGet(CALENDAR_MINE_TIMELINE_KEY, {
        ttlMin: 5,
        forceRefresh: !!forceRefresh,
        useL2: false,
        loader: async () => {
          // 参数必须保持 pageSize=50 以获得足够 upcoming 数据用于时间轴渲染
          return await calendarApi.mine({ includeSummary: true, tab: "upcoming", page: 1, pageSize: 50 });
        }
      });
      const s = (res && res.summary) || {};
      const upcoming = (res && res.upcoming) || [];
      this._recentUpcoming = upcoming;
      const rateRaw = Number(s.thisMonthCheckinRate || 0);
      const thisMonthCheckinRate = rateRaw <= 1 ? Math.round(rateRaw * 100) : Math.round(rateRaw);
      const tg = s.topGym || {};
      const g = app && app.globalData && app.globalData.me;
      const userName = (g && (g.displayName || g.nickName)) ? (g.displayName || g.nickName) : "我";

      const myPlansList = (upcoming || []).map((p) => ({
        id: p._id || "",
        gymName: (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "攀岩",
        date: p.date || "",
        rangeText: `${p.startTime || ""}-${p.endTime || ""}`,
        note: p.note || "",
        joinedCount: Number(p.joinedCount || 1),
        statusText: p.status === "cancelled" ? "已取消" : (p.date >= todayYMD() ? "计划中" : "已结束")
      }));

      this.setData({
        summary: {
          ...s,
          thisMonthPlans: Number(s.thisMonthPlans || 0),
          thisMonthCheckinRate,
          topGym: tg,
          topGymName: tg.name || tg.gymName || "",
          totalPartners: Number(s.totalPartners || 0)
        },
        userName,
        myPlansList
      });
      this._buildTimeline();
    } catch (e) {
      if (!silent) { try { wx.showToast({ title: e && e.message || "加载失败", icon: "none" }); } catch (_) {} }
    }
  },

  async loadStats({ reset, silent, forceRefresh }) {
    const app = getApp();
    const nextPage = reset ? 1 : this.data.stats.page;
    if (!silent) {
      try { this.setData({ "stats.loading": true }); } catch (_) {}
    }
    try {
      let res;
      if (reset) {
        res = await app.cacheGet(CACHE_KEYS.STATS_30DAY, {
          ttlMin: 60,
          forceRefresh: !!forceRefresh,
          useL2: true,
          loader: async () => {
            return await summary({
              days: 30,
              page: 1,
              pageSize: this.data.stats.pageSize
            });
          }
        });
      } else {
        res = await summary({
          days: 30,
          page: nextPage,
          pageSize: this.data.stats.pageSize
        });
      }
      const recent = ((res && res.recent) || []).map((r) => ({
        id: (r && r._id) ? r._id : `${r && r.date ? r.date : ""}_${r && r.gymId ? r.gymId : ""}_${r && r.mode ? r.mode : ""}_${Math.random().toString(36).slice(2)}`,
        gymName: (r && r.gymName) ? r.gymName : "",
        date: (r && r.date) ? r.date : "",
        delta: (r && r.delta) ? Number(r.delta || 0) : 0,
        modeText: (r && r.mode === "boulder") ? "抱石" : (r && r.mode === "lead" ? "先锋" : (r && r.mode === "toprope" ? "顶绳" : "攀岩"))
      }));
      const hasNext = !!(res && res.hasNext);
      if (reset) {
        this._recentActual = recent;
      } else {
        this._recentActual = (this._recentActual || []).concat(recent);
      }
      this.setData({
        stats: {
          ...this.data.stats,
          chartPoints: reset ? [] : this.data.stats.chartPoints,
          summaryText: reset ? ((res && res.summaryText) || "") : this.data.stats.summaryText,
          recent: reset ? recent : [...this.data.stats.recent, ...recent],
          page: nextPage,
          hasNext,
          loading: false
        }
      });
      this._buildTimeline();
    } catch (e) {
      try { this.setData({ "stats.loading": false }); } catch (_) {}
      if (!silent) { try { wx.showToast({ title: "加载失败", icon: "none" }); } catch (_) {} }
    }
  },

  _buildTimeline() {
    const start = todayYMD();
    const startDate = addDays(start, -14);
    const endDate = addDays(start, 13);
    const todayPct = 14 / (TIMELINE_DAYS - 1) * 100;
    const xLabels = buildXLabels(startDate, TIMELINE_DAYS);

    const all = [];
    (this._recentActual || []).forEach((r, i) => {
      if (!r || !r.date) return;
      const delta = diffDays(r.date, startDate);
      if (delta < 0 || delta >= TIMELINE_DAYS) return;
      all.push({
        _sort: `${r.date}_a_${i}`,
        date: r.date,
        delta,
        isPlan: false,
        gymName: r.gymName || ""
      });
    });
    (this._recentUpcoming || []).forEach((p, i) => {
      if (!p || !p.date) return;
      const delta = diffDays(p.date, startDate);
      if (delta < 0 || delta >= TIMELINE_DAYS) return;
      const gname = (p && p.gymName) ? p.gymName : ((p && p.gymSnapshot && p.gymSnapshot.name) ? p.gymSnapshot.name : "");
      all.push({
        _sort: `${p.date}_p_${i}`,
        date: p.date,
        delta,
        isPlan: true,
        gymName: gname
      });
    });

    all.sort((a, b) => {
      if (a.delta !== b.delta) return a.delta - b.delta;
      if (a.isPlan !== b.isPlan) return a.isPlan ? 1 : -1;
      return a._sort.localeCompare(b._sort);
    });

    const used = Array.from({ length: TRACK_COUNT }, () => new Set());
    const pickedTrack = (delta) => {
      const order = [2, 1, 3, 0, 4];
      for (let t = 0; t < TRACK_COUNT; t++) {
        const track = order[t];
        let ok = true;
        for (let k = -1; k <= 1; k++) {
          if (used[track] && used[track].has(delta + k)) { ok = false; break; }
        }
        if (ok) return track;
      }
      let best = 2, bestScore = Infinity;
      for (let t = 0; t < TRACK_COUNT; t++) {
        const s = (used[t] ? used[t].size : 0);
        if (s < bestScore) { bestScore = s; best = t; }
      }
      return best;
    };

    const events = all.map((ev, i) => {
      const track = pickedTrack(ev.delta);
      used[track].add(ev.delta);
      const xPct = Math.round((ev.delta / (TIMELINE_DAYS - 1)) * 10000) / 100;
      const yRpx = TRACK_TOP_PAD_RPX + track * TRACK_STEP_RPX;
      return {
        key: `${ev.delta}_${track}_${i}`,
        xPct,
        yRpx,
        isPlan: ev.isPlan,
        gymShort: shortGymName(ev.gymName)
      };
    });

    this.setData({
      startDate,
      endDate,
      todayPct: Math.round(todayPct * 100) / 100,
      events,
      xLabels
    });
  },

  onStatsPrev() {
    if (this.data.stats.page <= 1) return;
    this.setData({ "stats.page": this.data.stats.page - 1 }, () => this.loadStats({ reset: true }).catch(() => {}));
  },

  onStatsNext() {
    if (!this.data.stats.hasNext) return;
    this.setData({ "stats.page": this.data.stats.page + 1 }, () => this.loadStats({ reset: false }).catch(() => {}));
  },

  onMineTabChange(e) {
    const v = (e && e.detail && e.detail.value) || "";
    if (!v || v === this.data.mineTab) return;
    this.setData({ mineTab: v });
    if (v === "joined" && !this._joinedLoaded) this.loadJoined().catch(() => {});
  },

  async loadJoined() {
    try {
      const r = await calendarApi.mine({ tab: "joined", page: 1, pageSize: 20 });
      const list = ((r && r.joined) || []).map((p) => ({
        id: p._id || "",
        gymName: (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "攀岩",
        date: p.date || "",
        rangeText: `${p.startTime || ""}-${p.endTime || ""}`,
        note: p.note || "",
        joinedCount: Number(p.joinedCount || 1)
      }));
      this._joinedLoaded = true;
      this.setData({ joinedList: list });
    } catch (e) {
      this.setData({ joinedList: [] });
    }
  }
});
