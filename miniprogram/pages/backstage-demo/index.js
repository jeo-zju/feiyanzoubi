const demoApi = require("../../services/api/demo");
const { ensureAdminPageAccess } = require("../../utils/session");

const CITY_OPTIONS = ["杭州市", "北京市", "上海市", "广州市", "深圳市", "成都市", "重庆市", "武汉市", "南京市"];
const DENSITY_OPTIONS = [
  { key: "low", label: "低 · 12 场" },
  { key: "medium", label: "中 · 24 场" },
  { key: "high", label: "高 · 40 场" }
];
const SLOT_LABELS = { morning: "上午", afternoon: "下午", evening: "晚上" };
const STATUS_LABELS = { running: "生成中", done: "已完成", cleaned: "已清理", cleaning: "清理中", failed: "失败" };

function plainCity(value) {
  return String(value || "").replace(/市$/, "");
}

function slotsText(slots) {
  return (Array.isArray(slots) ? slots : []).map((s) => SLOT_LABELS[s] || s).join(" + ");
}

function decorateRun(run) {
  return Object.assign({}, run, {
    statusText: STATUS_LABELS[run.status] || run.status,
    progressText: `${run.created || 0}/${run.total || 0}`,
    canContinue: run.status === "running",
    canCleanup: ["done", "cleaning"].includes(run.status) ||
      (run.status === "cleaned" && (run.cleanupAnomalies || []).length > 0)
  });
}

function decoratePreview(p) {
  const items = (Array.isArray(p.items) ? p.items : []).map((it) => ({
    key: `${it.date}-${it.gymId}-${(it.timeSlots || []).join("_")}`,
    date: it.date,
    gymName: it.gymName || "未知岩馆",
    slotsText: slotsText(it.timeSlots),
    capacityText: `${it.capacity} 人满员`,
    title: it.title
  }));
  return Object.assign({}, p, { items });
}

Page({
  data: {
    cityOptions: CITY_OPTIONS,
    cityIndex: 0,
    densityOptions: DENSITY_OPTIONS,
    densityIndex: 1,
    assets: null,
    preview: null,
    previewLoading: false,
    generating: false,
    activeRunId: "",
    progressPct: 0,
    runs: []
  },

  async onShow() {
    await ensureAdminPageAccess();
    this.loadAssets();
    this.loadRuns();
  },

  onCityChange(e) {
    this.setData({ cityIndex: Number(e.detail.value), preview: null });
  },

  onDensityTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index !== this.data.densityIndex) this.setData({ densityIndex: index, preview: null });
  },

  currentCity() {
    return plainCity(this.data.cityOptions[this.data.cityIndex]);
  },

  async loadAssets() {
    try {
      const res = await demoApi.assetsStatus({ silent: true });
      this.setData({ assets: res });
    } catch (e) {
      // 静默：功能未启用时不应打断页面
    }
  },

  async onProvision() {
    try {
      const res = await demoApi.provisionIdentities();
      wx.showToast({ title: `身份 ${res.users}，新建 ${res.created}`, icon: "none" });
      this.loadAssets();
    } catch (e) {
      wx.showToast({ title: e.message || "建立失败", icon: "none" });
    }
  },

  async onPreview() {
    this.setData({ previewLoading: true });
    try {
      const res = await demoApi.previewDemoPlans({
        city: this.currentCity(),
        density: DENSITY_OPTIONS[this.data.densityIndex].key
      });
      this.setData({ preview: decoratePreview(res) });
      if (!res.toCreate) {
        wx.showToast({ title: "窗口内无需补场", icon: "none" });
      }
    } catch (e) {
      wx.showModal({ title: "预览失败", content: e.message || String(e), showCancel: false });
    } finally {
      this.setData({ previewLoading: false });
    }
  },

  onDrill() {
    wx.showModal({
      title: "小批演练",
      content: "将先预览并只生成同 seed 下的前 3 场满员约爬，用于灰度验证，确定？",
      confirmText: "演练 3 场",
      success: (res) => {
        if (res.confirm) this.doDrill();
      }
    });
  },

  async doDrill() {
    if (this.data.generating) return;
    this.setData({ generating: true, previewLoading: true });
    try {
      const preview = await demoApi.previewDemoPlans({
        city: this.currentCity(),
        density: DENSITY_OPTIONS[this.data.densityIndex].key,
        maxItems: 3
      });
      this.setData({ preview: decoratePreview(preview) });
      if (preview.toCreate !== 3) {
        wx.showToast({ title: `预览仅 ${preview.toCreate} 场（需≥3）`, icon: "none" });
        return;
      }
      const idempotencyKey = `drill-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const run = await demoApi.generateDemoPlans({
        city: this.currentCity(),
        density: DENSITY_OPTIONS[this.data.densityIndex].key,
        seed: preview.seed,
        maxItems: 3,
        idempotencyKey
      });
      this.setData({
        activeRunId: run.runId,
        progressPct: run.total ? Math.round(((run.created || 0) / run.total) * 100) : 0,
        preview: null
      });
      await this.driveRun(run.runId);
      await this.loadRuns();
    } catch (e) {
      wx.showModal({ title: "演练失败", content: e.message || String(e), showCancel: false });
    } finally {
      this.setData({ generating: false, previewLoading: false, activeRunId: "", progressPct: 0 });
    }
  },

  onGenerate() {
    const preview = this.data.preview;
    if (!preview || !preview.toCreate) {
      wx.showToast({ title: "请先预览且存在待建场次", icon: "none" });
      return;
    }
    wx.showModal({
      title: "确认生成",
      content: `将在 ${preview.city} 创建 ${preview.toCreate} 场满员约爬（真实报名与日程占用），确定继续？`,
      confirmText: "生成",
      success: (res) => {
        if (res.confirm) this.doGenerate();
      }
    });
  },

  async doGenerate() {
    if (this.data.generating) return;
    const idempotencyKey = `ui-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    this.setData({ generating: true });
    try {
      const run = await demoApi.generateDemoPlans({
        city: this.currentCity(),
        density: DENSITY_OPTIONS[this.data.densityIndex].key,
        seed: this.data.preview && this.data.preview.seed,
        idempotencyKey
      });
      this.setData({
        activeRunId: run.runId,
        progressPct: run.total ? Math.round(((run.created || 0) / run.total) * 100) : 0,
        preview: null
      });
      await this.driveRun(run.runId);
      await this.loadRuns();
    } catch (e) {
      wx.showModal({ title: "生成失败", content: e.message || String(e), showCancel: false });
    } finally {
      this.setData({ generating: false, activeRunId: "", progressPct: 0 });
    }
  },

  // 管理员轮询续跑：仅续跑已存在的任务，不自动发起任何新任务
  async driveRun(runId) {
    let summary = null;
    for (let guard = 0; guard < 30; guard += 1) {
      summary = await demoApi.continueDemoRun(runId);
      const total = summary.total || 0;
      const pct = total ? Math.round(((summary.created || 0) + (summary.failed || 0)) / total * 100) : 0;
      this.setData({ progressPct: Math.max(this.data.progressPct, pct) });
      if (summary.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (summary && summary.status === "done") {
      wx.showToast({ title: `已生成 ${summary.created} 场`, icon: "success" });
    } else if (summary && summary.failed) {
      wx.showModal({ title: "部分场次失败", content: `失败 ${summary.failed} 场，可在批次详情中查看`, showCancel: false });
    }
  },

  async onContinue(e) {
    const runId = e.currentTarget.dataset.id;
    this.setData({ activeRunId: runId });
    try {
      await this.driveRun(runId);
      await this.loadRuns();
    } finally {
      this.setData({ activeRunId: "" });
    }
  },

  async loadRuns() {
    try {
      const res = await demoApi.listDemoRuns(this.currentCity(), { silent: true });
      this.setData({ runs: (res.runs || []).map(decorateRun) });
    } catch (e) {
      this.setData({ runs: [] });
    }
  },

  onHideAll() {
    wx.showModal({
      title: "隐藏全部演示约爬",
      content: "隐藏后发现页、日历、分享旧链接都不再返回这些场次（最长 20 秒全域生效）。确定？",
      confirmText: "隐藏",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await demoApi.hideDemoPlans();
          wx.showToast({ title: "已全部隐藏", icon: "success" });
        } catch (e) {
          wx.showToast({ title: e.message || "隐藏失败", icon: "none" });
        }
      }
    });
  },

  onCleanup(e) {
    const runId = e.currentTarget.dataset.id;
    wx.showModal({
      title: "清理本批场次",
      content: "将删除该批次的全部约爬、报名关系与日程占用（素材与模拟身份保留），不可恢复。确定？",
      confirmText: "清理",
      confirmColor: "#e64340",
      success: (res) => {
        if (res.confirm) this.doCleanup(runId);
      }
    });
  },

  async doCleanup(runId) {
    try {
      let summary = await demoApi.cleanupDemoRun(runId);
      for (let guard = 0; guard < 20 && summary.status === "cleaning"; guard += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        summary = await demoApi.cleanupDemoRun(runId);
      }
      const stats = summary.cleanupStats || {};
      const anomalies = summary.cleanupAnomalies || [];
      if (anomalies.length) {
        wx.showModal({
          title: "清理完成但有异常",
          content: `删除 ${stats.plansRemoved || 0} 场，异常 ${anomalies.length} 条，请核查`,
          showCancel: false
        });
      } else {
        wx.showToast({ title: `已清理 ${stats.plansRemoved || 0} 场`, icon: "success" });
      }
      await this.loadRuns();
    } catch (e) {
      wx.showToast({ title: e.message || "清理失败", icon: "none" });
    }
  }
});
