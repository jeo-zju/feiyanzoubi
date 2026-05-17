Component({
  properties: {
    page: { type: Number, value: 1 },
    hasPrev: { type: Boolean, value: false },
    hasNext: { type: Boolean, value: false }
  },
  methods: {
    onPrev() {
      if (!this.data.hasPrev) return;
      this.triggerEvent("prev");
    },
    onNext() {
      if (!this.data.hasNext) return;
      this.triggerEvent("next");
    }
  }
});

