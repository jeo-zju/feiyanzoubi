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

function keysOf(doc) {
  if (!doc || typeof doc !== "object") return [];
  return Object.keys(doc).sort();
}

function pickExample(doc) {
  if (!doc || typeof doc !== "object") return null;
  const out = {};
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === "deltas" || k === "totals" || k === "limits" || k === "routes" || k === "currentCycle") continue;
    const v = doc[k];
    if (v == null) continue;
    const t = typeof v;
    if (t === "string") out[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v;
    else if (t === "number" || t === "boolean") out[k] = v;
    else if (t === "object") {
      if (Array.isArray(v)) out[k] = `[array:${v.length}]`;
      else out[k] = `[object:${Object.keys(v).length}]`;
    }
  }
  return out;
}

async function sample(collectionName, where, limit) {
  try {
    const res = await db.collection(collectionName).where(where || {}).limit(limit || 3).get();
    const list = (res && res.data) || [];
    const first = list[0] || null;
    return {
      collection: collectionName,
      ok: true,
      count: list.length,
      keys: first ? keysOf(first) : [],
      example: first ? pickExample(first) : null
    };
  } catch (e) {
    return {
      collection: collectionName,
      ok: false,
      error: e && e.message ? e.message : String(e)
    };
  }
}

function buildUserWhere(openid, userId) {
  const parts = [];
  if (openid) {
    parts.push({ openid });
    parts.push({ _openid: openid });
    parts.push({ uid: openid });
    parts.push({ user_uid: openid });
    parts.push({ user_id: openid });
    parts.push({ owner_uid: openid });
  }
  if (userId) {
    parts.push({ user_uid: userId });
    parts.push({ user_id: userId });
    parts.push({ uid: userId });
  }
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return _.or(parts);
}

function buildGymWhere(gymId) {
  const parts = [];
  if (gymId) {
    parts.push({ gymId });
    parts.push({ gym_id: gymId });
    parts.push({ gymID: gymId });
  }
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return _.or(parts);
}

async function sampleWithFallback(collectionName, wheres, limit) {
  const whereList = Array.isArray(wheres) ? wheres.filter(Boolean) : [];
  for (let i = 0; i < whereList.length; i++) {
    const r = await sample(collectionName, whereList[i], limit);
    if (r.ok && r.count > 0) return r;
  }
  return sample(collectionName, {}, limit);
}

exports.main = async () => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const userRes = await db.collection("RockUsers").where(_.or([{ openid }, { _openid: openid }, { uid: openid }])).limit(1).get();
    const userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const userId = userDoc && userDoc._id ? String(userDoc._id) : "";

    const gymsRes = await db.collection("RockGyms").limit(1).get();
    const gymDoc = gymsRes && gymsRes.data && gymsRes.data[0] ? gymsRes.data[0] : null;
    const gymId = gymDoc && gymDoc._id ? String(gymDoc._id) : "";

    const results = [];
    results.push(await sample("RockUsers", buildUserWhere(openid, userId), 1));
    results.push(await sample("RockGyms", {}, 1));
    results.push(await sample("RockGymCycles", buildGymWhere(gymId), 1));
    results.push(await sample("RockGymBlackboards", buildGymWhere(gymId), 1));

    const userWhere = buildUserWhere(openid, userId);
    const gymWhere = buildGymWhere(gymId);
    const andWhere = gymId ? _.and([userWhere, gymWhere]) : userWhere;

    results.push(await sampleWithFallback("RockCheckinRecords", [andWhere, userWhere, gymWhere], 1));
    results.push(await sampleWithFallback("RockUserDailyProgress", [userWhere], 1));
    results.push(await sampleWithFallback("RockUserCycleProgress", [andWhere, userWhere, gymWhere], 1));

    return ok({ openid, userId, gymId, results }, tid);
  } catch (e) {
    return fail("DEBUG_PROBE_FAILED", e && e.message ? e.message : "探测失败", tid);
  }
};

