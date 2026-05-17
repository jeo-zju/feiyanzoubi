const { create, context } = require("../../services/api/checkin");
const { today, monthLabel } = require("../../utils/date");

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
    mode: "difficulty",
    modeTabs: [
      { key: "difficulty", label: "难度" },
      { key: "boulder", label: "抱石" }
    ],
    totals: {},
    limits: {},
    deltas: {},
    rows: []
  },
  async onLoad(query) {
    const gymId = query && query.gymId ? String(query.gymId) : "";
    this.setData({ gymId, date: today(), dateEnd: today() });
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
      const dateEnd = this.data.dateEnd || today();

      this.setData({
        gym,
        cycle,
        cycleLabel,
        totals: (progress && progress.totals) || {},
        limits,
        dateStart: "",
        dateEnd
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  onModeChange(e) {
    const mode = e.detail.value;
    this.setData({ mode });
    this.buildRows();
  },
  async onPickDate(e) {
    const value = e && e.detail && e.detail.value ? String(e.detail.value) : "";
    if (!value || value === this.data.date) return;
    await this.confirmUnsavedAndRun(async () => {
      this.setData({ date: value });
      await this.loadContext();
      this.buildRows();
    });
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
      wx.showToast({ title: `已打卡 +${totalPicked}`, icon: "none" });
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

