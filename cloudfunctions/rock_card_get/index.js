const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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

function canRead(openid, card) {
  if (!openid || !card) return false;
  const owner = safeText(card.ownerOpenid);
  const createdBy = safeText(card.createdByOpenid);
  if (owner && owner === openid) return true;
  if (createdBy && createdBy === openid) return true;
  return false;
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const cardId = safeText(event && event.cardId);
    if (!cardId) return fail("BAD_REQUEST", "缺少 cardId", tid);

    const res = await db.collection("RockCards").doc(cardId).get();
    const card = res && res.data ? res.data : null;
    if (!card) return fail("NOT_FOUND", "名片不存在", tid);

    if (!canRead(openid, card)) return fail("FORBIDDEN", "无权限", tid);

    return ok({ card }, tid);
  } catch (e) {
    return fail("CARD_GET_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

