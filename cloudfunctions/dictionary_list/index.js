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

exports.main = async () => {
  const tid = traceId();
  try {
    const res = await db.collection("RockBlackTalkDictionary").orderBy("updatedAt", "desc").limit(200).get();
    const list = (res && res.data) || [];
    return ok({ list }, tid);
  } catch (e) {
    return fail("DICTIONARY_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

