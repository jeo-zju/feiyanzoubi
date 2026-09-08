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

// issue #35: 云函数端用管理端权限把 cloud:// fileID 换成临时 https URL，
// 避免客户端 getTempFileURL 受云存储安全规则限制导致名片头像空白/500
async function cloudIdsToTempUrl(ids) {
  const list = Array.from(new Set((ids || []).filter((v) => v && String(v).indexOf("cloud://") === 0)));
  const map = {};
  if (!list.length) return map;
  try {
    const r = await cloud.getTempFileURL({ fileList: list.slice(0, 50) });
    ((r && r.fileList) || []).forEach((fi) => {
      if (fi && fi.fileID && fi.tempFileURL) map[fi.fileID] = fi.tempFileURL;
    });
  } catch (e) {}
  return map;
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

    // issue #35: 名片头像 cloud:// 在云函数端换成临时 https URL
    // （custom 模式取 front.avatarFileId，wechat 模式取 front.avatarUrl）
    const front = card && card.front && typeof card.front === "object" ? card.front : null;
    if (front) {
      const urlMap = await cloudIdsToTempUrl([front.avatarFileId, front.avatarUrl]);
      const fix = (v) => (v && urlMap[v] ? urlMap[v] : v);
      card.front = Object.assign({}, front, {
        avatarFileId: fix(front.avatarFileId),
        avatarUrl: fix(front.avatarUrl)
      });
    }

    return ok({ card }, tid);
  } catch (e) {
    return fail("CARD_GET_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

