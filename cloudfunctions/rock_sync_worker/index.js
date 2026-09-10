const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const BOOTSTRAP_ADMIN_IDS = ["42098a0769e3423400183ddf36230f95"];

const {
  safeText,
  uniqueTexts,
  DEFAULT_SYNC_KEYWORDS,
  normalizePoi,
  buildSourceLinkId
} = require("../rock_sync_gyms/normalize");
const { findExistingGym } = require("../rock_sync_gyms/match");
const {
  buildNewGymDoc,
  buildGymPatch,
  saveSourceRecord,
  shouldQueueReview,
  saveReviewQueue
} = require("../rock_sync_gyms/write");
const { fetchTencentSearch, sleep, REQUEST_INTERVAL_MS } = require("../rock_sync_gyms/provider");

const LEASE_DURATION_MS = 120000; // 2 分钟租约
const MAX_RETRIES = 3;
const SHARD_BATCH_SIZE = 10; // 每次写入批大小

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid) {
  return { ok: false, error: { code, message }, traceId: tid };
}

function isBootstrapAdminId(value) {
  return BOOTSTRAP_ADMIN_IDS.includes(String(value == null ? "" : value).trim());
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
  if (!user) return false;
  return user.role === "admin" || user.isAdmin === true;
}

function isTrustedServerCall(wxctx, event) {
  const source = safeText(wxctx && wxctx.SOURCE);
  if (source === "云函数" && !wxctx.OPENID) return true;
  if (event && event.__serverDispatch === true && !wxctx.OPENID) return true;
  return false;
}

/**
 * 领取一个待处理分片。
 * 条件：status=queued 或 (status=processing 且 leaseExpiresAt < now)。
 * 原子更新：设置 status=processing, leaseOwner, leaseExpiresAt, leaseVersion。
 */
async function acquireShard(workerId) {
  const now = Date.now();
  const col = db.collection("RockGymSyncShards");

  // 查询一个可领取的分片
  const res = await col
    .where(
      _.or([
        { status: "queued" },
        _.and([{ status: "processing" }, { leaseExpiresAt: _.lt(now) }])
      ])
    )
    .orderBy("priority", "asc")
    .orderBy("createdAt", "asc")
    .limit(1)
    .get();

  if (!res || !res.data || !res.data.length) return null;

  const shard = res.data[0];
  const leaseExpiresAt = now + LEASE_DURATION_MS;
  const leaseVersion = Number(shard.leaseVersion || 0) + 1;

  // 带版本比较的更新（fencing token）
  try {
    await col.doc(shard._id).update({
      data: {
        status: "processing",
        leaseOwner: workerId,
        leaseExpiresAt,
        leaseVersion,
        updatedAt: now
      }
    });
    return { ...shard, leaseVersion };
  } catch (e) {
    return null; // 并发抢占失败
  }
}

async function updateShardProgress(shardId, patch) {
  await db.collection("RockGymSyncShards").doc(shardId).update({
    data: { ...patch, updatedAt: Date.now() }
  });
}

async function finishShard(shardId, status, stats) {
  await db.collection("RockGymSyncShards").doc(shardId).update({
    data: {
      status,
      leaseOwner: "",
      leaseExpiresAt: 0,
      finishedAt: Date.now(),
      stats: stats || {},
      updatedAt: Date.now()
    }
  });
}

async function processShard(db, shard, runId, action) {
  const now = Date.now();
  const stats = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    reviewQueued: 0,
    failed: 0
  };

  const apiKey = safeText(process.env.TENCENT_MAP_KEY);
  if (!apiKey) throw Object.assign(new Error("未配置 TENCENT_MAP_KEY"), { code: "MAP_KEY_MISSING" });

  const city = safeText(shard.city);
  const keyword = safeText(shard.keyword);
  const page = Number(shard.page) || 1;
  const pageSize = Number(shard.pageSize) || 10;

  let response;
  try {
    response = await fetchTencentSearch(apiKey, city, keyword, page, pageSize);
  } catch (e) {
    stats.failed += 1;
    throw e;
  }

  const list = Array.isArray(response.data) ? response.data : [];
  stats.fetched = list.length;

  // 归一化并去重（同批内）
  const seen = {};
  const items = [];
  list.forEach((poi) => {
    const key = safeText(poi && poi.id);
    if (!key || seen[key]) return;
    seen[key] = true;
    const normalized = normalizePoi(poi, { city, keyword });
    if (normalized.relevanceDecision === "rejected") return;
    items.push(normalized);
  });

  // 逐批处理（每批 SHARD_BATCH_SIZE 条）
  for (let i = 0; i < items.length; i += SHARD_BATCH_SIZE) {
    const batch = items.slice(i, i + SHARD_BATCH_SIZE);
    for (const item of batch) {
      try {
        const result = await processItem(db, item, shard.batchId, runId, action);
        if (result.action === "insert") stats.inserted += 1;
        if (result.action === "update") stats.updated += 1;
        if (result.action === "skip") stats.skipped += 1;
        if (result.action === "review") stats.reviewQueued += 1;
      } catch (e) {
        stats.failed += 1;
      }
    }
    // 批间短暂让步
    await sleep(50);
  }

  return stats;
}

// 复用 rock_sync_gyms 的 processItem 逻辑
async function processItem(db, item, batchId, runId, action) {
  const now = Date.now();
  const match = await findExistingGym(db, item);

  if (match.action === "skip") {
    await saveSourceRecord(db, item, batchId, runId, "skipped", match.gym && match.gym._id);
    return { action: "skip", score: match.score || 0, reason: match.reason || "" };
  }

  if (match.action === "review") {
    if (action === "apply") {
      await saveSourceRecord(db, item, batchId, runId, "pending_review", "");
      await saveReviewQueue(db, item, batchId, runId, { action: "review", score: 0, reason: match.reason });
      return { action: "review" };
    }
    return { action: "would_review" };
  }

  if (match.action === "insert") {
    if (item.relevanceDecision !== "accepted") {
      if (action === "apply") {
        await saveSourceRecord(db, item, batchId, runId, "pending_review", "");
        await saveReviewQueue(db, item, batchId, runId, { action: "review", score: 0, reason: item.relevanceReason });
        return { action: "review" };
      }
      return { action: "would_review" };
    }
    if (action === "apply") {
      const doc = buildNewGymDoc(item, batchId, now);
      const linkId = buildSourceLinkId(item.provider, item.providerPoiId);
      const tx = await db.startTransaction();
      let gymId = "";
      try {
        const addRes = await tx.collection("RockGyms").add({ data: doc });
        gymId = addRes && addRes._id ? addRes._id : "";
        await tx.collection("RockGymSourceLinks").doc(linkId).set({
          data: { provider: item.provider, providerPoiId: item.providerPoiId, gymId, status: "active", createdAt: now, updatedAt: now }
        });
        await tx.commit();
      } catch (e) {
        try { await tx.rollback(); } catch (rb) {}
        throw e;
      }
      await saveSourceRecord(db, item, batchId, runId, "inserted", gymId);
      if (shouldQueueReview(item, { action: "insert" })) {
        await saveReviewQueue(db, item, batchId, runId, { action: "insert", gymId, score: 0 });
      }
      return { action: "insert", gymId };
    }
    return { action: "would_insert" };
  }

  // merge
  if (action === "apply") {
    const patch = buildGymPatch(match.gym, item, batchId, now);
    const gymId = String(match.gym._id);
    const linkId = buildSourceLinkId(item.provider, item.providerPoiId);
    const tx = await db.startTransaction();
    try {
      await tx.collection("RockGyms").doc(gymId).update({ data: patch });
      await tx.collection("RockGymSourceLinks").doc(linkId).set({
        data: { provider: item.provider, providerPoiId: item.providerPoiId, gymId, status: "active", updatedAt: now }
      });
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (rb) {}
      throw e;
    }
    await saveSourceRecord(db, item, batchId, runId, "updated", gymId);
    if (shouldQueueReview(item, { action: "update", score: match.score, reason: match.reason })) {
      await saveReviewQueue(db, item, batchId, runId, { action: "update", gymId, score: match.score, reason: match.reason });
    }
    return { action: "update", gymId };
  }
  return { action: "would_update" };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const trustedServer = isTrustedServerCall(wxctx, event);
    if (!trustedServer && !(await isAdmin(wxctx.OPENID))) {
      return fail("FORBIDDEN", "无权限", tid);
    }

    const workerId = safeText(event && event.workerId) || `worker_${Date.now()}`;
    const action = safeText(event && event.action) || "apply";
    const maxShards = Math.max(1, Math.min(20, Number(event && event.maxShards) || 5));

    let processed = 0;
    const results = [];

    for (let i = 0; i < maxShards; i++) {
      const shard = await acquireShard(workerId);
      if (!shard) break;

      const runId = safeText(shard.runId);
      try {
        const stats = await processShard(db, shard, runId, action);
        await finishShard(shard._id, "completed", stats);
        results.push({ shardId: shard._id, status: "completed", stats });
      } catch (e) {
        const retryCount = Number(shard.retryCount || 0) + 1;
        if (retryCount >= MAX_RETRIES) {
          await finishShard(shard._id, "failed", { error: e && e.message });
        } else {
          const nextRetryAt = Date.now() + Math.pow(2, retryCount) * 1000;
          await updateShardProgress(shard._id, {
            status: "retry_wait",
            retryCount,
            nextRetryAt,
            lastError: e && e.message
          });
        }
        results.push({ shardId: shard._id, status: retryCount >= MAX_RETRIES ? "failed" : "retry_wait", error: e && e.message });
      }
      processed += 1;
    }

    return ok({ workerId, processed, results }, tid);
  } catch (e) {
    return fail(e && e.code ? e.code : "WORKER_FAILED", e && e.message ? e.message : "worker 执行失败", tid);
  }
};
