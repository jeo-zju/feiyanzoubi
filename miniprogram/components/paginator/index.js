Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    page: { type: Number, value: 1 },
    hasNext: { type: Boolean, value: false }
  },
  methods: {
    onPrev() {
      if (Number(this.data.page || 1) <= 1) return;
      this.triggerEvent("prev");
    },
    onNext() {
      if (!this.data.hasNext) return;
      this.triggerEvent("next");
    }
  }
});

