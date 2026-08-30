const { get } = require("../../services/api/gym");
const { upsertGym, manageGym } = require("../../services/api/gymOwner");
const { ensureAppLogin, ensureAdminPageAccess, isAdminUser } = require("../../utils/session");
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

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = safeText(item).toLowerCase();
    if (!mode) return;
    if (!["boulder", "difficulty", "lead"].includes(mode)) return;
    if (seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

function buildRouteTabs(modes) {
  const labels = {
    boulder: "抱石",
    difficulty: "难度",
    lead: "先锋"
  };
  return uniqueModes(modes).map((key) => ({
    key,
    label: labels[key]
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

const LEAD_TEMPLATES = DIFFICULTY_TEMPLATES;

function buildDeleteSummary(relations) {
  const info = relations || {};
  return [
    `周期 ${Number(info.cycleCount || 0)} 个`,
    `打卡 ${Number(info.checkinCount || 0)} 条`,
    `日进度 ${Number(info.dailyProgressCount || 0)} 条`,
    `周期进度 ${Number(info.cycleProgressCount || 0)} 条`,
    `评分 ${Number(info.hardnessRatingCount || 0)} 条`,
    `上墙 ${Number(info.wallCardCount || 0)} 条`,
    `评论 ${Number(info.commentCount || 0)} 条`
  ].join("，");
}

function formatDateTime(ts) {
  const value = Number(ts || 0) || 0;
  if (!value) return "";
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function normalizeMergeHistory(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.sourceGymId)
    .map((item) => ({
      sourceGymId: safeText(item.sourceGymId),
      sourceGymName: safeText(item.sourceGymName) || "未命名岩馆",
      mergedAtText: formatDateTime(item.mergedAt),
      cycleMappingCount: Number(item.cycleMappingCount || 0) || 0,
      mappedCycleCount: Number(item.mappedCycleCount || 0) || 0
    }));
}

Page({
  data: {
    gymId: "",
    gym: {},
    user: null,
    canManageDirectly: false,
    cycles: [],
    cycleEditing: null,
    closeEndDate: today(),
    tab: "info",
    tabs: [
      { key: "info", label: "岩馆信息" },
      { key: "cycle", label: "周期设置" },
      { key: "routes", label: "线路录入" }
    ],
    form: { name: "", city: "", address: "", supportedModes: ["boulder", "difficulty"] },
    modeOptions: [
      { key: "boulder", label: "抱石" },
      { key: "difficulty", label: "难度" },
      { key: "lead", label: "先锋" }
    ],
    cycleForm: {
      name: "",
      startDate: today(),
      boulderGrades: "V0,V1,V2,V3,V4,V5,V6,V7+",
      difficultyGrades: "5.9,5.10a,5.10b,5.10c,5.11a,5.11b",
      leadGrades: "5.9,5.10a,5.10b,5.10c,5.11a,5.11b"
    },
    routeMode: "boulder",
    routeTabs: buildRouteTabs(["boulder", "difficulty"]),
    routeRows: [],
    routeCounts: { boulder: {}, difficulty: {}, lead: {} },
    customGrade: "",
    mergeHistory: []
  },
  redirectToGym(targetGymId, targetGymName, options = {}) {
    const id = safeText(targetGymId);
    if (!id) {
      wx.showToast({ title: options.fallbackTitle || "目标岩馆不存在", icon: "none" });
      return;
    }
    const title = options.silent ? "" : `已跳转到${safeText(targetGymName) || "目标岩馆"}`;
    if (title) wx.showToast({ title, icon: "none" });
    wx.redirectTo({ url: `/pages/gym-manage/index?gymId=${id}` });
  },
  async onLoad(query) {
    const from = query && query.from ? String(query.from) : "";
    const preferredTab = query && query.tab ? String(query.tab) : "";
    let user = null;
    if (from === "checkin") {
      user = await ensureAppLogin();
      if (!user) return;
    } else {
      user = await ensureAdminPageAccess();
      if (!user) return;
    }
    const gymId = query && query.gymId ? String(query.gymId) : "";
    this.setData({
      gymId,
      user,
      canManageDirectly: !!isAdminUser(user),
      tab: preferredTab || this.data.tab
    });
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
        mergeHistory: [],
        cycles,
        form: {
          name: gym.name || gym.gymName || gym.title || "",
          city: gym.city || gym.cityName || gym.locationCity || "",
          address: gym.address || gym.addr || gym.location || "",
          supportedModes: uniqueModes(gym.supportedModes || ["boulder", "difficulty"])
        },
        cycleForm: {
          name: currentCycle.name || currentCycle.cycle_name || "",
          startDate: currentCycle.startDate || currentCycle.start_date || today(),
          boulderGrades: (currentCycle.boulderGrades || currentCycle.boulder_grades || ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7+"]).join(","),
          difficultyGrades: (currentCycle.difficultyGrades || currentCycle.rope_grades || currentCycle.difficulty_grades || ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"]).join(","),
          leadGrades: (currentCycle.leadGrades || currentCycle.lead_grades || ["5.9", "5.10a", "5.10b", "5.10c", "5.11a", "5.11b"]).join(",")
        },
        cycleEditing: currentCycle && currentCycle._id ? { _id: currentCycle._id, status: currentCycle.status || "" } : null,
        closeEndDate: today(),
        routeTabs: buildRouteTabs(gym.supportedModes || ["boulder", "difficulty"]),
        routeCounts: {
          boulder: (routes.boulder && (routes.boulder.limits || routes.boulder.counts || routes.boulder)) || {},
          difficulty:
            ((routes.difficulty && (routes.difficulty.limits || routes.difficulty.counts || routes.difficulty)) ||
              (routes.rope && (routes.rope.limits || routes.rope.counts || routes.rope)) ||
              {}),
          lead: (routes.lead && (routes.lead.limits || routes.lead.counts || routes.lead)) || {}
        }
      });
      if (this.data.gymId) {
        try {
          const historyRes = await manageGym({ action: "get_merge_history", gymId: this.data.gymId });
          this.setData({ mergeHistory: normalizeMergeHistory(historyRes && historyRes.mergeHistory) });
        } catch (e3) {}
      }
      const tabs = buildRouteTabs(gym.supportedModes || ["boulder", "difficulty"]);
      if (tabs.length && !tabs.some((item) => item.key === this.data.routeMode)) {
        this.setData({ routeMode: tabs[0].key });
      }
    } catch (e) {
      if (e && e.code === "GYM_MERGED") {
        try {
          const redirect = await manageGym({ action: "resolve_redirect", gymId: this.data.gymId });
          this.redirectToGym(
            (redirect && redirect.targetGymId) || e.targetGymId,
            (redirect && redirect.targetGymName) || e.targetGymName,
            { fallbackTitle: "该岩馆已合并" }
          );
          return;
        } catch (e2) {}
      }
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
  onToggleMode(e) {
    const mode = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.mode : "";
    const current = uniqueModes(this.data.form.supportedModes);
    const has = current.includes(mode);
    const next = has ? current.filter((item) => item !== mode) : current.concat(mode);
    const normalized = uniqueModes(next);
    if (!normalized.length) {
      wx.showToast({ title: "至少保留一种模式", icon: "none" });
      return;
    }
    const routeTabs = buildRouteTabs(normalized);
    const routeMode = routeTabs.some((item) => item.key === this.data.routeMode) ? this.data.routeMode : routeTabs[0].key;
    this.setData({
      form: { ...this.data.form, supportedModes: normalized },
      routeTabs,
      routeMode
    });
    this.refreshRouteRows();
  },
  onCycleName(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, name: e.detail.value } });
  },
  onCycleStart(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, startDate: e.detail.value } });
  },
  onCycleStartToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    this.setData({ cycleForm: { ...this.data.cycleForm, startDate: `${y}-${m}-${day}` } });
  },
  onCycleStartMonth() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    this.setData({ cycleForm: { ...this.data.cycleForm, startDate: `${y}-${m}-01` } });
  },
  onBoulderGrades(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, boulderGrades: e.detail.value } });
    this.refreshRouteRows();
  },
  onDifficultyGrades(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, difficultyGrades: e.detail.value } });
    this.refreshRouteRows();
  },
  onLeadGrades(e) {
    this.setData({ cycleForm: { ...this.data.cycleForm, leadGrades: e.detail.value } });
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
  onPickLeadTemplate() {
    const itemList = LEAD_TEMPLATES.map((t) => t.label);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const idx = res && typeof res.tapIndex === "number" ? res.tapIndex : -1;
        const tpl = idx >= 0 ? LEAD_TEMPLATES[idx] : null;
        if (!tpl) return;
        this.setData({ cycleForm: { ...this.data.cycleForm, leadGrades: tpl.grades.join(",") } });
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
        difficultyGrades: (c.difficultyGrades || c.rope_grades || c.difficulty_grades || []).join(","),
        leadGrades: (c.leadGrades || c.lead_grades || []).join(",")
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
    if (editing && editing.status === "archived") {
      wx.showToast({ title: "该周期已关闭", icon: "none" });
      return;
    }
    const endDate = safeText(this.data.closeEndDate) || today();
    const startDate = safeText(this.data.cycleForm.startDate) || "";
    wx.showModal({
      title: "关闭周期",
      content: `确认将本周期设置为 ${startDate || "开始日期未知"} ~ ${endDate} 吗？`,
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
    const tabs = buildRouteTabs(this.data.form.supportedModes || ["boulder", "difficulty"]);
    const mode = tabs.some((item) => item.key === this.data.routeMode) ? this.data.routeMode : tabs[0] && tabs[0].key;
    if (!mode) {
      this.setData({ routeRows: [], routeTabs: tabs });
      return;
    }
    const grades =
      mode === "boulder"
        ? splitGrades(this.data.cycleForm.boulderGrades)
        : mode === "lead"
          ? splitGrades(this.data.cycleForm.leadGrades)
          : splitGrades(this.data.cycleForm.difficultyGrades);
    const rows = buildRouteRows(grades, (this.data.routeCounts && this.data.routeCounts[mode]) || {});
    this.setData({ routeRows: rows, routeTabs: tabs, routeMode: mode });
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
    const key = mode === "boulder" ? "boulderGrades" : mode === "lead" ? "leadGrades" : "difficultyGrades";
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
    const supportedModes = uniqueModes(this.data.form.supportedModes);
    if (!supportedModes.length) {
      wx.showToast({ title: "至少选择一种模式", icon: "none" });
      return;
    }
    try {
      const res = await upsertGym({
        gymId: this.data.gymId || null,
        gym: { ...this.data.form, supportedModes }
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
    const supportedModes = uniqueModes(this.data.form.supportedModes);
    const boulderGrades = splitGrades(this.data.cycleForm.boulderGrades);
    const difficultyGrades = splitGrades(this.data.cycleForm.difficultyGrades);
    const leadGrades = splitGrades(this.data.cycleForm.leadGrades);
    if (
      (supportedModes.includes("boulder") && !boulderGrades.length) ||
      (supportedModes.includes("difficulty") && !difficultyGrades.length) ||
      (supportedModes.includes("lead") && !leadGrades.length)
    ) {
      wx.showToast({ title: "请补齐已启用模式的等级列表", icon: "none" });
      return;
    }
    try {
      const res = await upsertGym({
        gymId: this.data.gymId,
        cycle: {
          name: safeText(this.data.cycleForm.name),
          startDate,
          boulderGrades,
          difficultyGrades,
          leadGrades,
          cycleId:
            this.data.cycleEditing && this.data.cycleEditing._id && this.data.cycleEditing.status !== "archived"
              ? String(this.data.cycleEditing._id)
              : ""
        }
      });
      if (res && res.reviewState === "pending") {
        wx.showToast({ title: "已提交审核", icon: "none" });
      } else {
        wx.showToast({ title: "已保存", icon: "none" });
      }
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
      const res = await upsertGym({
        gymId: this.data.gymId,
        routes: {
          mode,
          limits
        }
      });
      if (res && res.reviewState === "pending") {
        wx.showToast({ title: "已提交审核", icon: "none" });
      } else {
        wx.showToast({ title: "已更新", icon: "none" });
      }
      await this.loadGym();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "更新失败", icon: "none" });
    }
  },
  async onDeleteGym() {
    if (!this.data.gymId) return;
    const gymName = safeText(this.data.form && this.data.form.name) || safeText(this.data.gym && this.data.gym.name) || "该岩馆";
    try {
      const preview = await manageGym({ action: "preview_delete", gymId: this.data.gymId });
      const warningText = Array.isArray(preview && preview.warnings) ? preview.warnings.join("\n") : "";
      wx.showModal({
        title: "删除岩馆",
        content: `${buildDeleteSummary(preview && preview.relations)}\n${warningText}`,
        confirmText: "下一步",
        success: (r1) => {
          if (!r1 || !r1.confirm) return;
          wx.showModal({
            title: "再次确认",
            content: `确认删除【${gymName}】吗？删除后它将不再出现在列表中。`,
            confirmText: "确认删除",
            success: async (r2) => {
              if (!r2 || !r2.confirm) return;
              try {
                await manageGym({
                  action: "apply_delete",
                  gymId: this.data.gymId,
                  mode: "soft",
                  confirmName: gymName
                });
                wx.showToast({ title: "已删除", icon: "none" });
                wx.navigateBack({
                  delta: 1,
                  fail: () => {
                    wx.redirectTo({ url: "/pages/owner/index" });
                  }
                });
              } catch (e2) {
                wx.showToast({ title: (e2 && e2.message) || "删除失败", icon: "none" });
              }
            }
          });
        }
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "删除失败", icon: "none" });
    }
  },
  onMergeGym() {
    if (!this.data.gymId) return;
    wx.navigateTo({ url: `/pages/gym-merge/index?sourceGymId=${this.data.gymId}` });
  },
  backOwner() {
    wx.navigateBack({ delta: 1 });
  }
});

