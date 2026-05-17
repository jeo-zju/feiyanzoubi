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
    lastCheckinAt: g.lastCheckinAt || g.lastVisitAt || g.last_checkin_at || "",
    visitCount: typeof g.visitCount === "number" ? g.visitCount : typeof g.visit_count === "number" ? g.visit_count : 0,
    updatedAt: g.updatedAt || g.updateTime || g.updated_at || g.createdAt || 0
  };
}

function normalizeProgress(doc) {
  if (!doc) return null;
  const rawTotals = doc.totals || doc.total || {};
  const rawTargets = doc.targets || doc.limits || doc.limit || {};
  return {
    _id: doc._id,
    gymId: doc.gymId || doc.gym_id || "",
    cycleKey: doc.cycleKey || doc.cycle_key || doc.cycleId || doc.cycle_id || doc.cycleId || "",
    totals: {
      boulder: rawTotals.boulder || {},
      difficulty: rawTotals.difficulty || rawTotals.rope || {}
    },
    limits: {
      boulder: rawTargets.boulder || {},
      difficulty: rawTargets.difficulty || rawTargets.rope || {}
    },
    visitCount: doc.visitCount || doc.visit_count || 0,
    updatedAt: doc.updatedAt || doc.updated_at || doc.createdAt || 0
  };
}

function normalizeCycle(c) {
  if (!c) return null;
  return {
    _id: c._id,
    name: c.cycle_name || c.name || "",
    startDate: c.start_date || c.startDate || "",
    endDate: c.end_date || c.endDate || "",
    boulderGrades: c.boulder_grades || c.boulderGrades || [],
    difficultyGrades: c.rope_grades || c.difficultyGrades || c.ropes || []
  };
}

function normalizeMode(category, mode) {
  const c = String(category || mode || "").toLowerCase();
  if (c === "boulder") return "boulder";
  if (c === "rope") return "difficulty";
  if (c === "difficulty") return "difficulty";
  return "boulder";
}

function addCounts(target, src) {
  if (!target || !src || typeof src !== "object") return;
  Object.keys(src).forEach((k) => {
    const n = Number(src[k] || 0);
    if (!Number.isFinite(n) || n <= 0) return;
    target[k] = Number(target[k] || 0) + n;
  });
}

function normalizeTotalsFromRecords(records) {
  const totals = { boulder: {}, difficulty: {} };
  (records || []).forEach((r) => {
    if (!r) return;
    if (r.grade != null && r.count != null) {
      const mode = normalizeMode(r.category, r.mode);
      const grade = String(r.grade || "").trim();
      const n = Number(r.count || 0);
      if (grade && Number.isFinite(n) && n > 0) {
        totals[mode][grade] = Number(totals[mode][grade] || 0) + n;
      }
      return;
    }
    const deltas = r.deltas || r.delta || null;
    if (deltas && typeof deltas === "object" && !Array.isArray(deltas)) {
      if (deltas.boulder || deltas.difficulty) {
        addCounts(totals.boulder, deltas.boulder);
        addCounts(totals.difficulty, deltas.difficulty);
        return;
      }
      const mode = r.mode === "rope" ? "difficulty" : r.mode;
      if (mode === "boulder" || mode === "difficulty") {
        addCounts(totals[mode], deltas);
        return;
      }
    }

    addCounts(totals.boulder, r.boulder_deltas || r.boulder_delta);
    addCounts(totals.difficulty, r.rope_deltas || r.rope_delta || r.difficulty_deltas || r.difficulty_delta);
  });
  return totals;
}

function normalizeRouteCountsFromBlackboard(doc) {
  if (!doc) return null;
  const raw = doc.per_grade_counts || doc.perGradeCounts || doc.per_grade_count || doc.perGradeCount || null;
  if (!raw || typeof raw !== "object") return null;
  const boulder = raw.boulder || raw.boulders || null;
  const rope = raw.rope || raw.ropes || null;
  const difficulty = raw.difficulty || null;
  if (boulder || rope || difficulty) {
    return {
      boulder: (boulder && typeof boulder === "object" ? boulder : {}) || {},
      difficulty: ((difficulty && typeof difficulty === "object" ? difficulty : null) || (rope && typeof rope === "object" ? rope : {})) || {}
    };
  }
  return null;
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const gymId = safeText(event && event.gymId);
    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);

    const gymRes = await db.collection("RockGyms").doc(gymId).get();
    const gymRaw = gymRes && gymRes.data ? gymRes.data : null;
    if (!gymRaw) return fail("NOT_FOUND", "岩馆不存在", tid);
    const gym = normalizeGym(gymRaw);

    const userRes = await db
      .collection("RockUsers")
      .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
      .limit(1)
      .get();
    const userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const userId = userDoc && userDoc._id ? String(userDoc._id) : "";

    const userWhereParts = [{ openid }, { _openid: openid }, { uid: openid }, { user_uid: openid }, { user_id: openid }];
    if (userId) {
      userWhereParts.push({ user_uid: userId });
      userWhereParts.push({ user_id: userId });
      userWhereParts.push({ uid: userId });
    }
    const userWhere = _.or(userWhereParts);
    const gymWhere = _.or([{ gymId }, { gym_id: gymId }, { gymID: gymId }]);
    const where = _.and([userWhere, gymWhere]);

    let cycle = null;
    const cycleId = gym.currentCycleId || "";
    if (cycleId) {
      try {
        const cycleRes = await db.collection("RockGymCycles").doc(cycleId).get();
        cycle = normalizeCycle(cycleRes && cycleRes.data ? cycleRes.data : null);
      } catch (e) {}
    }
    if (!cycle) {
      try {
        const cycleRes = await db.collection("RockGymCycles").where(gymWhere).limit(1).get();
        const c = cycleRes && cycleRes.data && cycleRes.data[0] ? cycleRes.data[0] : null;
        cycle = normalizeCycle(c);
      } catch (e) {}
    }
    if (cycle) gym.currentCycle = cycle;

    let routeCounts = null;
    try {
      const bbGymWhere = _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]);
      const cycleIdForBB = cycle && cycle._id ? String(cycle._id) : "";
      const bbWhere = cycleIdForBB
        ? _.and([bbGymWhere, _.or([{ cycle_id: cycleIdForBB }, { cycleId: cycleIdForBB }, { cycleID: cycleIdForBB }])])
        : bbGymWhere;
      let bbRes;
      try {
        bbRes = await db.collection("RockGymBlackboards").where(bbWhere).orderBy("updated_at", "desc").limit(1).get();
      } catch (e) {
        try {
          bbRes = await db.collection("RockGymBlackboards").where(bbWhere).orderBy("updatedAt", "desc").limit(1).get();
        } catch (e2) {
          bbRes = await db.collection("RockGymBlackboards").where(bbWhere).limit(1).get();
        }
      }
      const bbDoc = bbRes && bbRes.data && bbRes.data[0] ? bbRes.data[0] : null;
      routeCounts = normalizeRouteCountsFromBlackboard(bbDoc);
    } catch (e) {}

    let progressRes;
    try {
      progressRes = await db.collection("RockUserCycleProgress").where(where).orderBy("updated_at", "desc").limit(1).get();
    } catch (e) {
      try {
        progressRes = await db.collection("RockUserCycleProgress").where(where).orderBy("updatedAt", "desc").limit(1).get();
      } catch (e2) {
        progressRes = await db.collection("RockUserCycleProgress").where(where).limit(1).get();
      }
    }
    const doc = progressRes && progressRes.data && progressRes.data[0] ? progressRes.data[0] : null;

    let progress = normalizeProgress(doc);
    if (progress && progress.totals && !progress.totals.boulder && !progress.totals.difficulty) {
      progress.totals = { boulder: progress.totals.boulder || {}, difficulty: progress.totals.difficulty || {} };
    }

    if (!progress || !progress.totals || (!Object.keys(progress.totals.boulder || {}).length && !Object.keys(progress.totals.difficulty || {}).length)) {
      try {
        const recRes = await db.collection("RockCheckinRecords").where(where).limit(200).get();
        const records = (recRes && recRes.data) || [];
        const totals = normalizeTotalsFromRecords(records);
        progress = progress || { _id: "", gymId, cycleKey: cycleId || "", totals: {}, limits: {}, visitCount: 0, updatedAt: 0 };
        progress.totals = totals;
      } catch (e) {}
    }
    return ok({ gym, progress, routeCounts }, tid);
  } catch (e) {
    return fail("CHECKIN_CONTEXT_FAILED", e && e.message ? e.message : "加载失败", tid);
  }
};

