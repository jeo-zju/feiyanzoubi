Component({
  properties: {
    label: { type: String, value: "" },
    progressText: { type: String, value: "" },
    delta: { type: Number, value: 0 },
    canDec: { type: Boolean, value: true },
    canInc: { type: Boolean, value: true }
  },
  data: {
    deltaText: "+0"
  },
  observers: {
    delta(v) {
      const n = Number(v || 0);
      this.setData({ deltaText: `${n >= 0 ? "+" : ""}${n}` });
    }
  },
  methods: {
    onDec() {
      if (!this.data.canDec) return;
      this.triggerEvent("dec");
    },
    onInc() {
      if (!this.data.canInc) return;
      this.triggerEvent("inc");
    }
  }
});

