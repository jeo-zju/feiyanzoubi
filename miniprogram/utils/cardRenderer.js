const { clampText, wrapCanvasText } = require("./cardCanvas");

function drawFrontCard(ctx, options) {
  const W = Number(options && options.W) || 960;
  const H = Number(options && options.H) || 606;
  const front = (options && options.front) || {};
  const me = (options && options.me) || {};
  const user = (options && options.user) || {};
  const gymsLabel = (options && options.gymsLabel) || "";
  const avatarPath = (options && options.avatarPath) || "";
  const layout = (options && options.layout) || "responsive";
  const extra = (options && options.extra) || {};
  const climbSkills = extra.climbSkills || {};
  const heightCm = extra.heightCm || "";
  const armspanCm = extra.armspanCm || "";
  const rockId = extra.rockId || "";

  function drawChip(x, y, text, opts) {
    const padX = 24, padY = 14;
    const fs = (opts && opts.fontSize) || 24;
    ctx.setFontSize(fs);
    const w = ctx.measureText(text).width + padX * 2;
    const h = fs + padY * 2 - 4;
    const bg = (opts && opts.bg) || "rgba(143,123,255,0.18)";
    const bd = (opts && opts.border) || "rgba(143,123,255,0.4)";
    const fg = (opts && opts.color) || "#E7E9F3";
    ctx.setFillStyle(bg);
    ctx.setStrokeStyle(bd);
    ctx.setLineWidth(2);
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setFillStyle(fg);
    ctx.setFontSize(fs);
    ctx.setTextAlign("center");
    ctx.setTextBaseline("middle");
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    ctx.setTextAlign("left");
    ctx.setTextBaseline("alphabetic");
    return { w, h };
  }

  if (layout === "fixed") {
    const radius = 44;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(W - radius, 0);
    ctx.arcTo(W, 0, W, radius, radius);
    ctx.lineTo(W, H - radius);
    ctx.arcTo(W, H, W - radius, H, radius);
    ctx.lineTo(radius, H);
    ctx.arcTo(0, H, 0, H - radius, radius);
    ctx.lineTo(0, radius);
    ctx.arcTo(0, 0, radius, 0, radius);
    ctx.closePath();
    ctx.clip();

    const cardBg = ctx.createLinearGradient(0, 0, W, H);
    cardBg.addColorStop(0, "#13162A");
    cardBg.addColorStop(1, "#0F1223");
    ctx.setFillStyle(cardBg);
    ctx.fillRect(0, 0, W, H);

    const topBandH = Math.round(H / 6);
    const band = ctx.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, "rgba(143,123,255,0.95)");
    band.addColorStop(1, "rgba(242,193,78,0.95)");
    ctx.setFillStyle(band);
    ctx.fillRect(0, 0, W, topBandH);

    ctx.save();
    ctx.setFillStyle("rgba(11,13,21,0.42)");
    ctx.setFontSize(24);
    ctx.setTextAlign("center");
    ctx.fillText("飞岩走壁 · 攀岩名片", W / 2, Math.round(topBandH / 2) + 9);
    ctx.restore();
    ctx.setTextAlign("left");

    const pad = 52;
    const ax = pad;
    const ay = topBandH - 36;
    const ar = 94;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
    ctx.clip();
    if (avatarPath) ctx.drawImage(avatarPath, ax, ay, ar * 2, ar * 2);
    ctx.restore();
    ctx.setStrokeStyle("#0F1223");
    ctx.setLineWidth(8);
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setStrokeStyle("rgba(242,193,78,0.9)");
    ctx.setLineWidth(3);
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar + 7, 0, Math.PI * 2);
    ctx.stroke();

    const tx = ax + ar * 2 + 36;
    const nameY = ay + ar + 4;
    const nameText = clampText(front.displayName || me.displayName || user.nickName || "岩友", 10);
    ctx.setFillStyle("#E7E9F3");
    ctx.setFontSize(50);
    ctx.fillText(nameText, tx, nameY);

    if (rockId) {
      const nameW = ctx.measureText(nameText).width;
      ctx.setFillStyle("rgba(231,233,243,0.5)");
      ctx.setFontSize(26);
      ctx.fillText(`ID ${rockId}`, tx + nameW + 28, nameY - 2);
    }

    ctx.setFillStyle("rgba(231,233,243,0.65)");
    ctx.setFontSize(32);
    const meta = `${clampText(front.title || me.title || "长臂猿", 14)}${(front.mbti || me.mbti) ? ` · ${clampText(front.mbti || me.mbti, 6)}` : ""}`;
    ctx.fillText(meta, tx, nameY + 44);

    ctx.setFillStyle("rgba(242,193,78,0.9)");
    ctx.setFontSize(30);
    ctx.fillText(clampText(gymsLabel, 18), tx, nameY + 86);

    const chipStartY = ay + ar * 2 + 32;
    let chipX = pad, chipY = chipStartY;
    const chipGapX = 16, chipGapY = 12;
    const chipOpts = { fontSize: 30, bg: "rgba(143,123,255,0.25)", border: "rgba(143,123,255,0.42)", color: "#E7E9F3" };
    const chipOkOpts = { fontSize: 30, bg: "rgba(143,200,111,0.18)", border: "rgba(143,200,111,0.5)", color: "#8FC86F" };
    const rowH = 58;
    const chips = [];
    if (climbSkills.boulder) chips.push({ t: `抱石 ${climbSkills.boulder}` });
    if (climbSkills.toprope) chips.push({ t: `顶绳 ${climbSkills.toprope}` });
    if (climbSkills.lead) chips.push({ t: `先锋 ${climbSkills.lead}` });
    if (climbSkills.protector) chips.push({ t: "保护", ok: true });
    chips.forEach((c) => {
      const opts = c.ok ? chipOkOpts : chipOpts;
      const sz = drawChip(chipX, chipY, c.t, opts);
      chipX += sz.w + chipGapX;
      if (chipX > W - pad - 24) { chipX = pad; chipY += rowH + chipGapY; }
    });

    const metaRowY = chipY + rowH + 24;
    ctx.setFontSize(30);
    ctx.setFillStyle("rgba(231,233,243,0.72)");
    let mx = pad;
    if (heightCm) {
      const t = `↕ ${heightCm}cm`;
      ctx.fillText(t, mx, metaRowY);
      mx += ctx.measureText(t).width + 40;
    }
    if (armspanCm) {
      const t = `↔ ${armspanCm}cm`;
      ctx.fillText(t, mx, metaRowY);
      mx += ctx.measureText(t).width + 40;
    }

    const oneY = metaRowY + 46;
    const one = clampText(front.oneLiner || "用脚点谈判，用手点签字。", 48);
    ctx.setFillStyle("rgba(255,255,255,0.96)");
    ctx.setFontSize(42);
    const lines = wrapCanvasText(ctx, one, W - pad * 2);
    for (let i = 0; i < Math.min(2, lines.length); i++) {
      ctx.fillText(lines[i], pad, oneY + i * 56);
    }
    ctx.restore();
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

  ctx.setFillStyle("rgba(255,255,255,0.65)");
  ctx.setFontSize(Math.floor(H * 0.05));
  ctx.fillText("飞岩走壁 · 攀岩名片", pad + Math.floor(W * 0.06), H - Math.floor(H * 0.12));
  ctx.fillText(front.oneLinerStyle === "humor" ? "风格：幽默" : "风格：鼓励", pad + Math.floor(W * 0.06), H - Math.floor(H * 0.06));
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
