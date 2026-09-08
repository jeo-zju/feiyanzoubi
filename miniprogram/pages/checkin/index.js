const { create, context, revertLast } = require("../../services/api/checkin");
const { today, monthLabel } = require("../../utils/date");
const cache = require("../../utils/cache");

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
    modeTabs: [
      { key: "difficulty", label: "难度" },
      { key: "boulder", label: "抱石" }
    ],
    totals: {},
    limits: {},
    deltas: {},
    rows: [],
    revertAvailable: false,
    revertTs: 0,
    revertJustNow: false
  },

  onUnload() {
    if (this._revertTimer) {
      clearInterval(this._revertTimer);
      this._revertTimer = null;
    }
  },
  async onLoad(query) {
    const gymId = query && query.gymId ? String(query.gymId) : "";
    let mode = "difficulty";
    try {
      const byGym = gymId ? wx.getStorageSync(`checkin_mode_${gymId}`) : "";
      const global = wx.getStorageSync("checkin_mode");
      const m = String(byGym || global || "");
      if (m === "boulder" || m === "difficulty") mode = m;
    } catch (e) {}
    try {
      if (gymId) wx.setStorageSync("lastGymId", gymId);
    } catch (e) {}
    this.setData({ gymId, date: today(), dateEnd: today(), mode });
    await this.loadContext();
    this.buildRows();
  },
  async loadContext() {
    const gymId = this.data.gymId;
    if (!gymId) return;
    try {
      const res = await context({ gymId, date: this.data.date });
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
          (routes && routes.difficulty && (routes.difficulty.limits || routes.difficulty.counts || routes.difficulty)) ||
          {}
      };

      const limits = routeCounts || gymLimits || {};
      const dateStart = cycle && isValidYMD(cycle.startDate) ? cycle.startDate : "";
      const dateEnd =
        cycle && isValidYMD(cycle.endDate)
          ? cycle.endDate
          : cycle && cycle.endDate === ""
            ? today()
            : this.data.dateEnd || today();

      this.setData({
        gym,
        cycle,
        cycleLabel,
        totals: (progress && progress.totals) || {},
        limits,
        dateStart,
        dateEnd
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  onModeChange(e) {
    const mode = e.detail.value;
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
      await this.loadContext();
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
    const totalsByMode = (this.data.totals && this.data.totals[mode]) || {};
    const limitsByMode = (this.data.limits && this.data.limits[mode]) || {};
    const cycle = this.data.cycle || null;
    const cycleGrades =
      mode === "boulder"
        ? (cycle && (cycle.boulderGrades || cycle.boulder_grades)) || []
        : (cycle && (cycle.difficultyGrades || cycle.rope_grades)) || [];
    const gradeList = Array.isArray(cycleGrades)
      ? cycleGrades
      : typeof cycleGrades === "string"
        ? cycleGrades.split(/[,\s]+/).filter(Boolean)
        : [];
    const grades = gradeList.length ? gradeList : Object.keys(limitsByMode);
    if (!grades.length) {
      const fallback =
        mode === "difficulty"
          ? ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"]
          : ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7+"];
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
    const pickedByMode = { difficulty: {}, boulder: {} };
    Object.keys(deltas).forEach((k) => {
      const n = Number(deltas[k] || 0);
      if (!Number.isFinite(n) || n <= 0) return;
      if (k.startsWith("difficulty:")) pickedByMode.difficulty[k.slice("difficulty:".length)] = n;
      if (k.startsWith("boulder:")) pickedByMode.boulder[k.slice("boulder:".length)] = n;
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
        wx.enableAlertBeforeUnload({ message: "还有未保存的打卡，确定要离开吗？" });
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
        itemList: ["保存打卡", "不保存"],
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
  _startRevertTimer() {
    if (this._revertTimer) {
      clearInterval(this._revertTimer);
      this._revertTimer = null;
    }
    const WINDOW_MS = 30 * 60 * 1000;
    this._revertTimer = setInterval(() => {
      const ts = this.data.revertTs;
      if (!ts) return;
      if (Date.now() - ts > WINDOW_MS) {
        this.setData({ revertAvailable: false });
        if (this._revertTimer) {
          clearInterval(this._revertTimer);
          this._revertTimer = null;
        }
      }
    }, 1000);
  },

  async onTapRevert() {
    if (!this.data.revertAvailable) {
      wx.showToast({ title: "已超过撤销时间（30分钟）", icon: "none" });
      return;
    }
    const self = this;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "撤销本次打卡？",
        content: "会删除对应的打卡记录并回滚进度数据",
        confirmText: "撤销",
        confirmColor: "#C65A5A",
        success(r) { resolve(!!(r && r.confirm)); },
        fail() { resolve(false); }
      });
    });
    if (!confirmed) return;
    try {
      await revertLast();
      wx.showToast({ title: "已撤销", icon: "success" });
      this.setData({ revertAvailable: false, revertJustNow: true });
      if (this._revertTimer) {
        clearInterval(this._revertTimer);
        this._revertTimer = null;
      }
      try {
        cache.invalidate(cache.CACHE_KEYS.ME_PROFILE);
        cache.invalidate(cache.CACHE_KEYS.CALENDAR_SUMMARY);
        cache.invalidate(cache.CACHE_KEYS.STATS_30DAY);
      } catch (_) {}
      await this.loadContext();
      this.buildRows();
    } catch (e) {
      const code = (e && e.code) || String(e && e.message || "");
      if (/OUTSIDE_REVOCATION_WINDOW/i.test(code)) {
        this.setData({ revertAvailable: false });
        if (this._revertTimer) {
          clearInterval(this._revertTimer);
          this._revertTimer = null;
        }
        wx.showModal({ title: "撤销失败", content: "已超过撤销窗口（30分钟）", showCancel: false });
      } else {
        wx.showToast({ title: (e && e.message) || "撤销失败", icon: "none" });
      }
    }
  },

  async onSubmit() {
    const pickedByMode = this.getAllPicked();
    const totalPicked = sumObjectValues(pickedByMode.difficulty) + sumObjectValues(pickedByMode.boulder);
    if (!totalPicked) {
      wx.showToast({ title: "还没加任何数量", icon: "none" });
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
      const modes = ["difficulty", "boulder"];
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
      try {
        cache.invalidate(cache.CACHE_KEYS.ME_PROFILE);
        cache.invalidate(cache.CACHE_KEYS.CALENDAR_SUMMARY);
        cache.invalidate(cache.CACHE_KEYS.STATS_30DAY);
      } catch (_) {}
      const nowTs = Date.now();
      this.setData({ deltas: {}, revertAvailable: true, revertTs: nowTs, revertJustNow: false });
      this._startRevertTimer();
      wx.showToast({ title: `已打卡 +${totalPicked}`, icon: "none" });
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

