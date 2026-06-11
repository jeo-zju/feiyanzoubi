const { getWindowWidth } = require("../../utils/window");

function toPx(rpx) {
  return (Number(rpx || 0) * getWindowWidth()) / 750;
}

Component({
  properties: {
    points: { type: Array, value: [] },
    heightRpx: { type: Number, value: 200 },
    color: { type: String, value: "#8F7BFF" }
  },
  data: {
    canvasId: "",
    canvasWidth: 0,
    canvasHeight: 0
  },
  lifetimes: {
    attached() {
      const id = `lc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const w = Math.max(1, Math.round(toPx(690)));
      const h = Math.max(1, Math.round(toPx(this.data.heightRpx)));
      this.data.canvasId = id;
      this.setData({ canvasId: id, canvasWidth: w, canvasHeight: h }, () => setTimeout(() => this.draw(), 30));
    },
    ready() {
      this.draw();
    }
  },
  observers: {
    points() {
      this.draw();
    },
    heightRpx() {
      const w = Math.max(1, Math.round(toPx(690)));
      const h = Math.max(1, Math.round(toPx(this.data.heightRpx)));
      this.setData({ canvasWidth: w, canvasHeight: h }, () => this.draw());
    }
  },
  methods: {
    draw() {
      const points = (this.data.points || []).map((n) => Number(n || 0));
      const canvasId = this.data.canvasId;
      if (!canvasId) {
        setTimeout(() => this.draw(), 60);
        return;
      }

      const h = Number(this.data.canvasHeight || 0) || toPx(this.data.heightRpx);
      const w = Number(this.data.canvasWidth || 0) || toPx(690);
      const padding = toPx(16);
      const ctx = wx.createCanvasContext(canvasId, this);
      ctx.clearRect(0, 0, w, h);

      ctx.setStrokeStyle("rgba(231,233,243,0.18)");
      ctx.setLineWidth(1);
      ctx.beginPath();
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(w, h - 0.5);
      ctx.stroke();

      if (points.length < 2) {
        ctx.draw();
        return;
      }

      let min = points[0];
      let max = points[0];
      for (let i = 1; i < points.length; i++) {
        if (points[i] < min) min = points[i];
        if (points[i] > max) max = points[i];
      }
      if (min === max) {
        min = 0;
      }

      const innerW = w - padding * 2;
      const innerH = h - padding * 2;
      const stepX = innerW / (points.length - 1);

      function mapY(v) {
        const t = (v - min) / (max - min || 1);
        return padding + innerH * (1 - t);
      }

      ctx.setStrokeStyle(this.data.color);
      ctx.setLineWidth(toPx(2));
      ctx.setLineCap("round");
      ctx.setLineJoin("round");
      ctx.beginPath();
      ctx.moveTo(padding, mapY(points[0]));
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(padding + stepX * i, mapY(points[i]));
      }
      ctx.stroke();

      ctx.setFillStyle(this.data.color);
      for (let i = 0; i < points.length; i++) {
        const x = padding + stepX * i;
        const y = mapY(points[i]);
        ctx.beginPath();
        ctx.arc(x, y, toPx(3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.draw();
    }
  }
});

