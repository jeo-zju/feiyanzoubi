/**
 * 岩馆同步 - 匹配与去重模块
 *
 * 匹配顺序（严格）：
 *   1. 精确查来源映射 RockGymSourceLinks（provider + providerPoiId）
 *      - 已删除：返回 skip，不复活
 *      - 已合并：解析至最终目标（限制跳数、检查循环）
 *      - 目标缺失或多重映射：进入异常，不创建替身馆
 *   2. 无来源映射时，按 cityCode + normalizedName 窄候选召回
 *      - 查询异常必须抛出，不当作空集
 *   3. 自动关联需强证据组合 + 唯一候选 + 无分店冲突
 *   4. 同名、多候选、接近分数 → 审核
 */

const { safeText, uniqueModes, normalizeCityText, buildSourceLinkId } = require("./normalize");

const MERGE_REDIRECT_MAX_HOPS = 5;

function toRad(v) {
  return (Number(v) * Math.PI) / 180;
}

/**
 * 计算两点距离（米）。任一坐标无效返回 null（不参与评分）。
 */
function distanceInMeters(aLat, aLng, bLat, bLng) {
  const lat1 = Number(aLat);
  const lng1 = Number(aLng);
  const lat2 = Number(bLat);
  const lng2 = Number(bLng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  if (lat1 === 0 && lng1 === 0) return null;
  if (lat2 === 0 && lng2 === 0) return null;
  const R = 6378137;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function normalizeExistingGym(gym) {
  if (!gym) return null;
  const lat = Number(gym.lat || (gym.location && gym.location.lat) || 0);
  const lng = Number(gym.lng || (gym.location && gym.location.lng) || 0);
  return {
    ...gym,
    name: safeText(gym.name || gym.gymName || gym.title),
    normalizedName: safeText(gym.normalizedName || require("./normalize").normalizeName(gym.name || gym.gymName || gym.title)),
    city: safeText(gym.city || gym.cityName || gym.locationCity),
    address: safeText(gym.address || gym.addr || gym.location),
    phone: safeText(gym.phone || gym.tel),
    lat: lat || null,
    lng: lng || null,
    supportedModes: uniqueModes(gym.supportedModes),
    status: safeText(gym.status).toLowerCase() || "active",
    mergedIntoGymId: safeText(gym.mergedIntoGymId),
    claimedByOwner: !!(gym && gym.claimedByOwner),
    ownerOpenid: safeText(gym.ownerOpenid)
  };
}

function isExactSourceRefMatch(gym, item) {
  const current = normalizeExistingGym(gym);
  if (!current) return false;
  const sourceRefs = Array.isArray(current.sourceRefs) ? current.sourceRefs : [];
  return sourceRefs.some(
    (ref) => safeText(ref && ref.provider) === item.provider && safeText(ref && ref.providerPoiId) === item.providerPoiId
  );
}

/**
 * 候选评分。
 *
 * 规则：
 * - 来源 ID 精确匹配直接返回 10（最高）。
 * - 同名只给 0.5（之前是 1.0，会导致远距离同名自动合并）。
 * - 原始同名再加 0.3。
 * - 地址相同 0.4，电话相同 0.4，坐标 ≤100m 0.5，≤300m 0.3。
 * - 自动合并阈值：需要 ≥ 1.2 且有独立地理/电话证据。
 * - 坐标缺失不参与距离计算。
 */
function scoreGymCandidate(gym, item) {
  const current = normalizeExistingGym(gym);
  if (!current) return { score: 0, evidence: [] };

  if (isExactSourceRefMatch(current, item)) {
    return { score: 10, evidence: ["source_ref_exact"] };
  }

  let score = 0;
  const evidence = [];

  if (current.normalizedName && current.normalizedName === item.normalizedName) {
    score += 0.5;
    evidence.push("normalized_name");
  }
  if (current.name && current.name === item.name) {
    score += 0.3;
    evidence.push("raw_name");
  }
  if (current.address && current.address === item.address) {
    score += 0.4;
    evidence.push("address");
  }
  if (current.phone && item.phone && current.phone === item.phone) {
    score += 0.4;
    evidence.push("phone");
  }

  const dist = distanceInMeters(current.lat, current.lng, item.lat, item.lng);
  if (dist != null) {
    if (dist <= 100) {
      score += 0.5;
      evidence.push("coord_100m");
    } else if (dist <= 300) {
      score += 0.3;
      evidence.push("coord_300m");
    }
  }

  return { score, evidence };
}

/**
 * 判断是否可自动合并：
 * - 分数 ≥ 1.2
 * - 且必须包含至少一个独立证据（地址/电话/坐标），不能只靠名称
 */
function canAutoMerge(scoreInfo) {
  if (!scoreInfo || scoreInfo.score < 1.2) return false;
  const geoEvidence = ["address", "phone", "coord_100m", "coord_300m"];
  return scoreInfo.evidence.some((e) => geoEvidence.includes(e));
}

/**
 * 解析合并重定向链，防止循环和断链。
 * 返回最终 active 目标馆，或 null（异常时调用方应进审核）。
 */
async function resolveMergedTarget(db, gymId, hops) {
  const visited = new Set();
  let currentId = safeText(gymId);
  let remaining = hops || MERGE_REDIRECT_MAX_HOPS;

  while (currentId && remaining > 0) {
    if (visited.has(currentId)) return null; // 循环
    visited.add(currentId);
    remaining -= 1;

    let doc;
    try {
      const res = await db.collection("RockGyms").doc(currentId).get();
      doc = res && res.data ? res.data : null;
    } catch (e) {
      return null;
    }
    if (!doc) return null; // 断链

    const status = safeText(doc.status).toLowerCase() || "active";
    if (status === "active") return doc;
    if (status === "deleted") return null;
    if (status === "merged") {
      currentId = safeText(doc.mergedIntoGymId);
      continue;
    }
    return null;
  }
  return null;
}

/**
 * 精确来源映射查询。
 * 返回：{ gym, status, redirectGymId, reason } 或 null（无映射）。
 * 读取失败必须抛出，不当空集。
 */
async function lookupSourceLink(db, item) {
  const linkId = buildSourceLinkId(item.provider, item.providerPoiId);
  let res;
  try {
    res = await db.collection("RockGymSourceLinks").doc(linkId).get();
  } catch (e) {
    // 文档不存在是正常情况，不视为错误
    if (e && e.errCode === -1) return null;
    throw e;
  }
  const link = res && res.data ? res.data : null;
  if (!link) return null;

  const status = safeText(link.status); // active | deleted | merged
  const gymId = safeText(link.gymId);

  if (status === "deleted") {
    return { status: "deleted", gymId, reason: "source_link_deleted" };
  }
  if (status === "merged") {
    return { status: "merged", gymId, redirectGymId: safeText(link.redirectGymId), reason: "source_link_merged" };
  }
  return { status: "active", gymId, reason: "source_link_active" };
}

/**
 * 窄候选召回：按规范化城市 + 规范化名称查询，不依赖固定 limit。
 * 同时用 sourceRefs 精确匹配兜底（旧数据未迁移到 SourceLinks 时）。
 */
async function fetchCandidatesByName(db, item) {
  const cityNorm = normalizeCityText(item.city);
  const nameNorm = item.normalizedName;
  const col = db.collection("RockGyms");
  const candidates = [];

  const literal = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 主查询：城市 + 标准化名称
  try {
    const cityRx = db.RegExp({ regexp: literal(cityNorm), options: "i" });
    const byCityName = await col
      .where({
        city: cityRx,
        normalizedName: nameNorm
      })
      .limit(50)
      .get();
    (byCityName && byCityName.data ? byCityName.data : []).forEach((doc) => {
      if (doc && doc._id && !candidates.some((x) => String(x._id) === String(doc._id))) candidates.push(doc);
    });
  } catch (e) {
    throw e; // 查询异常必须抛出
  }

  // 兜底：按名称查（不限城市，防止城市字段差异）
  if (candidates.length === 0 && nameNorm) {
    try {
      const byName = await col.where({ normalizedName: nameNorm }).limit(50).get();
      (byName && byName.data ? byName.data : []).forEach((doc) => {
        if (doc && doc._id && !candidates.some((x) => String(x._id) === String(doc._id))) candidates.push(doc);
      });
    } catch (e) {
      throw e;
    }
  }

  return candidates;
}

/**
 * 主匹配入口。
 *
 * @returns
 *   - { action: "skip", reason: "deleted_match" }
 *   - { action: "merge", gym, score, matchedGymId, matchedGymName }
 *   - { action: "review", reason, candidates }  // 多候选或证据不足
 *   - { action: "insert" }  // 无匹配，可创建新馆
 */
async function findExistingGym(db, item) {
  // 1. 精确来源映射
  const link = await lookupSourceLink(db, item);
  if (link) {
    if (link.status === "deleted") {
      return { action: "skip", reason: "deleted_match", score: 10 };
    }
    if (link.status === "merged") {
      const target = await resolveMergedTarget(db, link.redirectGymId || link.gymId);
      if (target) {
        return {
          action: "merge",
          gym: target,
          score: 10,
          reason: "merged_target_update",
          matchedGymId: safeText(link.gymId)
        };
      }
      return { action: "review", reason: "merged_redirect_broken" };
    }
    // active：直接取馆
    try {
      const res = await db.collection("RockGyms").doc(link.gymId).get();
      const gym = res && res.data ? res.data : null;
      if (gym && normalizeExistingGym(gym).status === "active") {
        return { action: "merge", gym, score: 10, reason: "source_link_active" };
      }
      if (gym) {
        const status = normalizeExistingGym(gym).status;
        if (status === "deleted") return { action: "skip", reason: "deleted_match", score: 10 };
        if (status === "merged") {
          const target = await resolveMergedTarget(db, gym.mergedIntoGymId);
          if (target) {
            return { action: "merge", gym: target, score: 10, reason: "merged_target_update", matchedGymId: link.gymId };
          }
        }
      }
      return { action: "review", reason: "source_link_target_missing" };
    } catch (e) {
      throw e;
    }
  }

  // 2. 无来源映射 → 窄候选召回
  const candidates = await fetchCandidatesByName(db, item);
  if (!candidates.length) return { action: "insert" };

  // 3. 评分并决定
  const scored = candidates
    .filter((doc) => {
      const s = normalizeExistingGym(doc).status;
      return s === "active" || s === "merged" || s === "deleted";
    })
    .map((doc) => {
      const { score, evidence } = scoreGymCandidate(doc, item);
      return { doc, score, evidence };
    });

  if (!scored.length) return { action: "insert" };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];

  // 精确来源 ID 在候选中命中（旧数据 sourceRefs）
  if (best.score >= 10) {
    const status = normalizeExistingGym(best.doc).status;
    if (status === "deleted") return { action: "skip", reason: "deleted_match", score: 10 };
    if (status === "merged") {
      const target = await resolveMergedTarget(db, best.doc.mergedIntoGymId);
      if (target) {
        return { action: "merge", gym: target, score: 10, reason: "merged_target_update", matchedGymId: safeText(best.doc._id) };
      }
      return { action: "review", reason: "merged_redirect_broken" };
    }
    return { action: "merge", gym: best.doc, score: best.score, reason: "source_ref_exact" };
  }

  // 同名但无独立地理/电话证据，或多候选接近分数 → 审核
  const hasUniqueTop = !second || second.score < best.score - 0.2;
  if (!canAutoMerge({ score: best.score, evidence: best.evidence })) {
    return { action: "review", reason: "insufficient_evidence", candidates: scored.slice(0, 5) };
  }
  if (!hasUniqueTop) {
    return { action: "review", reason: "multiple_close_candidates", candidates: scored.slice(0, 5) };
  }

  const status = normalizeExistingGym(best.doc).status;
  if (status === "deleted") return { action: "skip", reason: "deleted_match", score: best.score };
  if (status === "merged") {
    const target = await resolveMergedTarget(db, best.doc.mergedIntoGymId);
    if (target) {
      return { action: "merge", gym: target, score: best.score, reason: "merged_target_update", matchedGymId: safeText(best.doc._id) };
    }
    return { action: "review", reason: "merged_redirect_broken" };
  }

  return { action: "merge", gym: best.doc, score: best.score, reason: "fuzzy_match", evidence: best.evidence };
}

module.exports = {
  distanceInMeters,
  normalizeExistingGym,
  isExactSourceRefMatch,
  scoreGymCandidate,
  canAutoMerge,
  resolveMergedTarget,
  lookupSourceLink,
  findExistingGym,
  MERGE_REDIRECT_MAX_HOPS
};
