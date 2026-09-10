/**
 * 岩馆同步 - 写入模块
 *
 * 职责：
 * - 构建新馆文档与补丁
 * - 字段级来源/锁保护：人工已编辑字段不被自动覆盖
 * - 来源映射 RockGymSourceLinks 的创建与回填
 * - 来源记录 RockGymSourceRecords 的幂等写入与 gymId 回填
 * - 审核队列 RockGymReviewQueue 的幂等入队（异常不吞）
 * - 区分实体置信度与模式置信度
 */

const { safeText, uniqueModes, buildSourceLinkId, contentHash } = require("./normalize");
const { normalizeExistingGym } = require("./match");

function buildSourceRef(item, now) {
  return {
    provider: item.provider,
    providerPoiId: item.providerPoiId,
    providerName: item.name,
    fetchedAt: now,
    lastSeenAt: now
  };
}

function mergeAliasNames(current, nextName) {
  const list = Array.isArray(current) ? current.slice(0) : [];
  const name = safeText(nextName);
  if (!name) return list;
  if (!list.includes(name)) list.push(name);
  return list.slice(0, 20);
}

function mergeSourceRefs(current, item, now) {
  const list = Array.isArray(current) ? current.slice(0) : [];
  const idx = list.findIndex(
    (ref) => safeText(ref && ref.provider) === item.provider && safeText(ref && ref.providerPoiId) === item.providerPoiId
  );
  if (idx >= 0) {
    list[idx] = {
      ...(list[idx] || {}),
      provider: item.provider,
      providerPoiId: item.providerPoiId,
      providerName: item.name,
      fetchedAt: list[idx].fetchedAt || now,
      lastSeenAt: now
    };
    return list;
  }
  list.push(buildSourceRef(item, now));
  return list.slice(0, 20);
}

function canAutoUpdateModes(gym) {
  const source = safeText(gym && gym.supportedModesSource);
  return !source || source === "auto_rule";
}

function chooseSupportedModes(currentGym, item) {
  const currentModes = uniqueModes((currentGym && currentGym.supportedModes) || []);
  const nextModes = uniqueModes(item && item.supportedModes);
  if (currentModes.length) return null;
  if (!nextModes.length) return null;
  if (!canAutoUpdateModes(currentGym)) return null;
  return {
    supportedModes: nextModes,
    supportedModesSource: "auto_rule",
    supportedModesConfidence: Number(item && item.modeConfidence) || 0
  };
}

/**
 * 判断字段是否为人工保护字段。
 * 当 claimedByOwner=true 或存在 ownerOpenid 时，地址/电话/位置/城市受保护。
 */
function isFieldProtected(gym, field) {
  const claimed = !!(gym && gym.claimedByOwner);
  const hasOwner = !!safeText(gym && gym.ownerOpenid);
  if (!claimed && !hasOwner) return false;
  const protectedFields = ["address", "phone", "lat", "lng", "location", "city", "province", "district", "name"];
  return protectedFields.includes(field);
}

/**
 * 构建新馆文档。
 *
 * 关键修复：
 * - 实体可信度（entityConfidence）与模式可信度（modeConfidence）分离
 * - 实体存疑（relevanceDecision !== accepted）时 reviewState = pending_review，不直接 approved
 * - 坐标缺失保持 null
 * - 自动创建来源映射 RockGymSourceLinks
 */
function buildNewGymDoc(item, batchId, now) {
  const isEntityAccepted = item.relevanceDecision === "accepted";
  const doc = {
    name: item.name,
    normalizedName: item.normalizedName,
    aliasNames: [],
    province: item.province,
    city: item.city,
    district: item.district,
    address: item.address,
    phone: item.phone,
    lat: item.lat,
    lng: item.lng,
    location: item.lat != null && item.lng != null ? { lat: item.lat, lng: item.lng } : null,
    supportedModes: uniqueModes(item.supportedModes),
    supportedModesSource: uniqueModes(item.supportedModes).length ? "auto_rule" : "",
    supportedModesConfidence: Number(item.modeConfidence) || 0,
    venueType: item.venueType || "unknown",
    entityConfidence: Number(item.relevanceConfidence) || 0,
    status: "active",
    claimedByOwner: false,
    sourceRefs: [buildSourceRef(item, now)],
    sourceSummary: {
      primaryProvider: item.provider,
      sourceCount: 1
    },
    syncMeta: {
      firstSeenAt: now,
      lastSeenAt: now,
      lastSyncedAt: now,
      lastVerifiedAt: 0
    },
    reviewState: isEntityAccepted ? "approved" : "pending_review",
    reviewReason: isEntityAccepted ? "" : safeText(item.relevanceReason) || "entity_needs_review",
    visitCount: 0,
    visit_count: 0,
    createdAt: now,
    updatedAt: now,
    created_at: db_serverDate(),
    updated_at: db_serverDate(),
    syncBatchId: batchId
  };
  return doc;
}

/**
 * 构建已有馆的更新补丁。
 *
 * 字段级保护：
 * - 人工已认领/有 owner 的馆：address/phone/lat/lng/location/city/province/district/name 不覆盖
 * - 只更新来源信息、同步时间、别名
 * - 模式字段遵循 canAutoUpdateModes
 * - 内容未变不改业务字段（通过对比）
 */
function buildGymPatch(existingGym, item, batchId, now) {
  const gym = normalizeExistingGym(existingGym);
  const mergedSourceRefs = mergeSourceRefs(gym.sourceRefs, item, now);
  const patch = {
    normalizedName: item.normalizedName || gym.normalizedName,
    sourceRefs: mergedSourceRefs,
    sourceSummary: {
      primaryProvider: item.provider,
      sourceCount: mergedSourceRefs.length
    },
    syncMeta: {
      firstSeenAt: Number(gym.syncMeta && gym.syncMeta.firstSeenAt) || now,
      lastSeenAt: now,
      lastSyncedAt: now,
      lastVerifiedAt: Number(gym.syncMeta && gym.syncMeta.lastVerifiedAt) || 0
    },
    syncBatchId: batchId
  };

  // 人工保护字段：不覆盖
  if (!isFieldProtected(gym, "province") && item.province) patch.province = item.province;
  if (!isFieldProtected(gym, "city") && item.city) patch.city = item.city;
  if (!isFieldProtected(gym, "district") && item.district) patch.district = item.district;
  if (!isFieldProtected(gym, "address") && item.address) patch.address = item.address;
  if (!isFieldProtected(gym, "phone") && item.phone) patch.phone = item.phone;

  // 坐标：仅在人工未保护且新坐标有效时更新
  if (!isFieldProtected(gym, "lat") && item.lat != null) {
    patch.lat = item.lat;
    patch.lng = item.lng;
    patch.location = item.lng != null ? { lat: item.lat, lng: item.lng } : null;
  }

  // 名称变化：加入别名，不直接覆盖（除非未保护且原名缺失）
  if (safeText(gym.name) && safeText(gym.name) !== item.name) {
    patch.aliasNames = mergeAliasNames(gym.aliasNames, item.name);
  } else if (!isFieldProtected(gym, "name") && item.name) {
    patch.name = item.name;
  }

  // 模式字段
  const modePatch = chooseSupportedModes(gym, item);
  if (modePatch) {
    patch.supportedModes = modePatch.supportedModes;
    patch.supportedModesSource = modePatch.supportedModesSource;
    patch.supportedModesConfidence = modePatch.supportedModesConfidence;
  }

  // venueType 更新
  if (item.venueType && item.venueType !== "unknown") {
    patch.venueType = item.venueType;
  }

  // 业务修改时间：仅在有实际业务字段变化时更新
  const hasBusinessChange = Object.keys(patch).some(
    (k) => !["sourceRefs", "sourceSummary", "syncMeta", "syncBatchId", "aliasNames"].includes(k)
  );
  if (hasBusinessChange) {
    patch.updatedAt = now;
    patch.updated_at = db_serverDate();
  } else {
    // 仅来源刷新，不改业务时间
    patch.syncMeta = patch.syncMeta; // keep
  }

  return patch;
}

/**
 * 创建或更新来源映射 RockGymSourceLinks。
 * 确定性 ID = hash(provider + providerPoiId)。
 */
async function upsertSourceLink(db, item, gymId, status) {
  const linkId = buildSourceLinkId(item.provider, item.providerPoiId);
  const now = Date.now();
  const doc = {
    provider: item.provider,
    providerPoiId: item.providerPoiId,
    gymId: safeText(gymId),
    status: status || "active",
    createdAt: now,
    updatedAt: now
  };
  try {
    await db.collection("RockGymSourceLinks").doc(linkId).set({ data: doc });
  } catch (e) {
    // set 在不存在时创建，存在时覆盖；若失败尝试 update
    try {
      await db.collection("RockGymSourceLinks").doc(linkId).update({
        data: { gymId: safeText(gymId), status: status || "active", updatedAt: now }
      });
    } catch (e2) {
      // 最后兜底 add
      await db.collection("RockGymSourceLinks").add({ data: { _id: linkId, ...doc } });
    }
  }
  return linkId;
}

/**
 * 幂等写入来源记录。
 * 幂等键：runId + provider + providerPoiId。
 * 处理后回填 gymId 与决定。
 */
async function saveSourceRecord(db, item, batchId, runId, processState, gymId) {
  const now = Date.now();
  const idempotentKey = `${safeText(runId)}::${item.provider}::${item.providerPoiId}`;
  const record = {
    provider: item.provider,
    providerPoiId: item.providerPoiId,
    batchId,
    runId: safeText(runId),
    idempotentKey,
    fetchedAt: now,
    keyword: item.sourceKeyword,
    region: item.sourceCity,
    rawName: item.name,
    rawAddress: item.address,
    rawPhone: item.phone,
    rawLocation: item.lat != null ? { lat: item.lat, lng: item.lng } : null,
    rawCategory: item.category,
    rawPayload: item,
    normalized: {
      name: item.name,
      normalizedName: item.normalizedName,
      province: item.province,
      city: item.city,
      district: item.district,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      phone: item.phone,
      supportedModes: uniqueModes(item.supportedModes)
    },
    processState: processState || "fetched",
    gymId: safeText(gymId) || "",
    decision: "",
    createdAt: now,
    updatedAt: now
  };

  // 先查是否已存在同幂等键
  try {
    const existing = await db
      .collection("RockGymSourceRecords")
      .where({ idempotentKey })
      .limit(1)
      .get();
    if (existing && existing.data && existing.data[0]) {
      const existingId = existing.data[0]._id;
      await db.collection("RockGymSourceRecords").doc(existingId).update({
        data: {
          processState: processState || "fetched",
          gymId: safeText(gymId) || "",
          fetchedAt: now,
          updatedAt: now,
          rawPayload: item
        }
      });
      return existingId;
    }
  } catch (e) {
    // 查询失败则直接 add，依赖数据库唯一约束（如有）
  }

  const res = await db.collection("RockGymSourceRecords").add({ data: record });
  return res && res._id ? res._id : "";
}

/**
 * 判断是否需要进入审核队列。
 * 区分：实体审核、模式审核、重复匹配审核、字段变更审核。
 */
function shouldQueueReview(item, writeResult) {
  if (!item) return false;
  if (writeResult && writeResult.action === "skip") return false;

  // 实体存疑
  if (item.relevanceDecision !== "accepted") return true;
  // 模式未识别或低置信度
  if (!uniqueModes(item.supportedModes).length) return true;
  if (Number(item.modeConfidence || 0) < 0.7) return true;
  // 模糊匹配置疑
  if (writeResult && writeResult.action === "update" && Number(writeResult.score || 0) < 1.5) return true;
  // 多候选或证据不足
  if (writeResult && writeResult.reason === "insufficient_evidence") return true;
  if (writeResult && writeResult.reason === "multiple_close_candidates") return true;
  return false;
}

/**
 * 幂等入审核队列。
 * 去重键：provider + providerPoiId + reviewType + 内容哈希。
 * 异常必须抛出，不吞。
 */
async function saveReviewQueue(db, item, batchId, runId, writeResult) {
  const now = Date.now();
  const reviewType = determineReviewType(item, writeResult);
  const hashPayload = {
    provider: item.provider,
    providerPoiId: item.providerPoiId,
    name: item.name,
    address: item.address,
    supportedModes: item.supportedModes,
    reviewType
  };
  const contentHashHex = contentHash(hashPayload);

  // 检查是否已有同内容的 pending 审核
  try {
    const existing = await db
      .collection("RockGymReviewQueue")
      .where({
        provider: item.provider,
        providerPoiId: item.providerPoiId,
        reviewType,
        contentHash: contentHashHex,
        reviewState: "pending"
      })
      .limit(1)
      .get();
    if (existing && existing.data && existing.data[0]) {
      return { id: existing.data[0]._id, duplicated: true };
    }
  } catch (e) {
    // 查询失败继续 add
  }

  const doc = {
    batchId,
    runId: safeText(runId),
    reviewType,
    contentHash: contentHashHex,
    provider: item.provider,
    providerPoiId: item.providerPoiId,
    name: item.name,
    city: item.city,
    district: item.district,
    address: item.address,
    phone: item.phone,
    supportedModes: uniqueModes(item.supportedModes),
    modeConfidence: Number(item.modeConfidence) || 0,
    modeReasons: Array.isArray(item.modeReasons) ? item.modeReasons : [],
    venueType: item.venueType || "unknown",
    entityConfidence: Number(item.relevanceConfidence) || 0,
    gymId: writeResult && writeResult.gymId ? String(writeResult.gymId) : "",
    writeAction: writeResult && writeResult.action ? writeResult.action : "",
    matchScore: Number(writeResult && writeResult.score) || 0,
    matchReason: safeText(writeResult && writeResult.reason),
    reviewState: "pending",
    reviewReason: determineReviewReason(item, writeResult),
    rawPayload: item,
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection("RockGymReviewQueue").add({ data: doc });
  return { id: res && res._id ? res._id : "", duplicated: false };
}

function determineReviewType(item, writeResult) {
  if (item.relevanceDecision !== "accepted") return "entity_review";
  if (writeResult && (writeResult.reason === "insufficient_evidence" || writeResult.reason === "multiple_close_candidates")) {
    return "duplicate_match_review";
  }
  if (!uniqueModes(item.supportedModes).length || Number(item.modeConfidence || 0) < 0.7) {
    return "gym_mode_review";
  }
  return "field_change_review";
}

function determineReviewReason(item, writeResult) {
  if (item.relevanceDecision !== "accepted") return safeText(item.relevanceReason) || "entity_needs_review";
  if (writeResult && writeResult.reason) return writeResult.reason;
  if (!uniqueModes(item.supportedModes).length) return "mode_missing";
  if (Number(item.modeConfidence || 0) < 0.7) return "low_confidence";
  return "field_change";
}

/**
 * 占位：db.serverDate() 在云函数运行时注入。
 * 纯函数测试时返回 0。
 */
function db_serverDate() {
  try {
    const cloud = require("wx-server-sdk");
    const db = cloud.database();
    return db.serverDate();
  } catch (e) {
    return 0;
  }
}

module.exports = {
  buildSourceRef,
  mergeAliasNames,
  mergeSourceRefs,
  canAutoUpdateModes,
  chooseSupportedModes,
  isFieldProtected,
  buildNewGymDoc,
  buildGymPatch,
  upsertSourceLink,
  saveSourceRecord,
  shouldQueueReview,
  saveReviewQueue,
  determineReviewType,
  determineReviewReason
};
