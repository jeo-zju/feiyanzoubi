const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

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

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function uniqueModes(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const mode = safeText(item).toLowerCase();
    if (!mode || !["boulder", "difficulty", "lead"].includes(mode) || seen[mode]) return;
    seen[mode] = true;
    out.push(mode);
  });
  return out;
}

function normalizeCityText(v) {
  return safeText(v)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(特别行政区|自治区|自治州|地区|盟|市|区|县)$/g, "");
}

function cityMatches(inputCity, targetCity) {
  const rawInput = safeText(inputCity).toLowerCase();
  const rawTarget = safeText(targetCity).toLowerCase();
  const normalizedInput = normalizeCityText(inputCity);
  const normalizedTarget = normalizeCityText(targetCity);

  if (!rawInput) return true;
  if (!rawTarget) return false;
  if (rawTarget.includes(rawInput) || rawInput.includes(rawTarget)) return true;
  if (!normalizedInput || !normalizedTarget) return false;
  return normalizedTarget.includes(normalizedInput) || normalizedInput.includes(normalizedTarget);
}

function normalizeGym(g) {
  const name = g.name || g.gymName || g.title || "";
  const city = g.city || g.cityName || g.locationCity || "";
  const address = g.address || g.addr || g.location || "";
  const currentCycleId = g.current_cycle_id || g.currentCycleId || g.cycle_id || "";
  const currentCycle = g.currentCycle || g.cycle || null;
  const routes = g.routes || g.routeConfig || null;
  const lines = g.lines || null;
  const hardnessAvg = toNumberOrNull(g.hardnessAvg);
  const hardnessCount = Math.max(0, Number(g.hardnessCount || 0) || 0);
  return {
    _id: g._id,
    name,
    city,
    address,
    currentCycleId,
    currentCycle,
    routes,
    lines,
    supportedModes: Array.isArray(g.supportedModes) ? g.supportedModes : [],
    lastCheckinAt: g.lastCheckinAt || g.lastVisitAt || g.last_checkin_at || "",
    visitCount: typeof g.visitCount === "number" ? g.visitCount : typeof g.visit_count === "number" ? g.visit_count : 0,
    hardnessAvg,
    hardnessCount,
    hardnessUpdatedAt: g.hardnessUpdatedAt || g.hardness_updated_at || 0,
    updatedAt: g.updatedAt || g.updateTime || g.updated_at || g.createdAt || 0
  };
}

function normalizeGymStatus(value) {
  const status = safeText(value).toLowerCase();
  if (status === "deleted") return "deleted";
  if (status === "merged") return "merged";
  return "active";
}

function isGymVisible(gym) {
  return normalizeGymStatus(gym && gym.status) === "active";
}

function matchesGym(gym, { city, keyword, mode }) {
  const source = gym || {};
  const cityText = safeText(source.city || source.cityName || source.locationCity);
  const nameText = safeText(source.name || source.gymName || source.title);
  const addressText = safeText(source.address || source.addr || source.location);
  const modeList = uniqueModes(source.supportedModes);

  if (city && !cityMatches(city, cityText)) return false;
  if (keyword) {
    const text = `${nameText} ${addressText}`.toLowerCase();
    if (!text.includes(keyword.toLowerCase())) return false;
  }
  if (mode && !modeList.includes(mode)) return false;
  return true;
}

function sortGyms(list, sortBy) {
  const gyms = Array.isArray(list) ? list.slice() : [];
  if (sortBy === "hardness") {
    gyms.sort((a, b) => {
      const avgA = toNumberOrNull(a && a.hardnessAvg);
      const avgB = toNumberOrNull(b && b.hardnessAvg);
      const safeAvgA = avgA == null ? -1 : avgA;
      const safeAvgB = avgB == null ? -1 : avgB;
      if (safeAvgB !== safeAvgA) return safeAvgB - safeAvgA;
      const countA = Math.max(0, Number((a && a.hardnessCount) || 0) || 0);
      const countB = Math.max(0, Number((b && b.hardnessCount) || 0) || 0);
      if (countB !== countA) return countB - countA;
      const updatedA = Number((a && a.updatedAt) || 0) || 0;
      const updatedB = Number((b && b.updatedAt) || 0) || 0;
      if (updatedB !== updatedA) return updatedB - updatedA;
      return safeText(a && a.name).localeCompare(safeText(b && b.name), "zh-Hans-CN");
    });
    return gyms;
  }
  gyms.sort((a, b) => {
    const updatedA = Number((a && a.updatedAt) || 0) || 0;
    const updatedB = Number((b && b.updatedAt) || 0) || 0;
    return updatedB - updatedA;
  });
  return gyms;
}

function sortGymsByRecentVisit(list, byGym) {
  return (Array.isArray(list) ? list : [])
    .map((gym, index) => ({ gym, index }))
    .sort((a, b) => {
      const lastA = safeText(byGym && byGym[safeText(a && a.gym && a.gym._id)] && byGym[safeText(a.gym._id)].lastDate);
      const lastB = safeText(byGym && byGym[safeText(b && b.gym && b.gym._id)] && byGym[safeText(b.gym._id)].lastDate);
      if (lastA && lastB && lastA !== lastB) return lastB.localeCompare(lastA);
      if (lastA && !lastB) return -1;
      if (!lastA && lastB) return 1;
      return a.index - b.index;
    })
    .map((item) => item.gym);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const userRes = await db
      .collection("RockUsers")
      .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
      .limit(1)
      .get();
    const userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const userId = userDoc && userDoc._id ? String(userDoc._id) : "";

    const userWhereParts = [{ openid }, { _openid: openid }, { uid: openid }, { user_uid: openid }, { user_id: openid }];
    if (userId) {
      userWhereParts.push({ user_uid: userId });
      userWhereParts.push({ user_id: userId });
      userWhereParts.push({ uid: userId });
    }
    const userWhere = _.or(userWhereParts);

    const city = safeText(event && event.city);
    const keyword = safeText(event && event.keyword);
    const mode = safeText(event && event.mode).toLowerCase();
    const sortBy = safeText(event && event.sortBy).toLowerCase();
    const ratedOnly = !!(event && event.ratedOnly);
    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(20, Number(event && event.pageSize ? event.pageSize : 5)));
    const skip = (page - 1) * pageSize;

    if (sortBy === "hardness" && !city) {
      return ok({ gyms: [], hasNext: false, page, needCity: true }, tid);
    }

    const col = db.collection("RockGyms");
    let res;
    try {
      res = await col.where({}).orderBy("updatedAt", "desc").limit(200).get();
    } catch (e) {
      res = await col.where({}).limit(200).get();
    }

    let list = ((res && res.data) || []).filter((doc) => isGymVisible(doc) && matchesGym(doc, { city, keyword, mode }));
    if (sortBy === "hardness" && ratedOnly) {
      list = list.filter((doc) => Math.max(0, Number(doc && doc.hardnessCount) || 0) > 0);
    }
    list = sortGyms(list, sortBy);
    const gymIds = list.map((g) => g && g._id).filter(Boolean);
    const byGym = {};
    if (gymIds.length) {
      const gymIn = _.in(gymIds);
      const gymWhere = _.or([{ gym_id: gymIn }, { gymId: gymIn }, { gymID: gymIn }]);
      let recRes;
      try {
        recRes = await db.collection("RockCheckinRecords").where(_.and([userWhere, gymWhere])).limit(5000).get();
      } catch (e) {
        recRes = null;
      }
      const records = (recRes && recRes.data) || [];
      records.forEach((r) => {
        if (!r) return;
        const gid = String(r.gym_id || r.gymId || r.gymID || "");
        const date = String(r.date || "");
        if (!gid) return;
        if (!byGym[gid]) byGym[gid] = { dateSet: new Set(), lastDate: "", routeCount: 0 };
        if (date) {
          byGym[gid].dateSet.add(date);
          if (!byGym[gid].lastDate || String(date).localeCompare(String(byGym[gid].lastDate)) > 0) byGym[gid].lastDate = date;
        }
        const c = Number(r.count || 0);
        if (Number.isFinite(c) && c > 0) byGym[gid].routeCount += c;
      });
      if (sortBy !== "hardness") list = sortGymsByRecentVisit(list, byGym);
    }
    const hasNext = list.length > skip + pageSize;
    const gyms = list.slice(skip, skip + pageSize).map(normalizeGym);
    gyms.forEach((g) => {
      const m = byGym[g._id];
      g.userVisitCount = m ? m.dateSet.size : 0;
      g.userLastCheckinAt = m ? m.lastDate : "";
      g.userRouteCount = m ? m.routeCount : 0;
    });
    return ok({ gyms, hasNext, page, needCity: false }, tid);
  } catch (e) {
    return fail("GYM_LIST_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

