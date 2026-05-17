const { get } = require("../../services/api/gym");
const { upsertGym } = require("../../services/api/gymOwner");
const { today } = require("../../utils/date");
const { safeText } = require("../../utils/format");

function splitGrades(s) {
  const text = safeText(s);
  if (!text) return [];
  return text
    .split(/[，,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildRouteRows(grades, currentMap) {
  const map = currentMap || {};
  return (grades || []).map((g) => ({
    grade: g,
    count: Number(map[g] || 0)
  }));
}

const BOULDER_TEMPLATES = [
  {
    key: "v_single",
    label: "V0,V1…",
    grades: ["VB", "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7+"]
  },
  {
    key: "v_range",
    label: "V0-V1,V1-V2…",
    grades: ["VB-V0", "V0-V1", "V1-V2", "V2-V3", "V3-V4", "V4-V5", "V5-V6", "V6-V7+"]
  },
  {
    key: "font",
    label: "Font 6A,6A+…",
    grades: ["5", "5+", "6A", "6A+", "6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+"]
  }
];

const DIFFICULTY_TEMPLATES = [
  {
    key: "yds_basic",
    label: "YDS 5.9~5.12",
    grades: ["5.8", "5.9", "5.10a", "5.10b", "5.10c", "5.10d", "5.11a", "5.11b", "5.11c", "5.11d", "5.12a", "5.12b", "5.12c", "5.12d"]
  },
  {
    key: "yds_mid",
    label: "YDS 5.10~5.13",
    grades: ["5.10a", "5.10b", "5.10c", "5.10d", "5.11a", "5.11b", "5.11c", "5.11d", "5.12a", "5.12b", "5.12c", "5.12d", "5.13a", "5.13b", "5.13c", "5.13d"]
  },
  {
    key: "french",
    label: "French 5c~7c",
    grades: ["5c", "6a", "6a+", "6b", "6b+", "6c", "6c+", "7a", "7a+", "7b", "7b+", "7c", "7c+"]
  }
];

Page({
  data: {
    gymId: "",
    gym: {},
    cycles: [],
    cycleEditing: null,
    closeEndDate: today(),
    tab: "info",
    tabs: [
      { key: "info", label: "岩馆信息" },
      { key: "cycle", label: "周期设置" },
      { key: "routes", label: "线路录入" }
    ],
    form: { name: "", city: "", address: "" },
    cycleForm: {
      name: "",
      startDate: today(),
      boulderGrades: "V0,V1,V2,V3,V4,V5,V6,V7+",
      difficultyGrades: "5.9,5.10a,5.10b,5.10c,5.11a,5.11b"
    },
    routeMode: "boulder",
    routeTabs: [
      { key: "boulder", label: "抱石" },
      { key: "difficulty", label: "难度" }
    ],
    routeRows: [],
    routeCounts: { boulder: {}, difficulty: {} },
    customGrade: ""
  },
  async onLoad(query) {
    const gymId = query && query.gymId ? String(query.gymId) : "";
    this.setData({ gymId });
    if (gymId) await this.loadGym();
    this.refreshRouteRows();
  },
  async loadGym() {
    try {
      const res = await get({ gymId: this.data.gymId });
      const gym = (res && res.gym) || {};
      const cycles = (res && res.cycles) || [];
      const currentCycle = gym.currentCycle || gym.cycle || (cycles && cycles[0]) || {};
      const routes = gym.routes || {};
      this.setData({
        gym,
        cycles,
        form: {
          name: gym.name || gym.gymName || gym.title || "",
          city: gym.city || gym.cityName || gym.locationCity || "",
          address: gym.address || gym.addr || gym.location || ""
        },
        cycleForm: {
          name: currentCycle.name || currentCycle.cycle_name || "",
          startDate: currentCycle.startDate || currentCycle.start_date || today(),
          boulderGrades: (currentCycle.boulderGrades || currentCycle.boulder_grades || ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7+"]).join(","),
          difficultyGrades: (currentCycle.difficultyGrades || currentCycle.rope_grades || currentCycle.difficulty_grades || ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"]).join(",")
        },
        cycleEditing: currentCycle && currentCycle._id ? { _id: currentCycle._id, status: currentCycle.status || "" } : null,
        closeEndDate: today(),
        routeCounts: {
          boulder: (routes.boulder && (routes.boulder.limits || routes.boulder.counts || routes.boulder)) || {},
          difficulty: (routes.difficulty && (routes.difficulty.limits || routes.difficulty.counts || routes.difficulty)) || {}
        }
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },
  onTabChange(e) {
    this.setData({ tab: e.detail.value });
    this.refreshRouteRows();
  },
  onRouteModeChange(e) {
    this.setData({ routeMode: e.detail.value });
    this.refreshRouteRows();
  },
  onName(e) {
    this.setData({ form: { ...this.data.form, name: e.detail.value } });
  },
  onCity(e) {
    this.setData({ form: { ...this.data.form, city: e.detail.value } });
  },
  onAddress(e) {
    this.setData({ form: { ...this.data.form, address: e.detail.value } });
  },
  onCycleName(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, name: e.detail.value } });
  },
  onCycleStart(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, startDate: e.detail.value } });
  },
  onBoulderGrades(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, boulderGrades: e.detail.value } });
    this.refreshRouteRows();
  },
  onDifficultyGrades(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, difficultyGrades: e.detail.value } });
    this.refreshRouteRows();
  },
  onPickBoulderTemplate() {
    const itemList = BOULDER_TEMPLATES.map((t) => t.label);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const idx = res && typeof res.tapIndex === "number" ? res.tapIndex : -1;
        const tpl = idx >= 0 ? BOULDER_TEMPLATES[idx] : null;
        if (!tpl) return;
        this.setData({ cycleForm: { ...this.data.cycleForm, boulderGrades: tpl.grades.join(",") } });
        this.refreshRouteRows();
      }
    });
  },
  onPickDifficultyTemplate() {
    const itemList = DIFFICULTY_TEMPLATES.map((t) => t.label);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const idx = res && typeof res.tapIndex === "number" ? res.tapIndex : -1;
        const tpl = idx >= 0 ? DIFFICULTY_TEMPLATES[idx] : null;
        if (!tpl) return;
        this.setData({ cycleForm: { ...this.data.cycleForm, difficultyGrades: tpl.grades.join(",") } });
        this.refreshRouteRows();
      }
    });
  },
  onSelectCycle(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const cycles = this.data.cycles || [];
    const c = cycles.find((x) => x && String(x._id) === String(id));
    if (!c) return;
    this.setData({
      cycleForm: {
        name: c.name || c.cycle_name || "",
        startDate: c.startDate || c.start_date || today(),
        boulderGrades: (c.boulderGrades || c.boulder_grades || []).join(","),
        difficultyGrades: (c.difficultyGrades || c.rope_grades || c.difficulty_grades || []).join(",")
      },
      cycleEditing: { _id: c._id, status: c.status || "" }
    });
  },
  async onDeleteCycle(e) {
    if (!this.data.gymId) return;
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    if (!id) return;
    const cycles = this.data.cycles || [];
    const c = cycles.find((x) => x && String(x._id) === String(id));
    const name = (c && (c.name || c.cycle_name)) || "该周期";
    const start = (c && (c.startDate || c.start_date)) || "";
    const end = (c && (c.endDate || c.end_date)) || "至今";

    wx.showModal({
      title: "删除周期",
      content: "删除后不可恢复，并会联动删除该周期下所有用户的打卡记录/进度/黑板统计，请谨慎操作。",
      confirmText: "下一步",
      success: (r1) => {
        if (!r1 || !r1.confirm) return;
        wx.showModal({
          title: "再次确认",
          content: `确认删除【${name}】(${start} ~ ${end}) 吗？`,
          confirmText: "确认删除",
          success: async (r2) => {
            if (!r2 || !r2.confirm) return;
            try {
              await upsertGym({
                gymId: this.data.gymId,
                deleteCycle: { cycleId: String(id) }
              });
              wx.showToast({ title: "已删除", icon: "none" });
              await this.loadGym();
            } catch (e2) {
              wx.showToast({ title: (e2 && e2.message) || "删除失败", icon: "none" });
            }
          }
        });
      }
    });
  },
  onCloseEndDate(e) {
    this.setData({ closeEndDate: e.detail.value });
  },
  async onCloseCycle() {
    if (!this.data.gymId) return;
    const editing = this.data.cycleEditing;
    const cycleId = editing && editing._id ? String(editing._id) : "";
    if (!cycleId) {
      wx.showToast({ title: "未找到当前周期", icon: "none" });
      return;
    }
    const endDate = safeText(this.data.closeEndDate) || today();
    wx.showModal({
      title: "关闭周期",
      content: `确认将该周期关闭到 ${endDate} 吗？`,
      confirmText: "关闭",
      success: async (res) => {
        if (!res || !res.confirm) return;
        try {
          await upsertGym({
            gymId: this.data.gymId,
            closeCycle: { cycleId, endDate }
          });
          wx.showToast({ title: "已关闭", icon: "none" });
          await this.loadGym();
        } catch (e) {
          wx.showToast({ title: (e && e.message) || "关闭失败", icon: "none" });
        }
      }
    });
  },
  refreshRouteRows() {
    if (this.data.tab !== "routes") return;
    const mode = this.data.routeMode;
    const grades =
      mode === "boulder" ? splitGrades(this.data.cycleForm.boulderGrades) : splitGrades(this.data.cycleForm.difficultyGrades);
    const rows = buildRouteRows(grades, (this.data.routeCounts && this.data.routeCounts[mode]) || {});
    this.setData({ routeRows: rows });
  },
  onRouteCount(e) {
    const grade = e.currentTarget.dataset.grade;
    const n = Number(e.detail.value || 0);
    const mode = this.data.routeMode;
    const map = { ...((this.data.routeCounts && this.data.routeCounts[mode]) || {}) };
    map[grade] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    this.setData({ routeCounts: { ...this.data.routeCounts, [mode]: map } });
    this.refreshRouteRows();
  },
  onCustomGrade(e) {
    this.setData({ customGrade: e.detail.value });
  },
  addGrade() {
    const g = safeText(this.data.customGrade);
    if (!g) return;
    const mode = this.data.routeMode;
    const key = mode === "boulder" ? "boulderGrades" : "difficultyGrades";
    const list = splitGrades(this.data.cycleForm[key]);
    if (list.includes(g)) {
      this.setData({ customGrade: "" });
      return;
    }
    list.push(g);
    this.setData({
      customGrade: "",
      cycleForm: { ...this.data.cycleForm, [key]: list.join(",") }
    });
    this.refreshRouteRows();
  },
  async saveGym() {
    const name = safeText(this.data.form.name);
    if (!name) {
      wx.showToast({ title: "请输入岩馆名", icon: "none" });
      return;
    }
    try {
      const res = await upsertGym({
        gymId: this.data.gymId || null,
        gym: { ...this.data.form }
      });
      const gymId = (res && res.gymId) || this.data.gymId;
      this.setData({ gymId });
      wx.showToast({ title: "已保存", icon: "none" });
      await this.loadGym();
    } catch (e) {
      wx.showToast({ title: "保存失败", icon: "none" });
    }
  },
  async saveCycle() {
    if (!this.data.gymId) {
      wx.showToast({ title: "请先创建岩馆", icon: "none" });
      return;
    }
    const startDate = safeText(this.data.cycleForm.startDate);
    if (!startDate) {
      wx.showToast({ title: "请选择开始日期", icon: "none" });
      return;
    }
    const boulderGrades = splitGrades(this.data.cycleForm.boulderGrades);
    const difficultyGrades = splitGrades(this.data.cycleForm.difficultyGrades);
    if (!boulderGrades.length || !difficultyGrades.length) {
      wx.showToast({ title: "请填写等级列表", icon: "none" });
      return;
    }
    try {
      await upsertGym({
        gymId: this.data.gymId,
        cycle: {
          name: safeText(this.data.cycleForm.name),
          startDate,
          boulderGrades,
          difficultyGrades,
          cycleId:
            this.data.cycleEditing && this.data.cycleEditing._id && this.data.cycleEditing.status !== "archived"
              ? String(this.data.cycleEditing._id)
              : ""
        }
      });
      wx.showToast({ title: "已保存", icon: "none" });
      await this.loadGym();
      if (this.data.tab === "routes") this.refreshRouteRows();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "保存失败", icon: "none" });
    }
  },
  async saveRoutes() {
    if (!this.data.gymId) {
      wx.showToast({ title: "请先创建岩馆", icon: "none" });
      return;
    }
    const mode = this.data.routeMode;
    const limits = (this.data.routeCounts && this.data.routeCounts[mode]) || {};
    try {
      await upsertGym({
        gymId: this.data.gymId,
        routes: {
          mode,
          limits
        }
      });
      wx.showToast({ title: "已更新", icon: "none" });
      await this.loadGym();
    } catch (e) {
      wx.showToast({ title: "更新失败", icon: "none" });
    }
  },
  backOwner() {
    wx.navigateBack({ delta: 1 });
  }
});

