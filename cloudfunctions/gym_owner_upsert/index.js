const cloud = require("wx-server-sdk");
const guard = require("./demo-guard");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const BOOTSTRAP_ADMIN_IDS = ["42098a0769e3423400183ddf36230f95"];

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

function isBootstrapAdminId(value) {
  return BOOTSTRAP_ADMIN_IDS.includes(String(value == null ? "" : value).trim());
}

function isBootstrapAdminUser(openid, userDoc) {
  return isBootstrapAdminId(openid) || !!(userDoc && isBootstrapAdminId(userDoc._id));
}

async function isAdmin(openid) {
  if (!openid) return false;
  if (isBootstrapAdminId(openid)) return true;
  const res = await db
    .collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1)
    .get();
  const user = res && res.data && res.data[0] ? res.data[0] : null;
  if (isBootstrapAdminUser(openid, user)) return true;
  if (!user) return false;
  return user.role === "admin" || user.isAdmin === true;
}

async function getUserByOpenid(openid) {
  if (!openid) return null;
  const res = await db
    .collection("RockUsers")
    .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
    .limit(1)
    .get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

async function getGymDoc(gymId) {
  if (!gymId) return null;
  const res = await db.collection("RockGyms").doc(gymId).get();
  return res && res.data ? res.data : null;
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

function normalizeGymStatus(value) {
  const status = safeText(value).toLowerCase();
  if (status === "deleted") return "deleted";
  if (status === "merged") return "merged";
  return "active";
}

function getGymName(gym) {
  return safeText(gym && (gym.name || gym.gymName || gym.title));
}

function hasExistingCycleData(gym, cycles) {
  const list = Array.isArray(cycles) ? cycles : [];
  if (list.some((item) => normalizeCycleRange(item).start)) return true;
  const currentCycle = gym && (gym.currentCycle || gym.cycle);
  const startDate = safeText(currentCycle && (currentCycle.startDate || currentCycle.start_date));
  return !!safeText(gym && (gym.current_cycle_id || gym.currentCycleId)) || isValidYMD(startDate);
}

function detectSubmissionModes(gym, cyclePatch, routesPatch) {
  const guessed = [].concat(Array.isArray(gym && gym.supportedModes) ? gym.supportedModes : []);
  if (cyclePatch) {
    if (Array.isArray(cyclePatch.boulderGrades) && cyclePatch.boulderGrades.length) guessed.push("boulder");
    if (Array.isArray(cyclePatch.difficultyGrades) && cyclePatch.difficultyGrades.length) guessed.push("difficulty");
    if (Array.isArray(cyclePatch.leadGrades) && cyclePatch.leadGrades.length) guessed.push("lead");
  }
  if (routesPatch && routesPatch.mode) guessed.push(routesPatch.mode);
  return uniqueModes(guessed);
}

function buildSubmissionSummary(cyclePatch, routesPatch) {
  const parts = [];
  if (cyclePatch) {
    const cycleName = safeText(cyclePatch.name) || "默认周期";
    const startDate = safeText(cyclePatch.startDate);
    parts.push(`周期：${cycleName}${startDate ? `（${startDate} 起）` : ""}`);
  }
  if (routesPatch && routesPatch.mode && routesPatch.limits) {
    const total = Object.keys(routesPatch.limits || {}).reduce((sum, key) => sum + Number(routesPatch.limits[key] || 0), 0);
    const modeLabel = routesPatch.mode === "boulder" ? "抱石" : routesPatch.mode === "lead" ? "先锋" : "难度";
    parts.push(`线路：${modeLabel} ${Number.isFinite(total) ? total : 0} 条`);
  }
  return parts.join("；");
}

async function createCycleReview({ gymId, gym, openid, userDoc, cyclePatch, routesPatch, now }) {
  const supportedModes = detectSubmissionModes(gym, cyclePatch, routesPatch);
  const reviewDoc = {
    reviewType: "gym_cycle_submission",
    reviewState: "pending",
    gymId,
    name: getGymName(gym),
    city: safeText(gym && gym.city),
    address: safeText(gym && gym.address),
    writeAction: "user_submit_cycle_routes",
    supportedModes,
    finalSupportedModes: [],
    modeConfidence: 0,
    modeReasons: [],
    reviewReason: "",
    reviewNote: "",
    submittedByOpenid: openid,
    submittedByUserId: safeText(userDoc && userDoc._id),
    submittedByName: safeText(userDoc && (userDoc.nickName || userDoc.nickname || userDoc.name)),
    submissionSummary: buildSubmissionSummary(cyclePatch, routesPatch),
    submissionPatch: {
      cycle: cyclePatch
        ? {
            cycleId: safeText(cyclePatch.cycleId),
            name: safeText(cyclePatch.name),
            startDate: safeText(cyclePatch.startDate),
            boulderGrades: Array.isArray(cyclePatch.boulderGrades) ? cyclePatch.boulderGrades : [],
            difficultyGrades: Array.isArray(cyclePatch.difficultyGrades) ? cyclePatch.difficultyGrades : [],
            leadGrades: Array.isArray(cyclePatch.leadGrades) ? cyclePatch.leadGrades : []
          }
        : null,
      routes: routesPatch && routesPatch.mode && routesPatch.limits
        ? {
            mode: routesPatch.mode === "boulder" ? "boulder" : routesPatch.mode === "lead" ? "lead" : "difficulty",
            limits: normalizeLimits(routesPatch.limits)
          }
        : null
    },
    createdAt: now,
    updatedAt: now
  };
  const addRes = await db.collection("RockGymReviewQueue").add({ data: reviewDoc });
  return addRes && addRes._id ? String(addRes._id) : "";
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
    // 模拟身份不得认领岩馆/写运营数据——纵深防御
    await guard.assertRealActor(openid);
    const now = Date.now();
    const admin = await isAdmin(openid);
    const userDoc = admin ? null : await getUserByOpenid(openid);

    const gymId = event && event.gymId ? String(event.gymId) : "";
    const gymPatch = event && event.gym ? event.gym : null;
    const cyclePatch = event && event.cycle ? event.cycle : null;
    const routesPatch = event && event.routes ? event.routes : null;
    const closeCycle = event && event.closeCycle ? event.closeCycle : null;
    const deleteCycle = event && event.deleteCycle ? event.deleteCycle : null;

    const gymsCol = db.collection("RockGyms");

    if (!gymId) {
      if (!admin) return fail("FORBIDDEN", "仅管理员可创建岩馆", tid);
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
        status: "active",
        deletedAt: 0,
        deletedByOpenid: "",
        deleteReason: "",
        mergedIntoGymId: "",
        mergedAt: 0,
        mergedByOpenid: "",
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

    let gymDoc = null;
    if (admin) {
      gymDoc = await getGymDoc(gymId);
      if (!gymDoc) return fail("NOT_FOUND", "岩馆不存在", tid);
    } else {
      gymDoc = await getGymDoc(gymId);
      if (!gymDoc) return fail("NOT_FOUND", "岩馆不存在", tid);
      if (gymPatch || closeCycle || deleteCycle) {
        return fail("FORBIDDEN", "你可以补录当前周期和线路数量，其他操作请联系管理员", tid);
      }
      if (!cyclePatch && !(routesPatch && routesPatch.limits)) {
        return fail("FORBIDDEN", "你可以补录当前周期和线路数量，其他操作请联系管理员", tid);
      }
    }
    const gymStatus = normalizeGymStatus(gymDoc && gymDoc.status);
    if (gymStatus === "deleted") return fail("GYM_INACTIVE", "岩馆已删除，不能继续编辑", tid);
    if (gymStatus === "merged") return fail("GYM_INACTIVE", "岩馆已合并，不能继续编辑", tid);

    if (!admin) {
      const cycles = await listCyclesForGym(gymId, 200);
      const hasExistingCycle = hasExistingCycleData(gymDoc, cycles);
      if (!hasExistingCycle && !cyclePatch) {
        return fail("BAD_REQUEST", "当前岩馆还没有周期，请先补录当前周期，再录入线路数量", tid);
      }
      if (hasExistingCycle) {
        const reviewId = await createCycleReview({
          gymId,
          gym: gymDoc,
          openid,
          userDoc,
          cyclePatch,
          routesPatch,
          now
        });
        return ok({ gymId, reviewState: "pending", applied: false, reviewId }, tid);
      }
    }

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
      if (gymPatch.phone != null) patch.phone = safeText(gymPatch.phone);
      if (gymPatch.lat != null) patch.lat = Number(gymPatch.lat) || null;
      if (gymPatch.lng != null) patch.lng = Number(gymPatch.lng) || null;
      if (gymPatch.supportedModes != null) patch.supportedModes = uniqueModes(gymPatch.supportedModes);
      // 人工编辑岩馆字段后标记为已人工维护，同步不得覆盖地址/电话/位置/城市
      if (gymPatch.city != null || gymPatch.address != null || gymPatch.phone != null || gymPatch.lat != null || gymPatch.lng != null || name) {
        patch.claimedByOwner = true;
      }
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
      patch.routes = gymDoc && gymDoc.routes && typeof gymDoc.routes === "object" ? gymDoc.routes : {};
      patch.routes[mode] = { ...(patch.routes[mode] || {}), limits: normalizeLimits(routesPatch.limits) };
      patch.lines = patch.lines || (gymDoc && gymDoc.lines) || { boulder: 0, difficulty: 0, lead: 0 };
      const sum = Object.keys(patch.routes[mode].limits).reduce((s, k) => s + Number(patch.routes[mode].limits[k] || 0), 0);
      patch.lines[mode] = sum;
    }

    await gymsCol.doc(gymId).update({ data: patch });
    return ok({ gymId }, tid);
  } catch (e) {
    return fail("GYM_UPSERT_FAILED", e && e.message ? e.message : "保存失败", tid);
  }
};

