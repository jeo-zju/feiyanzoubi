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

function normalizeGymStatus(value) {
  const status = safeText(value).toLowerCase();
  if (status === "deleted") return "deleted";
  if (status === "merged") return "merged";
  return "active";
}

function getGymName(gym) {
  return safeText(gym && (gym.name || gym.gymName || gym.title));
}

async function canManageGym(openid, gymId) {
  const res = await db.collection("RockGyms").doc(gymId).get();
  const gym = res && res.data ? res.data : null;
  if (!gym) return { ok: false, gym: null };
  if (await isAdmin(openid)) return { ok: true, gym };
  if (gym.ownerOpenid && gym.ownerOpenid === openid) return { ok: true, gym };
  if (gym.owner_uid && gym.owner_uid === openid) return { ok: true, gym };
  const managers = Array.isArray(gym.managers) ? gym.managers : [];
  const managerOpenids = Array.isArray(gym.managerOpenids) ? gym.managerOpenids : [];
  const managerUids = Array.isArray(gym.manager_uids) ? gym.manager_uids : [];
  if (managers.includes(openid) || managerOpenids.includes(openid) || managerUids.includes(openid)) {
    return { ok: true, gym };
  }
  return { ok: false, gym };
}

function buildManagedGymsWhere(openid) {
  return _.or([
    { ownerOpenid: openid },
    { owner_uid: openid },
    { managers: openid },
    { managerOpenids: openid },
    { manager_uids: openid }
  ]);
}

async function countDocs(collectionName, where) {
  try {
    const res = await db.collection(collectionName).where(where).count();
    return res && typeof res.total === "number" ? res.total : 0;
  } catch (e) {
    return 0;
  }
}

async function buildDeleteRelations(gymId) {
  const gymWhere = _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]);
  return {
    cycleCount: await countDocs("RockGymCycles", gymWhere),
    checkinCount: await countDocs("RockCheckinRecords", gymWhere),
    dailyProgressCount: await countDocs("RockUserDailyProgress", gymWhere),
    cycleProgressCount: await countDocs("RockUserCycleProgress", gymWhere),
    hardnessRatingCount: await countDocs("RockGymHardnessRatings", { gymId }),
    wallCardCount: await countDocs("RockGymWallCards", { gymId }),
    commentCount: await countDocs("RockComments", gymWhere),
    blackboardCount: await countDocs("RockGymBlackboards", gymWhere)
  };
}

function hasRelations(relations) {
  return Object.keys(relations || {}).some((key) => Number(relations[key] || 0) > 0);
}

function buildDeleteWarnings(relations) {
  const warnings = [];
  if (Number(relations && relations.cycleCount) > 0) warnings.push("存在周期数据，删除后前台将不可继续打卡。");
  if (Number(relations && relations.checkinCount) > 0) warnings.push("存在历史打卡记录，本次仅做逻辑删除，不清空历史数据。");
  if (!warnings.length) warnings.push("当前未发现关联业务数据，将执行逻辑删除。");
  return warnings;
}

function uniqueStrings(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const text = safeText(item);
    if (!text || seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out;
}

function uniqueModes(list) {
  return uniqueStrings(list)
    .map((item) => item.toLowerCase())
    .filter((item) => ["boulder", "difficulty", "lead"].includes(item));
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function normalizeDateRange(cycle) {
  const start = safeText(cycle && (cycle.start_date || cycle.startDate));
  const end = safeText(cycle && (cycle.end_date || cycle.endDate));
  return {
    _id: safeText(cycle && cycle._id),
    name: safeText(cycle && (cycle.name || cycle.cycle_name)) || "默认周期",
    start: isValidYMD(start) ? start : "",
    end: isValidYMD(end) ? end : "",
    status: safeText(cycle && cycle.status)
  };
}

function overlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return false;
  const ae = aEnd || "9999-12-31";
  const be = bEnd || "9999-12-31";
  return aStart <= be && bStart <= ae;
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

function detectCycleConflicts(sourceCycles, targetCycles) {
  const sourceRanges = (sourceCycles || []).map(normalizeDateRange).filter((item) => item._id && item.start);
  const targetRanges = (targetCycles || []).map(normalizeDateRange).filter((item) => item._id && item.start);
  const conflicts = [];
  sourceRanges.forEach((source) => {
    targetRanges.forEach((target) => {
      if (!overlap(source.start, source.end, target.start, target.end)) return;
      conflicts.push({
        sourceCycleId: source._id,
        sourceCycleName: source.name,
        sourceRange: `${source.start} ~ ${source.end || "至今"}`,
        targetCycleId: target._id,
        targetCycleName: target.name,
        targetRange: `${target.start} ~ ${target.end || "至今"}`
      });
    });
  });
  return conflicts;
}

function buildMergeWarnings(conflicts) {
  if (conflicts.length) return ["检测到源岩馆与目标岩馆存在周期重叠，可通过手动映射把源周期并入目标周期后继续合并。"];
  return ["将把源岩馆的周期与历史数据迁移到目标岩馆，源岩馆会标记为已合并。"];
}

function groupCycleConflicts(conflicts, targetCycles) {
  const grouped = {};
  (conflicts || []).forEach((item) => {
    const sourceCycleId = safeText(item && item.sourceCycleId);
    if (!sourceCycleId) return;
    if (!grouped[sourceCycleId]) {
      grouped[sourceCycleId] = {
        sourceCycleId,
        sourceCycleName: safeText(item.sourceCycleName),
        sourceRange: safeText(item.sourceRange),
        targetOptions: []
      };
    }
    grouped[sourceCycleId].targetOptions.push({
      targetCycleId: safeText(item.targetCycleId),
      targetCycleName: safeText(item.targetCycleName),
      targetRange: safeText(item.targetRange)
    });
  });
  return Object.keys(grouped).map((key) => {
    const row = grouped[key];
    const targetIds = row.targetOptions.map((item) => item.targetCycleId);
    const extraTargets = (targetCycles || [])
      .map(normalizeDateRange)
      .filter((item) => item._id)
      .filter((item) => targetIds.includes(item._id))
      .map((item) => ({
        targetCycleId: item._id,
        targetCycleName: item.name,
        targetRange: `${item.start} ~ ${item.end || "至今"}`
      }));
    return {
      ...row,
      targetOptions: extraTargets.length ? extraTargets : row.targetOptions
    };
  });
}

function buildCycleMappingMap(list) {
  const map = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const sourceCycleId = safeText(item && item.sourceCycleId);
    const targetCycleId = safeText(item && item.targetCycleId);
    if (!sourceCycleId || !targetCycleId) return;
    map[sourceCycleId] = targetCycleId;
  });
  return map;
}

function filterConflictsByMappings(conflicts, mappingMap) {
  return (conflicts || []).filter((item) => {
    const sourceCycleId = safeText(item && item.sourceCycleId);
    const targetCycleId = safeText(item && item.targetCycleId);
    if (!sourceCycleId || !targetCycleId) return false;
    return mappingMap[sourceCycleId] !== targetCycleId;
  });
}

function getMappedCycleTarget(cycleId, mappingMap) {
  const key = safeText(cycleId);
  return key && mappingMap[key] ? mappingMap[key] : "";
}

async function buildMergeSummary(gymId) {
  return buildDeleteRelations(gymId);
}

async function eachDocByWhere(collectionName, where, handler, batchSize) {
  const col = db.collection(collectionName);
  const size = Math.max(1, Math.min(50, Number(batchSize || 50)));
  for (let round = 0; round < 400; round++) {
    let res;
    try {
      res = await col.where(where).limit(size).get();
    } catch (e) {
      const msg = String((e && e.message) || "");
      const notExist =
        msg.includes("DATABASE_COLLECTION_NOT_EXIST") ||
        msg.includes("database collection not exists") ||
        msg.includes("Db or Table not exist") ||
        msg.includes("ResourceNotFound");
      if (notExist) return;
      throw e;
    }
    const list = (res && res.data) || [];
    if (!list.length) break;
    for (let i = 0; i < list.length; i++) {
      await handler(list[i], col);
    }
    if (list.length < size) break;
  }
}

function mergeSourceRefs(targetRefs, sourceRefs) {
  const all = [].concat(Array.isArray(targetRefs) ? targetRefs : [], Array.isArray(sourceRefs) ? sourceRefs : []);
  const out = [];
  const seen = {};
  all.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const provider = safeText(item.provider);
    const providerPoiId = safeText(item.providerPoiId);
    const key = provider && providerPoiId ? `${provider}__${providerPoiId}` : JSON.stringify(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(item);
  });
  return out;
}

function normalizeMergeHistory(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const sourceGymId = safeText(item.sourceGymId);
    const mergedAt = Number(item.mergedAt || 0) || 0;
    const key = `${sourceGymId}__${mergedAt}__${safeText(item.targetGymId)}`;
    if (!sourceGymId || !mergedAt || seen[key]) return;
    seen[key] = true;
    out.push({
      sourceGymId,
      sourceGymName: safeText(item.sourceGymName),
      targetGymId: safeText(item.targetGymId),
      targetGymName: safeText(item.targetGymName),
      mergedAt,
      mergedByOpenid: safeText(item.mergedByOpenid),
      cycleMappingCount: Number(item.cycleMappingCount || 0) || 0,
      mappedCycleCount: Number(item.mappedCycleCount || 0) || 0
    });
  });
  return out.sort((a, b) => Number(b.mergedAt || 0) - Number(a.mergedAt || 0));
}

function buildMergeHistory(targetGym, sourceGym, currentEntry) {
  return normalizeMergeHistory(
    []
      .concat(Array.isArray(targetGym && targetGym.mergeHistory) ? targetGym.mergeHistory : [])
      .concat(Array.isArray(sourceGym && sourceGym.mergeHistory) ? sourceGym.mergeHistory : [])
      .concat(currentEntry ? [currentEntry] : [])
  );
}

function pickCurrentCycle(cycles) {
  const today = new Date();
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  const ymd = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const ranges = (cycles || []).map(normalizeDateRange).filter((item) => item._id && item.start);
  const active = ranges
    .filter((item) => item.start <= ymd && ymd <= (item.end || "9999-12-31"))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
  if (active) return active;
  return ranges.sort((a, b) => String(b.start).localeCompare(String(a.start)))[0] || null;
}

async function recalcGymHardness(gymId) {
  let list = [];
  try {
    const res = await db.collection("RockGymHardnessRatings").where({ gymId }).limit(1000).get();
    list = (res && res.data) || [];
  } catch (e) {
    const msg = String((e && e.message) || "");
    const notExist =
      msg.includes("DATABASE_COLLECTION_NOT_EXIST") ||
      msg.includes("database collection not exists") ||
      msg.includes("Db or Table not exist") ||
      msg.includes("ResourceNotFound");
    if (!notExist) throw e;
  }
  let total = 0;
  let count = 0;
  list.forEach((item) => {
    const score = Number(item && item.score);
    if (!Number.isFinite(score)) return;
    total += score;
    count += 1;
  });
  return {
    hardnessCount: count,
    hardnessAvg: count ? Math.round((total / count) * 10) / 10 : null
  };
}

async function previewMerge(sourceGymId, targetGymId, sourcePerm, targetPerm, tid) {
  const sourceGym = sourcePerm && sourcePerm.gym ? sourcePerm.gym : null;
  const targetGym = targetPerm && targetPerm.gym ? targetPerm.gym : null;
  if (!sourceGym || !targetGym) return fail("NOT_FOUND", "岩馆不存在", tid);
  if (sourceGymId === targetGymId) return fail("BAD_REQUEST", "不能合并到同一个岩馆", tid);
  if (normalizeGymStatus(sourceGym.status) !== "active") return fail("GYM_INACTIVE", "源岩馆当前不可合并", tid);
  if (normalizeGymStatus(targetGym.status) !== "active") return fail("GYM_INACTIVE", "目标岩馆当前不可合并", tid);

  const sourceCycles = await listCyclesForGym(sourceGymId, 200);
  const targetCycles = await listCyclesForGym(targetGymId, 200);
  const conflicts = detectCycleConflicts(sourceCycles, targetCycles);
  const conflictGroups = groupCycleConflicts(conflicts, targetCycles);
  return ok(
    {
      sourceGym: { _id: sourceGymId, name: getGymName(sourceGym), city: safeText(sourceGym.city) },
      targetGym: { _id: targetGymId, name: getGymName(targetGym), city: safeText(targetGym.city) },
      summary: {
        source: await buildMergeSummary(sourceGymId),
        target: await buildMergeSummary(targetGymId)
      },
      cyclePlan: {
        sourceCycleCount: sourceCycles.length,
        targetCycleCount: targetCycles.length,
        conflictCount: conflicts.length,
        conflicts: conflicts.slice(0, 10),
        conflictGroups,
        sourceCycles: sourceCycles.map(normalizeDateRange),
        targetCycles: targetCycles.map(normalizeDateRange),
        requiresManualMapping: conflicts.length > 0,
        canManualMap: conflicts.length > 0
      },
      warnings: buildMergeWarnings(conflicts),
      canMerge: conflicts.length === 0
    },
    tid
  );
}

async function migrateSimpleGymRefs(sourceGymId, targetGymId, movedCounts) {
  const gymWhere = _.or([{ gym_id: sourceGymId }, { gymId: sourceGymId }, { gymID: sourceGymId }]);
  const mappings = [
    {
      collection: "RockCheckinRecords",
      key: "checkins",
      patch: { gym_id: targetGymId, gymId: targetGymId, gymID: targetGymId }
    },
    {
      collection: "RockUserDailyProgress",
      key: "dailyProgress",
      patch: { gym_id: targetGymId, gymId: targetGymId, gymID: targetGymId }
    },
    {
      collection: "RockUserCycleProgress",
      key: "cycleProgress",
      patch: { gym_id: targetGymId, gymId: targetGymId, gymID: targetGymId }
    },
    {
      collection: "RockGymBlackboards",
      key: "blackboards",
      patch: { gym_id: targetGymId, gymId: targetGymId, gymID: targetGymId }
    },
    {
      collection: "RockComments",
      key: "comments",
      patch: { gym_id: targetGymId, gymId: targetGymId, gymID: targetGymId }
    }
  ];
  for (let i = 0; i < mappings.length; i++) {
    const item = mappings[i];
    await eachDocByWhere(item.collection, gymWhere, async (doc, col) => {
      await col.doc(doc._id).update({ data: item.patch });
      movedCounts[item.key] += 1;
    });
  }
  await eachDocByWhere("RockGymSourceRecords", { gymId: sourceGymId }, async (doc, col) => {
    await col.doc(doc._id).update({ data: { gymId: targetGymId } });
    movedCounts.sourceRecords += 1;
  });
  await eachDocByWhere("RockGymReviewQueue", { gymId: sourceGymId }, async (doc, col) => {
    await col.doc(doc._id).update({ data: { gymId: targetGymId } });
    movedCounts.reviewQueue += 1;
  });
}

function mergeNumberMap(target, source) {
  const out = { ...(target || {}) };
  Object.keys(source || {}).forEach((key) => {
    const n = Number(source[key] || 0);
    if (!Number.isFinite(n) || n === 0) return;
    out[key] = Number(out[key] || 0) + n;
  });
  return out;
}

function mergeTodayValue(targetToday, sourceToday) {
  const out = { ...(targetToday || {}) };
  Object.keys(sourceToday || {}).forEach((category) => {
    const targetValue = out[category];
    const sourceValue = sourceToday[category];
    if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)) {
      out[category] = mergeNumberMap(targetValue || {}, sourceValue || {});
      return;
    }
    out[category] = sourceValue;
  });
  return out;
}

function mergeProgressDoc(targetDoc, sourceDoc) {
  const totals = { ...(targetDoc && targetDoc.totals ? targetDoc.totals : {}) };
  const sourceTotals = sourceDoc && sourceDoc.totals ? sourceDoc.totals : {};
  ["boulder", "difficulty", "lead", "rope"].forEach((key) => {
    totals[key] = mergeNumberMap(totals[key] || {}, sourceTotals[key] || {});
  });
  return totals;
}

async function migrateCycles(sourceGymId, targetGymId, cycleMappingMap, movedCounts) {
  await eachDocByWhere("RockGymCycles", _.or([{ gym_id: sourceGymId }, { gymId: sourceGymId }, { gymID: sourceGymId }]), async (doc, col) => {
    const mappedTargetCycleId = getMappedCycleTarget(doc && doc._id, cycleMappingMap);
    if (mappedTargetCycleId) {
      await col.doc(doc._id).remove();
      movedCounts.cycles += 1;
      movedCounts.mappedCycles += 1;
      return;
    }
    await col.doc(doc._id).update({
      data: {
        gym_id: targetGymId,
        gymId: targetGymId,
        gymID: targetGymId,
        updated_at: db.serverDate(),
        updatedAt: Date.now()
      }
    });
    movedCounts.cycles += 1;
  });
}

async function migrateRatings(sourceGymId, targetGymId, movedCounts) {
  await eachDocByWhere("RockGymHardnessRatings", { gymId: sourceGymId }, async (doc, col) => {
    const openid = safeText(doc && doc.openid);
    let existing = null;
    if (openid) {
      const found = await col.where({ gymId: targetGymId, openid }).limit(1).get();
      existing = found && found.data && found.data[0] ? found.data[0] : null;
    }
    if (existing && existing._id) {
      const existingUpdated = Number(existing.updatedAt || 0) || 0;
      const nextUpdated = Number(doc.updatedAt || 0) || 0;
      if (nextUpdated >= existingUpdated) {
        await col.doc(existing._id).update({
          data: {
            score: doc.score,
            userId: safeText(doc.userId),
            updatedAt: nextUpdated || Date.now()
          }
        });
      }
      await col.doc(doc._id).remove();
    } else {
      await col.doc(doc._id).update({ data: { gymId: targetGymId } });
    }
    movedCounts.hardnessRatings += 1;
  });
}

async function migrateWallCards(sourceGymId, targetGymId, movedCounts) {
  await eachDocByWhere("RockGymWallCards", { gymId: sourceGymId }, async (doc, col) => {
    const cardId = safeText(doc && doc.cardId);
    let existing = null;
    if (cardId) {
      const found = await col.where({ gymId: targetGymId, cardId }).limit(1).get();
      existing = found && found.data && found.data[0] ? found.data[0] : null;
    }
    if (existing && existing._id) {
      const existingHungAt = Number(existing.hungAt || 0) || 0;
      const nextHungAt = Number(doc.hungAt || 0) || 0;
      if (nextHungAt >= existingHungAt) {
        await col.doc(existing._id).update({
          data: {
            snapshot: doc.snapshot || existing.snapshot || {},
            ownerOpenid: safeText(doc.ownerOpenid) || safeText(existing.ownerOpenid),
            createdByOpenid: safeText(doc.createdByOpenid) || safeText(existing.createdByOpenid),
            hungByOpenid: safeText(doc.hungByOpenid) || safeText(existing.hungByOpenid),
            hungAt: nextHungAt || existingHungAt
          }
        });
      }
      await col.doc(doc._id).remove();
    } else {
      await col.doc(doc._id).update({ data: { gymId: targetGymId, wallId: targetGymId } });
    }
    movedCounts.wallCards += 1;
  });
}

async function migrateCheckinRecords(sourceGymId, targetGymId, cycleMappingMap, movedCounts) {
  const gymWhere = _.or([{ gym_id: sourceGymId }, { gymId: sourceGymId }, { gymID: sourceGymId }]);
  await eachDocByWhere("RockCheckinRecords", gymWhere, async (doc, col) => {
    const sourceCycleId = safeText(doc && (doc.cycle_id || doc.cycleId || doc.cycleID));
    const nextCycleId = getMappedCycleTarget(sourceCycleId, cycleMappingMap) || sourceCycleId;
    await col.doc(doc._id).update({
      data: {
        gym_id: targetGymId,
        gymId: targetGymId,
        gymID: targetGymId,
        cycle_id: nextCycleId,
        cycleId: nextCycleId,
        cycleID: nextCycleId
      }
    });
    movedCounts.checkins += 1;
  });
}

async function migrateDailyProgress(sourceGymId, targetGymId, cycleMappingMap, movedCounts) {
  const gymWhere = _.or([{ gym_id: sourceGymId }, { gymId: sourceGymId }, { gymID: sourceGymId }]);
  await eachDocByWhere("RockUserDailyProgress", gymWhere, async (doc, col) => {
    const uid = safeText(doc && doc.uid);
    const date = safeText(doc && doc.date);
    const sourceCycleId = safeText(doc && (doc.cycle_id || doc.cycleId || doc.cycleID));
    const nextCycleId = getMappedCycleTarget(sourceCycleId, cycleMappingMap) || sourceCycleId;
    const existingRes = await col.where({ uid, date, gym_id: targetGymId, cycle_id: nextCycleId }).limit(1).get();
    const existing = existingRes && existingRes.data && existingRes.data[0] ? existingRes.data[0] : null;
    if (existing && existing._id && existing._id !== doc._id) {
      await col.doc(existing._id).update({
        data: {
          today: mergeTodayValue(existing.today || {}, doc.today || {}),
          updated_at: db.serverDate()
        }
      });
      await col.doc(doc._id).remove();
    } else {
      await col.doc(doc._id).update({
        data: {
          gym_id: targetGymId,
          gymId: targetGymId,
          gymID: targetGymId,
          cycle_id: nextCycleId,
          cycleId: nextCycleId,
          cycleID: nextCycleId
        }
      });
    }
    movedCounts.dailyProgress += 1;
  });
}

async function migrateCycleProgress(sourceGymId, targetGymId, cycleMappingMap, movedCounts) {
  const gymWhere = _.or([{ gym_id: sourceGymId }, { gymId: sourceGymId }, { gymID: sourceGymId }]);
  await eachDocByWhere("RockUserCycleProgress", gymWhere, async (doc, col) => {
    const uid = safeText(doc && doc.uid);
    const sourceCycleId = safeText(doc && (doc.cycle_id || doc.cycleId || doc.cycleID));
    const nextCycleId = getMappedCycleTarget(sourceCycleId, cycleMappingMap) || sourceCycleId;
    const existingRes = await col.where({ uid, gym_id: targetGymId, cycle_id: nextCycleId }).limit(1).get();
    const existing = existingRes && existingRes.data && existingRes.data[0] ? existingRes.data[0] : null;
    if (existing && existing._id && existing._id !== doc._id) {
      await col.doc(existing._id).update({
        data: {
          totals: mergeProgressDoc(existing, doc),
          updated_at: db.serverDate()
        }
      });
      await col.doc(doc._id).remove();
    } else {
      await col.doc(doc._id).update({
        data: {
          gym_id: targetGymId,
          gymId: targetGymId,
          gymID: targetGymId,
          cycle_id: nextCycleId,
          cycleId: nextCycleId,
          cycleID: nextCycleId
        }
      });
    }
    movedCounts.cycleProgress += 1;
  });
}

async function migrateBlackboards(sourceGymId, targetGymId, cycleMappingMap, movedCounts) {
  const gymWhere = _.or([{ gym_id: sourceGymId }, { gymId: sourceGymId }, { gymID: sourceGymId }]);
  await eachDocByWhere("RockGymBlackboards", gymWhere, async (doc, col) => {
    const sourceCycleId = safeText(doc && (doc.cycle_id || doc.cycleId || doc.cycleID));
    const nextCycleId = getMappedCycleTarget(sourceCycleId, cycleMappingMap) || sourceCycleId;
    const existingRes = nextCycleId
      ? await col.where({ gym_id: targetGymId, cycle_id: nextCycleId }).limit(1).get()
      : { data: [] };
    const existing = existingRes && existingRes.data && existingRes.data[0] ? existingRes.data[0] : null;
    if (existing && existing._id && existing._id !== doc._id) {
      const existingUpdated = Number(existing.updatedAt || existing.updated_at || 0) || 0;
      const nextUpdated = Number(doc.updatedAt || doc.updated_at || 0) || 0;
      if (nextUpdated >= existingUpdated) {
        await col.doc(existing._id).update({
          data: {
            ...doc,
            gym_id: targetGymId,
            gymId: targetGymId,
            gymID: targetGymId,
            cycle_id: nextCycleId,
            cycleId: nextCycleId,
            cycleID: nextCycleId
          }
        });
      }
      await col.doc(doc._id).remove();
    } else {
      await col.doc(doc._id).update({
        data: {
          gym_id: targetGymId,
          gymId: targetGymId,
          gymID: targetGymId,
          cycle_id: nextCycleId,
          cycleId: nextCycleId,
          cycleID: nextCycleId
        }
      });
    }
    movedCounts.blackboards += 1;
  });
}

async function applyMerge(event, openid, sourceGymId, targetGymId, sourcePerm, targetPerm, tid) {
  const sourceGym = sourcePerm && sourcePerm.gym ? sourcePerm.gym : null;
  const targetGym = targetPerm && targetPerm.gym ? targetPerm.gym : null;
  if (!sourceGym || !targetGym) return fail("NOT_FOUND", "岩馆不存在", tid);
  if (sourceGymId === targetGymId) return fail("BAD_REQUEST", "不能合并到同一个岩馆", tid);
  if (normalizeGymStatus(targetGym.status) !== "active") return fail("GYM_INACTIVE", "目标岩馆当前不可合并", tid);

  const sourceStatus = normalizeGymStatus(sourceGym.status);
  if (sourceStatus === "merged" && safeText(sourceGym.mergedIntoGymId) === targetGymId) {
    return ok({ merged: true, sourceGymId, targetGymId }, tid);
  }
  if (sourceStatus !== "active") return fail("GYM_INACTIVE", "源岩馆当前不可合并", tid);

  const confirmName = safeText(event && event.confirmName);
  const sourceName = getGymName(sourceGym);
  if (!confirmName) return fail("BAD_REQUEST", "缺少确认岩馆名", tid);
  if (confirmName !== sourceName) return fail("BAD_REQUEST", "确认岩馆名不匹配", tid);

  const sourceCycles = await listCyclesForGym(sourceGymId, 200);
  const targetCyclesBefore = await listCyclesForGym(targetGymId, 200);
  const conflicts = detectCycleConflicts(sourceCycles, targetCyclesBefore);
  const cycleMappingMap = buildCycleMappingMap(event && event.cycleMappings);
  const unresolvedConflicts = filterConflictsByMappings(conflicts, cycleMappingMap);
  if (unresolvedConflicts.length) {
    return fail("MERGE_CONFLICT", "仍存在未处理的周期重叠，请先完成周期映射", tid);
  }

  const movedCounts = {
    cycles: 0,
    mappedCycles: 0,
    checkins: 0,
    dailyProgress: 0,
    cycleProgress: 0,
    hardnessRatings: 0,
    wallCards: 0,
    comments: 0,
    blackboards: 0,
    sourceRecords: 0,
    reviewQueue: 0
  };

  await migrateCycles(sourceGymId, targetGymId, cycleMappingMap, movedCounts);
  await migrateCheckinRecords(sourceGymId, targetGymId, cycleMappingMap, movedCounts);
  await migrateDailyProgress(sourceGymId, targetGymId, cycleMappingMap, movedCounts);
  await migrateCycleProgress(sourceGymId, targetGymId, cycleMappingMap, movedCounts);
  await migrateBlackboards(sourceGymId, targetGymId, cycleMappingMap, movedCounts);
  await migrateSimpleGymRefs(sourceGymId, targetGymId, movedCounts);
  await migrateRatings(sourceGymId, targetGymId, movedCounts);
  await migrateWallCards(sourceGymId, targetGymId, movedCounts);

  const targetCyclesAfter = await listCyclesForGym(targetGymId, 200);
  const nextCurrentCycle = pickCurrentCycle(targetCyclesAfter);
  const nextSourceRefs = mergeSourceRefs(targetGym.sourceRefs, sourceGym.sourceRefs);
  const now = Date.now();
  const currentMergeEntry = {
    sourceGymId,
    sourceGymName: sourceName,
    targetGymId,
    targetGymName: getGymName(targetGym),
    mergedAt: now,
    mergedByOpenid: openid,
    cycleMappingCount: Object.keys(cycleMappingMap).length,
    mappedCycleCount: Number(movedCounts.mappedCycles || 0) || 0
  };
  const nextMergeHistory = buildMergeHistory(targetGym, sourceGym, currentMergeEntry);
  await db.collection("RockGyms").doc(targetGymId).update({
    data: {
      supportedModes: uniqueModes([].concat(targetGym.supportedModes || [], sourceGym.supportedModes || [])),
      managers: uniqueStrings([].concat(targetGym.managers || [], sourceGym.managers || [])),
      managerOpenids: uniqueStrings([].concat(targetGym.managerOpenids || [], sourceGym.managerOpenids || [])),
      manager_uids: uniqueStrings([].concat(targetGym.manager_uids || [], sourceGym.manager_uids || [])),
      aliasNames: uniqueStrings([].concat(targetGym.aliasNames || [], sourceGym.aliasNames || [], [sourceName])),
      sourceRefs: nextSourceRefs,
      sourceSummary: {
        primaryProvider:
          safeText(targetGym && targetGym.sourceSummary && targetGym.sourceSummary.primaryProvider) ||
          safeText(sourceGym && sourceGym.sourceSummary && sourceGym.sourceSummary.primaryProvider),
        sourceCount: nextSourceRefs.length
      },
      mergeHistory: nextMergeHistory,
      current_cycle_id: nextCurrentCycle ? nextCurrentCycle._id : "",
      currentCycleId: nextCurrentCycle ? nextCurrentCycle._id : "",
      currentCycle: nextCurrentCycle
        ? {
            name: nextCurrentCycle.name,
            startDate: nextCurrentCycle.start,
            endDate: nextCurrentCycle.end
          }
        : null,
      updatedAt: now,
      updated_at: db.serverDate()
    }
  });

  const hardnessSummary = await recalcGymHardness(targetGymId);
  await db.collection("RockGyms").doc(targetGymId).update({
    data: {
      hardnessAvg: hardnessSummary.hardnessAvg,
      hardnessCount: hardnessSummary.hardnessCount,
      hardnessUpdatedAt: now,
      updatedAt: now,
      updated_at: db.serverDate()
    }
  });

  await db.collection("RockGyms").doc(sourceGymId).update({
    data: {
      status: "merged",
      mergedIntoGymId: targetGymId,
      mergedAt: now,
      mergedByOpenid: openid,
      mergeHistory: normalizeMergeHistory(sourceGym && sourceGym.mergeHistory),
      current_cycle_id: "",
      currentCycleId: "",
      currentCycle: null,
      updatedAt: now,
      updated_at: db.serverDate()
    }
  });

  return ok(
    {
      merged: true,
      sourceGymId,
      targetGymId,
      movedCounts,
      mergeHistory: nextMergeHistory,
      targetGymSnapshot: {
        _id: targetGymId,
        name: getGymName(targetGym),
        city: safeText(targetGym.city)
      }
    },
    tid
  );
}

async function previewDelete(gymId, perm, tid) {
  const gym = perm && perm.gym ? perm.gym : null;
  if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
  const status = normalizeGymStatus(gym.status);
  if (status === "merged") return fail("GYM_INACTIVE", "岩馆已合并，不能删除", tid);
  const relations = await buildDeleteRelations(gymId);
  return ok(
    {
      gym: {
        _id: gymId,
        name: getGymName(gym),
        city: safeText(gym.city),
        status
      },
      relations,
      hasRelations: hasRelations(relations),
      allowedModes: {
        softDelete: true,
        hardDelete: false
      },
      warnings: buildDeleteWarnings(relations)
    },
    tid
  );
}

async function resolveGymRedirect(gymId, perm, tid) {
  const gym = perm && perm.gym ? perm.gym : null;
  if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
  const status = normalizeGymStatus(gym.status);
  const targetGymId = safeText(gym.mergedIntoGymId);
  let targetGymName = "";
  if (targetGymId) {
    try {
      const targetRes = await db.collection("RockGyms").doc(targetGymId).get();
      const targetGym = targetRes && targetRes.data ? targetRes.data : null;
      targetGymName = getGymName(targetGym);
    } catch (e) {}
  }
  return ok(
    {
      gymId,
      status,
      targetGymId,
      targetGymName
    },
    tid
  );
}

async function getMergeHistory(gymId, perm, tid) {
  const gym = perm && perm.gym ? perm.gym : null;
  if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
  return ok(
    {
      gymId,
      mergeHistory: normalizeMergeHistory(gym.mergeHistory)
    },
    tid
  );
}

async function getDeletedGyms(openid, tid) {
  const where = (await isAdmin(openid)) ? {} : buildManagedGymsWhere(openid);
  const countRes = await db.collection("RockGyms").where(where).count();
  const total = countRes && typeof countRes.total === "number" ? countRes.total : 0;
  const batchSize = 100;
  const rows = [];
  for (let i = 0; i < Math.ceil(total / batchSize); i++) {
    let res;
    try {
      res = await db.collection("RockGyms").where(where).skip(i * batchSize).limit(batchSize).get();
    } catch (e) {
      res = { data: [] };
    }
    rows.push(...((res && res.data) || []));
  }
  const gyms = rows
    .filter((item) => normalizeGymStatus(item && item.status) === "deleted")
    .sort((a, b) => {
      const deletedA = Number((a && a.deletedAt) || 0) || 0;
      const deletedB = Number((b && b.deletedAt) || 0) || 0;
      return deletedB - deletedA;
    })
    .map((item) => ({
      _id: item._id,
      name: getGymName(item),
      city: safeText(item.city),
      address: safeText(item.address),
      deletedAt: Number(item.deletedAt || 0) || 0,
      deleteReason: safeText(item.deleteReason)
    }));
  return ok({ gyms }, tid);
}

async function applyDelete(event, openid, gymId, perm, tid) {
  const gym = perm && perm.gym ? perm.gym : null;
  if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
  const status = normalizeGymStatus(gym.status);
  if (status === "merged") return fail("GYM_INACTIVE", "岩馆已合并，不能删除", tid);
  if (status === "deleted") {
    return ok({ gymId, mode: "soft", status: "deleted" }, tid);
  }

  const confirmName = safeText(event && event.confirmName);
  const gymName = getGymName(gym);
  if (!confirmName) return fail("BAD_REQUEST", "缺少确认岩馆名", tid);
  if (confirmName !== gymName) return fail("BAD_REQUEST", "确认岩馆名不匹配", tid);

  const now = Date.now();
  await db.collection("RockGyms").doc(gymId).update({
    data: {
      status: "deleted",
      deletedAt: now,
      deletedByOpenid: openid,
      deleteReason: safeText(event && event.reason),
      updatedAt: now,
      updated_at: db.serverDate()
    }
  });
  return ok({ gymId, mode: "soft", status: "deleted" }, tid);
}

async function restoreDelete(openid, gymId, perm, tid) {
  const gym = perm && perm.gym ? perm.gym : null;
  if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
  const status = normalizeGymStatus(gym.status);
  if (status === "merged") return fail("GYM_INACTIVE", "已合并岩馆不能恢复", tid);
  if (status === "active") return ok({ gymId, status: "active" }, tid);
  const now = Date.now();
  await db.collection("RockGyms").doc(gymId).update({
    data: {
      status: "active",
      deletedAt: 0,
      deletedByOpenid: "",
      deleteReason: "",
      updatedAt: now,
      updated_at: db.serverDate(),
      restoredAt: now,
      restoredByOpenid: openid
    }
  });
  return ok({ gymId, status: "active" }, tid);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!(await isAdmin(openid))) return fail("FORBIDDEN", "无权限", tid);

    const action = safeText(event && event.action);
    const gymId = safeText(event && event.gymId);
    if (action === "preview_merge" || action === "apply_merge") {
      const sourceGymId = safeText(event && event.sourceGymId);
      const targetGymId = safeText(event && event.targetGymId);
      if (!sourceGymId || !targetGymId) return fail("BAD_REQUEST", "缺少源岩馆或目标岩馆", tid);
      const sourcePerm = await canManageGym(openid, sourceGymId);
      const targetPerm = await canManageGym(openid, targetGymId);
      if (!sourcePerm.ok || !targetPerm.ok) return fail("FORBIDDEN", "无权限", tid);
      if (action === "preview_merge") return previewMerge(sourceGymId, targetGymId, sourcePerm, targetPerm, tid);
      if (action === "apply_merge") return applyMerge(event, openid, sourceGymId, targetGymId, sourcePerm, targetPerm, tid);
      return fail("BAD_REQUEST", "不支持的 action", tid);
    }
    if (action === "get_deleted_gyms") return getDeletedGyms(openid, tid);
    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);

    const perm = await canManageGym(openid, gymId);
    if (!perm.ok) return fail("FORBIDDEN", "无权限", tid);

    if (action === "get_merge_history") return getMergeHistory(gymId, perm, tid);
    if (action === "resolve_redirect") return resolveGymRedirect(gymId, perm, tid);
    if (action === "preview_delete") return previewDelete(gymId, perm, tid);
    if (action === "apply_delete") return applyDelete(event, openid, gymId, perm, tid);
    if (action === "restore_delete") return restoreDelete(openid, gymId, perm, tid);
    return fail("BAD_REQUEST", "不支持的 action", tid);
  } catch (e) {
    return fail("GYM_OWNER_MANAGE_FAILED", e && e.message ? e.message : "操作失败", tid);
  }
};
