const { getWindowWidth } = require("../../utils/window");
const { createCanvasCompatContext } = require("../../utils/canvas2d");

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
      this._retryLeft = 4;
      const id = `lc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const w = Math.max(1, Math.round(toPx(690)));
      const h = Math.max(1, Math.round(toPx(this.data.heightRpx)));
      this.data.canvasId = id;
      this.setData({ canvasId: id, canvasWidth: w, canvasHeight: h }, () => setTimeout(() => this.draw(), 50));
    },
    ready() {
      try { this.draw(); } catch (_) {}
    },
    detached() {
      if (this._retryT) { clearTimeout(this._retryT); this._retryT = null; }
      this._destroyed = true;
    }
  },
  observers: {
    points() {
      try { this.draw(); } catch (_) {}
    },
    heightRpx() {
      const w = Math.max(1, Math.round(toPx(690)));
      const h = Math.max(1, Math.round(toPx(this.data.heightRpx)));
      this.setData({ canvasWidth: w, canvasHeight: h }, () => { try { this.draw(); } catch (_) {} });
    }
  },
  methods: {
    ensureCanvas2D() {
      const width = Math.max(1, Math.round(this.data.canvasWidth || toPx(690)));
      const height = Math.max(1, Math.round(this.data.canvasHeight || toPx(this.data.heightRpx)));
      if (this._canvasRef && this._canvasRef.canvas && this._canvasRef.ctx) {
        this._canvasRef.canvas.width = width;
        this._canvasRef.canvas.height = height;
        return Promise.resolve(this._canvasRef);
      }
      return new Promise((resolve) => {
        const query = wx.createSelectorQuery().in(this);
        query
          .select(`#${this.data.canvasId}`)
          .fields({ node: true, size: true })
          .exec((res) => {
            const item = res && res[0] ? res[0] : null;
            const canvas = item && item.node ? item.node : null;
            if (!canvas || typeof canvas.getContext !== "function") {
              resolve(null);
              return;
            }
            canvas.width = width;
            canvas.height = height;
            this._canvasRef = {
              canvas,
              ctx: createCanvasCompatContext(canvas.getContext("2d"))
            };
            resolve(this._canvasRef);
          });
      });
    },
    _scheduleRetry() {
      if (this._destroyed) return;
      if (!this._retryLeft && this._retryLeft !== 0) this._retryLeft = 4;
      if (this._retryLeft <= 0) return;
      this._retryLeft = Number(this._retryLeft) - 1;
      if (this._retryT) { clearTimeout(this._retryT); this._retryT = null; }
      this._retryT = setTimeout(() => { this._retryT = null; this.draw(); }, 220);
    },
    async draw() {
      if (this._destroyed) return;
      let points = [];
      try { points = (this.data.points || []).map((n) => Number(n || 0)); } catch (_) { points = []; }
      const canvasId = this.data.canvasId;
      if (!canvasId) {
        this._scheduleRetry();
        return;
      }

      const h = Number(this.data.canvasHeight || 0) || toPx(this.data.heightRpx);
      const w = Number(this.data.canvasWidth || 0) || toPx(690);
      const padding = toPx(16);
      let canvasRef = null;
      try { canvasRef = await this.ensureCanvas2D(); } catch (_) { canvasRef = null; }
      if (!canvasRef) {
        this._scheduleRetry();
        return;
      }
      const canvas = canvasRef.canvas;
      const ctx = canvasRef.ctx;
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      ctx.clearRect(0, 0, w, h);

      ctx.setStrokeStyle("rgba(231,233,243,0.18)");
      ctx.setLineWidth(1);
      ctx.beginPath();
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(w, h - 0.5);
      ctx.stroke();

      if (points.length < 2) {
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
    }
  }
});

