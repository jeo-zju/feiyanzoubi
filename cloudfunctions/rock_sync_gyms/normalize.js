/**
 * 岩馆同步 - 归一化与实体分型纯规则模块
 *
 * 本模块只包含纯函数，不依赖 wx-server-sdk / 数据库 / 网络，
 * 便于在本地 Node 环境直接单测与复现。
 */

const DEFAULT_SYNC_KEYWORDS = ["攀岩", "攀岩馆", "抱石馆", "攀岩训练馆"];

const STRONG_GYM_NAME_RE = /(攀岩馆|抱石馆|室内攀岩|攀岩|抱石|岩馆|boulder|bouldering|climbing)/i;
const CLIMBING_CATEGORY_RE = /(攀岩|抱石)/i;
const EXTREME_CATEGORY_RE = /极限运动/i;
const WEAK_GYM_NAME_RE = /(训练馆|训练中心|俱乐部|中心|运动馆|运动中心)/i;
// 酒店/宾馆/民宿不在此黑名单——酒店内对外营业的真实岩馆需核实，不应直接拒绝
const IRRELEVANT_RE = /(ktv|马术|车辆改装|改装|汽修|洗车|酒吧|足浴|棋牌|台球|网吧|按摩|足疗|摄影|宠物|驾校|汽车美容|餐厅|火锅|烤肉|烧烤|茶楼|spa|轰趴)/i;
const SPORTS_CATEGORY_RE = /^运动健身(?::|：|$)/;
const GATE_LIKE_NAME_RE = /((东|西|南|北|中)[0-9一二三四五六七八九十]*门|出入口|入口|出口)$/;
const CAMPUS_OR_COMPOUND_RE = /(大学|学院|学校|校区|中学|小学|幼儿园|小区|苑|园区|广场|公寓|社区)/;

// 实体用途/准入冲突识别
const RETAIL_OR_OFFICE_RE = /(装备|用品|器材|器械|专卖店|商店|体验中心|办公室|总部|展厅|服务中心)/i;
const TRAINING_OR_CLUB_RE = /(培训|俱乐部|社团|协会|教学|课程|训练营)/i;
const AMUSEMENT_RE = /(儿童乐园|游乐场|游乐园|淘气堡|蹦床|滑梯|亲子|游乐)/i;
const OUTDOOR_CRAG_RE = /(野攀|自然岩场|野外|岩壁|岩场)/i;
// 受限场所：学校/小区/酒店等，即便含攀岩也需核实对外开放条件
const RESTRICTED_VENUE_RE = /(大学|学院|学校|校区|中学|小学|幼儿园|小区|苑|园区|广场|公寓|社区|酒店|宾馆|民宿)/i;

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

/**
 * 名称标准化：去空白/括号、统一大小写、去掉尾部常见后缀。
 * 注意：门店后缀（如“望京店”）不过度删除，仅去掉通用的“馆/店/体验馆/中心店”。
 */
function normalizeName(name) {
  return safeText(name)
    .replace(/[()（）【】\[\]\s]+/g, "")
    .replace(/(攀岩馆|抱石馆|岩馆|体验馆|中心店)$/g, "")
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

  if (/抱石|boulder|bouldering/.test(text)) {
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
    confidence: reasons.length ? 0.8 : 0,
    reasons: reasons.length ? reasons : ["未识别到明确模式关键词"]
  };
}

/**
 * 城市文本规范化：去掉“市/区/县/特别行政区”等后缀并小写，
 * 用于跨字段（city/cityName/locationCity）归一化比较。
 */
function normalizeCityText(v) {
  return safeText(v)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(特别行政区|自治区|自治州|地区|盟|市|区|县)$/g, "");
}

/**
 * 判断两个城市文本是否指向同一城市。
 * 优先用规范化后的包含关系，直辖市/带“市”差异均可匹配。
 */
function cityMatches(inputCity, targetCity) {
  const rawInput = safeText(inputCity).toLowerCase();
  const rawTarget = safeText(targetCity).toLowerCase();
  if (!rawInput) return true;
  if (!rawTarget) return false;
  if (rawTarget.includes(rawInput) || rawInput.includes(rawTarget)) return true;
  const normalizedInput = normalizeCityText(inputCity);
  const normalizedTarget = normalizeCityText(targetCity);
  if (!normalizedInput || !normalizedTarget) return false;
  return normalizedTarget.includes(normalizedInput) || normalizedInput.includes(normalizedTarget);
}

/**
 * 实体分型：输出 climbing_venue / mixed_sports_venue / amusement_attraction /
 * training_or_club / retail_or_office / outdoor_crag / unknown。
 *
 * 注意：这里输出的是“场所类型”，不等同于“是否可作为约爬地点”。
 * 后者需要核实固定场址、持续攀爬设施、对外使用条件。
 */
function classifyVenueType(poi) {
  const name = safeText(poi && poi.title);
  const category = safeText(poi && poi.category);
  const text = `${name} ${category}`;

  // 用途冲突信号优先判定：即使名称含攀岩，装备店/办公室/游乐/培训仍不是岩馆
  if (OUTDOOR_CRAG_RE.test(text)) return "outdoor_crag";
  if (AMUSEMENT_RE.test(text)) return "amusement_attraction";
  if (RETAIL_OR_OFFICE_RE.test(text)) return "retail_or_office";
  if (TRAINING_OR_CLUB_RE.test(text)) return "training_or_club";

  const hasClimbingCategory = CLIMBING_CATEGORY_RE.test(category);
  const hasStrongName = STRONG_GYM_NAME_RE.test(name);
  const hasExtremeCategory = EXTREME_CATEGORY_RE.test(category);

  if (hasClimbingCategory || hasStrongName) return "climbing_venue";
  if (hasExtremeCategory) return "unknown";
  return "unknown";
}

/**
 * 相关性评估：返回 accepted / needs_review / rejected 三路决策。
 *
 * - accepted：名称和类目都明确指向攀岩场馆，且无准入/用途冲突。
 * - needs_review：证据不足、相互矛盾或特殊准入（儿童、学校、酒店内等）。
 * - rejected：明确不在本轮范围（无关行业、非运动健身类目、出入口等）。
 */
function assessPoiRelevance(poi, scope) {
  const name = safeText(poi && poi.title);
  const category = safeText(poi && poi.category);
  const nameAndCategory = `${name} ${category}`;
  const reasons = [];

  const hasStrongName = STRONG_GYM_NAME_RE.test(name);
  const hasClimbingCategory = CLIMBING_CATEGORY_RE.test(category);
  const hasExtremeCategory = EXTREME_CATEGORY_RE.test(category);
  const hasWeakGymName = WEAK_GYM_NAME_RE.test(name);
  const inSportsCategory = SPORTS_CATEGORY_RE.test(category);

  if (IRRELEVANT_RE.test(nameAndCategory)) {
    return { decision: "rejected", reason: "命中无关行业黑名单", confidence: 0 };
  }
  if (!inSportsCategory) {
    return { decision: "rejected", reason: "不在运动健身类目", confidence: 0 };
  }
  if (GATE_LIKE_NAME_RE.test(name) || (CAMPUS_OR_COMPOUND_RE.test(name) && /门$/.test(name))) {
    return { decision: "rejected", reason: "名称更像学校或园区出入口", confidence: 0 };
  }

  const venueType = classifyVenueType(poi);

  // 用途冲突：装备店、办公室、游乐设施、培训机构、自然岩场不能直接作为正式岩馆
  if (venueType === "retail_or_office") {
    return { decision: "needs_review", reason: "疑似用品/办公场所，需核实是否提供攀爬场地", confidence: 0.3, venueType };
  }
  if (venueType === "amusement_attraction") {
    return { decision: "needs_review", reason: "疑似游乐/亲子项目，需核实是否为持续开放的攀岩场馆", confidence: 0.3, venueType };
  }
  if (venueType === "training_or_club") {
    return { decision: "needs_review", reason: "疑似培训/社团机构，需核实是否有固定对外攀爬场地", confidence: 0.35, venueType };
  }
  if (venueType === "outdoor_crag") {
    return { decision: "needs_review", reason: "自然岩场不在本轮室内岩馆范围", confidence: 0.2, venueType };
  }

  // 学校/小区/酒店等带准入限制的场所：即便名称含攀岩也需审核对外开放条件
  if (RESTRICTED_VENUE_RE.test(name)) {
    if (hasStrongName || hasClimbingCategory) {
      reasons.push("名称含攀岩但位于学校/酒店等受限场所");
      return { decision: "needs_review", reason: reasons.join("；"), confidence: 0.5, venueType };
    }
  }

  if (hasStrongName) reasons.push("名称命中岩馆关键词");
  if (hasClimbingCategory) reasons.push("类目命中攀岩相关");
  if (inSportsCategory) reasons.push("类目属于运动健身");
  if (hasWeakGymName) reasons.push("名称命中场馆弱提示词");

  // 极限运动类目但无明确攀岩类目/名称：不等于攀岩，需核实
  if (hasExtremeCategory && !hasClimbingCategory && !hasStrongName) {
    return { decision: "needs_review", reason: "极限运动不等于攀岩，需核实", confidence: 0.4, venueType };
  }

  if (!hasStrongName && !hasClimbingCategory) {
    return { decision: "rejected", reason: "名称和类目都未明确体现岩馆", confidence: 0.1, venueType };
  }
  if (!hasStrongName && hasClimbingCategory && !hasWeakGymName) {
    return { decision: "needs_review", reason: "仅类目相关但名称不够明确，需补证", confidence: 0.4, venueType };
  }

  const confidence = hasStrongName && hasClimbingCategory ? 0.9 : hasStrongName ? 0.8 : 0.7;
  return {
    decision: "accepted",
    reason: reasons.join("；") || "通过严格相关性过滤",
    confidence,
    venueType
  };
}

/**
 * 将地图 POI 归一化为内部候选结构。
 * 坐标缺失保持 null，不归零。
 */
function normalizePoi(item, scope) {
  const poi = item || {};
  const ad = poi.ad_info || {};
  const location = poi.location || {};
  const rawLat = Number(location.lat);
  const rawLng = Number(location.lng);
  const hasValidLat = Number.isFinite(rawLat) && rawLat !== 0;
  const hasValidLng = Number.isFinite(rawLng) && rawLng !== 0;

  const modeInfo = inferSupportedModes(`${safeText(poi.title)} ${safeText(poi.category)}`);
  const relevance = assessPoiRelevance(poi, scope);

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
    lat: hasValidLat ? rawLat : null,
    lng: hasValidLng ? rawLng : null,
    supportedModes: modeInfo.supportedModes,
    modeConfidence: modeInfo.confidence,
    modeReasons: modeInfo.reasons,
    venueType: relevance.venueType || "unknown",
    relevanceDecision: relevance.decision,
    relevanceReason: safeText(relevance.reason),
    relevanceConfidence: Number(relevance.confidence) || 0
  };
}

/**
 * 来源确定性 ID：provider + providerPoiId 的哈希。
 * 用 SHA-1（Node 内置），保证稳定且不依赖截断的 sourceRefs。
 */
function buildSourceLinkId(provider, providerPoiId) {
  const crypto = require("crypto");
  const key = `${safeText(provider)}::${safeText(providerPoiId)}`;
  return crypto.createHash("sha1").update(key).digest("hex");
}

/**
 * 内容哈希：用于审核去重和幂等提交。
 */
function contentHash(obj) {
  const crypto = require("crypto");
  return crypto.createHash("sha1").update(JSON.stringify(obj || {})).digest("hex");
}

module.exports = {
  DEFAULT_SYNC_KEYWORDS,
  safeText,
  clampInt,
  uniqueTexts,
  normalizeName,
  uniqueModes,
  inferSupportedModes,
  normalizeCityText,
  cityMatches,
  classifyVenueType,
  assessPoiRelevance,
  normalizePoi,
  buildSourceLinkId,
  contentHash
};
