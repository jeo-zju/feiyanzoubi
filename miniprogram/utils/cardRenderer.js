const { clampText, wrapCanvasText } = require("./cardCanvas");

function drawFrontCard(ctx, options) {
  const W = Number(options && options.W) || 1080;
  const H = Number(options && options.H) || 680;
  const front = (options && options.front) || {};
  const gymsLabel = (options && options.gymsLabel) || "";
  const avatarPath = (options && options.avatarPath) || "";
  const layout = (options && options.layout) || "responsive";

  if (layout === "fixed") {
    ctx.setFillStyle("#0B0D15");
    ctx.fillRect(0, 0, W, H);

    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(143,123,255,0.95)");
    g.addColorStop(1, "rgba(242,193,78,0.95)");
    ctx.setFillStyle(g);
    ctx.fillRect(0, 0, W, 78);

    ctx.setFillStyle("rgba(255,255,255,0.10)");
    ctx.fillRect(54, 120, W - 108, H - 210);

    const ax = 86;
    const ay = 156;
    const ar = 72;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
    ctx.clip();
    if (avatarPath) ctx.drawImage(avatarPath, ax, ay, ar * 2, ar * 2);
    ctx.restore();
    ctx.setStrokeStyle("rgba(242,193,78,0.85)");
    ctx.setLineWidth(6);
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar + 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(48);
    ctx.fillText(clampText(front.displayName || "岩友", 10), 190, 206);

    ctx.setFillStyle("rgba(255,255,255,0.92)");
    ctx.setFontSize(28);
    const meta = `${clampText(front.title, 12)}${front.mbti ? ` · ${clampText(front.mbti, 6)}` : ""}`;
    ctx.fillText(meta, 190, 250);

    const one = clampText(front.oneLiner, 40);
    ctx.setFillStyle("rgba(255,255,255,0.95)");
    ctx.setFontSize(34);
    const lines = wrapCanvasText(ctx, one, W - 200);
    for (let i = 0; i < Math.min(2, lines.length); i++) {
      ctx.fillText(lines[i], 120, 352 + i * 46);
    }

    ctx.setFillStyle("rgba(255,255,255,0.65)");
    ctx.setFontSize(22);
    ctx.fillText("飞岩走壁 · 攀岩名片", 120, H - 88);
    ctx.fillText(front.oneLinerStyle === "humor" ? "风格：幽默" : "风格：鼓励", 120, H - 54);
    return;
  }

  ctx.setFillStyle("#0B0D15");
  ctx.fillRect(0, 0, W, H);

  const barH = Math.max(56, Math.floor(H * 0.14));
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgba(143,123,255,0.95)");
  g.addColorStop(1, "rgba(242,193,78,0.95)");
  ctx.setFillStyle(g);
  ctx.fillRect(0, 0, W, barH);

  const pad = Math.floor(W * 0.06);
  const cardY = barH + Math.floor(H * 0.08);
  ctx.setFillStyle("rgba(255,255,255,0.10)");
  ctx.fillRect(pad, cardY, W - pad * 2, H - cardY - pad);

  const ar = Math.floor(H * 0.17);
  const ax = pad + Math.floor(W * 0.03);
  const ay = cardY + Math.floor(H * 0.08);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
  ctx.clip();
  if (avatarPath) ctx.drawImage(avatarPath, ax, ay, ar * 2, ar * 2);
  ctx.restore();

  ctx.setStrokeStyle("rgba(242,193,78,0.85)");
  ctx.setLineWidth(Math.max(4, Math.floor(H * 0.012)));
  ctx.beginPath();
  ctx.arc(ax + ar, ay + ar, ar + Math.floor(H * 0.008), 0, Math.PI * 2);
  ctx.stroke();

  const tx = ax + ar * 2 + Math.floor(W * 0.05);
  ctx.setFillStyle("#FFFFFF");
  ctx.setFontSize(Math.floor(H * 0.11));
  ctx.fillText(clampText(front.displayName || "岩友", 10), tx, ay + Math.floor(H * 0.13));

  ctx.setFillStyle("rgba(255,255,255,0.92)");
  ctx.setFontSize(Math.floor(H * 0.06));
  const meta = `${clampText(front.title, 12)}${front.mbti ? ` · ${clampText(front.mbti, 6)}` : ""}`;
  ctx.fillText(meta, tx, ay + Math.floor(H * 0.24));

  ctx.setFillStyle("rgba(242,193,78,0.95)");
  ctx.setFontSize(Math.floor(H * 0.055));
  ctx.fillText(clampText(gymsLabel, 14), tx, ay + Math.floor(H * 0.33));

  const one = clampText(front.oneLiner, 40);
  ctx.setFillStyle("rgba(255,255,255,0.95)");
  ctx.setFontSize(Math.floor(H * 0.075));
  const lines = wrapCanvasText(ctx, one, W - pad * 2 - Math.floor(W * 0.08));
  const ox = pad + Math.floor(W * 0.06);
  const oy = ay + ar * 2 + Math.floor(H * 0.06);
  const lh = Math.floor(H * 0.10);
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    ctx.fillText(lines[i], ox, oy + i * lh);
  }

  ctx.setFillStyle("rgba(255,255,255,0.65)");
  ctx.setFontSize(Math.floor(H * 0.05));
  ctx.fillText("飞岩走壁 · 攀岩名片", ox, H - Math.floor(H * 0.12));
  ctx.fillText(front.oneLinerStyle === "humor" ? "风格：幽默" : "风格：鼓励", ox, H - Math.floor(H * 0.06));
}

function drawBackCard(ctx, options) {
  const W = Number(options && options.W) || 1080;
  const H = Number(options && options.H) || 680;
  const front = (options && options.front) || {};
  const back = (options && options.back) || {};
  const photoPath = (options && options.photoPath) || "";
  const layout = (options && options.layout) || "responsive";

  ctx.setFillStyle("#0B0D15");
  ctx.fillRect(0, 0, W, H);

  if (photoPath) {
    ctx.drawImage(photoPath, 0, 0, W, H);
    ctx.setFillStyle("rgba(11,13,21,0.55)");
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "rgba(143,123,255,0.55)");
    g.addColorStop(1, "rgba(242,193,78,0.35)");
    ctx.setFillStyle(g);
    ctx.fillRect(0, 0, W, H);
  }

  if (layout === "fixed") {
    ctx.setFillStyle("rgba(255,255,255,0.10)");
    ctx.fillRect(60, 80, W - 120, H - 160);

    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(40);
    ctx.fillText(clampText(front.displayName || "岩友", 10), 120, 156);

    ctx.setFillStyle("rgba(255,255,255,0.92)");
    ctx.setFontSize(28);
    ctx.fillText("背面故事", 120, 208);

    ctx.setFillStyle("rgba(255,255,255,0.95)");
    ctx.setFontSize(30);
    const lines = wrapCanvasText(ctx, clampText(back.story, 220), W - 240);
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      ctx.fillText(lines[i], 120, 270 + i * 44);
    }

    ctx.setFillStyle("rgba(255,255,255,0.65)");
    ctx.setFontSize(22);
    ctx.fillText("飞岩走壁 · 攀岩名片", 120, H - 62);
    return;
  }

  const pad = Math.floor(W * 0.06);
  ctx.setFillStyle("rgba(255,255,255,0.10)");
  ctx.fillRect(pad, pad, W - pad * 2, H - pad * 2);

  const tx = pad + Math.floor(W * 0.06);
  ctx.setFillStyle("#FFFFFF");
  ctx.setFontSize(Math.floor(H * 0.10));
  ctx.fillText(clampText(front.displayName || "岩友", 10), tx, pad + Math.floor(H * 0.18));

  ctx.setFillStyle("rgba(255,255,255,0.92)");
  ctx.setFontSize(Math.floor(H * 0.065));
  ctx.fillText("背面故事", tx, pad + Math.floor(H * 0.30));

  ctx.setFillStyle("rgba(255,255,255,0.95)");
  ctx.setFontSize(Math.floor(H * 0.07));
  const lines = wrapCanvasText(ctx, clampText(back.story, 220), W - tx * 2);
  const startY = pad + Math.floor(H * 0.42);
  const lh = Math.floor(H * 0.105);
  const maxLines = Math.max(6, Math.floor((H - startY - Math.floor(H * 0.20)) / lh));
  for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
    ctx.fillText(lines[i], tx, startY + i * lh);
  }

  ctx.setFillStyle("rgba(255,255,255,0.65)");
  ctx.setFontSize(Math.floor(H * 0.05));
  ctx.fillText("飞岩走壁 · 攀岩名片", tx, H - Math.floor(H * 0.08));
}

function flushCanvas(ctx, reserve) {
  return new Promise((resolve) => ctx.draw(!!reserve, resolve));
}

module.exports = {
  drawFrontCard,
  drawBackCard,
  flushCanvas
};
