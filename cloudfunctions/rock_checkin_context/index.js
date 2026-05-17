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

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
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
  function flattenGradeMap(m) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return {};
    const out = {};
    Object.keys(m).forEach((k) => {
      const v = m[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.keys(v).forEach((k2) => {
          const key = `${String(k)}.${String(k2)}`;
          out[key] = v[k2];
        });
      } else {
        out[k] = v;
      }
    });
    return out;
  }
  return {
    _id: doc._id,
    gymId: doc.gymId || doc.gym_id || "",
    cycleKey: doc.cycleKey || doc.cycle_key || doc.cycleId || doc.cycle_id || doc.cycleId || "",
    totals: {
      boulder: rawTotals.boulder || {},
      difficulty: flattenGradeMap(rawTotals.difficulty || rawTotals.rope || {})
    },
    limits: {
      boulder: rawTargets.boulder || {},
      difficulty: flattenGradeMap(rawTargets.difficulty || rawTargets.rope || {})
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

async function resolveCycleByDate(gymId, date, fallbackCycleId) {
  const ymd = isValidYMD(date) ? date : "";
  const gymWhere = _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]);
  if (!ymd) {
    if (fallbackCycleId) {
      try {
        const r = await db.collection("RockGymCycles").doc(fallbackCycleId).get();
        const c = normalizeCycle(r && r.data ? r.data : null);
        return { cycleId: fallbackCycleId, cycle: c };
      } catch (e) {}
    }
    try {
      const r = await db.collection("RockGymCycles").where(gymWhere).orderBy("start_date", "desc").limit(1).get();
      const doc = r && r.data && r.data[0] ? r.data[0] : null;
      const c = normalizeCycle(doc);
      return { cycleId: c && c._id ? String(c._id) : "", cycle: c };
    } catch (e) {
      return { cycleId: "", cycle: null };
    }
  }

  const whereSnake = _.and([
    { gym_id: gymId },
    { start_date: _.lte(ymd) },
    _.or([{ end_date: _.gte(ymd) }, { end_date: _.eq("") }, { end_date: _.exists(false) }])
  ]);
  const whereCamel = _.and([
    gymWhere,
    { startDate: _.lte(ymd) },
    _.or([{ endDate: _.gte(ymd) }, { endDate: _.eq("") }, { endDate: _.exists(false) }])
  ]);
  const tries = [
    { where: whereSnake, orderBy: "start_date" },
    { where: whereCamel, orderBy: "startDate" }
  ];
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    try {
      const res = await db.collection("RockGymCycles").where(t.where).orderBy(t.orderBy, "desc").limit(1).get();
      const doc = res && res.data && res.data[0] ? res.data[0] : null;
      const c = normalizeCycle(doc);
      if (c && c._id) return { cycleId: String(c._id), cycle: c };
    } catch (e) {}
  }
  try {
    const res = await db.collection("RockGymCycles").where(gymWhere).limit(200).get();
    const list = (res && res.data) || [];
    const hit = list
      .map((c) => ({
        _id: c._id,
        start: String(c.start_date || c.startDate || ""),
        end: String(c.end_date || c.endDate || "9999-12-31"),
        raw: c
      }))
      .filter((c) => c._id && isValidYMD(c.start) && isValidYMD(c.end))
      .filter((c) => c.start <= ymd && ymd <= c.end)
      .sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
    const c = hit ? normalizeCycle(hit.raw) : null;
    return { cycleId: c && c._id ? String(c._id) : "", cycle: c };
  } catch (e) {
    return { cycleId: "", cycle: null };
  }
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
  function flattenGradeMap(m) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return {};
    const out = {};
    Object.keys(m).forEach((k) => {
      const v = m[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.keys(v).forEach((k2) => {
          const key = `${String(k)}.${String(k2)}`;
          out[key] = v[k2];
        });
      } else {
        out[k] = v;
      }
    });
    return out;
  }
  const boulder = raw.boulder || raw.boulders || null;
  const rope = raw.rope || raw.ropes || null;
  const difficulty = raw.difficulty || null;
  if (boulder || rope || difficulty) {
    return {
      boulder: (boulder && typeof boulder === "object" ? boulder : {}) || {},
      difficulty: flattenGradeMap(
        ((difficulty && typeof difficulty === "object" ? difficulty : null) || (rope && typeof rope === "object" ? rope : {})) || {}
      )
    };
  }
  return { flat: raw };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const gymId = safeText(event && event.gymId);
    const date = safeText(event && event.date);
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

    const fallbackCycleId = gym.currentCycleId || "";
    const cyclePicked = await resolveCycleByDate(gymId, date, fallbackCycleId);
    const cycleId = cyclePicked && cyclePicked.cycleId ? cyclePicked.cycleId : "";
    const cycle = cyclePicked ? cyclePicked.cycle : null;
    if (cycle) {
      gym.currentCycle = cycle;
      gym.currentCycleId = cycleId;
    }

    let routeCounts = null;
    try {
      const bbGymWhere = _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]);
      const cycleIdForBB = cycleId || (cycle && cycle._id ? String(cycle._id) : "");
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
      let bbDoc = bbRes && bbRes.data && bbRes.data[0] ? bbRes.data[0] : null;
      if (!bbDoc && cycleIdForBB) {
        try {
          let bbRes2;
          try {
            bbRes2 = await db.collection("RockGymBlackboards").where(bbGymWhere).orderBy("updated_at", "desc").limit(1).get();
          } catch (e) {
            try {
              bbRes2 = await db.collection("RockGymBlackboards").where(bbGymWhere).orderBy("updatedAt", "desc").limit(1).get();
            } catch (e2) {
              bbRes2 = await db.collection("RockGymBlackboards").where(bbGymWhere).limit(1).get();
            }
          }
          bbDoc = bbRes2 && bbRes2.data && bbRes2.data[0] ? bbRes2.data[0] : null;
        } catch (e) {}
      }
      const rc = normalizeRouteCountsFromBlackboard(bbDoc);
      if (rc && rc.flat && typeof rc.flat === "object") {
        const flat = rc.flat;
        const boulderOut = {};
        const diffOut = {};
        const bGrades = (cycle && cycle.boulderGrades) || [];
        const dGrades = (cycle && cycle.difficultyGrades) || [];
        if (Array.isArray(bGrades) && bGrades.length) {
          bGrades.forEach((g) => {
            if (Object.prototype.hasOwnProperty.call(flat, g)) boulderOut[g] = flat[g];
          });
        }
        if (Array.isArray(dGrades) && dGrades.length) {
          dGrades.forEach((g) => {
            if (Object.prototype.hasOwnProperty.call(flat, g)) diffOut[g] = flat[g];
          });
        }
        if (!Object.keys(boulderOut).length && !Object.keys(diffOut).length) {
          Object.keys(flat).forEach((k) => {
            const key = String(k || "").trim();
            if (!key) return;
            if (/^v/i.test(key) || key.includes("VB")) boulderOut[key] = flat[k];
            else diffOut[key] = flat[k];
          });
        }
        routeCounts = { boulder: boulderOut, difficulty: diffOut };
      } else {
        routeCounts = rc;
      }
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

