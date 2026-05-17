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
    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(20, Number(event && event.pageSize ? event.pageSize : 5)));
    const skip = (page - 1) * pageSize;

    const col = db.collection("RockGyms");
    const whereParts = [];
    if (city) {
      whereParts.push({ city });
      whereParts.push({ cityName: city });
      whereParts.push({ locationCity: city });
    }
    if (keyword) {
      const re = db.RegExp({ regexp: keyword, options: "i" });
      whereParts.push({ name: re });
      whereParts.push({ gymName: re });
      whereParts.push({ title: re });
    }

    let where = {};
    if (whereParts.length === 1) where = whereParts[0];
    else if (whereParts.length > 1) where = _.or(whereParts);

    let res;
    try {
      res = await col.where(where).orderBy("updatedAt", "desc").skip(skip).limit(pageSize + 1).get();
    } catch (e) {
      res = await col.where(where).skip(skip).limit(pageSize + 1).get();
    }

    const list = (res && res.data) || [];
    const hasNext = list.length > pageSize;
    const gyms = list.slice(0, pageSize).map(normalizeGym);

    const gymIds = gyms.map((g) => g && g._id).filter(Boolean);
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
      const byGym = {};
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
      gyms.forEach((g) => {
        const m = byGym[g._id];
        g.userVisitCount = m ? m.dateSet.size : 0;
        g.userLastCheckinAt = m ? m.lastDate : "";
        g.userRouteCount = m ? m.routeCount : 0;
      });
    }
    return ok({ gyms, hasNext, page }, tid);
  } catch (e) {
    return fail("GYM_LIST_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};

