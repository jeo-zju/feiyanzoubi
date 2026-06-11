Component({
  properties: {
    tabs: {
      type: Array,
      value: []
    },
    value: {
      type: String,
      value: ""
    }
  },
  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key;
      this.triggerEvent("change", { value: key });
    }
  }
});

