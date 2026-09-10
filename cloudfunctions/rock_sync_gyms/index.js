const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const {
  safeText,
  clampInt,
  uniqueTexts,
  DEFAULT_SYNC_KEYWORDS,
  normalizePoi,
  buildSourceLinkId
} = require("./normalize");
const { findExistingGym } = require("./match");
const {
  buildNewGymDoc,
  buildGymPatch,
  saveSourceRecord,
  shouldQueueReview,
  saveReviewQueue
} = require("./write");
const { fetchTencentSearch, sleep, REQUEST_INTERVAL_MS } = require("./provider");

const BOOTSTRAP_ADMIN_IDS = ["42098a0769e3423400183ddf36230f95"];

// 支持的 action 枚举：preview（预览）/ apply（正式写入）/ dispatch（创建分片供 worker 领取）
const VALID_ACTIONS = ["preview", "apply", "dispatch"];

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

/**
 * 判断是否为可信的服务端调度调用。
 * 云函数间调用时 wxctx.SOURCE 为 "云函数"，且不应有普通用户 OPENID。
 * 这里仅做基础校验，真正的服务身份隔离需在部署时通过云函数调用权限配置。
 */
function isTrustedServerCall(wxctx, event) {
  const source = safeText(wxctx && wxctx.SOURCE);
  // 云函数内部调用（SCF 触发）且无客户端 OPENID
  if (source === "云函数" && !wxctx.OPENID) return true;
  // 显式服务端调度标记（由内部调度函数传入，普通客户端无法构造可信来源）
  if (event && event.__serverDispatch === true && !wxctx.OPENID) return true;
  return false;
}

async function createSyncRun(batchId, meta) {
  const payload = {
    batchId,
    provider: safeText(meta && meta.provider),
    triggerType: safeText(meta && meta.triggerType) || "manual",
    action: safeText(meta && meta.action) || "preview",
    scope: meta && meta.scope ? meta.scope : {},
    stats: {
      requests: 0,
      fetched: 0,
      unique: 0,
      filteredIrrelevant: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      reviewQueued: 0,
      wouldInsert: 0,
      wouldUpdate: 0,
      wouldReview: 0,
      sourceSaved: 0
    },
    startedAt: Date.now(),
    finishedAt: 0,
    success: false,
    errorMessage: "",
    triggeredByOpenid: safeText(meta && meta.openid)
  };
  const res = await db.collection("RockGymSyncRuns").add({ data: payload });
  return { _id: res && res._id ? res._id : "", data: payload };
}

async function finishSyncRun(runId, patch) {
  if (!runId) return;
  await db.collection("RockGymSyncRuns").doc(runId).update({
    data: {
      finishedAt: Date.now(),
      success: !!(patch && patch.success),
      errorMessage: safeText(patch && patch.errorMessage),
      stats: (patch && patch.stats) || {},
      updatedAt: Date.now()
    }
  });
}

function buildSourceLinkIdFromItem(item) {
  return buildSourceLinkId(item.provider, item.providerPoiId);
}

function buildBatchId(provider) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${safeText(provider) || "sync"}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 处理单个候选：匹配 → 决定 → 写入/审核。
 * action = preview 时只计算变更，不写 RockGyms。
 */
async function processItem(db, item, batchId, runId, action) {
  const now = Date.now();
  const match = await findExistingGym(db, item);

  if (match.action === "skip") {
    await saveSourceRecord(db, item, batchId, runId, "skipped", match.gym && match.gym._id);
    return {
      action: "skip",
      gymId: match.gym && match.gym._id ? String(match.gym._id) : "",
      score: match.score || 0,
      reason: match.reason || ""
    };
  }

  if (match.action === "review") {
    // 实体存疑或匹配不确定 → 进审核，不自动建馆
    if (action === "apply") {
      const sourceRecordId = await saveSourceRecord(db, item, batchId, runId, "pending_review", "");
      try {
        await saveReviewQueue(db, item, batchId, runId, { action: "review", score: 0, reason: match.reason });
      } catch (e) {
        // 审核入队失败不吞，回写来源记录状态
        await saveSourceRecord(db, item, batchId, runId, "review_queue_failed", "");
        throw e;
      }
      return {
        action: "review",
        sourceRecordId,
        reason: match.reason || "needs_review",
        score: 0
      };
    }
    return { action: "would_review", reason: match.reason || "needs_review", score: 0 };
  }

  if (match.action === "insert") {
    // 实体存疑（非 accepted）不自动建馆，进审核队列
    if (item.relevanceDecision !== "accepted") {
      if (action === "apply") {
        await saveSourceRecord(db, item, batchId, runId, "pending_review", "");
        try {
          await saveReviewQueue(db, item, batchId, runId, { action: "review", score: 0, reason: item.relevanceReason });
        } catch (e) {
          await saveSourceRecord(db, item, batchId, runId, "review_queue_failed", "");
          throw e;
        }
        return { action: "review", reason: item.relevanceReason || "entity_needs_review", score: 0 };
      }
      return { action: "would_review", reason: item.relevanceReason || "entity_needs_review", score: 0 };
    }
    if (action === "apply") {
      const doc = buildNewGymDoc(item, batchId, now);
      const linkId = buildSourceLinkIdFromItem(item);
      // 事务：原子创建主馆与来源映射
      const tx = await db.startTransaction();
      let gymId = "";
      try {
        const addRes = await tx.collection("RockGyms").add({ data: doc });
        gymId = addRes && addRes._id ? addRes._id : "";
        const linkDoc = {
          provider: item.provider,
          providerPoiId: item.providerPoiId,
          gymId,
          status: "active",
          createdAt: now,
          updatedAt: now
        };
        await tx.collection("RockGymSourceLinks").doc(linkId).set({ data: linkDoc });
        await tx.commit();
      } catch (e) {
        try {
          await tx.rollback();
        } catch (rbErr) {}
        throw e;
      }
      await saveSourceRecord(db, item, batchId, runId, "inserted", gymId);
      // 模式未识别仍需审核（但实体已确认，馆已创建并对用户可见）
      if (shouldQueueReview(item, { action: "insert" })) {
        await saveReviewQueue(db, item, batchId, runId, { action: "insert", gymId, score: 0 });
      }
      return { action: "insert", gymId, score: 0 };
    }
    return { action: "would_insert", score: 0 };
  }

  // action === "merge" → 更新已有馆
  if (action === "apply") {
    const patch = buildGymPatch(match.gym, item, batchId, now);
    const gymId = String(match.gym._id);
    const linkId = buildSourceLinkIdFromItem(item);
    // 事务：原子更新主馆与来源映射
    const tx = await db.startTransaction();
    try {
      await tx.collection("RockGyms").doc(gymId).update({ data: patch });
      await tx.collection("RockGymSourceLinks").doc(linkId).set({
        data: {
          provider: item.provider,
          providerPoiId: item.providerPoiId,
          gymId,
          status: "active",
          updatedAt: now
        }
      });
      await tx.commit();
    } catch (e) {
      try {
        await tx.rollback();
      } catch (rbErr) {}
      throw e;
    }
    await saveSourceRecord(db, item, batchId, runId, "updated", gymId);
    if (shouldQueueReview(item, { action: "update", score: match.score, reason: match.reason })) {
      await saveReviewQueue(db, item, batchId, runId, {
        action: "update",
        gymId,
        score: match.score,
        reason: match.reason
      });
    }
    return {
      action: "update",
      gymId,
      score: match.score,
      reason: match.reason || "",
      matchedGymId: match.matchedGymId || "",
      matchedGymName: safeText(match.gym && (match.gym.name || match.gym.gymName || match.gym.title))
    };
  }
  return {
    action: "would_update",
    gymId: String(match.gym._id),
    score: match.score,
    reason: match.reason || ""
  };
}

exports.main = async (event) => {
  const tid = traceId();
  let syncRunId = "";
  let stats = {
    requests: 0,
    fetched: 0,
    unique: 0,
    filteredIrrelevant: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    reviewQueued: 0,
    wouldInsert: 0,
    wouldUpdate: 0,
    wouldReview: 0,
    sourceSaved: 0,
    skipReasons: {}
  };
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const trustedServer = isTrustedServerCall(wxctx, event);

    // 权限：管理员 或 可信服务端调度
    if (!trustedServer && !(await isAdmin(openid))) {
      return fail("FORBIDDEN", "无权限", tid);
    }

    const provider = safeText(event && event.provider) || "tencent";
    if (provider !== "tencent") {
      return fail("UNSUPPORTED_PROVIDER", "当前仅支持腾讯位置服务", tid);
    }

    const apiKey = safeText(process.env.TENCENT_MAP_KEY) || safeText(event && event.apiKey);
    if (!apiKey) {
      return fail("MAP_KEY_MISSING", "未配置 TENCENT_MAP_KEY", tid);
    }

    // 严格 action 枚举，禁止用真值转换
    const rawAction = safeText(event && event.action);
    const legacyWrite = event && event.write === true;
    const action = VALID_ACTIONS.includes(rawAction) ? rawAction : legacyWrite ? "apply" : "preview";
    const isApply = action === "apply";

    const city = safeText(event && event.city) || safeText(Array.isArray(event && event.cities) ? event.cities[0] : "") || "北京市";
    const keywords = uniqueTexts((event && event.keywords) || [event && event.keyword || ""]).length
      ? uniqueTexts((event && event.keywords) || [event && event.keyword || ""])
      : DEFAULT_SYNC_KEYWORDS.slice(0);
    const pageLimit = clampInt(event && event.pageLimit, 1, 20, 1);
    const pageSize = clampInt(event && event.pageSize, 1, 20, 10);
    const batchId = safeText(event && event.batchId) || buildBatchId(provider);

    if (!city) return fail("BAD_REQUEST", "缺少城市", tid);
    if (!keywords.length) return fail("BAD_REQUEST", "缺少关键词", tid);

    const triggerType = trustedServer ? safeText(event && event.triggerType) || "scheduled" : "manual";

    const run = await createSyncRun(batchId, {
      provider,
      triggerType,
      action,
      scope: { city, keywords, pageLimit, pageSize, requestIntervalMs: REQUEST_INTERVAL_MS },
      openid: trustedServer ? "" : openid
    });
    syncRunId = run._id;

    // dispatch：只创建分片，不执行抓取，由 worker 领取处理
    if (action === "dispatch") {
      const shardCol = db.collection("RockGymSyncShards");
      const now = Date.now();
      let shardCount = 0;
      for (let ki = 0; ki < keywords.length; ki++) {
        for (let p = 1; p <= pageLimit; p++) {
          const shard = {
            runId: syncRunId,
            batchId,
            provider,
            city,
            keyword: keywords[ki],
            page: p,
            pageSize,
            status: "queued",
            retryCount: 0,
            leaseOwner: "",
            leaseExpiresAt: 0,
            leaseVersion: 0,
            priority: ki * 100 + p,
            createdAt: now,
            updatedAt: now
          };
          await shardCol.add({ data: shard });
          shardCount += 1;
        }
      }
      await finishSyncRun(syncRunId, { success: true, stats: { ...stats, shardCount } });
      return ok({ provider, batchId, action: "dispatch", runId: syncRunId, shardCount, city, keywords, pageLimit }, tid);
    }

    const requests = [];
    const seen = {};
    const filteredSeen = {};
    let requestCount = 0;
    let truncated = false;

    for (let j = 0; j < keywords.length; j++) {
      const keyword = keywords[j];
      for (let page = 1; page <= pageLimit; page++) {
        if (requestCount > 0) await sleep(REQUEST_INTERVAL_MS);
        const response = await fetchTencentSearch(apiKey, city, keyword, page, pageSize);
        requestCount += 1;
        const list = Array.isArray(response.data) ? response.data : [];
        stats.fetched += list.length;
        requests.push({
          city,
          keyword,
          page,
          count: list.length
        });
        list.forEach((poi) => {
          const key = safeText(poi && poi.id);
          if (!key) return;
          const normalized = normalizePoi(poi, { city, keyword });
          if (normalized.relevanceDecision === "rejected") {
            if (!filteredSeen[key]) {
              filteredSeen[key] = normalized;
              stats.filteredIrrelevant += 1;
            }
            return;
          }
          if (seen[key]) {
            // 合并 provenance：同 POI 多关键词命中
            const existing = seen[key];
            existing._provenance = existing._provenance || [existing.sourceKeyword];
            if (!existing._provenance.includes(keyword)) existing._provenance.push(keyword);
            return;
          }
          seen[key] = normalized;
        });
        // 触及分页上限时标记截断
        if (list.length >= pageSize && page >= pageLimit) {
          truncated = true;
        }
        if (list.length < pageSize) break;
      }
    }

    const items = Object.keys(seen).map((key) => seen[key]);
    stats.requests = requests.length;
    stats.unique = items.length;

    const writeResults = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const res = await processItem(db, item, batchId, syncRunId, action);
      if (res.action === "insert") stats.inserted += 1;
      if (res.action === "update") stats.updated += 1;
      if (res.action === "skip") {
        stats.skipped += 1;
        const reason = safeText(res.reason) || "unknown";
        stats.skipReasons[reason] = Number(stats.skipReasons[reason] || 0) + 1;
      }
      if (res.action === "review") stats.reviewQueued += 1;
      if (res.action === "would_insert") stats.wouldInsert += 1;
      if (res.action === "would_update") stats.wouldUpdate += 1;
      if (res.action === "would_review") stats.wouldReview += 1;
      if (isApply) stats.sourceSaved += 1;
      writeResults.push({
        providerPoiId: item.providerPoiId,
        name: item.name,
        gymId: res.gymId || "",
        action: res.action,
        score: res.score || 0,
        reason: safeText(res.reason),
        matchedGymId: safeText(res.matchedGymId),
        matchedGymName: safeText(res.matchedGymName)
      });
    }

    await finishSyncRun(syncRunId, { success: true, stats });
    return ok(
      {
        provider,
        batchId,
        action,
        truncated,
        stats,
        requests,
        items: items.slice(0, 60),
        filteredSamples: Object.keys(filteredSeen)
          .slice(0, 20)
          .map((key) => filteredSeen[key]),
        writeResults: writeResults.slice(0, 60)
      },
      tid
    );
  } catch (e) {
    try {
      await finishSyncRun(syncRunId, {
        success: false,
        errorMessage: e && e.message ? e.message : "同步失败",
        stats
      });
    } catch (e2) {}
    return fail(e && e.code ? e.code : "SYNC_FAILED", e && e.message ? e.message : "同步失败", tid);
  }
};
