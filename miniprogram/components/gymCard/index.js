const MODE_LABELS = {
  boulder: "抱石",
  difficulty: "难度",
  lead: "先锋"
};

function buildDisplayGym(gym) {
  const next = { ...(gym || {}) };
  const seen = {};
  const labels = [];
  (Array.isArray(next.supportedModeLabels) ? next.supportedModeLabels : []).forEach((label) => {
    const text = String(label || "").trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    labels.push(text);
  });
  if (!labels.length) {
    (Array.isArray(next.supportedModes) ? next.supportedModes : []).forEach((mode) => {
      const text = MODE_LABELS[String(mode || "").trim().toLowerCase()];
      if (!text || seen[text]) return;
      seen[text] = true;
      labels.push(text);
    });
  }
  next.supportedModeLabels = labels;
  const hardnessCount = Math.max(0, Number(next.hardnessCount || 0) || 0);
  const hardnessAvg = Number(next.hardnessAvg);
  next.hardnessText =
    hardnessCount > 0 && Number.isFinite(hardnessAvg) ? `${hardnessCount} 人打出 ${hardnessAvg.toFixed(1)} 分` : "无人打分";
  next.recentVisitLabel = next.lastVisitLabel ? "上次去过" : "";
  const compactMeta = [];
  if (next.visitLabel) compactMeta.push(next.visitLabel);
  if (next.recentVisitLabel) compactMeta.push(next.recentVisitLabel);
  next.compactMetaText = `${compactMeta.length ? `(${compactMeta.join(" / ")}) ` : ""}${next.address || ""}`.trim();
  return next;
}

Component({
  properties: {
    gym: { type: Object, value: {} },
    compact: { type: Boolean, value: false }
  },
  data: {
    displayGym: {}
  },
  observers: {
    gym(gym) {
      this.setData({ displayGym: buildDisplayGym(gym) });
    }
  },
  methods: {
    onTap() {
      const gym = this.data.gym || {};
      this.triggerEvent("tap", { gym });
    }
  }
});
