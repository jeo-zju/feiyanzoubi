const { clampText, wrapCanvasText } = require("./cardCanvas");

// 名片渲染版本：任何绘制逻辑/布局调整后 bump 一次。
// me 页把该版本纳入名片指纹，版本变化 → 指纹失配 → 强制重绘，
// 避免持久化缓存的旧名片 PNG 被继续复用（#38 旧布局、#40 旧字段残留的根因）。
const RENDER_VERSION = "r20260907b";

// issue #38: 按像素宽度截断文本（超长加省略号），防止名片文字溢出到右侧数据网格
function fitCanvasText(ctx, text, maxW) {
  const t = String(text == null ? "" : text);
  if (!t || !(maxW > 0)) return "";
  if (ctx.measureText(t).width <= maxW) return t;
  let lo = 0;
  const hi = t.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ctx.measureText(t.slice(0, mid) + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? t.slice(0, lo) + "…" : "…";
}

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
  const wechatId = (extra.showWechat && extra.wechatId) ? extra.wechatId : "";
  const xhsId = (extra.showXhs && extra.xhsId) ? extra.xhsId : "";

  function drawRoundedRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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

    const pad = Math.round(W * 0.05);
    const topBandH = Math.round(H / 8);

    const band = ctx.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, "rgba(143,123,255,0.95)");
    band.addColorStop(1, "rgba(242,193,78,0.95)");
    ctx.setFillStyle(band);
    ctx.fillRect(0, 0, W, topBandH);

    ctx.setFillStyle("rgba(11,13,21,0.5)");
    ctx.fillRect(0, 0, W, topBandH);

    ctx.setTextAlign("center");
    ctx.setTextBaseline("alphabetic");
    ctx.setFillStyle("#E7E9F3");
    ctx.setFontSize(Math.round(topBandH * 0.42));
    ctx.fillText("飞岩走壁 · 攀岩名片", W / 2, Math.round(topBandH * 0.6));
    ctx.setTextAlign("left");
    ctx.setTextBaseline("alphabetic");

    const avatarR = 86;
    const avatarX = pad;
    const avatarY = topBandH + Math.round(H * 0.07);
    const avatarCx = avatarX + avatarR;
    const avatarCy = avatarY + avatarR;

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, avatarR, 0, Math.PI * 2);
    ctx.clip();
    if (avatarPath) ctx.drawImage(avatarPath, avatarX, avatarY, avatarR * 2, avatarR * 2);
    ctx.restore();

    ctx.setStrokeStyle("#0F1223");
    ctx.setLineWidth(6);
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, avatarR + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setStrokeStyle("#F2C14E");
    ctx.setLineWidth(2.5);
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, avatarR + 7, 0, Math.PI * 2);
    ctx.stroke();

    const infoX = avatarCx + avatarR + 24;
    // issue #38: 左侧文字区域右边界 = 右侧数据网格左缘，昵称/称呼/地点均不得越界
    const textMaxX = Math.round(W * 0.58) - 24;

    // issue #38: 昵称过长时先缩字号、仍超宽则省略号截断；岩友号 ID 移到地点行展示，
    // 不再紧跟昵称右侧（长昵称会把 ID 顶进右侧网格造成遮挡）
    const nameRaw = String(front.displayName || me.displayName || user.nickName || "岩友");
    const nameY = avatarCy - 12;
    let nameFontSize = 56;
    ctx.setTextAlign("left");
    ctx.setTextBaseline("alphabetic");
    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(nameFontSize);
    let nameText = nameRaw;
    if (ctx.measureText(nameRaw).width > textMaxX - infoX) {
      nameFontSize = 44;
      ctx.setFontSize(nameFontSize);
    }
    if (ctx.measureText(nameRaw).width > textMaxX - infoX) {
      nameText = fitCanvasText(ctx, nameRaw, textMaxX - infoX);
    }
    ctx.fillText(nameText, infoX, nameY);

    const metaTitle = clampText(front.title || me.title || "岩友", 14);
    const metaMbti = (front.mbti || me.mbti) ? ` · ${clampText(front.mbti || me.mbti, 6)}` : "";
    const metaY = nameY + 52;
    ctx.setFillStyle("rgba(231,233,243,0.75)");
    ctx.setFontSize(24);
    // 「称呼 · MBTI」行：移除左右手绘装饰破折号（右侧紧跟 MBTI 像多余横线，
    // 左侧还压在头像边缘上），整行可用宽度相应放宽
    const metaText = fitCanvasText(ctx, `${metaTitle}${metaMbti}`, textMaxX - infoX);
    ctx.fillText(metaText, infoX, metaY);

    const locY = metaY + 40;
    ctx.setFontSize(26);
    const idText = rockId ? `ID ${rockId}` : "";
    const idTextW = idText ? ctx.measureText(idText).width : 0;
    if (gymsLabel) {
      // issue #38: 地点后跟岩友号 ID（灰色），地点超长时省略号截断，整行不越过网格
      ctx.setFillStyle("#F2C14E");
      const gymBudget = idText ? textMaxX - infoX - idTextW - 14 : textMaxX - infoX;
      const gymText = fitCanvasText(ctx, `📍 ${gymsLabel}`, Math.max(80, gymBudget));
      ctx.fillText(gymText, infoX, locY);
      if (idText) {
        ctx.setFillStyle("rgba(231,233,243,0.55)");
        ctx.fillText(idText, infoX + ctx.measureText(gymText).width + 14, locY);
      }
    } else if (idText) {
      ctx.setFillStyle("rgba(231,233,243,0.55)");
      ctx.fillText(idText, infoX, locY);
    }

    const gridGap = 10;
    const gridRows = 2;
    const gridCols = 2;
    const gridH = 54;
    const rightAreaX = Math.round(W * 0.58);
    const rightAreaW = W - pad - rightAreaX;
    const gridCellW = Math.floor((rightAreaW - gridGap * (gridCols - 1)) / gridCols);
    const gridTotalW = gridCellW * gridCols + gridGap * (gridCols - 1);
    const gridX = W - pad - gridTotalW;
    const gridTopY = avatarY + Math.round(avatarR - gridH);

    const cellFontSize = 26;

    function drawCardCell(gx, gy, w, h, label, tone) {
      const cr = 16;
      const bg = tone === "gold" ? "rgba(242,193,78,0.12)" : "rgba(143,123,255,0.18)";
      const bd = tone === "gold" ? "rgba(242,193,78,0.55)" : "rgba(143,123,255,0.55)";
      ctx.setFillStyle(bg);
      ctx.setStrokeStyle(bd);
      ctx.setLineWidth(2);
      drawRoundedRectPath(gx, gy, w, h, cr);
      ctx.fill();
      ctx.stroke();

      ctx.setTextAlign("left");
      ctx.setTextBaseline("middle");
      ctx.setFillStyle("#E7E9F3");
      // issue #39: 标签超宽时自动缩字号，保证「身高 175cm」类内容完整可见
      let fs = cellFontSize;
      ctx.setFontSize(fs);
      while (fs > 18 && ctx.measureText(label).width > w - 28) {
        fs -= 2;
        ctx.setFontSize(fs);
      }
      ctx.fillText(label, gx + 16, gy + h / 2);
    }

    const gridData = [];
    if (climbSkills.boulder) gridData.push({ label: `抱石 ${climbSkills.boulder}`, tone: "purple" });
    if (climbSkills.toprope) gridData.push({ label: `顶绳 ${climbSkills.toprope}`, tone: "gold" });
    // issue #39: emoji（↕️/↔️）在部分机型 canvas 字体里缺字形不渲染，
    // 改用中文小标签「身高/臂展」，含义明确且任何设备都能画出
    if (heightCm) gridData.push({ label: `身高 ${heightCm}cm`, tone: "purple" });
    if (armspanCm) gridData.push({ label: `臂展 ${armspanCm}cm`, tone: "gold" });

    while (gridData.length < gridRows * gridCols) {
      gridData.push({ empty: true });
    }

    for (let i = 0; i < gridRows * gridCols; i++) {
      const item = gridData[i];
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const cx = gridX + col * (gridCellW + gridGap);
      const cy = gridTopY + row * (gridH + gridGap);
      if (item.empty) {
        ctx.setFillStyle("rgba(255,255,255,0.04)");
        ctx.setStrokeStyle("rgba(255,255,255,0.1)");
        ctx.setLineWidth(1);
        drawRoundedRectPath(cx, cy, gridCellW, gridH, 16);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      drawCardCell(cx, cy, gridCellW, gridH, item.label, item.tone);
    }

    const avatarBottomY = avatarY + avatarR * 2;
    const gridBottomY = gridTopY + gridRows * gridH + (gridRows - 1) * gridGap;
    const infoBottomY = gymsLabel ? locY + 12 : metaY + 30;
    const rowBottomY = Math.max(avatarBottomY, gridBottomY, infoBottomY);

    const dividerY = rowBottomY + 36;

    ctx.setStrokeStyle("rgba(242,193,78,0.4)");
    ctx.setLineWidth(1.5);
    ctx.beginPath();
    ctx.moveTo(pad, dividerY);
    ctx.lineTo(W - pad, dividerY);
    ctx.stroke();

    ctx.setTextBaseline("alphabetic");

    const socialFontSize = 26;
    const sloganFontSize = 44;

    const socialY = dividerY + socialFontSize + 18;

    const lowerBottomLimit = H - radius - 12;
    const sloganAreaTop = dividerY + 24;
    const sloganAreaBottom = lowerBottomLimit;
    const sloganAreaH = sloganAreaBottom - sloganAreaTop;
    const sloganTextH = sloganFontSize;
    const sloganY = sloganAreaTop + Math.round((sloganAreaH - sloganTextH) / 2) + sloganTextH;

    ctx.setTextAlign("left");
    ctx.setFillStyle("rgba(231,233,243,0.72)");
    ctx.setFontSize(socialFontSize);

    const socialParts = [];
    if (wechatId) socialParts.push(`微信 ${clampText(wechatId, 14)}`);
    if (xhsId) socialParts.push(`小红书 ${clampText(xhsId, 12)}`);
    const signature = front.signature || front.note || "";
    if (signature) socialParts.push(clampText(signature, 16));
    // issue #40: 微信/小红书/签名均为空时此处留空，不再兜底展示「风格：幽默/鼓励」

    let sx = pad;
    socialParts.forEach((text, idx) => {
      ctx.setFillStyle("rgba(231,233,243,0.72)");
      ctx.fillText(text, sx, socialY);
      sx += ctx.measureText(text).width;
      if (idx < socialParts.length - 1) {
        sx += 4;
        ctx.setFillStyle("rgba(242,193,78,0.55)");
        ctx.fillText("|", sx + 6, socialY);
        sx += 16;
      }
    });

    const oneLiner = clampText(front.oneLiner || "今天就爬开心点", 40);
    ctx.setTextAlign("center");
    ctx.setFillStyle("#FFFFFF");
    ctx.setFontSize(sloganFontSize);
    ctx.fillText(oneLiner, W / 2, sloganY);

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
  ctx.setTextAlign("left");
  ctx.setTextBaseline("alphabetic");
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
  // issue #40: 底部信息行展示签名，没有签名则留空，不再硬编码「风格：幽默/鼓励」
  const respSignature = front.signature || front.note || "";
  if (respSignature) {
    ctx.setFillStyle("rgba(255,255,255,0.45)");
    ctx.fillText(clampText(respSignature, 20), pad + Math.floor(W * 0.06), H - Math.floor(H * 0.06));
  }
}

function flushCanvas(ctx, reserve) {
  return new Promise((resolve) => ctx.draw(!!reserve, resolve));
}

module.exports = {
  drawFrontCard,
  flushCanvas,
  RENDER_VERSION
};
