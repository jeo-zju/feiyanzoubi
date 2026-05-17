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

function normalizeLimits(limits) {
  const out = {};
  if (!limits || typeof limits !== "object") return out;
  Object.keys(limits).forEach((k) => {
    const key = safeText(k);
    const n = Number(limits[k] || 0);
    if (!key) return;
    out[key] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  });
  return out;
}

async function canManageGym(openid, gymId) {
  const res = await db.collection("RockGyms").doc(gymId).get();
  const gym = res && res.data ? res.data : null;
  if (!gym) return { ok: false, gym: null };
  if (gym.ownerOpenid && gym.ownerOpenid === openid) return { ok: true, gym };
  if (gym.owner_uid && gym.owner_uid === openid) return { ok: true, gym };
  const managers = Array.isArray(gym.managers) ? gym.managers : [];
  const managerOpenids = Array.isArray(gym.managerOpenids) ? gym.managerOpenids : [];
  const managerUids = Array.isArray(gym.manager_uids) ? gym.manager_uids : [];
  if (managers.includes(openid) || managerOpenids.includes(openid)) return { ok: true, gym };
  if (managerUids.includes(openid)) return { ok: true, gym };
  return { ok: false, gym };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const now = Date.now();

    const gymId = event && event.gymId ? String(event.gymId) : "";
    const gymPatch = event && event.gym ? event.gym : null;
    const cyclePatch = event && event.cycle ? event.cycle : null;
    const routesPatch = event && event.routes ? event.routes : null;

    const gymsCol = db.collection("RockGyms");

    if (!gymId) {
      const name = safeText(gymPatch && gymPatch.name);
      if (!name) return fail("BAD_REQUEST", "缺少岩馆名", tid);
      const city = safeText(gymPatch && gymPatch.city);
      const address = safeText(gymPatch && gymPatch.address);
      const cycle = cyclePatch
        ? {
            name: safeText(cyclePatch.name),
            startDate: safeText(cyclePatch.startDate),
            boulderGrades: Array.isArray(cyclePatch.boulderGrades) ? cyclePatch.boulderGrades : [],
            difficultyGrades: Array.isArray(cyclePatch.difficultyGrades) ? cyclePatch.difficultyGrades : []
          }
        : null;

      const doc = {
        name,
        city,
        address,
        ownerOpenid: openid,
        owner_uid: openid,
        managers: [openid],
        managerOpenids: [openid],
        manager_uids: [openid],
        currentCycle: cycle,
        routes: {},
        visitCount: 0,
        visit_count: 0,
        createdAt: now,
        updatedAt: now
      };
      doc.created_at = db.serverDate();
      doc.updated_at = db.serverDate();

      if (routesPatch && routesPatch.mode && routesPatch.limits) {
        const mode = routesPatch.mode === "boulder" ? "boulder" : "difficulty";
        doc.routes[mode] = { limits: normalizeLimits(routesPatch.limits) };
      }

      const addRes = await gymsCol.add({ data: doc });
      return ok({ gymId: addRes && addRes._id ? addRes._id : null }, tid);
    }

    const perm = await canManageGym(openid, gymId);
    if (!perm.ok) return fail("FORBIDDEN", "无权限", tid);
    const patch = { updatedAt: now, updated_at: db.serverDate() };

    if (gymPatch) {
      const name = safeText(gymPatch.name);
      if (name) patch.name = name;
      if (gymPatch.city != null) patch.city = safeText(gymPatch.city);
      if (gymPatch.address != null) patch.address = safeText(gymPatch.address);
    }

    if (cyclePatch) {
      const name = safeText(cyclePatch.name);
      const startDate = safeText(cyclePatch.startDate);
      const boulderGrades = Array.isArray(cyclePatch.boulderGrades) ? cyclePatch.boulderGrades : [];
      const difficultyGrades = Array.isArray(cyclePatch.difficultyGrades) ? cyclePatch.difficultyGrades : [];
      if (!startDate) return fail("BAD_REQUEST", "缺少开始日期", tid);
      patch.currentCycle = { name, startDate, boulderGrades, difficultyGrades };

      const cycleDoc = {
        gym_id: gymId,
        cycle_name: name || "默认周期",
        start_date: startDate,
        boulder_grades: boulderGrades,
        rope_grades: difficultyGrades,
        status: "active",
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
        gymId,
        name: name || "默认周期",
        startDate,
        boulderGrades,
        difficultyGrades,
        createdAt: now,
        updatedAt: now
      };
      const cycleAddRes = await db.collection("RockGymCycles").add({ data: cycleDoc });
      const cycleId = cycleAddRes && cycleAddRes._id ? String(cycleAddRes._id) : "";
      if (cycleId) {
        patch.current_cycle_id = cycleId;
        patch.currentCycleId = cycleId;
      }
    }

    if (routesPatch && routesPatch.limits) {
      const mode = routesPatch.mode === "boulder" ? "boulder" : "difficulty";
      patch.routes = perm.gym.routes || {};
      patch.routes[mode] = { ...(patch.routes[mode] || {}), limits: normalizeLimits(routesPatch.limits) };
      patch.lines = patch.lines || perm.gym.lines || { boulder: 0, difficulty: 0 };
      const sum = Object.keys(patch.routes[mode].limits).reduce((s, k) => s + Number(patch.routes[mode].limits[k] || 0), 0);
      patch.lines[mode] = sum;
    }

    await gymsCol.doc(gymId).update({ data: patch });
    return ok({ gymId }, tid);
  } catch (e) {
    return fail("GYM_UPSERT_FAILED", e && e.message ? e.message : "保存失败", tid);
  }
};

