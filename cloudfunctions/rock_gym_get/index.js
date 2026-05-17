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

function normalizeGym(g) {
  const name = g.name || g.gymName || g.title || "";
  const city = g.city || g.cityName || g.locationCity || "";
  const address = g.address || g.addr || g.location || "";
  const currentCycleId = g.current_cycle_id || g.currentCycleId || g.cycle_id || "";
  const currentCycle = g.currentCycle || g.cycle || null;
  const routes = g.routes || g.routeConfig || null;
  const lines = g.lines || null;
  return {
    _id: g._id,
    name,
    city,
    address,
    currentCycleId,
    currentCycle,
    routes,
    lines,
    lastCheckinAt: g.lastCheckinAt || g.lastVisitAt || g.last_checkin_at || "",
    visitCount: typeof g.visitCount === "number" ? g.visitCount : typeof g.visit_count === "number" ? g.visit_count : 0,
    updatedAt: g.updatedAt || g.updateTime || g.updated_at || g.createdAt || 0
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const gymId = safeText(event && event.gymId);
    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);
    const res = await db.collection("RockGyms").doc(gymId).get();
    const gym = res && res.data ? res.data : null;
    if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
    return ok({ gym: normalizeGym(gym) }, tid);
  } catch (e) {
    return fail("GYM_GET_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

