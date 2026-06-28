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
  return next;
}

Component({
  properties: {
    gym: { type: Object, value: {} }
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

