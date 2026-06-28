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

function parseYMD(ymd) {
  if (!isValidYMD(ymd)) return null;
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatYMD(d) {
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function prevDay(ymd) {
  const d = parseYMD(ymd);
  if (!d) return "";
  d.setDate(d.getDate() - 1);
  return formatYMD(d);
}

function normEndDate(v) {
  const t = safeText(v);
  if (!t) return "";
  return isValidYMD(t) ? t : "";
}

async function listCyclesForGym(gymId, limit) {
  const lim = Math.max(1, Math.min(200, Number(limit || 200)));
  try {
    const res = await db.collection("RockGymCycles").where({ gym_id: gymId }).orderBy("start_date", "desc").limit(lim).get();
    return (res && res.data) || [];
  } catch (e) {
    try {
      const res = await db.collection("RockGymCycles").where({ gymId }).orderBy("startDate", "desc").limit(lim).get();
      return (res && res.data) || [];
    } catch (e2) {
      return [];
    }
  }
}

function overlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return false;
  const ae = aEnd || "9999-12-31";
  const be = bEnd || "9999-12-31";
  return aStart <= be && bStart <= ae;
}

function normalizeCycleRange(c) {
  const start = safeText(c && (c.start_date || c.startDate));
  const end = normEndDate(c && (c.end_date || c.endDate));
  return {
    _id: c && c._id ? String(c._id) : "",
    start: isValidYMD(start) ? start : "",
    end,
    status: safeText(c && c.status)
  };
}

async function removeAllByWhere(collectionName, where, batchSize) {
  const col = db.collection(collectionName);
  const size = Math.max(1, Math.min(20, Number(batchSize || 20)));
  for (let round = 0; round < 2000; round++) {
    const res = await col.where(where).limit(size).get();
    const list = (res && res.data) || [];
    if (!list.length) break;
    for (let i = 0; i < list.length; i++) {
      await col.doc(list[i]._id).remove();
    }
    if (list.length < size) break;
  }
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

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = safeText(item).toLowerCase();
    if (!mode) return;
    if (!["boulder", "difficulty", "lead"].includes(mode)) return;
    if (seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
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
    const closeCycle = event && event.closeCycle ? event.closeCycle : null;
    const deleteCycle = event && event.deleteCycle ? event.deleteCycle : null;

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
            difficultyGrades: Array.isArray(cyclePatch.difficultyGrades) ? cyclePatch.difficultyGrades : [],
            leadGrades: Array.isArray(cyclePatch.leadGrades) ? cyclePatch.leadGrades : []
          }
        : null;
      const supportedModes = uniqueModes(gymPatch && gymPatch.supportedModes);

      const doc = {
        name,
        city,
        address,
        supportedModes,
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
        const mode = routesPatch.mode === "boulder" ? "boulder" : routesPatch.mode === "lead" ? "lead" : "difficulty";
        doc.routes[mode] = { limits: normalizeLimits(routesPatch.limits) };
      }

      const addRes = await gymsCol.add({ data: doc });
      return ok({ gymId: addRes && addRes._id ? addRes._id : null }, tid);
    }

    const perm = await canManageGym(openid, gymId);
    if (!perm.ok) return fail("FORBIDDEN", "无权限", tid);
    const patch = { updatedAt: now, updated_at: db.serverDate() };

    if (deleteCycle) {
      const cycleId = deleteCycle && deleteCycle.cycleId ? String(deleteCycle.cycleId) : "";
      if (!cycleId) return fail("BAD_REQUEST", "缺少 cycleId", tid);

      const cycleRes = await db.collection("RockGymCycles").doc(cycleId).get();
      const cycle = cycleRes && cycleRes.data ? cycleRes.data : null;
      if (!cycle) return fail("NOT_FOUND", "周期不存在", tid);
      const cycleGymId = String(cycle.gym_id || cycle.gymId || "");
      if (cycleGymId && cycleGymId !== gymId) return fail("BAD_REQUEST", "周期不属于该岩馆", tid);

      await db.collection("RockGymCycles").doc(cycleId).remove();

      const whereByCycle = _.and([
        _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]),
        _.or([{ cycle_id: cycleId }, { cycleId }, { cycleID: cycleId }])
      ]);
      await removeAllByWhere("RockCheckinRecords", whereByCycle, 20);
      await removeAllByWhere("RockUserDailyProgress", whereByCycle, 20);
      await removeAllByWhere("RockUserCycleProgress", whereByCycle, 20);
      await removeAllByWhere("RockGymBlackboards", whereByCycle, 20);

      const gymDoc = perm.gym || null;
      const currentId = gymDoc ? String(gymDoc.current_cycle_id || gymDoc.currentCycleId || "") : "";
      if (currentId && currentId === cycleId) {
        patch.current_cycle_id = "";
        patch.currentCycleId = "";
      }
      await gymsCol.doc(gymId).update({ data: patch });
      return ok({ gymId, deletedCycleId: cycleId }, tid);
    }

    if (closeCycle) {
      const cycleId = closeCycle && closeCycle.cycleId ? String(closeCycle.cycleId) : "";
      const endDate = safeText(closeCycle && closeCycle.endDate);
      if (!cycleId) return fail("BAD_REQUEST", "缺少 cycleId", tid);
      if (!endDate || !isValidYMD(endDate)) return fail("BAD_REQUEST", "缺少关闭日期（YYYY-MM-DD）", tid);

      const cycleRes = await db.collection("RockGymCycles").doc(cycleId).get();
      const cycle = cycleRes && cycleRes.data ? cycleRes.data : null;
      if (!cycle) return fail("NOT_FOUND", "周期不存在", tid);
      const cycleGymId = String(cycle.gym_id || cycle.gymId || "");
      if (cycleGymId && cycleGymId !== gymId) return fail("BAD_REQUEST", "周期不属于该岩馆", tid);
      const startDate = safeText(cycle.start_date || cycle.startDate);
      if (!startDate || !isValidYMD(startDate)) return fail("BAD_REQUEST", "周期开始日期异常", tid);
      if (endDate < startDate) return fail("BAD_REQUEST", "关闭日期不能早于开始日期", tid);

      const all = await listCyclesForGym(gymId, 200);
      const ranges = all.map(normalizeCycleRange).filter((c) => c._id && c.start);
      const cur = ranges.find((c) => c._id === cycleId) || { start: startDate, end: "" };
      const nextEnd = endDate;
      for (let i = 0; i < ranges.length; i++) {
        const other = ranges[i];
        if (other._id === cycleId) continue;
        if (overlap(cur.start, nextEnd, other.start, other.end)) {
          return fail("CYCLE_OVERLAP", "关闭后仍与其它周期重叠，请先处理重叠的历史周期", tid);
        }
      }

      try {
        const nextRes = await db
          .collection("RockGymCycles")
          .where(_.and([{ gym_id: gymId }, { start_date: _.gt(startDate) }]))
          .orderBy("start_date", "asc")
          .limit(1)
          .get();
        const next = nextRes && nextRes.data && nextRes.data[0] ? nextRes.data[0] : null;
        const nextStart = next ? safeText(next.start_date || next.startDate) : "";
        if (nextStart && isValidYMD(nextStart) && endDate >= nextStart) {
          return fail("BAD_REQUEST", "关闭日期与下一个周期重叠，请选择更早日期", tid);
        }
      } catch (e) {}

      await db
        .collection("RockGymCycles")
        .doc(cycleId)
        .update({
          data: {
            end_date: endDate,
            endDate,
            status: "archived",
            updated_at: db.serverDate(),
            updatedAt: now
          }
        });

      const today = formatYMD(new Date());
      let currentCycleId = "";
      try {
        const currentRes = await db
          .collection("RockGymCycles")
          .where(
            _.and([
              { gym_id: gymId },
              { start_date: _.lte(today) },
              _.or([{ end_date: _.gte(today) }, { end_date: _.eq("") }, { end_date: _.exists(false) }])
            ])
          )
          .orderBy("start_date", "desc")
          .limit(1)
          .get();
        const c = currentRes && currentRes.data && currentRes.data[0] ? currentRes.data[0] : null;
        if (c && c._id) currentCycleId = String(c._id);
      } catch (e) {}
      patch.current_cycle_id = currentCycleId;
      patch.currentCycleId = currentCycleId;

      await gymsCol.doc(gymId).update({ data: patch });
      return ok({ gymId, closedCycleId: cycleId }, tid);
    }

    if (gymPatch) {
      const name = safeText(gymPatch.name);
      if (name) patch.name = name;
      if (gymPatch.city != null) patch.city = safeText(gymPatch.city);
      if (gymPatch.address != null) patch.address = safeText(gymPatch.address);
      if (gymPatch.supportedModes != null) patch.supportedModes = uniqueModes(gymPatch.supportedModes);
    }

    if (cyclePatch) {
      const name = safeText(cyclePatch.name);
      const startDate = safeText(cyclePatch.startDate);
      const boulderGrades = Array.isArray(cyclePatch.boulderGrades) ? cyclePatch.boulderGrades : [];
      const difficultyGrades = Array.isArray(cyclePatch.difficultyGrades) ? cyclePatch.difficultyGrades : [];
      const leadGrades = Array.isArray(cyclePatch.leadGrades) ? cyclePatch.leadGrades : [];
      if (!startDate) return fail("BAD_REQUEST", "缺少开始日期", tid);
      if (!isValidYMD(startDate)) return fail("BAD_REQUEST", "开始日期格式应为 YYYY-MM-DD", tid);

      const editingCycleId = safeText(cyclePatch.cycleId);
      if (editingCycleId) {
        const cycleRes = await db.collection("RockGymCycles").doc(editingCycleId).get();
        const existed = cycleRes && cycleRes.data ? cycleRes.data : null;
        if (!existed) return fail("NOT_FOUND", "周期不存在", tid);
        const existedGymId = String(existed.gym_id || existed.gymId || "");
        if (existedGymId && existedGymId !== gymId) return fail("BAD_REQUEST", "周期不属于该岩馆", tid);
        const endDate = normEndDate(existed.end_date || existed.endDate);

        const all = await listCyclesForGym(gymId, 200);
        const ranges = all.map(normalizeCycleRange).filter((c) => c._id && c.start);
        for (let i = 0; i < ranges.length; i++) {
          const other = ranges[i];
          if (other._id === editingCycleId) continue;
          if (overlap(startDate, endDate, other.start, other.end)) {
            return fail("CYCLE_OVERLAP", "修改后与其它周期重叠，请调整开始/结束日期", tid);
          }
        }

        patch.currentCycle = _.set({ name, startDate, boulderGrades, difficultyGrades, leadGrades });
        await db.collection("RockGymCycles").doc(editingCycleId).update({
          data: {
            gym_id: gymId,
            gymId,
            cycle_name: name || "默认周期",
            name: name || "默认周期",
            start_date: startDate,
            startDate,
            boulder_grades: boulderGrades,
            boulderGrades,
            rope_grades: difficultyGrades,
            difficultyGrades,
            lead_grades: leadGrades,
            leadGrades,
            updated_at: db.serverDate(),
            updatedAt: now
          }
        });
        patch.current_cycle_id = editingCycleId;
        patch.currentCycleId = editingCycleId;
      } else {
        const all = await listCyclesForGym(gymId, 200);
        const ranges = all.map(normalizeCycleRange).filter((c) => c._id && c.start);
        const openCycle = ranges.find((c) => !c.end);
        if (openCycle) {
          return fail("BAD_REQUEST", "请先关闭当前周期，再创建新周期", tid);
        }
        for (let i = 0; i < ranges.length; i++) {
          const other = ranges[i];
          if (overlap(startDate, "", other.start, other.end)) {
            return fail("CYCLE_OVERLAP", "开始日期与历史周期重叠，请调整日期或先关闭/删除重叠周期", tid);
          }
        }

        const cycleDoc = {
          gym_id: gymId,
          cycle_name: name || "默认周期",
          start_date: startDate,
          boulder_grades: boulderGrades,
          rope_grades: difficultyGrades,
          lead_grades: leadGrades,
          status: "active",
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
          gymId,
          name: name || "默认周期",
          startDate,
          boulderGrades,
          difficultyGrades,
          leadGrades,
          createdAt: now,
          updatedAt: now
        };
        const cycleAddRes = await db.collection("RockGymCycles").add({ data: cycleDoc });
        const cycleId = cycleAddRes && cycleAddRes._id ? String(cycleAddRes._id) : "";
        if (!cycleId) return fail("DATABASE_REQUEST_FAILED", "创建周期失败", tid);

        patch.current_cycle_id = cycleId;
        patch.currentCycleId = cycleId;
        patch.currentCycle = _.set({ name, startDate, boulderGrades, difficultyGrades, leadGrades });
      }
    }

    if (routesPatch && routesPatch.limits) {
      const mode = routesPatch.mode === "boulder" ? "boulder" : routesPatch.mode === "lead" ? "lead" : "difficulty";
      patch.routes = perm.gym.routes && typeof perm.gym.routes === "object" ? perm.gym.routes : {};
      patch.routes[mode] = { ...(patch.routes[mode] || {}), limits: normalizeLimits(routesPatch.limits) };
      patch.lines = patch.lines || perm.gym.lines || { boulder: 0, difficulty: 0, lead: 0 };
      const sum = Object.keys(patch.routes[mode].limits).reduce((s, k) => s + Number(patch.routes[mode].limits[k] || 0), 0);
      patch.lines[mode] = sum;
    }

    await gymsCol.doc(gymId).update({ data: patch });
    return ok({ gymId }, tid);
  } catch (e) {
    return fail("GYM_UPSERT_FAILED", e && e.message ? e.message : "保存失败", tid);
  }
};

