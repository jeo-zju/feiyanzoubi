Component({
  properties: {
    gym: { type: Object, value: {} }
  },
  methods: {
    onTap() {
      const gym = this.data.gym || {};
      this.triggerEvent("tap", { gym });
    }
  }
});

