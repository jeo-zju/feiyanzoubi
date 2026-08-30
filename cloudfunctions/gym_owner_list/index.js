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

function normalizeGym(g) {
  const name = g.name || g.gymName || g.title || "";
  const city = g.city || g.cityName || g.locationCity || "";
  const address = g.address || g.addr || g.location || "";
  const currentCycleId = g.current_cycle_id || g.currentCycleId || g.cycle_id || "";
  const currentCycle = g.currentCycle || g.cycle || null;
  const routes = g.routes || g.routeConfig || null;
  const lines = g.lines || null;
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
    updatedAt: g.updatedAt || g.updateTime || g.updated_at || g.createdAt || 0
  };
}

function normalizeGymStatus(value) {
  const status = String(value == null ? "" : value).trim().toLowerCase();
  if (status === "deleted") return "deleted";
  if (status === "merged") return "merged";
  return "active";
}

function isGymVisible(gym) {
  return normalizeGymStatus(gym && gym.status) === "active";
}

function containsKeyword(gym, keyword) {
  const text = String(keyword == null ? "" : keyword).trim().toLowerCase();
  if (!text) return true;
  const merged = [
    gym && (gym.name || gym.gymName || gym.title || ""),
    gym && (gym.city || gym.cityName || gym.locationCity || ""),
    gym && (gym.address || gym.addr || gym.location || ""),
    ...(Array.isArray(gym && gym.aliasNames) ? gym.aliasNames : [])
  ]
    .join(" ")
    .toLowerCase();
  return merged.includes(text);
}

function sumLines(gyms) {
  const list = Array.isArray(gyms) ? gyms : [];
  return list.reduce(
    (acc, gym) => {
      const lines = gym && gym.lines ? gym.lines : {};
      acc.boulderLines += Number(lines.boulder || 0);
      acc.diffLines += Number(lines.difficulty || 0);
      acc.leadLines += Number(lines.lead || 0);
      return acc;
    },
    { boulderLines: 0, diffLines: 0, leadLines: 0 }
  );
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    const adminAllowed = await isAdmin(openid);
    if (!adminAllowed) return fail("FORBIDDEN", "无权限", tid);

    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(20, Number(event && event.pageSize ? event.pageSize : 5)));
    const keyword = String(event && event.keyword ? event.keyword : "").trim();
    const skip = (page - 1) * pageSize;

    const where = {};

    const countRes = await db.collection("RockGyms").where(where).count();
    const managedTotal = countRes && typeof countRes.total === "number" ? countRes.total : 0;
    const batchSize = 100;
    const batches = Math.ceil(managedTotal / batchSize);
    const allGyms = [];
    for (let i = 0; i < batches; i++) {
      let batchRes;
      try {
        batchRes = await db.collection("RockGyms").where(where).skip(i * batchSize).limit(batchSize).get();
      } catch (e) {
        batchRes = { data: [] };
      }
      const rows = (batchRes && batchRes.data) || [];
      allGyms.push(...rows);
    }

    const visibleGyms = allGyms
      .filter(isGymVisible)
      .filter((item) => containsKeyword(item, keyword))
      .sort((a, b) => {
        const updatedA = Number((a && a.updatedAt) || (a && a.updated_at) || 0) || 0;
        const updatedB = Number((b && b.updatedAt) || (b && b.updated_at) || 0) || 0;
        return updatedB - updatedA;
      });
    const total = visibleGyms.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const summary = { gymCount: total, ...sumLines(visibleGyms) };
    const hasNext = total > skip + pageSize;
    const gyms = visibleGyms.slice(skip, skip + pageSize).map(normalizeGym);
    return ok({ gyms, hasNext, page, total, totalPages, keyword, summary }, tid);
  } catch (e) {
    return fail("GYM_OWNER_LIST_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

