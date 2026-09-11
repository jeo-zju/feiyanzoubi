// 演示约爬任务编排：预览 → 建任务（RockDemoRuns）→ 分批原子落库 → 续跑/状态。
// 单场“满员约爬”在一个事务内提交：计划文档 + N-1 条 confirmed 报名行 + 全体成员日程占用，
// 任何一步失败整批回滚，绝不出现“数字满了但没有报名关系”的假满员。
const crypto = require("crypto");
const profileMod = require("./profile");
const generator = require("./generator");
const schedule = require("./schedule");
const guard = require("./demo-guard");

const BATCH_PLANS = 6;            // 单次调用落库场次（云函数约 20s 上限内留足余量）
const CLEANUP_PLANS = 20;         // 单次调用清理场次（删除+占用释放均为普通写，批量可更大）
const LEASE_MS = 60 * 1000;
const MAX_ERRORS = 50;

function safeText(v) { return v == null ? "" : String(v).trim(); }
function sha32(text) { return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32); }
function normalizeCity(text) { return safeText(text).replace(/市$/, ""); }

function createRunApi(deps) {
  const db = deps.db;
  const _ = db.command;
  const cloud = deps.cloud;
  const now = () => Date.now();

  async function listAll(collection, where) {
    const out = [];
    for (let skip = 0; ; skip += 50) {
      let q = db.collection(collection);
      if (where) q = q.where(where);
      const r = await q.skip(skip).limit(50).get();
      out.push(...r.data);
      if (r.data.length < 50) return out;
    }
  }

  // ---------- 城市岩馆（与 rock_gym_list 同一过滤口径：状态 + 审核 + 跨城市字段正则） ----------
  async function loadGyms(city) {
    const literal = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = db.RegExp({ regexp: literal, options: "i" });
    const all = await listAll("RockGyms", _.and([
      { status: _.nin(["deleted", "merged"]) },
      { reviewState: _.neq("pending_review") },
      _.or([{ city: rx }, { cityName: rx }, { locationCity: rx }])
    ]));
    return all.map((g) => ({
      gymId: String(g._id || g.gymId || ""),
      name: g.name || g.gymName || g.title || "",
      city: g.city || g.cityName || g.locationCity || city,
      address: g.address || g.addr || g.location || "",
      supportedModes: Array.isArray(g.supportedModes) ? g.supportedModes : []
    })).filter((g) => g.gymId);
  }

  // ---------- 城市模拟用户池：已分配本市 + 全局未分配（预览按并集估算，生成时按使用领取） ----------
  async function loadPool(city) {
    const demoUsers = await listAll("RockUsers", { accountType: "demo" });
    const allocated = [], free = [];
    demoUsers.forEach((u) => {
      const row = {
        _id: u._id,
        openid: u.openid || u._openid || u.uid || "",
        nickName: u.nickName || "",
        displayName: u.displayName || u.nickName || "",
        avatarUrl: u.avatarUrl || u.avatarFileId || "",
        demoProfile: u.demoProfile || { modes: [] },
        demoCity: safeText(u.demoCity),
        demoAllocated: u.demoAllocated === true
      };
      if (!row.openid) return;
      if (u.demoAllocated === true && safeText(u.demoCity) === city) allocated.push(row);
      else if (u.demoAllocated !== true && !safeText(u.demoCity)) free.push(row);
    });
    return { allocated, free, pool: allocated.concat(free) };
  }

  async function countExisting(city, start, end) {
    const r = await db.collection("RockCalendarPlans").where(_.and([
      { dataOrigin: "demo" },
      { datasetId: profileMod.DATASET_ID },
      { cityKey: city },
      { status: "active" },
      { date: _.gte(start) },
      { date: _.lte(end) }
    ])).count().catch(() => ({ total: 0 }));
    return Number(r.total || 0);
  }

  async function prepareContext(event) {
    const city = normalizeCity(event.city);
    if (!city) throw Object.assign(new Error("缺少城市"), { code: "BAD_REQUEST" });
    const density = generator.normalizeDensity(event.density);
    const [gyms, poolInfo] = [await loadGyms(city), await loadPool(city)];
    const today = schedule.beijingYMD(now());
    const end = schedule.addDaysYMD(today, generator.WINDOW_DAYS - 1);
    const existing = await countExisting(city, today, end);
    const seed = safeText(event.seed) || ("auto-" + Math.floor(Math.random() * 1e9).toString(36));
    const plan = generator.generatePlanItems({
      seed, city, pool: poolInfo.pool, gyms, existing, density, nowMs: now()
    });
    // 管理员灰度演练：maxItems 仅截取确定性输出的前 N 场（仍按同一 seed 复现），用于先小批验证
    const maxItems = Number(event.maxItems || 0);
    if (maxItems > 0 && maxItems < plan.items.length) {
      plan.items = plan.items.slice(0, maxItems);
      plan.wanted = maxItems;
    }
    return { city, density, seed, gyms, poolInfo, plan };
  }

  function publicPreview(ctx) {
    const usedOpenids = new Set();
    ctx.plan.items.forEach((it) => {
      usedOpenids.add(it.hostOpenid);
      it.memberOpenids.forEach((x) => usedOpenids.add(x));
    });
    return {
      city: ctx.city,
      density: ctx.plan.density,
      seed: ctx.seed,
      window: ctx.plan.window,
      target: ctx.plan.target,
      existing: ctx.plan.existing,
      wanted: ctx.plan.wanted,
      toCreate: ctx.plan.items.length,
      shortage: ctx.plan.shortage,
      reasons: ctx.plan.reasons,
      gymCount: ctx.gyms.length,
      poolAllocated: ctx.poolInfo.allocated.length,
      poolFree: ctx.poolInfo.free.length,
      poolUsed: usedOpenids.size,
      items: ctx.plan.items.map((it) => ({
        seq: it.seq, date: it.date, timeSlots: it.timeSlots, gymId: it.gymId,
        gymName: it.gymSnapshot.name, capacity: it.capacity, title: it.title, skillTags: it.skillTags
      }))
    };
  }

  async function preview(event) {
    const ctx = await prepareContext(event);
    return publicPreview(ctx);
  }

  // ---------- 单场满员事务 ----------
  function snapshotOf(poolMap, openid) {
    const u = poolMap.get(openid) || {};
    return {
      nickName: u.nickName || "岩友",
      avatarUrl: u.avatarUrl || "",
      displayName: u.displayName || u.nickName || "岩友",
      title: "",
      rockId: ""
    };
  }

  function joinIdFor(planId, openid) {
    return "j_" + sha32(planId + "|" + openid);
  }

  async function writeOnePlan({ runDoc, item, poolMap, stamp }) {
    const t = stamp;
    const host = item.hostOpenid;
    const requestId = `demoplan|${runDoc._id}|${item.seq}`;
    const planId = "p_" + sha32(host + "|" + requestId);
    const candidate = schedule.normalizeNewSlots(item.date, item.timeSlots);
    const members = item.memberOpenids;
    const plan = {
      schemaVersion: 2, joinSchemaVersion: 2,
      title: item.title, capacity: item.capacity, joinMode: item.joinMode,
      timeSlots: item.timeSlots, atmosphereTags: item.atmosphereTags || [],
      meetingPoint: item.meetingPoint || "", contact: item.contact || "",
      startAt: candidate.startAt, endAt: candidate.endAt, joinDeadline: candidate.startAt,
      cityKey: runDoc.cityKey, confirmedCount: item.capacity, isFull: true,
      participantIds: [host].concat(members), version: 1,
      uid: host, openid: host, _openid: host,
      userSnapshot: snapshotOf(poolMap, host),
      gymId: item.gymId, gymSnapshot: item.gymSnapshot,
      mode: "gym", outdoorName: "",
      date: item.date, startTime: candidate.startTime, endTime: candidate.endTime,
      durationMin: candidate.durationMin,
      visibility: "public", circleIds: [], note: item.note || "", needPartner: false,
      skillTags: item.skillTags, status: "active", checkinRecordId: "",
      // 演示内部字段（不进入任何公开投影）：来源、只读策略、可精确清理的批次归属
      dataOrigin: "demo", participationPolicy: "read_only_demo",
      datasetId: runDoc.datasetId, runId: runDoc._id,
      demoBatchId: `${runDoc._id}#${item.seq}`,
      requestFingerprint: `demo|${runDoc._id}|${item.seq}`,
      createdAt: t, updatedAt: t,
      created_at: db.serverDate(), updated_at: db.serverDate()
    };
    let existed = false;
    await schedule.withRetries(() => db.runTransaction(async (tx) => {
      const planRef = tx.collection("RockCalendarPlans").doc(planId);
      const previous = await schedule.optionalTxDoc(planRef);
      if (previous) { existed = true; return; }
      // 发起人占用（status=host，与正常发布完全一致）
      const hostDays = await schedule.occupy(tx, {
        openid: host, planId, status: "host", candidate, now: t, conflictOptions: { includePlanId: true }
      });
      await schedule.commitDayWrites(hostDays);
      // 其余成员：confirmed 报名行 + 日程占用，同一事务提交
      for (const memberOpenid of members) {
        const days = await schedule.occupy(tx, {
          openid: memberOpenid, planId, status: "confirmed", candidate, now: t,
          conflictOptions: { includePlanId: true }
        });
        await schedule.commitDayWrites(days);
        await tx.collection("RockCalendarJoins").doc(joinIdFor(planId, memberOpenid)).set({
          data: {
            planId, openid: memberOpenid, _openid: memberOpenid, uid: memberOpenid,
            planOwnerOpenid: host, date: item.date, status: "confirmed",
            userSnapshot: snapshotOf(poolMap, memberOpenid),
            createdAt: t, updatedAt: t, created_at: db.serverDate(), updated_at: db.serverDate()
          }
        });
      }
      await planRef.set({ data: plan });
    }));
    return { planId, existed };
  }

  function runSummary(doc) {
    return {
      runId: doc._id, city: doc.city, status: doc.status, density: doc.density,
      seed: doc.seed, window: { start: doc.windowStart, end: doc.windowEnd },
      target: doc.target, existing: doc.existing, wanted: doc.wanted,
      created: doc.created, existed: doc.existed, skipped: doc.skipped, failed: doc.failed,
      cursor: doc.cursor, total: doc.items.length,
      planIds: doc.planIds || [], errors: doc.errors || [], updatedAt: doc.updatedAt,
      cleanupCursor: doc.cleanupCursor || 0,
      cleanupStats: doc.cleanupStats || null,
      cleanupAnomalies: doc.cleanupAnomalies || [],
      cleanedAt: doc.cleanedAt || 0
    };
  }

  // ---------- 建任务 ----------
  async function generate(event, actor) {
    // 幂等：同一 idempotencyKey 直接返回原任务，且必须早于“补差额”规划（避免已完成任务被判成无事可做）
    let idemKey = safeText(event.idempotencyKey);
    if (idemKey) {
      const dupId = "dr_" + sha32(idemKey).slice(0, 24);
      const dup = await db.collection("RockDemoRuns").doc(dupId).get().catch(() => null);
      if (dup && dup.data) return runSummary(dup.data);
    }

    const ctx = await prepareContext(event);
    if (!ctx.gyms.length) throw Object.assign(new Error("该城市暂无可发布的岩馆"), { code: "NO_GYM" });
    if (!ctx.plan.items.length) throw Object.assign(new Error("没有可补充的场次（可能已达密度目标或用户池不足）"), { code: "NOTHING_TO_DO" });

    // 领取本任务实际使用到的未分配模拟用户（城市是模拟用户的稳定属性，不复制头像/资料）
    const used = new Set();
    ctx.plan.items.forEach((it) => {
      used.add(it.hostOpenid);
      it.memberOpenids.forEach((x) => used.add(x));
    });
    const freeMap = new Map(ctx.poolInfo.free.map((u) => [u.openid, u]));
    const claim = [...used].filter((id) => freeMap.has(id));
    for (let i = 0; i < claim.length; i++) {
      await db.collection("RockUsers").doc(freeMap.get(claim[i])._id).update({
        data: { demoCity: ctx.city, city: ctx.city, demoAllocated: true, updatedAt: now() }
      });
    }

    if (!idemKey) idemKey = "idem-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
    const runId = "dr_" + sha32(idemKey).slice(0, 24);
    const t = now();
    const doc = {
      _id: runId,
      datasetId: ctx.plan.datasetId,
      generatorVersion: ctx.plan.generatorVersion,
      assetVersion: ctx.plan.assetVersion,
      city: ctx.city, cityKey: ctx.city,
      seed: ctx.seed, density: ctx.plan.density,
      windowStart: ctx.plan.window.start, windowEnd: ctx.plan.window.end,
      target: ctx.plan.target, existing: ctx.plan.existing, wanted: ctx.plan.wanted,
      items: ctx.plan.items,
      cursor: 0, created: 0, existed: 0, skipped: ctx.plan.shortage, failed: 0,
      planIds: [], errors: [],
      status: "running", idempotencyKey: idemKey,
      createdBy: actor && actor.openid ? actor.openid : (actor && actor.kind) || "admin",
      leaseOwner: "", leaseVersion: 0, leaseExpiresAt: 0,
      createdAt: t, updatedAt: t
    };
    await db.collection("RockDemoRuns").doc(runId).set({ data: doc });
    await processBatch(runId, actor);
    const fresh = (await db.collection("RockDemoRuns").doc(runId).get()).data;
    return runSummary(fresh);
  }

  // ---------- 分批落库 + 租约 ----------
  async function processBatch(runId, actor) {
    const ref = db.collection("RockDemoRuns").doc(runId);
    const got = await ref.get().catch(() => null);
    const runDoc = got && got.data ? got.data : null;
    if (!runDoc) throw Object.assign(new Error("任务不存在"), { code: "NOT_FOUND" });
    // 非 running 均为生成终态（done/cleaning 中断/cleaned），续跑不得复活已被清理的计划
    if (runDoc.status !== "running") return runSummary(runDoc);

    const t = now();
    const owner = (actor && actor.openid) || actor.kind || "cloud";
    if (runDoc.leaseExpiresAt && runDoc.leaseExpiresAt > t && runDoc.leaseOwner !== owner) {
      throw Object.assign(new Error("任务正在其他调用中执行"), { code: "LEASE_BUSY" });
    }
    const leaseVersion = Number(runDoc.leaseVersion || 0) + 1;
    await ref.update({ data: { leaseOwner: owner, leaseVersion, leaseExpiresAt: t + LEASE_MS, updatedAt: t } });

    // 池资料（城市池在 generate 时已领取；续跑时重新读取，兼容 provision 修复）
    const users = await listAll("RockUsers", { accountType: "demo" });
    const poolMap = new Map();
    users.forEach((u) => {
      const id = u.openid || u._openid || u.uid || "";
      if (id) poolMap.set(id, u);
    });

    const items = Array.isArray(runDoc.items) ? runDoc.items : [];
    let cursor = Number(runDoc.cursor || 0);
    let created = Number(runDoc.created || 0);
    let existed = Number(runDoc.existed || 0);
    let failed = Number(runDoc.failed || 0);
    const planIds = (runDoc.planIds || []).slice();
    const errors = (runDoc.errors || []).slice();
    const stamp = runDoc.createdAt || t;

    const end = Math.min(items.length, cursor + BATCH_PLANS);
    for (let i = cursor; i < end; i++) {
      const item = items[i];
      try {
        const r = await writeOnePlan({ runDoc, item, poolMap, stamp });
        if (r.existed) existed += 1; else created += 1;
        if (planIds.indexOf(r.planId) < 0) planIds.push(r.planId);
      } catch (e) {
        failed += 1;
        errors.push({ seq: item.seq, code: e.code || "PLAN_WRITE_FAILED", message: e.errMsg || e.message || String(e) });
        if (errors.length > MAX_ERRORS) errors.shift();
      }
      cursor = i + 1;
    }

    const done = cursor >= items.length;
    // 事务提交后重新取引用（事务内集合快照会更替）
    const tailRef = db.collection("RockDemoRuns").doc(runId);
    await tailRef.update({
      data: {
        cursor, created, existed, failed, planIds, errors,
        status: done ? "done" : "running",
        leaseOwner: done ? "" : owner,
        leaseExpiresAt: done ? 0 : now() + LEASE_MS,
        updatedAt: now()
      }
    });
    const fresh = (await db.collection("RockDemoRuns").doc(runId).get()).data;
    return runSummary(fresh);
  }

  async function generateContinue(runId, actor) {
    return processBatch(safeText(runId), actor);
  }

  async function status(runId) {
    const got = await db.collection("RockDemoRuns").doc(safeText(runId)).get().catch(() => null);
    if (!got || !got.data) throw Object.assign(new Error("任务不存在"), { code: "NOT_FOUND" });
    return runSummary(got.data);
  }

  async function listRuns(city) {
    const where = city ? { datasetId: profileMod.DATASET_ID, cityKey: city } : { datasetId: profileMod.DATASET_ID };
    const docs = await listAll("RockDemoRuns", where);
    return docs.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 20).map(runSummary);
  }

  // ---------- 一键隐藏：所有公开投影立即停止返回演示局（真实用户旧链接同样 NOT_FOUND） ----------
  async function setVisibility(visible, actor) {
    const t = now();
    const ref = db.collection("RockAppConfig").doc("demo");
    const got = await ref.get().catch(() => null);
    const payload = {
      showAll: !!visible, updatedAt: t,
      updatedBy: (actor && (actor.openid || actor.kind)) || "admin"
    };
    if (got && got.data) await ref.update({ data: payload });
    else await ref.set({ data: payload });
    guard.resetShowCache();
    return { showAll: !!visible, cacheNote: "其他云函数实例的读取缓存最长 20 秒后全部生效" };
  }

  // 删除单场：报名行 → 日程占用 → 计划文档，并显式复核占用无残留。
  // 硬隔离：dataOrigin/datasetId 不符直接拒绝，绝不按 id 盲删。
  async function removeOneDemoPlan(planId, stamp) {
    const pgot = await db.collection("RockCalendarPlans").doc(planId).get().catch(() => null);
    const plan = pgot && pgot.data;
    if (!plan) return { planId, missingPlan: true, joinsRemoved: 0, occupied: 0, leftovers: [] };
    if (plan.dataOrigin !== "demo" || plan.datasetId !== profileMod.DATASET_ID) {
      throw Object.assign(new Error("目标计划不是本数据集的演示数据，已拒绝清理"), { code: "SCOPE_GUARD" });
    }
    const joins = await listAll("RockCalendarJoins", { planId });
    for (const j of joins) {
      await db.collection("RockCalendarJoins").doc(j._id).remove();
    }
    const participants = Array.from(new Set(
      [plan.openid].concat(plan.participantIds || []).filter(Boolean)
    ));
    await schedule.cleanupPlanOccupancy(db, plan, participants, stamp);
    const leftovers = [];
    let cand = null;
    try { cand = schedule.candidateFromPlan(plan); } catch (e) { cand = null; }
    if (cand) {
      const dates = Object.keys(cand.byDate);
      for (const openid of participants) {
        for (const date of dates) {
          const d = await db.collection("RockUserScheduleDays")
            .doc(schedule.dayDocId(openid, date)).get().catch(() => null);
          if (d && d.data && Array.isArray(d.data.entries) &&
              d.data.entries.some((e) => e && e.planId === planId)) {
            leftovers.push(openid + "@" + date);
          }
        }
      }
    }
    await db.collection("RockCalendarPlans").doc(planId).remove();
    return { planId, missingPlan: false, joinsRemoved: joins.length, occupied: participants.length, leftovers };
  }

  // 按 runId 精确清理（可续跑）。RockUsers/RockDemoAssets 为跨城市共享素材，永不删。
  async function cleanup(event, actor) {
    const runId = safeText(event.runId);
    if (!runId) throw Object.assign(new Error("缺少 runId"), { code: "BAD_REQUEST" });
    if (event.confirm !== true) {
      throw Object.assign(new Error("清理不可逆，需要二次确认 confirm:true"), { code: "CONFIRM_REQUIRED" });
    }
    const ref = db.collection("RockDemoRuns").doc(runId);
    const got = await ref.get().catch(() => null);
    const runDoc = got && got.data;
    if (!runDoc) throw Object.assign(new Error("任务不存在"), { code: "NOT_FOUND" });
    if (runDoc.status === "running") {
      throw Object.assign(new Error("任务仍在生成中，完成后再清理"), { code: "RUN_ACTIVE" });
    }
    const planIds = Array.isArray(runDoc.planIds) ? runDoc.planIds : [];
    const stats = Object.assign(
      { plansRemoved: 0, joinsRemoved: 0, missingPlans: 0, occupancyReleased: 0 },
      runDoc.cleanupStats || {}
    );
    const anomalies = (runDoc.cleanupAnomalies || []).slice();
    let cursor = Number(runDoc.cleanupCursor || 0);
    const stamp = now();
    const end = Math.min(planIds.length, cursor + CLEANUP_PLANS);
    for (; cursor < end; cursor++) {
      const planId = planIds[cursor];
      try {
        const r = await removeOneDemoPlan(planId, stamp);
        if (r.missingPlan) stats.missingPlans += 1;
        else {
          stats.plansRemoved += 1;
          stats.joinsRemoved += r.joinsRemoved;
          stats.occupancyReleased += r.occupied;
        }
        (r.leftovers || []).forEach((x) => anomalies.push({ planId, kind: "OCCUPANCY_LEFT", target: x }));
      } catch (e) {
        anomalies.push({ planId, kind: e.code || "CLEANUP_FAILED", message: e.errMsg || e.message || String(e) });
      }
    }
    const done = cursor >= planIds.length;
    const tailRef = db.collection("RockDemoRuns").doc(runId);
    const payload = {
      cleanupCursor: cursor, cleanupStats: stats, cleanupAnomalies: anomalies,
      status: done ? "cleaned" : "cleaning", updatedAt: stamp
    };
    if (done) {
      payload.cleanedAt = stamp;
      payload.cleanedBy = (actor && (actor.openid || actor.kind)) || "admin";
    }
    await tailRef.update({ data: payload });
    const fresh = (await db.collection("RockDemoRuns").doc(runId).get()).data;
    return runSummary(fresh);
  }

  return { preview, generate, generateContinue, status, listRuns, processBatch, setVisibility, cleanup, BATCH_PLANS };
}

module.exports = { createRunApi, normalizeCity, BATCH_PLANS };
