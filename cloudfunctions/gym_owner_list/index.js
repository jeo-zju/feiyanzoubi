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
    lastCheckinAt: g.lastCheckinAt || g.lastVisitAt || g.last_checkin_at || "",
    visitCount: typeof g.visitCount === "number" ? g.visitCount : typeof g.visit_count === "number" ? g.visit_count : 0,
    updatedAt: g.updatedAt || g.updateTime || g.updated_at || g.createdAt || 0
  };
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(20, Number(event && event.pageSize ? event.pageSize : 5)));
    const skip = (page - 1) * pageSize;

    const where = _.or([
      { owner_uid: openid },
      { ownerOpenid: openid },
      { owner_uid: _.in([openid]) },
      { managerOpenids: _.in([openid]) },
      { managers: _.in([openid]) }
    ]);

    let res;
    try {
      res = await db.collection("RockGyms").where(where).orderBy("updatedAt", "desc").skip(skip).limit(pageSize + 1).get();
    } catch (e) {
      res = await db.collection("RockGyms").where(where).skip(skip).limit(pageSize + 1).get();
    }

    const list = (res && res.data) || [];
    const hasNext = list.length > pageSize;
    const gyms = list.slice(0, pageSize).map(normalizeGym);
    return ok({ gyms, hasNext, page }, tid);
  } catch (e) {
    return fail("GYM_OWNER_LIST_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

