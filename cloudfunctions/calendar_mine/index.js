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

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayYMD() {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  return formatYMD(utc8);
}

function monthStartYMD() {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  utc8.setDate(1);
  return formatYMD(utc8);
}

function daysAgo(n) {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000 - n * 86400000);
  return formatYMD(utc8);
}

function computeOverlapMinutes(aStart, aEnd, bStart, bEnd) {
  const toMin = (t) => {
    const m = String(t).match(/^(\d{2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  const as = toMin(aStart);
  const ae = toMin(aEnd);
  const bs = toMin(bStart);
  const be = toMin(bEnd);
  const s = Math.max(as, bs);
  const e = Math.min(ae, be);
  return Math.max(0, e - s);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("AUTH_REQUIRED", "请登录后操作", tid);

    const range = safeText(event && event.range) || "all";
    const tab = safeText(event && event.tab) || "";
    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(50, Number(event && event.pageSize ? event.pageSize : 20)));
    const skip = (page - 1) * pageSize;

    const includeJoined = tab === "joined" || !!(event && event.includeJoined);

    const today = todayYMD();
    const monthStart = monthStartYMD();

    const col = db.collection("RockCalendarPlans");
    const mineWhere = _.or([{ _openid: openid }, { openid }, { uid: openid }]);
    const activeWhere = _.or([{ status: "active" }, { status: _.exists(false) }, { status: null }]);
    const baseActiveMine = _.and([mineWhere, activeWhere]);

    const monthRes = await col.where(_.and([baseActiveMine, { date: _.gte(monthStart) }])).limit(200).get();
    const monthPlans = (monthRes && monthRes.data) || [];

    const thisMonthPlans = monthPlans.length;
    const expiredPlans = monthPlans.filter((p) => p.date < today && p.status !== "cancelled");
    const checkined = expiredPlans.filter((p) => !!(p && p.checkinRecordId));
    const thisMonthCheckinRate = expiredPlans.length ? Math.round((checkined.length * 100) / expiredPlans.length) / 100 : 0;

    const gymCount = {};
    monthPlans.forEach((p) => {
      if (!p || p.status === "cancelled") return;
      const name = (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "野攀";
      gymCount[name] = Number(gymCount[name] || 0) + 1;
    });
    let topGym = { name: "", count: 0 };
    Object.keys(gymCount).forEach((k) => {
      if (gymCount[k] > topGym.count) topGym = { name: k, count: gymCount[k] };
    });

    const partners = new Set();
    const todayAndUpcoming = monthPlans.filter((p) => p.date >= today);
    if (todayAndUpcoming.length) {
      const dateGymMap = {};
      todayAndUpcoming.forEach((p) => {
        const k = `${p.date}__${p.gymId || "outdoor"}`;
        if (!dateGymMap[k]) dateGymMap[k] = [];
        dateGymMap[k].push(p);
      });
      const keys = Object.keys(dateGymMap);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const parts = k.split("__");
        const date = parts[0];
        const gid = parts[1];
        const mine = dateGymMap[k].filter((p) => (p._openid || p.uid) === openid);
        if (!mine.length) continue;
        const othersRes = await col
          .where(
            _.and([
              { date },
              gid === "outdoor" ? { mode: "outdoor" } : { gymId: gid },
              { status: "active" },
              _.and([{ visibility: "public" }])
            ])
          )
          .limit(200)
          .get();
        const others = (othersRes && othersRes.data) || [];
        mine.forEach((m) => {
          others.forEach((o) => {
            const uid = o._openid || o.uid;
            if (!uid || uid === openid) return;
            if (computeOverlapMinutes(m.startTime, m.endTime, o.startTime, o.endTime) >= 30) {
              partners.add(uid);
            }
          });
        });
      }
    }
    const totalPartners = partners.size;

    const last14Start = daysAgo(13);
    const recent = await col
      .where(_.and([baseActiveMine, { date: _.gte(last14Start) }]))
      .orderBy("date", "desc")
      .limit(200)
      .get();
    const recentPlans = (recent && recent.data) || [];
    const byDate = {};
    recentPlans.forEach((p) => {
      if (p.status === "cancelled") return;
      byDate[p.date] = (byDate[p.date] || 0) + 1;
    });
    const chartPoints = [];
    for (let i = 13; i >= 0; i--) {
      const d = daysAgo(i);
      chartPoints.push({ date: d, value: byDate[d] || 0 });
    }

    const summary = {
      thisMonthPlans,
      thisMonthCheckinRate,
      topGym,
      totalPartners,
      chartPoints
    };

    let upcoming = [];
    let past = [];
    let joined = [];
    let hasNext = false;

    if (tab !== "joined" && (range === "upcoming" || range === "all")) {
      const uRes = await col
        .where(_.and([baseActiveMine, { date: _.gte(today) }]))
        .orderBy("date", "asc")
        .orderBy("startTime", "asc")
        .skip(skip)
        .limit(pageSize + 1)
        .get();
      const list = (uRes && uRes.data) || [];
      hasNext = list.length > pageSize;
      upcoming = list.slice(0, pageSize);
    }
    if (tab !== "joined" && (range === "past" || range === "all")) {
      const pRes = await col
        .where(_.and([baseActiveMine, { date: _.lt(today) }]))
        .orderBy("date", "desc")
        .orderBy("startTime", "desc")
        .skip(skip)
        .limit(pageSize + 1)
        .get();
      const list = (pRes && pRes.data) || [];
      if (range === "past") hasNext = list.length > pageSize;
      past = list.slice(0, pageSize);
    }

    if (includeJoined || tab === "joined") {
      try {
        const joinCol = db.collection("RockCalendarJoins");
        const joinIdentityWhere = _.or([{ _openid: openid }, { openid }, { uid: openid }]);
        const jRes = await joinCol
          .where(joinIdentityWhere)
          .orderBy("createdAt", "desc")
          .skip(tab === "joined" ? skip : 0)
          .limit(tab === "joined" ? pageSize + 1 : 100)
          .get();
        const joinRows = (jRes && jRes.data) || [];
        const planIds = [...new Set(joinRows.map((r) => String(r.planId || "")).filter(Boolean))];
        if (planIds.length) {
          const pRes = await col.where({ _id: _.in(planIds) }).limit(planIds.length).get();
          const plans = (pRes && pRes.data) || [];
          const idToPlan = {};
          plans.forEach((p) => { idToPlan[String(p._id || "")] = p; });
          joinRows.forEach((r) => {
            const pl = idToPlan[String(r.planId || "")];
            if (pl) joined.push(pl);
          });
        }
        if (tab === "joined") {
          hasNext = joinRows.length > pageSize;
          joined = joined.slice(0, pageSize);
        }
      } catch (_) {
        joined = [];
      }
    }

    return ok({ upcoming, past, joined, summary, page, pageSize, hasNext }, tid);
  } catch (e) {
    return fail("MINE_FAILED", e && e.message ? e.message : "查询失败", tid);
  }
};
