const cloud = require("wx-server-sdk");

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
  const id = safeText(value);
  return !!id && BOOTSTRAP_ADMIN_IDS.includes(id);
}

function isBootstrapAdminUser(openid, userDoc) {
  return isBootstrapAdminId(openid) || !!(userDoc && isBootstrapAdminId(userDoc._id));
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

function normalizeQueueDoc(doc) {
  const item = doc || {};
  return {
    _id: item._id || "",
    reviewType: safeText(item.reviewType) || "gym_mode_review",
    batchId: safeText(item.batchId),
    provider: safeText(item.provider),
    providerPoiId: safeText(item.providerPoiId),
    name: safeText(item.name),
    city: safeText(item.city),
    district: safeText(item.district),
    address: safeText(item.address),
    phone: safeText(item.phone),
    gymId: safeText(item.gymId),
    writeAction: safeText(item.writeAction),
    matchScore: Number(item.matchScore) || 0,
    supportedModes: uniqueModes(item.supportedModes),
    modeConfidence: Number(item.modeConfidence) || 0,
    modeReasons: Array.isArray(item.modeReasons) ? item.modeReasons : [],
    reviewState: safeText(item.reviewState) || "pending",
    reviewReason: safeText(item.reviewReason),
    reviewNote: safeText(item.reviewNote),
    finalSupportedModes: uniqueModes(item.finalSupportedModes),
    submissionSummary: safeText(item.submissionSummary),
    submittedByName: safeText(item.submittedByName),
    submittedByOpenid: safeText(item.submittedByOpenid),
    createdAt: Number(item.createdAt) || 0,
    reviewedAt: Number(item.reviewedAt) || 0,
    reviewedByOpenid: safeText(item.reviewedByOpenid)
  };
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function normEndDate(v) {
  const text = safeText(v);
  if (!text) return "";
  return isValidYMD(text) ? text : "";
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
    end
  };
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

function normalizeLimits(limits) {
  const out = {};
  if (!limits || typeof limits !== "object") return out;
  Object.keys(limits).forEach((key) => {
    const grade = safeText(key);
    const count = Number(limits[key] || 0);
    if (!grade) return;
    out[grade] = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
  });
  return out;
}

async function applyCyclePatch(gymId, cyclePatch, now) {
  if (!cyclePatch) return null;
  const name = safeText(cyclePatch.name);
  const startDate = safeText(cyclePatch.startDate);
  const boulderGrades = Array.isArray(cyclePatch.boulderGrades) ? cyclePatch.boulderGrades : [];
  const difficultyGrades = Array.isArray(cyclePatch.difficultyGrades) ? cyclePatch.difficultyGrades : [];
  const leadGrades = Array.isArray(cyclePatch.leadGrades) ? cyclePatch.leadGrades : [];
  if (!startDate || !isValidYMD(startDate)) {
    throw Object.assign(new Error("补录周期缺少有效的开始日期"), { code: "BAD_REQUEST" });
  }

  const editingCycleId = safeText(cyclePatch.cycleId);
  if (editingCycleId) {
    const cycleRes = await db.collection("RockGymCycles").doc(editingCycleId).get();
    const existed = cycleRes && cycleRes.data ? cycleRes.data : null;
    if (!existed) throw Object.assign(new Error("待审核周期不存在"), { code: "NOT_FOUND" });
    const existedGymId = safeText(existed.gym_id || existed.gymId);
    if (existedGymId && existedGymId !== gymId) {
      throw Object.assign(new Error("待审核周期不属于该岩馆"), { code: "BAD_REQUEST" });
    }
    const endDate = normEndDate(existed.end_date || existed.endDate);
    const all = await listCyclesForGym(gymId, 200);
    const ranges = all.map(normalizeCycleRange).filter((item) => item._id && item.start);
    for (let i = 0; i < ranges.length; i++) {
      const other = ranges[i];
      if (other._id === editingCycleId) continue;
      if (overlap(startDate, endDate, other.start, other.end)) {
        throw Object.assign(new Error("审核通过后的周期与其它周期重叠，请先处理历史周期"), { code: "CYCLE_OVERLAP" });
      }
    }
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
    return {
      current_cycle_id: editingCycleId,
      currentCycleId: editingCycleId,
      currentCycle: { name, startDate, boulderGrades, difficultyGrades, leadGrades }
    };
  }

  const all = await listCyclesForGym(gymId, 200);
  const ranges = all.map(normalizeCycleRange).filter((item) => item._id && item.start);
  const openCycle = ranges.find((item) => !item.end);
  if (openCycle) {
    throw Object.assign(new Error("审核通过前请先关闭当前周期，再创建新周期"), { code: "BAD_REQUEST" });
  }
  for (let i = 0; i < ranges.length; i++) {
    const other = ranges[i];
    if (overlap(startDate, "", other.start, other.end)) {
      throw Object.assign(new Error("审核通过后的周期与历史周期重叠，请调整日期"), { code: "CYCLE_OVERLAP" });
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
  const addRes = await db.collection("RockGymCycles").add({ data: cycleDoc });
  const cycleId = addRes && addRes._id ? String(addRes._id) : "";
  if (!cycleId) throw Object.assign(new Error("创建周期失败"), { code: "DATABASE_REQUEST_FAILED" });
  return {
    current_cycle_id: cycleId,
    currentCycleId: cycleId,
    currentCycle: { name, startDate, boulderGrades, difficultyGrades, leadGrades }
  };
}

function applyRoutesPatchToGym(gym, routesPatch) {
  if (!routesPatch || !routesPatch.limits) return {};
  const mode = routesPatch.mode === "boulder" ? "boulder" : routesPatch.mode === "lead" ? "lead" : "difficulty";
  const nextRoutes = gym && gym.routes && typeof gym.routes === "object" ? { ...gym.routes } : {};
  nextRoutes[mode] = { ...(nextRoutes[mode] || {}), limits: normalizeLimits(routesPatch.limits) };
  const nextLines = gym && gym.lines && typeof gym.lines === "object" ? { ...gym.lines } : { boulder: 0, difficulty: 0, lead: 0 };
  const sum = Object.keys(nextRoutes[mode].limits).reduce((total, key) => total + Number(nextRoutes[mode].limits[key] || 0), 0);
  nextLines[mode] = sum;
  return { routes: nextRoutes, lines: nextLines };
}

async function applyCycleSubmissionReview(doc, now) {
  const gymId = safeText(doc && doc.gymId);
  if (!gymId) throw Object.assign(new Error("审核记录缺少 gymId"), { code: "BAD_REQUEST" });
  const gymRes = await db.collection("RockGyms").doc(gymId).get();
  const gym = gymRes && gymRes.data ? gymRes.data : null;
  if (!gym) throw Object.assign(new Error("岩馆不存在"), { code: "NOT_FOUND" });

  const submissionPatch = doc && doc.submissionPatch && typeof doc.submissionPatch === "object" ? doc.submissionPatch : {};
  const patch = {
    updatedAt: now,
    updated_at: db.serverDate()
  };

  if (submissionPatch.cycle) {
    Object.assign(patch, await applyCyclePatch(gymId, submissionPatch.cycle, now));
  }
  if (submissionPatch.routes) {
    Object.assign(patch, applyRoutesPatchToGym(gym, submissionPatch.routes));
  }

  await db.collection("RockGyms").doc(gymId).update({ data: patch });
}

async function listQueue(event) {
  const page = Math.max(1, Number(event && event.page ? event.page : 1));
  const pageSize = Math.max(1, Math.min(50, Number(event && event.pageSize ? event.pageSize : 20)));
  const skip = (page - 1) * pageSize;
  const state = safeText(event && event.state) || "pending";
  const keyword = safeText(event && event.keyword).toLowerCase();
  const where = state === "all" ? {} : { reviewState: state };
  let res;
  try {
    res = await db.collection("RockGymReviewQueue").where(where).orderBy("createdAt", "desc").limit(200).get();
  } catch (e) {
    res = await db.collection("RockGymReviewQueue").where(where).limit(200).get();
  }
  const list = ((res && res.data) || []).filter((doc) => {
    if (!keyword) return true;
    const text = `${safeText(doc && doc.name)} ${safeText(doc && doc.city)} ${safeText(doc && doc.district)} ${safeText(doc && doc.address)}`.toLowerCase();
    return text.includes(keyword);
  });
  const hasNext = list.length > skip + pageSize;
  const items = list.slice(skip, skip + pageSize).map(normalizeQueueDoc);
  return { items, hasNext, page, state, keyword };
}

async function reviewQueueItem(event, openid) {
  const id = safeText(event && event.id);
  const decision = safeText(event && event.decision);
  const note = safeText(event && event.note);
  if (!id) throw Object.assign(new Error("缺少审核记录 id"), { code: "BAD_REQUEST" });
  if (!["approved", "rejected"].includes(decision)) {
    throw Object.assign(new Error("decision 仅支持 approved/rejected"), { code: "BAD_REQUEST" });
  }
  const ref = db.collection("RockGymReviewQueue").doc(id);
  const res = await ref.get();
  const doc = res && res.data ? res.data : null;
  if (!doc) throw Object.assign(new Error("审核记录不存在"), { code: "NOT_FOUND" });

  const reviewType = safeText(doc.reviewType) || "gym_mode_review";
  const now = Date.now();

  // gym_cycle_submission：先应用周期再更新审核状态（保持现有流程，失败不更新审核）
  if (reviewType === "gym_cycle_submission") {
    if (decision === "approved") {
      await applyCycleSubmissionReview(doc, now);
    }
    await ref.update({
      data: {
        reviewState: decision,
        reviewNote: note,
        reviewedAt: now,
        reviewedByOpenid: openid,
        updatedAt: now
      }
    });
    return { id, decision, gymId: safeText(doc.gymId), reviewType };
  }

  // entity_review / duplicate_match_review：只更新审核状态，不自动建馆/合并（需人工操作）
  if (reviewType === "entity_review" || reviewType === "duplicate_match_review") {
    await ref.update({
      data: {
        reviewState: decision,
        reviewNote: note,
        reviewedAt: now,
        reviewedByOpenid: openid,
        updatedAt: now
      }
    });
    return { id, decision, gymId: safeText(doc.gymId), reviewType };
  }

  // gym_mode_review / field_change_review：审核状态与馆更新原子化（事务）
  const finalSupportedModes =
    decision === "approved" ? uniqueModes((event && event.supportedModes) || doc.finalSupportedModes || doc.supportedModes) : [];
  if (decision === "approved" && !finalSupportedModes.length) {
    throw Object.assign(new Error("通过审核时至少选择一种模式"), { code: "BAD_REQUEST" });
  }
  const gymId = safeText(doc.gymId);

  const queuePatch = {
    reviewState: decision,
    reviewNote: note,
    reviewedAt: now,
    reviewedByOpenid: openid,
    updatedAt: now
  };
  if (decision === "approved") queuePatch.finalSupportedModes = finalSupportedModes;

  // 使用事务保证审核队列与馆表一致；任一失败都回滚
  const tx = await db.startTransaction();
  try {
    await tx.collection("RockGymReviewQueue").doc(id).update({ data: queuePatch });
    if (decision === "approved" && gymId) {
      await tx.collection("RockGyms").doc(gymId).update({
        data: {
          supportedModes: finalSupportedModes,
          supportedModesSource: "manual_review",
          supportedModesConfidence: 1,
          updatedAt: now,
          updated_at: db.serverDate()
        }
      });
    }
    await tx.commit();
  } catch (e) {
    try {
      await tx.rollback();
    } catch (rbErr) {
      // rollback 失败不掩盖原始错误
    }
    throw e;
  }

  return { id, decision, gymId, finalSupportedModes, reviewType };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!(await isAdmin(openid))) return fail("FORBIDDEN", "无权限", tid);

    const action = safeText(event && event.action) || "list";
    if (action === "list") {
      return ok(await listQueue(event), tid);
    }
    if (action === "review") {
      return ok(await reviewQueueItem(event, openid), tid);
    }
    return fail("BAD_REQUEST", "未知 action", tid);
  } catch (e) {
    return fail(e && e.code ? e.code : "REVIEW_QUEUE_FAILED", e && e.message ? e.message : "执行失败", tid);
  }
};
