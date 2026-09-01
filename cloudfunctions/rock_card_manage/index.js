const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid) {
  return { ok: false, error: { code, message }, traceId: tid };
}

function safeText(v) {
  return v == null ? "" : String(v).trim();
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const action = safeText(event && event.action);
    const cardId = safeText(event && event.cardId);
    if (!action) return fail("BAD_REQUEST", "缺少 action", tid);
    if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);

    const cardsCol = db.collection("RockCards");
    const res = await cardsCol.doc(cardId).get();
    const card = res && res.data ? res.data : null;
    if (!card) return fail("NOT_FOUND", "名片不存在", tid);

    if (safeText(card.ownerOpenid) !== openid) return fail("FORBIDDEN", "无权限", tid);
    if (safeText(card.status) !== "active") return fail("FORBIDDEN", "名片不可操作", tid);

    if (action === "update_one_liner") {
      const oneLiner = safeText(event && event.oneLiner).slice(0, 60);
      await cardsCol.doc(cardId).update({
        data: {
          "front.oneLiner": oneLiner,
          "front.oneLinerStyle": safeText(event && event.oneLinerStyle) === "encourage" ? "encourage" : "humor",
          updatedAt: Date.now(),
          updated_at: db.serverDate()
        }
      });
      return ok({ cardId, oneLiner }, tid);
    }

    if (action === "sync_profile") {
      // #13: 编辑资料保存时，将资料字段完整同步到主名片（不耗额度、不需要背面故事）
      const front = (event && event.front) && typeof event.front === "object" ? event.front : {};
      const patch = {};
      ["displayName", "title", "mbti", "oneLiner"].forEach((k) => {
        if (front[k] !== undefined) patch["front." + k] = safeText(front[k]);
      });
      if (front.oneLinerStyle !== undefined) {
        patch["front.oneLinerStyle"] = safeText(front.oneLinerStyle) === "encourage" ? "encourage" : "humor";
      }
      if (front.avatarMode !== undefined) {
        patch["front.avatarMode"] = safeText(front.avatarMode) === "custom" ? "custom" : "wechat";
      }
      if (front.avatarFileId !== undefined) patch["front.avatarFileId"] = safeText(front.avatarFileId);
      if (front.avatarUrl !== undefined) patch["front.avatarUrl"] = safeText(front.avatarUrl);
      if (front.wanderer !== undefined) patch["front.wanderer"] = !!front.wanderer;
      if (Array.isArray(front.gyms)) {
        patch["front.gyms"] = front.gyms.slice(0, 3).map((g) => {
          if (typeof g === "string") return { gymId: "", name: safeText(g), city: "" };
          return { gymId: safeText(g && g.gymId), name: safeText(g && g.name), city: safeText(g && g.city) };
        });
      }
      patch.updatedAt = Date.now();
      patch.updated_at = db.serverDate();
      await cardsCol.doc(cardId).update({ data: patch });
      return ok({ cardId }, tid);
    }

    if (action === "set_primary") {
      await cardsCol.where({ ownerOpenid: openid, isPrimary: true }).update({ data: { isPrimary: false, updated_at: db.serverDate() } });
      await cardsCol.doc(cardId).update({ data: { isPrimary: true, updated_at: db.serverDate() } });
      return ok({ cardId }, tid);
    }

    if (action === "remove_received") {
      if (card.isPrimary) return fail("BAD_REQUEST", "不能删除主名片", tid);
      if (safeText(card.createdByOpenid) === openid) return fail("BAD_REQUEST", "不能删除自己制作的名片", tid);
      await cardsCol.doc(cardId).remove();
      return ok({ removed: true }, tid);
    }

    if (action === "remove_created") {
      if (safeText(card.createdByOpenid || card.ownerOpenid) !== openid) return fail("FORBIDDEN", "只能删除自己创建的名片", tid);
      let hasActiveGift = false;
      let hasWallPlacements = false;
      try {
        const giftRaw = await db.collection("RockCardGifts").where({ cardId, status: _.in(["pending", "sent", "gifting"]) }).limit(1).get();
        hasActiveGift = !!(giftRaw && giftRaw.data && giftRaw.data.length);
      } catch (e) {}
      try {
        const wallRaw = await db.collection("RockGymWallCards").where({ cardId, status: _.in(["active", "pinned", ""]) }).limit(1).get();
        hasWallPlacements = !!(wallRaw && wallRaw.data && wallRaw.data.length);
      } catch (e) {}
      const dryRun = !!(event && event.dryRun);
      if (dryRun) return ok({ hasActiveGift, hasWallPlacements, canRemove: true }, tid);
      try {
        const wallBatch = await db.collection("RockGymWallCards").where({ cardId }).limit(1000).get();
        const wallList = (wallBatch && wallBatch.data) || [];
        for (let i = 0; i < wallList.length; i++) { try { await db.collection("RockGymWallCards").doc(String(wallList[i]._id)).remove(); } catch (e) {} }
      } catch (e) {}
      try {
        await db.collection("RockCardGifts").where({ cardId, status: _.in(["pending", "gifting"]) }).update({ data: { status: "cancelled", cancelledBy: openid, cancelledAt: Date.now(), cancelled_at: db.serverDate() } });
      } catch (e) {}
      await cardsCol.doc(cardId).remove();
      return ok({ removed: true, hasActiveGift, hasWallPlacements }, tid);
    }

    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail("CARD_MANAGE_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};

