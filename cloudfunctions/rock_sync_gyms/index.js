const https = require("https");
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const REQUEST_INTERVAL_MS = 350;
const DEFAULT_SYNC_KEYWORDS = [
  "攀岩馆",
  "抱石馆",
  "攀石馆",
  "攀岩训练馆",
  "攀岩俱乐部",
  "攀岩中心",
  "室内攀岩"
];

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

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function uniqueTexts(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const text = safeText(item);
    if (!text) return;
    if (seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out;
}

function normalizeName(name) {
  return safeText(name)
    .replace(/[()（）【】\[\]\s]+/g, "")
    .replace(/攀岩馆|抱石馆|攀石馆|岩馆|体验馆|中心店|店$/g, "")
    .toLowerCase();
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

function inferSupportedModes(input) {
  const text = safeText(input).toLowerCase();
  const supportedModes = [];
  const reasons = [];

  if (/抱石|攀石|boulder|bouldering/.test(text)) {
    supportedModes.push("boulder");
    reasons.push("命中抱石关键词");
  }
  if (/难度|顶绳|绳攀|rope|top rope|auto belay|自动保护/.test(text)) {
    supportedModes.push("difficulty");
    reasons.push("命中难度关键词");
  }
  if (/先锋|lead/.test(text)) {
    supportedModes.push("lead");
    reasons.push("命中先锋关键词");
  }
  if (/综合|全能|双区/.test(text)) {
    supportedModes.push("boulder", "difficulty");
    reasons.push("命中综合关键词");
  }

  return {
    supportedModes: uniqueModes(supportedModes),
    confidence: reasons.length ? 0.8 : 0.2,
    reasons: reasons.length ? reasons : ["仅凭搜索结果暂未识别可用打卡模式"]
  };
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 12000,
        headers: {
          Accept: "application/json"
        }
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP_${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(raw || "{}"));
          } catch (e) {
            reject(new Error("MAP_RESPONSE_PARSE_FAILED"));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("MAP_REQUEST_TIMEOUT"));
    });
    req.on("error", reject);
  });
}

function buildTencentSearchUrl(params) {
  const query = new URLSearchParams();
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value == null || value === "") return;
    query.set(key, String(value));
  });
  return `https://apis.map.qq.com/ws/place/v1/search?${query.toString()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizePoi(item, scope) {
  const poi = item || {};
  const ad = poi.ad_info || {};
  const location = poi.location || {};
  const modeInfo = inferSupportedModes(`${safeText(poi.title)} ${safeText(poi.category)}`);
  return {
    provider: "tencent",
    providerPoiId: safeText(poi.id),
    sourceCity: safeText(scope && scope.city),
    sourceKeyword: safeText(scope && scope.keyword),
    name: safeText(poi.title),
    normalizedName: normalizeName(poi.title),
    address: safeText(poi.address),
    phone: safeText(poi.tel),
    category: safeText(poi.category),
    province: safeText(ad.province),
    city: safeText(ad.city),
    district: safeText(ad.district),
    adcode: safeText(ad.adcode),
    lat: Number(location.lat) || 0,
    lng: Number(location.lng) || 0,
    supportedModes: modeInfo.supportedModes,
    modeConfidence: modeInfo.confidence,
    modeReasons: modeInfo.reasons
  };
}

function toRad(v) {
  return (Number(v) * Math.PI) / 180;
}

function distanceInMeters(aLat, aLng, bLat, bLng) {
  const lat1 = Number(aLat);
  const lng1 = Number(aLng);
  const lat2 = Number(bLat);
  const lng2 = Number(bLng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.MAX_SAFE_INTEGER;
  const R = 6378137;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function buildBatchId(provider) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${safeText(provider) || "sync"}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

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

async function isAdmin(openid) {
  if (!openid) return false;
  const res = await db.collection("RockUsers").where({ openid }).limit(1).get();
  const user = res && res.data && res.data[0] ? res.data[0] : null;
  if (!user) return false;
  return user.role === "admin" || user.isAdmin === true;
}

async function createSyncRun(batchId, meta) {
  const payload = {
    batchId,
    provider: safeText(meta && meta.provider),
    triggerType: safeText(meta && meta.triggerType) || "manual",
    writeMode: !!(meta && meta.writeMode),
    scope: meta && meta.scope ? meta.scope : {},
    stats: {
      requests: 0,
      fetched: 0,
      unique: 0,
      inserted: 0,
      updated: 0,
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

async function saveSourceRecord(item, batchId) {
  const now = Date.now();
  const record = {
    provider: item.provider,
    providerPoiId: item.providerPoiId,
    batchId,
    fetchedAt: now,
    keyword: item.sourceKeyword,
    region: item.sourceCity,
    rawName: item.name,
    rawAddress: item.address,
    rawPhone: item.phone,
    rawLocation: { lat: item.lat, lng: item.lng },
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
    processState: "fetched",
    createdAt: now,
    updatedAt: now
  };
  await db.collection("RockGymSourceRecords").add({ data: record });
}

function shouldQueueReview(item, writeResult) {
  if (!item) return false;
  if (!uniqueModes(item.supportedModes).length) return true;
  if (Number(item.modeConfidence || 0) < 0.7) return true;
  if (writeResult && writeResult.action === "update" && Number(writeResult.score || 0) < 1.2) return true;
  return false;
}

async function saveReviewQueue(item, batchId, writeResult) {
  const now = Date.now();
  const doc = {
    batchId,
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
    gymId: writeResult && writeResult.gymId ? String(writeResult.gymId) : "",
    writeAction: writeResult && writeResult.action ? writeResult.action : "",
    matchScore: Number(writeResult && writeResult.score) || 0,
    reviewState: "pending",
    reviewReason: !uniqueModes(item.supportedModes).length ? "mode_missing" : "low_confidence",
    rawPayload: item,
    createdAt: now,
    updatedAt: now
  };
  await db.collection("RockGymReviewQueue").add({ data: doc });
}

function normalizeExistingGym(gym) {
  if (!gym) return null;
  return {
    ...gym,
    name: safeText(gym.name || gym.gymName || gym.title),
    normalizedName: safeText(gym.normalizedName || normalizeName(gym.name || gym.gymName || gym.title)),
    city: safeText(gym.city || gym.cityName || gym.locationCity),
    address: safeText(gym.address || gym.addr || gym.location),
    phone: safeText(gym.phone || gym.tel),
    lat: Number(gym.lat || (gym.location && gym.location.lat) || 0) || 0,
    lng: Number(gym.lng || (gym.location && gym.location.lng) || 0) || 0,
    supportedModes: uniqueModes(gym.supportedModes)
  };
}

function scoreGymCandidate(gym, item) {
  const current = normalizeExistingGym(gym);
  if (!current) return 0;
  let score = 0;
  const sourceRefs = Array.isArray(current.sourceRefs) ? current.sourceRefs : [];
  if (
    sourceRefs.some(
      (ref) => safeText(ref && ref.provider) === item.provider && safeText(ref && ref.providerPoiId) === item.providerPoiId
    )
  ) {
    return 10;
  }
  if (current.normalizedName && current.normalizedName === item.normalizedName) score += 1;
  if (current.name && current.name === item.name) score += 0.6;
  if (current.address && current.address === item.address) score += 0.5;
  if (current.phone && item.phone && current.phone === item.phone) score += 0.4;
  const dist = distanceInMeters(current.lat, current.lng, item.lat, item.lng);
  if (dist <= 100) score += 0.5;
  else if (dist <= 300) score += 0.3;
  return score;
}

async function findExistingGym(item) {
  const col = db.collection("RockGyms");
  const candidates = [];
  const pushList = (list) => {
    (Array.isArray(list) ? list : []).forEach((doc) => {
      if (!doc || !doc._id) return;
      if (candidates.some((x) => String(x._id) === String(doc._id))) return;
      candidates.push(doc);
    });
  };

  if (item.city) {
    try {
      const byCity = await col.where({ city: item.city }).limit(100).get();
      pushList(byCity && byCity.data);
    } catch (e) {}
  }
  if (!candidates.length && item.name) {
    try {
      const byName = await col.where({ name: item.name }).limit(50).get();
      pushList(byName && byName.data);
    } catch (e) {}
  }
  if (!candidates.length) return null;

  let best = null;
  let bestScore = 0;
  candidates.forEach((doc) => {
    const score = scoreGymCandidate(doc, item);
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  });
  if (best && bestScore >= 1) {
    return { gym: best, score: bestScore };
  }
  return null;
}

function buildNewGymDoc(item, batchId) {
  const now = Date.now();
  return {
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
    location: { lat: item.lat, lng: item.lng },
    supportedModes: uniqueModes(item.supportedModes),
    supportedModesSource: uniqueModes(item.supportedModes).length ? "auto_rule" : "",
    supportedModesConfidence: Number(item.modeConfidence) || 0,
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
      lastVerifiedAt: now
    },
    reviewState: "approved",
    visitCount: 0,
    visit_count: 0,
    createdAt: now,
    updatedAt: now,
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
    syncBatchId: batchId
  };
}

function buildGymPatch(existingGym, item, batchId) {
  const gym = normalizeExistingGym(existingGym);
  const now = Date.now();
  const patch = {
    normalizedName: item.normalizedName || gym.normalizedName,
    province: item.province || safeText(gym.province),
    city: item.city || gym.city,
    district: item.district || safeText(gym.district),
    address: item.address || gym.address,
    phone: item.phone || gym.phone,
    lat: item.lat || gym.lat || 0,
    lng: item.lng || gym.lng || 0,
    location: {
      lat: item.lat || gym.lat || 0,
      lng: item.lng || gym.lng || 0
    },
    status: "active",
    sourceRefs: mergeSourceRefs(gym.sourceRefs, item, now),
    sourceSummary: {
      primaryProvider: item.provider,
      sourceCount: mergeSourceRefs(gym.sourceRefs, item, now).length
    },
    syncMeta: {
      firstSeenAt: Number(gym.syncMeta && gym.syncMeta.firstSeenAt) || now,
      lastSeenAt: now,
      lastSyncedAt: now,
      lastVerifiedAt: now
    },
    aliasNames: safeText(gym.name) && safeText(gym.name) !== item.name ? mergeAliasNames(gym.aliasNames, item.name) : gym.aliasNames || [],
    updatedAt: now,
    updated_at: db.serverDate(),
    syncBatchId: batchId
  };
  const modePatch = chooseSupportedModes(gym, item);
  if (modePatch) {
    patch.supportedModes = modePatch.supportedModes;
    patch.supportedModesSource = modePatch.supportedModesSource;
    patch.supportedModesConfidence = modePatch.supportedModesConfidence;
  }
  return patch;
}

async function upsertGym(item, batchId) {
  const match = await findExistingGym(item);
  if (!match || !match.gym) {
    const doc = buildNewGymDoc(item, batchId);
    const res = await db.collection("RockGyms").add({ data: doc });
    return {
      action: "insert",
      gymId: res && res._id ? res._id : "",
      score: 0
    };
  }
  const patch = buildGymPatch(match.gym, item, batchId);
  await db.collection("RockGyms").doc(match.gym._id).update({ data: patch });
  return {
    action: "update",
    gymId: String(match.gym._id),
    score: match.score
  };
}

async function fetchTencentSearch(apiKey, city, keyword, pageIndex, pageSize) {
  const url = buildTencentSearchUrl({
    key: apiKey,
    keyword,
    boundary: `region(${city},0)`,
    page_size: pageSize,
    page_index: pageIndex,
    output: "json"
  });
  const response = await requestJson(url);
  if (!response || Number(response.status) !== 0) {
    const message = safeText(response && response.message) || "地图接口调用失败";
    const err = new Error(message);
    err.code = `MAP_${safeText(response && response.status) || "FAILED"}`;
    throw err;
  }
  return response;
}

exports.main = async (event) => {
  const tid = traceId();
  let syncRunId = "";
  let stats = {
    requests: 0,
    fetched: 0,
    unique: 0,
    inserted: 0,
    updated: 0,
    sourceSaved: 0,
    reviewQueued: 0
  };
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const provider = safeText(event && event.provider) || "tencent";
    if (provider !== "tencent") {
      return fail("UNSUPPORTED_PROVIDER", "当前仅支持腾讯位置服务", tid);
    }

    const apiKey = safeText(process.env.TENCENT_MAP_KEY) || safeText(event && event.apiKey);
    if (!apiKey) {
      return fail("MAP_KEY_MISSING", "未配置 TENCENT_MAP_KEY", tid);
    }

    const writeMode = !!(event && event.write);
    const dryRun = writeMode ? false : event && event.dryRun !== false;
    if (writeMode && !(await isAdmin(openid))) {
      return fail("FORBIDDEN", "仅管理员可写入正式馆表", tid);
    }

    const city = safeText(event && event.city) || safeText(Array.isArray(event && event.cities) ? event.cities[0] : "") || "北京市";
    const keywords = uniqueTexts((event && event.keywords) || [event && event.keyword || ""]).length
      ? uniqueTexts((event && event.keywords) || [event && event.keyword || ""])
      : DEFAULT_SYNC_KEYWORDS.slice(0);
    const pageLimit = clampInt(event && event.pageLimit, 1, 5, 1);
    const pageSize = clampInt(event && event.pageSize, 1, 20, 10);
    const batchId = safeText(event && event.batchId) || buildBatchId(provider);

    if (!city) return fail("BAD_REQUEST", "缺少城市", tid);
    if (!keywords.length) return fail("BAD_REQUEST", "缺少关键词", tid);

    const run = await createSyncRun(batchId, {
      provider,
      triggerType: "manual",
      writeMode,
      scope: { city, keywords, pageLimit, pageSize, requestIntervalMs: REQUEST_INTERVAL_MS },
      openid
    });
    syncRunId = run._id;

    const requests = [];
    const seen = {};
    let requestCount = 0;

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
          if (!key || seen[key]) return;
          seen[key] = normalizePoi(poi, { city, keyword });
        });
        if (list.length < pageSize) break;
      }
    }

    const items = Object.keys(seen).map((key) => seen[key]);
    stats.requests = requests.length;
    stats.unique = items.length;

    const writeResults = [];
    if (writeMode) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await saveSourceRecord(item, batchId);
        stats.sourceSaved += 1;
        const res = await upsertGym(item, batchId);
        if (res.action === "insert") stats.inserted += 1;
        if (res.action === "update") stats.updated += 1;
        if (shouldQueueReview(item, res)) {
          try {
            await saveReviewQueue(item, batchId, res);
            stats.reviewQueued += 1;
          } catch (e) {}
        }
        writeResults.push({
          providerPoiId: item.providerPoiId,
          name: item.name,
          gymId: res.gymId,
          action: res.action,
          score: res.score
        });
      }
    }

    await finishSyncRun(syncRunId, { success: true, stats });
    return ok(
      {
        provider,
        batchId,
        dryRun,
        write: writeMode,
        stats,
        requests,
        items: items.slice(0, 60),
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
