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

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shiftDays(ymd, delta) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  d.setDate(d.getDate() + delta);
  return formatYMD(d);
}

function sumObject(obj) {
  let s = 0;
  if (!obj) return 0;
  Object.keys(obj).forEach((k) => {
    const n = Number(obj[k] || 0);
    if (Number.isFinite(n) && n > 0) s += n;
  });
  return s;
}

function sumToday(today) {
  if (!today || typeof today !== "object" || Array.isArray(today)) return 0;
  return (
    sumObject(today.boulder || today.boulders || {}) +
    sumObject(today.difficulty || today.rope || today.ropes || {}) +
    sumObject(today.lead || today.leads || {}) +
    sumObject(today.other || {})
  );
}

function normalizeMode(category, mode) {
  const c = String(category || mode || "").toLowerCase();
  if (c === "boulder") return "boulder";
  if (c === "lead") return "lead";
  if (c === "rope") return "difficulty";
  if (c === "difficulty") return "difficulty";
  return "boulder";
}

async function fetchRecentRecordsBatch(db, userWhere, skip, limit) {
  try {
    const res = await db
      .collection("RockCheckinRecords")
      .where(userWhere)
      .orderBy("date", "desc")
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(limit)
      .get();
    return (res && res.data) || [];
  } catch (e1) {
    try {
      const res = await db
        .collection("RockCheckinRecords")
        .where(userWhere)
        .orderBy("date", "desc")
        .skip(skip)
        .limit(limit)
        .get();
      return (res && res.data) || [];
    } catch (e2) {
      const res = await db.collection("RockCheckinRecords").where(userWhere).skip(skip).limit(limit).get();
      return (res && res.data) || [];
    }
  }
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

    const days = Math.max(1, Math.min(90, Number(event && event.days ? event.days : 30)));
    const page = Math.max(1, Number(event && event.page ? event.page : 1));
    const pageSize = Math.max(1, Math.min(20, Number(event && event.pageSize ? event.pageSize : 5)));

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));

    const startYMD = formatYMD(start);
    const endYMD = formatYMD(end);

    const dateRange = _.gte(startYMD).and(_.lte(endYMD));
    let rangeRecordsRes;
    try {
      rangeRecordsRes = await db
        .collection("RockCheckinRecords")
        .where(_.or(userWhereParts.map((p) => ({ ...p, date: dateRange }))))
        .limit(5000)
        .get();
    } catch (e) {
      rangeRecordsRes = null;
    }
    const rangeRecords = (rangeRecordsRes && rangeRecordsRes.data) || [];
    const dateToDeltaFromRecords = {};
    const gymIdSet = new Set();
    const visitKeySet = new Set();
    let rangeRouteCount = 0;
    rangeRecords.forEach((r) => {
      if (!r) return;
      const gid = String(r.gym_id || r.gymId || r.gymID || "");
      const date = String(r.date || "");
      if (gid) gymIdSet.add(gid);
      if (gid && date) visitKeySet.add(`${gid}|${date}`);
      const d = Number(r.count || r.deltaSum || r.delta_sum || 0);
      if (Number.isFinite(d) && d > 0) {
        rangeRouteCount += d;
        if (date) dateToDeltaFromRecords[date] = Number(dateToDeltaFromRecords[date] || 0) + d;
      }
    });

    let dateToDelta = { ...dateToDeltaFromRecords };
    try {
      const dailyRes = await db
        .collection("RockUserDailyProgress")
        .where(_.or(userWhereParts.map((p) => ({ ...p, date: dateRange }))))
        .limit(1000)
        .get();
      const daily = (dailyRes && dailyRes.data) || [];
      const dailyMap = {};
      daily.forEach((d) => {
        if (!d || !d.date) return;
        const v =
          Number(d.count || 0) ||
          sumToday(d.today) ||
          (d.totals ? Number((d.totals.boulder || 0) + (d.totals.difficulty || 0) + (d.totals.lead || 0)) : 0);
        if (!Number.isFinite(v)) return;
        dailyMap[d.date] = Number(dailyMap[d.date] || 0) + v;
      });
      const hasDailyNonZero = Object.keys(dailyMap).some((k) => Number(dailyMap[k] || 0) > 0);
      if (hasDailyNonZero) dateToDelta = dailyMap;
    } catch (e) {}

    const chartPoints = [];
    for (let i = 0; i < days; i++) {
      const ymd = shiftDays(startYMD, i);
      chartPoints.push(Number(dateToDelta[ymd] || 0));
    }

    const grouped = {};
    const startIdx = (page - 1) * pageSize;
    const groupedTarget = startIdx + pageSize + 1;
    const batchSize = Math.max(100, pageSize * 40);
    let skip = 0;
    let exhausted = false;
    while (!exhausted) {
      const records = await fetchRecentRecordsBatch(db, userWhere, skip, batchSize);
      if (!records.length) break;
      records.forEach((r) => {
        if (!r) return;
        const gid = String(r.gym_id || r.gymId || r.gymID || "");
        const date = String(r.date || "");
        const mode = normalizeMode(r.category, r.mode);
        if (!gid || !date) return;
        const key = `${gid}|${date}|${mode}`;
        if (!grouped[key]) grouped[key] = { _id: key, gymId: gid, date, mode, delta: 0 };

        let d = 0;
        if (r.count != null) d = Number(r.count || 0);
        else if (r.deltaSum != null) d = Number(r.deltaSum || 0);
        else if (r.delta_sum != null) d = Number(r.delta_sum || 0);
        else if (r.deltas && typeof r.deltas === "object" && !Array.isArray(r.deltas)) d = sumObject(r.deltas);
        if (Number.isFinite(d) && d > 0) grouped[key].delta += d;
      });
      skip += records.length;
      exhausted = records.length < batchSize || Object.keys(grouped).length > groupedTarget;
    }

    const groupedList = Object.values(grouped).sort((a, b) => {
      const d = String(b.date || "").localeCompare(String(a.date || ""));
      if (d) return d;
      const g = String(b.gymId || "").localeCompare(String(a.gymId || ""));
      if (g) return g;
      return String(b.mode || "").localeCompare(String(a.mode || ""));
    });
    const pageItems = groupedList.slice(startIdx, startIdx + pageSize);
    const hasNext = groupedList.length > startIdx + pageSize || !exhausted;

    const gymIds = Array.from(new Set(pageItems.map((r) => r.gymId).filter(Boolean)));
    let gymsById = {};
    if (gymIds.length) {
      const gymsRes = await db
        .collection("RockGyms")
        .where({ _id: _.in(gymIds) })
        .limit(100)
        .get();
      const gyms = (gymsRes && gymsRes.data) || [];
      gymsById = gyms.reduce((m, g) => {
        m[g._id] = g;
        return m;
      }, {});
    }

    const recent = pageItems.map((r) => ({
      _id: r._id,
      gymId: r.gymId,
      gymName: (gymsById[r.gymId] && gymsById[r.gymId].name) || "",
      date: r.date,
      mode: r.mode,
      delta: r.delta
    }));

    const gymCount = gymIdSet.size;
    const visitCount = visitKeySet.size;
    const summaryText = `最近${days}天你累计爬过${visitCount}次，去过${gymCount}家攀岩馆，累计打卡${rangeRouteCount}条线路。`;

    return ok({ chartPoints, summaryText, recent, hasNext }, tid);
  } catch (e) {
    return fail("STATS_FAILED", e && e.message ? e.message : "统计失败", tid);
  }
};

