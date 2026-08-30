const { safeText } = require("./format");

function createCanvasCompatContext(ctx) {
  if (!ctx || ctx.__legacyCanvasCompatApplied) return ctx;
  if (typeof ctx.setFillStyle !== "function") {
    ctx.setFillStyle = function (value) {
      ctx.fillStyle = value;
    };
  }
  if (typeof ctx.setStrokeStyle !== "function") {
    ctx.setStrokeStyle = function (value) {
      ctx.strokeStyle = value;
    };
  }
  if (typeof ctx.setLineWidth !== "function") {
    ctx.setLineWidth = function (value) {
      ctx.lineWidth = value;
    };
  }
  if (typeof ctx.setFontSize !== "function") {
    ctx.setFontSize = function (value) {
      ctx.font = `${Math.max(1, Number(value) || 0)}px sans-serif`;
    };
  }
  if (typeof ctx.setTextAlign !== "function") {
    ctx.setTextAlign = function (value) {
      ctx.textAlign = value;
    };
  }
  if (typeof ctx.setLineCap !== "function") {
    ctx.setLineCap = function (value) {
      ctx.lineCap = value;
    };
  }
  if (typeof ctx.setLineJoin !== "function") {
    ctx.setLineJoin = function (value) {
      ctx.lineJoin = value;
    };
  }
  ctx.__legacyCanvasCompatApplied = true;
  return ctx;
}

function loadCanvasImage(canvas, src) {
  const path = safeText(src);
  if (!canvas || !path || typeof canvas.createImage !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

function exportCanvasTempFile(canvas, width, height, destWidth, destHeight) {
  if (!canvas) return Promise.resolve("");
  return new Promise((resolve) => {
    wx.canvasToTempFilePath({
      canvas,
      width,
      height,
      destWidth: destWidth || width,
      destHeight: destHeight || height,
      fileType: "png",
      quality: 1,
      success: (r) => resolve(r && r.tempFilePath ? r.tempFilePath : ""),
      fail: () => resolve("")
    });
  });
}

module.exports = {
  createCanvasCompatContext,
  loadCanvasImage,
  exportCanvasTempFile
};
