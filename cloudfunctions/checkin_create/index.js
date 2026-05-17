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

async function getGym(gymId) {
  const res = await db.collection("RockGyms").doc(gymId).get();
  return (res && res.data) || null;
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
    const totals = { boulder: {}, rope: {} };
    addCounts(category === "boulder" ? totals.boulder : totals.rope, deltas);
    await col.add({
      data: {
        uid,
        gym_id: gymId,
        cycle_id: cycleId,
        totals,
        targets: { boulder: {}, rope: {} },
        cap_locked: false,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
    return;
  }

  const totals = doc.totals && typeof doc.totals === "object" ? { ...doc.totals } : { boulder: {}, rope: {} };
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

    const userRes = await db
      .collection("RockUsers")
      .where(_.or([{ openid }, { _openid: openid }, { uid: openid }]))
      .limit(1)
      .get();
    const userDoc = userRes && userRes.data && userRes.data[0] ? userRes.data[0] : null;
    const userId = userDoc && userDoc._id ? String(userDoc._id) : "";

    const gymId = event && event.gymId ? String(event.gymId) : "";
    const date = event && event.date ? String(event.date) : "";
    const mode = event && event.mode === "boulder" ? "boulder" : "difficulty";
    const category = mode === "difficulty" ? "rope" : "boulder";
    const cycleId = event && event.cycleId ? String(event.cycleId) : "";

    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);
    if (!date) return fail("BAD_REQUEST", "缺少 date", tid);

    const deltas = normalizeDeltas(event && event.deltas ? event.deltas : null);
    const deltaSum = sumObject(deltas);
    if (!deltaSum) return fail("BAD_REQUEST", "deltas 为空", tid);

    const gym = await getGym(gymId);
    if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);

    const gymCycleId = gym.current_cycle_id || gym.currentCycleId || "";
    const cycleKey = cycleId || gymCycleId || "default";

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

