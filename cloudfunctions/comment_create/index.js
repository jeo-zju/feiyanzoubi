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

    const gymId = safeText(event && event.gymId);
    const recordId = safeText(event && event.recordId);
    const content = safeText(event && event.content);
    if (!content) return fail("BAD_REQUEST", "内容为空", tid);

    const userRes = await db.collection("RockUsers").where(_.or([{ openid }, { _openid: openid }])).limit(1).get();
    const user = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : {};

    const now = Date.now();
    const doc = {
      openid,
      gymId: gymId || null,
      recordId: recordId || null,
      content,
      nickName: user.nickName || "",
      avatarUrl: user.avatarUrl || "",
      createdAt: now,
      updatedAt: now
    };
    const res = await db.collection("RockComments").add({ data: doc });
    return ok({ commentId: res && res._id ? res._id : null }, tid);
  } catch (e) {
    return fail("COMMENT_CREATE_FAILED", e && e.message ? e.message : "发布失败", tid);
  }
};

