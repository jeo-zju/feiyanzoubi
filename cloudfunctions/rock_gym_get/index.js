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
    supportedModes: Array.isArray(g.supportedModes) ? g.supportedModes : [],
    lastCheckinAt: g.lastCheckinAt || g.lastVisitAt || g.last_checkin_at || "",
    visitCount: typeof g.visitCount === "number" ? g.visitCount : typeof g.visit_count === "number" ? g.visit_count : 0,
    updatedAt: g.updatedAt || g.updateTime || g.updated_at || g.createdAt || 0
  };
}

function normalizeCycle(c) {
  if (!c) return null;
  return {
    _id: c._id,
    name: c.cycle_name || c.name || "",
    status: c.status || "",
    startDate: c.start_date || c.startDate || "",
    endDate: c.end_date || c.endDate || "",
    boulderGrades: c.boulder_grades || c.boulderGrades || [],
    difficultyGrades: c.rope_grades || c.difficultyGrades || c.ropes || [],
    leadGrades: c.lead_grades || c.leadGrades || []
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
    const outGym = normalizeGym(gym);

    const gymWhere = _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]);
    let cycles = [];
    try {
      const cRes = await db.collection("RockGymCycles").where({ gym_id: gymId }).orderBy("start_date", "desc").limit(20).get();
      cycles = ((cRes && cRes.data) || []).map(normalizeCycle).filter(Boolean);
    } catch (e) {
      try {
        const cRes = await db.collection("RockGymCycles").where(gymWhere).orderBy("startDate", "desc").limit(20).get();
        cycles = ((cRes && cRes.data) || []).map(normalizeCycle).filter(Boolean);
      } catch (e2) {
        const cRes = await db.collection("RockGymCycles").where(gymWhere).limit(20).get();
        cycles = ((cRes && cRes.data) || []).map(normalizeCycle).filter(Boolean);
      }
    }

    let currentCycle = null;
    if (outGym.currentCycleId) {
      currentCycle = cycles.find((c) => c && String(c._id) === String(outGym.currentCycleId)) || null;
      if (!currentCycle) {
        try {
          const r = await db.collection("RockGymCycles").doc(outGym.currentCycleId).get();
          currentCycle = normalizeCycle(r && r.data ? r.data : null);
        } catch (e) {}
      }
    }
    if (!currentCycle && cycles.length) currentCycle = cycles[0];
    outGym.currentCycle = currentCycle;

    return ok({ gym: outGym, cycles }, tid);
  } catch (e) {
    return fail("GYM_GET_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

