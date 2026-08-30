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

function sumObject(obj) {
  let s = 0;
  if (!obj) return 0;
  Object.keys(obj).forEach((k) => {
    const n = Number(obj[k] || 0);
    if (Number.isFinite(n) && n > 0) s += n;
  });
  return s;
}

function normalizeDeltas(deltas) {
  const out = {};
  if (!deltas || typeof deltas !== "object") return out;
  Object.keys(deltas).forEach((k) => {
    const key = String(k).trim();
    const n = Number(deltas[k] || 0);
    if (!key) return;
    if (Number.isFinite(n) && n > 0) out[key] = Math.floor(n);
  });
  return out;
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function parseYMD(ymd) {
  if (!isValidYMD(ymd)) return null;
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatYMD(d) {
  const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function prevDay(ymd) {
  const d = parseYMD(ymd);
  if (!d) return "";
  d.setDate(d.getDate() - 1);
  return formatYMD(d);
}

function normalizeGymStatus(value) {
  const status = String(value == null ? "" : value).trim().toLowerCase();
  if (status === "deleted") return "deleted";
  if (status === "merged") return "merged";
  return "active";
}

function getGymName(gym) {
  return safeText(gym && (gym.name || gym.gymName || gym.title));
}

async function getGym(gymId) {
  const res = await db.collection("RockGyms").doc(gymId).get();
  return (res && res.data) || null;
}

async function resolveCycleIdByDate(gymId, date) {
  if (!gymId || !isValidYMD(date)) return "";
  const gymWhere = _.or([{ gym_id: gymId }, { gymId }, { gymID: gymId }]);
  const dateEnd = "9999-12-31";
  const whereSnake = _.and([
    { gym_id: gymId },
    { start_date: _.lte(date) },
    _.or([{ end_date: _.gte(date) }, { end_date: _.eq("") }, { end_date: _.exists(false) }])
  ]);
  const whereCamel = _.and([
    gymWhere,
    { startDate: _.lte(date) },
    _.or([{ endDate: _.gte(date) }, { endDate: _.eq("") }, { endDate: _.exists(false) }])
  ]);
  const tries = [
    { where: whereSnake, orderBy: "start_date" },
    { where: whereCamel, orderBy: "startDate" }
  ];
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    try {
      const res = await db.collection("RockGymCycles").where(t.where).orderBy(t.orderBy, "desc").limit(1).get();
      const doc = res && res.data && res.data[0] ? res.data[0] : null;
      if (doc && doc._id) return String(doc._id);
    } catch (e) {}
  }
  try {
    const res = await db.collection("RockGymCycles").where(gymWhere).limit(200).get();
    const list = (res && res.data) || [];
    const hit = list
      .map((c) => {
        const s = String(c.start_date || c.startDate || "");
        const e = String(c.end_date || c.endDate || dateEnd);
        return { _id: c._id, start: s, end: e };
      })
      .filter((c) => c._id && isValidYMD(c.start) && isValidYMD(c.end))
      .filter((c) => c.start <= date && date <= c.end)
      .sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
    return hit && hit._id ? String(hit._id) : "";
  } catch (e) {
    return "";
  }
}

function addCounts(target, src) {
  if (!target || !src || typeof src !== "object") return;
  Object.keys(src).forEach((k) => {
    const grade = String(k || "").trim();
    const n = Number(src[k] || 0);
    if (!grade) return;
    if (!Number.isFinite(n) || n <= 0) return;
    target[grade] = Number(target[grade] || 0) + n;
  });
}

function normalizeMode(mode) {
  const value = String(mode || "").toLowerCase();
  if (value === "boulder") return "boulder";
  if (value === "lead") return "lead";
  if (value === "rope") return "difficulty";
  if (value === "difficulty") return "difficulty";
  return "difficulty";
}

function toCategory(mode) {
  if (mode === "boulder") return "boulder";
  if (mode === "lead") return "lead";
  return "rope";
}

async function upsertDaily(uid, date, gymId, cycleId, category, deltas) {
  const col = db.collection("RockUserDailyProgress");
  const found = await col.where({ uid, date, gym_id: gymId, cycle_id: cycleId }).limit(1).get();
  const doc = found && found.data && found.data[0] ? found.data[0] : null;
  if (!doc) {
    const today = {};
    today[category] = { ...(deltas || {}) };
    await col.add({
      data: {
        uid,
        gym_id: gymId,
        cycle_id: cycleId,
        date,
        today,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    return;
  }
  const today = doc.today && typeof doc.today === "object" ? { ...doc.today } : {};
  const byCat = today[category] && typeof today[category] === "object" ? { ...today[category] } : {};
  addCounts(byCat, deltas);
  today[category] = byCat;
  await col.doc(doc._id).update({
    data: {
      today,
      updated_at: db.serverDate()
    }
  });
}

async function upsertCycle(uid, gymId, cycleId, category, deltas) {
  const col = db.collection("RockUserCycleProgress");
  const found = await col.where({ uid, gym_id: gymId, cycle_id: cycleId }).limit(1).get();
  const doc = found && found.data && found.data[0] ? found.data[0] : null;

  if (!doc) {
    const totals = { boulder: {}, rope: {}, lead: {} };
    addCounts(totals[category] || totals.rope, deltas);
    await col.add({
      data: {
        uid,
        gym_id: gymId,
        cycle_id: cycleId,
        totals,
        targets: { boulder: {}, rope: {}, lead: {} },
        cap_locked: false,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    return;
  }

  const totals = doc.totals && typeof doc.totals === "object" ? { ...doc.totals } : { boulder: {}, rope: {}, lead: {} };
  const byCat = totals[category] && typeof totals[category] === "object" ? { ...totals[category] } : {};
  addCounts(byCat, deltas);
  totals[category] = byCat;

  await col.doc(doc._id).update({
    data: {
      totals,
      updated_at: db.serverDate()
    }
  });
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const action = safeText(event && event.action) || "create";

    const userRes = await db
      .collection("RockUsers")
      .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
      .limit(1)
      .get();
    const userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const userId = userDoc && userDoc._id ? String(userDoc._id) : "";

    if (action === "revert_last") {
      const WINDOW_MS = 30 * 60 * 1000;
      const nowTs = Date.now();
      const latest = await db
        .collection("RockCheckinRecords")
        .where({ uid: openid })
        .orderBy("created_at", "desc")
        .limit(100)
        .get();
      const list = (latest && latest.data) || [];
      let anchorTs = 0;
      const candidates = [];
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        let ts = rec.createdAtMs || 0;
        if (!ts && rec.created_at && typeof rec.created_at === "object" && typeof rec.created_at.getTime === "function") ts = rec.created_at.getTime();
        if (!ts) continue;
        if (!anchorTs) anchorTs = ts;
        if (anchorTs - ts > 180 * 1000) break;
        candidates.push(rec);
      }
      if (!candidates.length) return fail("NOT_FOUND", "最近没有打卡记录", tid);
      if (nowTs - anchorTs > WINDOW_MS) return fail("OUTSIDE_REVOCATION_WINDOW", "超过 30 分钟撤销窗口", tid);
      const deltaAgg = {};
      const removedIds = [];
      for (let i = 0; i < candidates.length; i++) {
        const r = candidates[i];
        const id = String(r._id || "");
        const gid = String(r.gym_id || "");
        const cid = String(r.cycle_id || "");
        const cat = String(r.category || "");
        const dt = String(r.date || "");
        const grade = String(r.grade || "");
        const n = Number(r.count || 0);
        if (gid && cid && dt && grade && Number.isFinite(n) && n > 0) {
          const k = `${gid}|${cid}|${cat}|${dt}`;
          if (!deltaAgg[k]) deltaAgg[k] = { gid, cid, cat, dt, deltas: {} };
          deltaAgg[k].deltas[grade] = Number(deltaAgg[k].deltas[grade] || 0) + n;
        }
        if (id) { try { await db.collection("RockCheckinRecords").doc(id).remove(); removedIds.push(id); } catch (e) {} }
      }
      const keys = Object.keys(deltaAgg);
      for (let i = 0; i < keys.length; i++) {
        const row = deltaAgg[keys[i]];
        try {
          const dFound = await db.collection("RockUserDailyProgress").where({ uid: openid, gym_id: row.gid, cycle_id: row.cid, date: row.dt }).limit(1).get();
          const dDoc = dFound && dFound.data && dFound.data[0] ? dFound.data[0] : null;
          if (dDoc) {
            const today = dDoc.today && typeof dDoc.today === "object" ? { ...dDoc.today } : {};
            const catData = today[row.cat] && typeof today[row.cat] === "object" ? { ...today[row.cat] } : {};
            Object.keys(row.deltas).forEach((g) => {
              const old = Number(catData[g] || 0);
              const nv = Math.max(0, old - Number(row.deltas[g] || 0));
              if (nv <= 0) delete catData[g]; else catData[g] = nv;
            });
            today[row.cat] = catData;
            await db.collection("RockUserDailyProgress").doc(String(dDoc._id)).update({ data: { today, updated_at: db.serverDate() } });
          }
        } catch (e) {}
        try {
          const cFound = await db.collection("RockUserCycleProgress").where({ uid: openid, gym_id: row.gid, cycle_id: row.cid }).limit(1).get();
          const cDoc = cFound && cFound.data && cFound.data[0] ? cFound.data[0] : null;
          if (cDoc) {
            const totals = cDoc.totals && typeof cDoc.totals === "object" ? { ...cDoc.totals } : { boulder: {}, rope: {}, lead: {} };
            const catData = totals[row.cat] && typeof totals[row.cat] === "object" ? { ...totals[row.cat] } : {};
            Object.keys(row.deltas).forEach((g) => {
              const old = Number(catData[g] || 0);
              const nv = Math.max(0, old - Number(row.deltas[g] || 0));
              if (nv <= 0) delete catData[g]; else catData[g] = nv;
            });
            totals[row.cat] = catData;
            await db.collection("RockUserCycleProgress").doc(String(cDoc._id)).update({ data: { totals, updated_at: db.serverDate() } });
          }
        } catch (e) {}
      }
      return ok({ removedCount: removedIds.length, createdAtTs: anchorTs }, tid);
    }

    const gymId = event && event.gymId ? String(event.gymId) : "";
    const date = event && event.date ? String(event.date) : "";
    const mode = normalizeMode(event && event.mode);
    const category = toCategory(mode);

    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);
    if (!date) return fail("BAD_REQUEST", "缺少 date", tid);
    if (!isValidYMD(date)) return fail("BAD_REQUEST", "date 格式应为 YYYY-MM-DD", tid);

    const deltas = normalizeDeltas(event && event.deltas ? event.deltas : null);
    const deltaSum = sumObject(deltas);
    if (!deltaSum) return fail("BAD_REQUEST", "deltas 为空", tid);

    const gym = await getGym(gymId);
    if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
    const gymStatus = normalizeGymStatus(gym.status);
    if (gymStatus === "deleted") return fail("GYM_INACTIVE", "该岩馆已下线，暂时不能打卡", tid);
    if (gymStatus === "merged") {
      const targetGymId = safeText(gym.mergedIntoGymId);
      let targetGymName = "";
      if (targetGymId) {
        try {
          const targetGym = await getGym(targetGymId);
          targetGymName = getGymName(targetGym);
        } catch (e) {}
      }
      return {
        ok: false,
        error: {
          code: "GYM_MERGED",
          message: "该岩馆已合并，正在跳转到目标岩馆",
          targetGymId,
          targetGymName
        },
        traceId: tid
      };
    }

    const cycleKey = await resolveCycleIdByDate(gymId, date);
    if (!cycleKey) {
      return {
        ok: false,
        error: {
          code: "NO_CYCLE",
          message: "当前岩馆还没有录入可用周期，暂时无法打卡。你可以先补录当前周期和线路数量；如果馆里已有周期，修改内容会进入管理员审核。",
          gymId,
          date,
          action: "setup_cycle_routes"
        },
        traceId: tid
      };
    }

    const recordIds = [];
    const grades = Object.keys(deltas);
    for (let i = 0; i < grades.length; i++) {
      const grade = grades[i];
      const count = Number(deltas[grade] || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      const rec = {
        uid: openid,
        gym_id: gymId,
        cycle_id: cycleKey,
        category,
        grade,
        count,
        date,
        note: "",
        black_talk_tags: [],
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      };
      const r = await db.collection("RockCheckinRecords").add({ data: rec });
      if (r && r._id) recordIds.push(r._id);
    }

    await upsertDaily(openid, date, gymId, cycleKey, category, deltas);
    await upsertCycle(openid, gymId, cycleKey, category, deltas);

    await db
      .collection("RockGyms")
      .doc(gymId)
      .update({
        data: {
          last_checkin_at: date,
          updated_at: db.serverDate()
        }
      });

    return ok({ recordIds }, tid);
  } catch (e) {
    return fail("CHECKIN_FAILED", e && e.message ? e.message : "提交失败", tid);
  }
};

