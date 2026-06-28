const { create, context } = require("../../services/api/checkin");
const { today, monthLabel } = require("../../utils/date");
const { safeText } = require("../../utils/format");
const { buildCacheKey, readCache, writeCache } = require("../../utils/pageCache");

const CHECKIN_CONTEXT_CACHE_MAX_AGE = 2 * 60 * 1000;
const MODE_LABELS = {
  boulder: "抱石",
  difficulty: "难度",
  lead: "先锋"
};

function uniqueModeList(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = String(item || "").trim().toLowerCase();
    if (!mode || !MODE_LABELS[mode] || seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

function hasModeData(map) {
  return !!(map && typeof map === "object" && Object.keys(map).length);
}

function buildModeTabs(modes) {
  return uniqueModeList(modes).map((key) => ({
    key,
    label: MODE_LABELS[key]
  }));
}

function detectSupportedModes({ explicit, cycle, routes, totals, limits }) {
  const explicitModes = uniqueModeList(explicit);
  if (explicitModes.length) return explicitModes;
  const guessed = [];
  if (routes && routes.boulder) guessed.push("boulder");
  if (routes && (routes.difficulty || routes.rope)) guessed.push("difficulty");
  if (routes && routes.lead) guessed.push("lead");
  if (cycle && Array.isArray(cycle.boulderGrades) && cycle.boulderGrades.length) guessed.push("boulder");
  if (cycle && Array.isArray(cycle.difficultyGrades) && cycle.difficultyGrades.length) guessed.push("difficulty");
  if (cycle && Array.isArray(cycle.leadGrades) && cycle.leadGrades.length) guessed.push("lead");
  if (hasModeData(totals && totals.boulder) || hasModeData(limits && limits.boulder)) guessed.push("boulder");
  if (hasModeData(totals && totals.difficulty) || hasModeData(limits && limits.difficulty)) guessed.push("difficulty");
  if (hasModeData(totals && totals.lead) || hasModeData(limits && limits.lead)) guessed.push("lead");
  const modes = uniqueModeList(guessed);
  return modes.length ? modes : ["difficulty", "boulder"];
}

function sumObjectValues(obj) {
  let s = 0;
  if (!obj) return 0;
  Object.keys(obj).forEach((k) => {
    const n = Number(obj[k] || 0);
    if (Number.isFinite(n)) s += n;
  });
  return s;
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

Page({
  data: {
    gymId: "",
    gym: {},
    cycle: null,
    cycleLabel: "",
    date: "",
    dateStart: "",
    dateEnd: "",
    calendarVisible: false,
    mode: "difficulty",
    modeTabs: [],
    supportedModes: [],
    totals: {},
    limits: {},
    deltas: {},
    rows: []
  },
  async onLoad(query) {
    const gymId = query && query.gymId ? String(query.gymId) : "";
    let mode = "difficulty";
    try {
      const byGym = gymId ? wx.getStorageSync(`checkin_mode_${gymId}`) : "";
      const global = wx.getStorageSync("checkin_mode");
      const m = String(byGym || global || "");
      if (m === "boulder" || m === "difficulty" || m === "lead") mode = m;
    } catch (e) {}
    try {
      if (gymId) wx.setStorageSync("lastGymId", gymId);
    } catch (e) {}
    const nextDate = today();
    this.setData({ gymId, date: nextDate, dateEnd: nextDate, mode });
    const hasCache = this.applyContextCache(gymId, nextDate);
    if (hasCache) this.buildRows();
    await this.loadContext({ silent: hasCache, hasCache });
    this.buildRows();
  },
  getContextCacheKey(gymId, date) {
    const app = getApp();
    const user = (app && app.globalData && app.globalData.user) || {};
    return buildCacheKey("checkin_context", {
      openid: safeText(user.openid),
      gymId: safeText(gymId),
      date: safeText(date)
    });
  },
  normalizeContextState(res) {
    const gym = (res && res.gym) || {};
    const progress = (res && res.progress) || null;
    const routeCounts = (res && res.routeCounts) || null;
    const cycle = gym.currentCycle || gym.cycle || null;
    const cycleLabel = cycle && cycle.startDate ? monthLabel(cycle.startDate) : "默认周期";

    const routes = gym.routes || null;
    const gymLimits = {
      boulder:
        (routes && routes.boulder && (routes.boulder.limits || routes.boulder.counts || routes.boulder)) || {},
      difficulty:
        ((routes && routes.difficulty && (routes.difficulty.limits || routes.difficulty.counts || routes.difficulty)) ||
          (routes && routes.rope && (routes.rope.limits || routes.rope.counts || routes.rope)) ||
          {}),
      lead: (routes && routes.lead && (routes.lead.limits || routes.lead.counts || routes.lead)) || {}
    };

    const limits = {
      boulder: (routeCounts && routeCounts.boulder) || gymLimits.boulder || {},
      difficulty: (routeCounts && routeCounts.difficulty) || gymLimits.difficulty || {},
      lead: (routeCounts && routeCounts.lead) || gymLimits.lead || {}
    };
    const totals = {
      boulder: (progress && progress.totals && progress.totals.boulder) || {},
      difficulty: (progress && progress.totals && progress.totals.difficulty) || {},
      lead: (progress && progress.totals && progress.totals.lead) || {}
    };
    const supportedModes = detectSupportedModes({
      explicit: (res && res.supportedModes) || gym.supportedModes,
      cycle,
      routes,
      totals,
      limits
    });
    const nextMode = supportedModes.includes(this.data.mode) ? this.data.mode : supportedModes[0] || "difficulty";
    const dateStart = cycle && isValidYMD(cycle.startDate) ? cycle.startDate : "";
    const dateEnd =
      cycle && isValidYMD(cycle.endDate)
        ? cycle.endDate
        : cycle && cycle.endDate === ""
          ? today()
          : this.data.dateEnd || today();

    return {
      gym,
      cycle,
      cycleLabel,
      totals,
      limits,
      supportedModes,
      modeTabs: buildModeTabs(supportedModes),
      mode: nextMode,
      dateStart,
      dateEnd
    };
  },
  applyContextCache(gymId, date) {
    const cached = readCache(this.getContextCacheKey(gymId, date), { maxAge: CHECKIN_CONTEXT_CACHE_MAX_AGE });
    if (!cached || !cached.data) return false;
    this.setData(this.normalizeContextState(cached.data));
    return true;
  },
  async loadContext({ silent, hasCache } = {}) {
    const gymId = this.data.gymId;
    if (!gymId) return;
    try {
      const requestDate = this.data.date;
      const res = await context({ gymId, date: requestDate }, { loading: !silent });
      const nextState = this.normalizeContextState(res);
      this.setData(nextState);
      writeCache(this.getContextCacheKey(gymId, requestDate), res || {});
    } catch (e) {
      if (!hasCache) wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  onModeChange(e) {
    const mode = e.detail.value;
    if (!this.data.supportedModes.includes(mode)) return;
    this.setData({ mode });
    try {
      wx.setStorageSync("checkin_mode", mode);
      if (this.data.gymId) wx.setStorageSync(`checkin_mode_${this.data.gymId}`, mode);
    } catch (e) {}
    this.buildRows();
  },
  async selectDate(value) {
    const v = String(value || "");
    if (!v || v === this.data.date) return;
    await this.confirmUnsavedAndRun(async () => {
      this.setData({ date: v });
      const hasCache = this.applyContextCache(this.data.gymId, v);
      if (hasCache) this.buildRows();
      await this.loadContext({ silent: hasCache, hasCache });
      this.buildRows();
    });
  },
  async onPickDate(e) {
    const value = e && e.detail && e.detail.value ? String(e.detail.value) : "";
    if (!value || value === this.data.date) return;
    await this.selectDate(value);
  },
  openCalendar() {
    this.setData({ calendarVisible: true });
  },
  closeCalendar() {
    this.setData({ calendarVisible: false });
  },
  async onCalendarChange(e) {
    const value = e && e.detail && e.detail.value ? String(e.detail.value) : "";
    this.closeCalendar();
    await this.selectDate(value);
  },
  buildRows() {
    const mode = this.data.mode;
    if (!mode) {
      this.setData({ rows: [] });
      return;
    }
    const totalsByMode = (this.data.totals && this.data.totals[mode]) || {};
    const limitsByMode = (this.data.limits && this.data.limits[mode]) || {};
    const cycle = this.data.cycle || null;
    const cycleGrades =
      mode === "boulder"
        ? (cycle && (cycle.boulderGrades || cycle.boulder_grades)) || []
        : mode === "lead"
          ? (cycle && (cycle.leadGrades || cycle.lead_grades || cycle.difficultyGrades || cycle.rope_grades)) || []
          : (cycle && (cycle.difficultyGrades || cycle.rope_grades)) || [];
    const gradeList = Array.isArray(cycleGrades)
      ? cycleGrades
      : typeof cycleGrades === "string"
        ? cycleGrades.split(/[,\s]+/).filter(Boolean)
        : [];
    const grades = gradeList.length ? gradeList : Object.keys(limitsByMode);
    if (!grades.length) {
      const fallback =
        mode === "boulder"
          ? ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7+"]
          : mode === "lead"
            ? ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"]
            : ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"];
      const nextLimits = { ...limitsByMode };
      fallback.forEach((g) => {
        if (!Object.prototype.hasOwnProperty.call(nextLimits, g)) nextLimits[g] = 0;
      });
      const rows = Object.keys(nextLimits).map((grade) => {
        const total = Number(totalsByMode[grade] || 0);
        const limitRaw = nextLimits[grade];
        const limit = limitRaw == null || limitRaw === "" ? null : Number(limitRaw || 0);
        const key = `${mode}:${grade}`;
        const delta = Number((this.data.deltas && this.data.deltas[key]) || 0);
        const canInc = limit == null ? true : limit <= 0 ? true : total + delta < limit;
        const progressText = limit == null ? `${total}/-` : `${total}/${limit}`;
        return {
          key,
          label: grade,
          delta,
          deltaText: `+${delta}`,
          canInc,
          progressText
        };
      });
      this.setData({ rows, limits: { ...this.data.limits, [mode]: nextLimits } });
      return;
    }
    const rows = grades.map((gradeRaw) => {
      const grade = String(gradeRaw || "").trim();
      const total = Number(totalsByMode[grade] || 0);
      const limitRaw = limitsByMode[grade];
      const limit = limitRaw == null || limitRaw === "" ? null : Number(limitRaw || 0);
      const key = `${mode}:${grade}`;
      const delta = Number((this.data.deltas && this.data.deltas[key]) || 0);
      const canInc = limit == null ? true : limit <= 0 ? true : total + delta < limit;
      const progressText = limit == null ? `${total}/-` : `${total}/${limit}`;
      return {
        key,
        label: grade,
        delta,
        deltaText: `+${delta}`,
        canInc,
        progressText
      };
    });
    this.setData({ rows });
  },
  onDec(e) {
    const key = e.currentTarget.dataset.key;
    const n = Number((this.data.deltas && this.data.deltas[key]) || 0);
    if (n <= 0) return;
    this.setData({ deltas: { ...this.data.deltas, [key]: n - 1 } });
    this.syncBeforeUnload();
    this.buildRows();
  },
  onInc(e) {
    const key = e.currentTarget.dataset.key;
    const rows = this.data.rows || [];
    const row = rows.find((r) => r.key === key);
    if (!row || !row.canInc) return;
    const n = Number((this.data.deltas && this.data.deltas[key]) || 0);
    this.setData({ deltas: { ...this.data.deltas, [key]: n + 1 } });
    this.syncBeforeUnload();
    this.buildRows();
  },
  async goHome() {
    await this.confirmUnsavedAndRun(async () => {
      wx.switchTab({ url: "/pages/home/index" });
    });
  },
  async goWall() {
    const gymId = this.data.gymId;
    if (!gymId) return;
    await this.confirmUnsavedAndRun(async () => {
      wx.navigateTo({ url: `/pages/wall/index?gymId=${gymId}` });
    });
  },
  getAllPicked() {
    const deltas = this.data.deltas || {};
    const pickedByMode = {};
    Object.keys(deltas).forEach((k) => {
      const n = Number(deltas[k] || 0);
      if (!Number.isFinite(n) || n <= 0) return;
      const idx = k.indexOf(":");
      if (idx <= 0) return;
      const mode = k.slice(0, idx);
      const grade = k.slice(idx + 1);
      if (!MODE_LABELS[mode] || !grade) return;
      if (!pickedByMode[mode]) pickedByMode[mode] = {};
      pickedByMode[mode][grade] = n;
    });
    return pickedByMode;
  },
  getUnsavedTotal() {
    const deltas = this.data.deltas || {};
    let s = 0;
    Object.keys(deltas).forEach((k) => {
      const n = Number(deltas[k] || 0);
      if (Number.isFinite(n) && n > 0) s += n;
    });
    return s;
  },
  syncBeforeUnload() {
    const has = this.getUnsavedTotal() > 0;
    if (has) {
      if (wx.enableAlertBeforeUnload) {
        wx.enableAlertBeforeUnload({ message: "还有未保存的打卡，确定离开吗？" });
      }
      return;
    }
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },
  async confirmUnsavedAndRun(next) {
    const unsaved = this.getUnsavedTotal();
    if (!unsaved) {
      await next();
      return;
    }
    await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: ["先保存", "不保存"],
        success: async (res) => {
          if (!res) return resolve();
          if (res.tapIndex === 0) {
            const ok = await this.onSubmit();
            if (ok) await next();
            return resolve();
          }
          if (res.tapIndex === 1) {
            this.setData({ deltas: {} });
            this.syncBeforeUnload();
            await next();
            return resolve();
          }
          resolve();
        },
        fail: () => resolve()
      });
    });
  },
  async onSubmit() {
    const pickedByMode = this.getAllPicked();
    const totalPicked = Object.keys(pickedByMode).reduce((sum, mode) => sum + sumObjectValues(pickedByMode[mode]), 0);
    if (!totalPicked) {
      wx.showToast({ title: "还没记录数量", icon: "none" });
      return false;
    }
    const app = getApp();
    const user = app && app.globalData ? app.globalData.user : null;
    const openid = user && user.openid ? user.openid : "";
    if (!openid) {
      wx.showToast({ title: "请先登录", icon: "none" });
      return false;
    }
    try {
      const cycleId =
        (this.data.gym && this.data.gym.currentCycleId) || (this.data.cycle && this.data.cycle._id ? this.data.cycle._id : null);
      const modes = Object.keys(pickedByMode);
      for (const mode of modes) {
        const picked = pickedByMode[mode] || {};
        if (!Object.keys(picked).length) continue;
        await create({
          gymId: this.data.gymId,
          date: this.data.date,
          mode,
          deltas: picked,
          cycleId
        });
      }
      try {
        if (this.data.gymId) wx.setStorageSync("lastGymId", this.data.gymId);
      } catch (e) {}
      wx.showToast({ title: `已保存 +${totalPicked}`, icon: "none" });
      this.setData({ deltas: {} });
      this.syncBeforeUnload();
      await this.loadContext();
      this.buildRows();
      return true;
    } catch (e) {
      wx.showToast({ title: "提交失败", icon: "none" });
      return false;
    }
  }
});

