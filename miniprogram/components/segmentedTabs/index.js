Component({
  properties: {
    tabs: {
      type: Array,
      value: []
    },
    value: {
      type: String,
      value: ""
    },
    // 可选主题：theme="v2" 使用岩场邀请函弱绿底选中态；默认保持旧样式
    theme: {
      type: String,
      value: ""
    },
    // v2 紧凑变体：仅首页日期快捷行使用（透明底、等宽、单项约 72rpx），不影响其他页
    compact: {
      type: Boolean,
      value: false
    }
  },
  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key;
      this.triggerEvent("change", { value: key });
    }
  }
});
