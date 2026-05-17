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

    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail("CARD_MANAGE_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};

