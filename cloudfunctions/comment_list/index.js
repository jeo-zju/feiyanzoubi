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
    const gymId = safeText(event && event.gymId);
    const recordId = safeText(event && event.recordId);
    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(50, Number(event && event.pageSize ? event.pageSize : 20)));
    const skip = (page - 1) * pageSize;

    const whereParts = [];
    if (gymId) {
      whereParts.push({ gymId });
      whereParts.push({ gym_id: gymId });
      whereParts.push({ gymID: gymId });
    }
    if (recordId) {
      whereParts.push({ recordId });
      whereParts.push({ record_id: recordId });
      whereParts.push({ recordID: recordId });
    }

    let where = {};
    if (!gymId && !recordId) where = { _id: _.exists(false) };
    else if (whereParts.length === 1) where = whereParts[0];
    else where = _.or(whereParts);

    const res = await db
      .collection("RockComments")
      .where(where)
      .orderBy("createdAt", "desc")
      .skip(skip)
      .limit(pageSize + 1)
      .get();
    const list = (res && res.data) || [];
    const hasNext = list.length > pageSize;
    return ok({ list: list.slice(0, pageSize), hasNext }, tid);
  } catch (e) {
    return fail("COMMENT_LIST_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

