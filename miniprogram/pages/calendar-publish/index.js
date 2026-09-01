const calendarApi = require("../../services/api/calendar");
const gymApi = require("../../services/api/gym");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const cache = require("../../utils/cache");

const MAX_DAYS = 14;
const WEEK_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
// 时间段快速筛选预设：全天/上午/下午 + 自定义（时间段滚轮）。
// 全天取 10:00-22:00，与时间轴可视窗口（calendar-timeline 的 START_HOUR=10 / END_HOUR=22）一致，
// 同时满足云函数「单次计划不超过 12 小时」的约束（00:00-23:59 会触发后端 12 小时上限被拒绝）。
const TIME_QUICK = [
  { key: "allday", label: "全天", hint: "10:00-22:00", startTime: "10:00", endTime: "22:00" },
  { key: "morning", label: "上午", hint: "10:00-14:00", startTime: "10:00", endTime: "14:00" },
  { key: "afternoon", label: "下午", hint: "14:00-22:00", startTime: "14:00", endTime: "22:00" },
  { key: "custom", label: "时间段", hint: "自定义", startTime: "", endTime: "" }
];

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function addDays(baseDate, days) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  d.setDate(d.getDate() + days);
  return d;
}
function todayYMD(baseDate) {
  const d = baseDate || new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseYMD(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function hmLabel(v) { return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`; }

Page({
  data: {
    city: "",
    selectedGymId: "",
    selectedGymName: "",
    gymKeyword: "",
    gymSearched: [],
    gymSearching: false,
    dateCells: [],
    selectedDate: "",
    dateRangeLabel: "",
    startTime: "10:00",
    endTime: "22:00",
    hourOptions: (() => { const arr = []; for (let h = 6; h <= 23; h++) arr.push(`${h < 10 ? "0" + h : h}:00`); return arr; })(),
    startHourIdx: 4,
    endHourIdx: 16,
    durationHourText: "12 小时",
    timeQuickKey: "allday",
    timeQuickLabel: "全天",
    timeQuick: TIME_QUICK,
    visibility: "public",
    visibilityTabs: [
      { key: "public", label: "公开发布" },
      { key: "friends", label: "对岩友发布" },
      { key: "circle", label: "对岩友圈发布" }
    ],
    visibilityHint: "",
    advancedOpen: true,
    note: "",
    needPartner: true,
    skillTags: [
      { key: "boulder", label: "抱石", on: false, warn: true },
      { key: "lead", label: "先锋", on: false },
      { key: "toprope", label: "顶绳", on: false },
      { key: "auto", label: "自动锁", on: false },
      { key: "protector", label: "求保护员", on: false }
    ]
  },

  async onLoad(options) {
    try { await ensureAppLogin(); } catch (e) {}
    const city = decodeURIComponent(safeText(options && options.city) || "");
    const gymId = safeText(options && options.gymId) || "";
    const date = safeText(options && options.date) || todayYMD();

    const baseDate = new Date(Date.now() + 8 * 3600 * 1000);
    const cells = [];
    for (let i = 0; i < MAX_DAYS; i++) {
      const d = addDays(baseDate, i);
      const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const isToday = i === 0;
      const crossMonth = i > 0 && d.getMonth() !== addDays(baseDate, i - 1).getMonth();
      let label;
      if (crossMonth || i === 0) {
        label = `${d.getMonth() + 1}/${d.getDate()}`;
      } else {
        label = String(d.getDate());
      }
      cells.push({
        date: ymd,
        label,
        isToday,
        weekdayShort: isToday ? "" : WEEK_SHORT[d.getDay()],
        selected: ymd === date
      });
    }
    const startLabel = `${parseYMD(cells[0].date).getMonth() + 1}月${parseYMD(cells[0].date).getDate()}日`;
    const endLabel = `${parseYMD(cells[MAX_DAYS - 1].date).getMonth() + 1}月${parseYMD(cells[MAX_DAYS - 1].date).getDate()}日`;
    let gymName = "";
    if (gymId) {
      try {
        const g = await gymApi.get({ gymId });
        if (g && g.gym) gymName = g.gym.name || g.gym.gymName || "";
      } catch (e) {}
    }
    this.setData({
      city,
      selectedGymId: gymId,
      selectedGymName: gymName,
      dateCells: cells,
      selectedDate: date,
      dateRangeLabel: `${startLabel} - ${endLabel}`
    });
    this.recomputeDuration();
  },

  onUnload() {
    if (this._gymSearchTimer) {
      clearTimeout(this._gymSearchTimer);
      this._gymSearchTimer = null;
    }
    this._gymSearchToken = (this._gymSearchToken || 0) + 1;
  },

  onGymKeywordInput(e) {
    const keyword = safeText(e && e.detail && e.detail.value);
    this.setData({ gymKeyword: keyword });
    if (this._gymSearchTimer) {
      clearTimeout(this._gymSearchTimer);
      this._gymSearchTimer = null;
    }
    this._gymSearchToken = (this._gymSearchToken || 0) + 1;
    const token = this._gymSearchToken;
    if (!keyword) {
      this.setData({ gymSearched: [], gymSearching: false });
      return;
    }
    this.setData({ gymSearching: true });
    const self = this;
    this._gymSearchTimer = setTimeout(() => {
      self._gymSearchTimer = null;
      self.loadGymSearch(keyword, token);
    }, 300);
  },

  async loadGymSearch(keyword, token) {
    try {
      const res = await gymApi.list(
        { page: 1, pageSize: 10, keyword, city: safeText(this.data.city) },
        { loading: false }
      );
      if (token !== this._gymSearchToken) return;
      const list = (res && res.gyms) || [];
      this.setData({
        gymSearching: false,
        gymSearched: list.map((x) => ({
          _id: x._id,
          name: x.name || x.gymName || "",
          city: x.city || "",
          address: x.address || ""
        }))
      });
    } catch (e) {
      if (token !== this._gymSearchToken) return;
      this.setData({ gymSearched: [], gymSearching: false });
    }
  },

  onSelectGym(e) {
    const ds = e && e.currentTarget && e.currentTarget.dataset;
    this.setData({
      selectedGymId: ds.gymid || "",
      selectedGymName: ds.gymname || ""
    });
  },

  onClearGym() { this.setData({ selectedGymId: "", selectedGymName: "" }); },

  onSelectDate(e) {
    const date = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.date;
    if (!date) return;
    const cells = this.data.dateCells.map((x) => ({ ...x, selected: x.date === date }));
    this.setData({ dateCells: cells, selectedDate: date });
  },

  onSelectTimeQuick(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const preset = TIME_QUICK.find((x) => x.key === key);
    if (!preset) return;
    const patch = { timeQuickKey: key, timeQuickLabel: preset.label };
    if (key !== "custom" && preset.startTime && preset.endTime) {
      patch.startTime = preset.startTime;
      patch.endTime = preset.endTime;
    }
    // #20: 同步整点下拉索引（非整点时间就近取整）
    const roundHour = (hm) => {
      const m = this.timeHMToMin(hm || "10:00");
      const h = Math.max(6, Math.min(23, Math.round(m / 60)));
      return `${h < 10 ? "0" + h : h}:00`;
    };
    const sVal = key === "custom" ? this.data.startTime : patch.startTime || this.data.startTime;
    const eVal = key === "custom" ? this.data.endTime : patch.endTime || this.data.endTime;
    const sRound = roundHour(sVal);
    const eRound = roundHour(eVal);
    patch.startHourIdx = Math.max(0, this.data.hourOptions.indexOf(sRound));
    patch.endHourIdx = Math.max(0, this.data.hourOptions.indexOf(eRound));
    if (key === "custom") {
      patch.startTime = sRound;
      patch.endTime = eRound;
    }
    this.setData(patch, () => this.recomputeDuration());
  },

  onStartHourChange(e) {
    const idx = Math.max(0, Number((e && e.detail && e.detail.value) || 0));
    const v = this.data.hourOptions[idx] || "10:00";
    const startMin = this.timeHMToMin(v);
    let end = this.data.endTime;
    if (this.timeHMToMin(end) - startMin < 60) {
      end = hmLabel(Math.min(23 * 60, startMin + 120));
    }
    const endIdx = Math.max(0, this.data.hourOptions.indexOf(end));
    this.setData({ startTime: v, startHourIdx: idx, endTime: end, endHourIdx: endIdx });
    this.recomputeDuration();
  },
  onEndHourChange(e) {
    const idx = Math.max(0, Number((e && e.detail && e.detail.value) || 0));
    const v = this.data.hourOptions[idx] || "22:00";
    if (this.timeHMToMin(v) <= this.timeHMToMin(this.data.startTime)) {
      wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" });
      return;
    }
    this.setData({ endTime: v, endHourIdx: idx });
    this.recomputeDuration();
  },
  onStartTimeChange(e) {
    const v = (e && e.detail && e.detail.value) || "";
    if (!v) return;
    const startMin = this.timeHMToMin(v);
    let end = this.data.endTime;
    if (this.timeHMToMin(end) - startMin < 30) {
      end = hmLabel(Math.min(23 * 60 + 30, startMin + 120));
    }
    this.setData({ startTime: v, endTime: end, timeQuickKey: "custom", timeQuickLabel: "时间段" });
    this.recomputeDuration();
  },

  onEndTimeChange(e) {
    const v = (e && e.detail && e.detail.value) || "";
    if (!v) return;
    if (this.timeHMToMin(v) <= this.timeHMToMin(this.data.startTime)) {
      wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" });
      return;
    }
    this.setData({ endTime: v, timeQuickKey: "custom", timeQuickLabel: "时间段" });
    this.recomputeDuration();
  },

  timeHMToMin(hm) {
    const m = String(hm || "").match(/^(\d{2}):(\d{2})$/);
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]);
  },

  recomputeDuration() {
    const s = this.timeHMToMin(this.data.startTime);
    const e = this.timeHMToMin(this.data.endTime);
    const diff = Math.max(30, e - s);
    const hours = Math.floor(diff / 60);
    const mins = diff - hours * 60;
    let txt = mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
    this.setData({ durationHourText: txt });
  },

  onVisibilityChange(e) {
    const v = (e && e.detail && e.detail.value) || "public";
    const patch = { visibility: v, visibilityHint: this.visibilityHintFor(v) };
    if (v === "public") {
      // 公开发布：默认勾选「求搭子」并展开高级选项
      patch.needPartner = true;
      patch.advancedOpen = true;
    } else {
      // #21: 对岩友/岩友圈发布不展示「求搭子」，联动关闭
      patch.needPartner = false;
      patch.advancedOpen = true;
    }
    this.setData(patch);
  },

  visibilityHintFor(v) {
    if (v === "friends") return "对岩友发布——只有你的岩友能看到你的发布";
    if (v === "circle") return "对岩友圈发布——会自动发布到对应岩馆关联的岩友圈(已加入的)";
    return "";
  },

  onToggleAdvanced() { this.setData({ advancedOpen: !this.data.advancedOpen }); },

  onNoteInput(e) { this.setData({ note: (e && e.detail && e.detail.value) || "" }); },

  onTogglePartner(e) { this.setData({ needPartner: !!(e && e.detail && e.detail.value) }); },

  onToggleSkillTag(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const tags = this.data.skillTags.map((x) => (x.key === key ? { ...x, on: !x.on } : x));
    this.setData({ skillTags: tags });
  },

  async onPublish() {
    if (!this.data.selectedGymId) {
      wx.showToast({ title: "请选择或搜索岩馆", icon: "none" });
      return;
    }
    if (!this.data.selectedDate) {
      wx.showToast({ title: "请选择日期", icon: "none" });
      return;
    }
    const start = this.timeHMToMin(this.data.startTime);
    const end = this.timeHMToMin(this.data.endTime);
    if (end - start < 30) {
      wx.showToast({ title: "时间段至少 30 分钟", icon: "none" });
      return;
    }
    if (end - start > 12 * 60) {
      wx.showToast({ title: "单次计划最多 12 小时", icon: "none" });
      return;
    }
    const skillTags = this.data.skillTags.filter((x) => x.on).map((x) => x.key);
    const payload = {
      action: "create",
      mode: "gym",
      date: this.data.selectedDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      visibility: this.data.visibility,
      note: this.data.note || "",
      needPartner: !!this.data.needPartner,
      skillTags,
      gymId: this.data.selectedGymId
    };
    wx.showLoading({ title: "发布中…", mask: true });
    try {
      const res = await calendarApi.publish(payload);
      wx.hideLoading();
      try {
        cache.invalidate(cache.CACHE_KEYS.CALENDAR_SUMMARY);
        cache.invalidate(cache.CACHE_KEYS.STATS_30DAY);
      } catch (_) {}
      wx.showToast({ title: "发布成功 🧗", icon: "success" });
      setTimeout(() => {
        const q = [`date=${this.data.selectedDate}`];
        if (this.data.city) q.push(`city=${encodeURIComponent(this.data.city)}`);
        if (this.data.selectedGymId) q.push(`gymId=${this.data.selectedGymId}`);
        wx.redirectTo({ url: `/pages/calendar-timeline/index?${q.join("&")}` });
      }, 450);
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: "发布失败", content: (e && e.message) || "请稍后重试", showCancel: false });
    }
  }
});
