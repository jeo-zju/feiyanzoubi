const cloud = require("wx-server-sdk");
const guard = require("./demo-guard");

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

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;

    const action = safeText(event && event.action) || "create";

    if (!openid) return fail("AUTH_REQUIRED", "请登录后操作", tid);
    // 模拟身份（demo_ 合成 openid）不得打卡/写入任何内容——纵深防御
    await guard.assertRealActor(openid);
    if (action === "revert_last") {
      const submissionId = safeText(event && event.submissionId);
      if (!submissionId) return fail("BATCH_REQUIRED", "旧版打卡无法精确撤销，请更新后重新提交", tid);
      const result = await db.runTransaction(async tx => {
        const ref = tx.collection("RockCheckinSubmissions").doc(submissionId);
        const batch = await readDoc(ref);
        if (!batch || batch.openid !== openid) throw businessError("NOT_FOUND", "打卡批次不存在");
        if (batch.status === "revoked") return { submissionId, removedCount: 0 };
        if (Date.now() - batch.createdAtMs > 30 * 60 * 1000) throw businessError("OUTSIDE_REVOCATION_WINDOW", "超过 30 分钟撤销窗口");
        const dailyRef = tx.collection("RockUserDailyProgress").doc(batch.dailyId);
        const cycleRef = tx.collection("RockUserCycleProgress").doc(batch.cycleProgressId);
        const daily = await readDoc(dailyRef);
        const cycle = await readDoc(cycleRef);
        if (!daily || !cycle) throw businessError("INCONSISTENT_DATA", "汇总数据缺失，请联系管理员");
        const today = adjust(daily.today, batch.items, -1);
        const totals = adjust(cycle.totals, batch.items, -1);
        for (const id of batch.recordIds) await tx.collection("RockCheckinRecords").doc(id).remove();
        await dailyRef.update({ data: { today, updated_at: db.serverDate() } });
        await cycleRef.update({ data: { totals, updated_at: db.serverDate() } });
        await ref.update({ data: { status: "revoked", revokedAt: Date.now() } });
        return { submissionId, removedCount: batch.recordIds.length };
      });
      return ok(result, tid);
    }
    if (action !== "create") return fail("BAD_ACTION", "不支持的操作", tid);

    const gymId = event && event.gymId ? String(event.gymId) : "";
    const date = event && event.date ? String(event.date) : "";


    if (!gymId) return fail("BAD_REQUEST", "缺少 gymId", tid);
    if (!date) return fail("BAD_REQUEST", "缺少 date", tid);
    if (!isValidYMD(date)) return fail("BAD_REQUEST", "date 格式应为 YYYY-MM-DD", tid);

    const requestId = safeText(event && event.requestId);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return fail("REQUEST_ID_REQUIRED", "请更新小程序后重新提交", tid);
    const items = {};
    const input = event.items || { [normalizeMode(event.mode)]: event.deltas };
    for (const mode of ["boulder", "difficulty", "lead"]) {
      const counts = normalizeDeltas(input[mode]);
      for (const grade of Object.keys(counts)) {
        if (!/^[A-Za-z0-9.+-]{1,12}$/.test(grade) || counts[grade] > 999) return fail("BAD_REQUEST", "等级或数量无效", tid);
      }
      if (sumObject(counts)) items[toCategory(mode)] = counts;
    }
    if (!Object.keys(items).length) return fail("BAD_REQUEST", "请选择打卡数量", tid);
    const parsedDate = Date.parse(date + "T00:00:00+08:00");
    if (!Number.isFinite(parsedDate) || new Date(parsedDate + 8 * 3600000).toISOString().slice(0,10) !== date || parsedDate > Date.now()) return fail("BAD_REQUEST", "打卡日期无效", tid);

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

    const crypto = require("crypto");
    const hash = value => crypto.createHash("sha256").update(value).digest("hex").slice(0,32);
    const submissionId = "s_" + hash(openid + "|" + requestId);
    const identity = _.or([{ uid: openid }, { openid }, { _openid: openid }]);
    const findProgressId = async (collection, where, fallback) => {
      const r = await db.collection(collection).where(_.and([identity, where])).limit(2).get();
      if (r.data.length > 1) throw businessError("DUPLICATE_PROGRESS", "发现重复汇总，请联系管理员修复后提交");
      return r.data[0] ? r.data[0]._id : fallback;
    };
    const dailyId = await findProgressId("RockUserDailyProgress", { gym_id: gymId, cycle_id: cycleKey, date }, "d_" + hash(openid + "|" + gymId + "|" + cycleKey + "|" + date));
    const cycleProgressId = await findProgressId("RockUserCycleProgress", { gym_id: gymId, cycle_id: cycleKey }, "c_" + hash(openid + "|" + gymId + "|" + cycleKey));
    const fingerprint = JSON.stringify({ gymId, date, items });
    const result = await db.runTransaction(async tx => {
      const batchRef = tx.collection("RockCheckinSubmissions").doc(submissionId);
      const previous = await readDoc(batchRef);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw businessError("REQUEST_CONFLICT", "重试内容发生变化，请先确认上次提交结果");
        if (previous.status === "revoked") throw businessError("ALREADY_REVOKED", "该批次已撤销，请重新填写");
        return { submissionId, recordIds: previous.recordIds, createdAtMs: previous.createdAtMs };
      }
      const dailyRef = tx.collection("RockUserDailyProgress").doc(dailyId);
      const cycleRef = tx.collection("RockUserCycleProgress").doc(cycleProgressId);
      const daily = await readDoc(dailyRef);
      const cycle = await readDoc(cycleRef);
      const recordIds = [];
      const createdAtMs = Date.now();
      for (const category of Object.keys(items)) for (const grade of Object.keys(items[category])) {
        const id = "r_" + hash(submissionId + "|" + category + "|" + grade);
        await tx.collection("RockCheckinRecords").doc(id).set({ data: {
          uid: openid, openid, _openid: openid, gym_id: gymId, cycle_id: cycleKey,
          submissionId, category, grade, count: items[category][grade], date,
          createdAtMs, created_at: db.serverDate(), updated_at: db.serverDate()
        } });
        recordIds.push(id);
      }
      const base = { uid: openid, openid, _openid: openid, gym_id: gymId, cycle_id: cycleKey, updated_at: db.serverDate() };
      if (daily) await dailyRef.update({ data: { today: adjust(daily.today, items, 1), updated_at: db.serverDate() } });
      else await dailyRef.set({ data: { ...base, date, today: adjust({}, items, 1), created_at: db.serverDate() } });
      if (cycle) await cycleRef.update({ data: { totals: adjust(cycle.totals, items, 1), updated_at: db.serverDate() } });
      else await cycleRef.set({ data: { ...base, totals: adjust({}, items, 1), targets: { boulder: {}, rope: {}, lead: {} }, cap_locked: false, created_at: db.serverDate() } });
      await batchRef.set({ data: { openid, requestId, fingerprint, items, dailyId, cycleProgressId, recordIds, createdAtMs, status: "active" } });
      return { submissionId, recordIds, createdAtMs };
    });
    return ok(result, tid);
  } catch (e) {
    return fail(e.code || "CHECKIN_FAILED", e && e.message ? e.message : "提交失败", tid);
  }
};


function businessError(code, message) { return Object.assign(new Error(message), { code }); }
async function readDoc(ref) {
  try { const r = await ref.get(); return r.data || null; }
  catch (e) {
    if (/document.*(not.*exist|not.*found)|DOCUMENT_NOT_FOUND/i.test(String(e.errMsg || e.message || e.code))) return null;
    throw e;
  }
}
function adjust(source, items, direction) {
  const result = JSON.parse(JSON.stringify(source || {}));
  for (const category of Object.keys(items)) {
    if (!result[category]) result[category] = {};
    for (const grade of Object.keys(items[category])) {
      const value = Number(result[category][grade] || 0) + direction * items[category][grade];
      if (value < 0) throw businessError("INCONSISTENT_DATA", "进度数据不一致，请联系管理员");
      if (value) result[category][grade] = value; else delete result[category][grade];
    }
  }
  return result;
}
