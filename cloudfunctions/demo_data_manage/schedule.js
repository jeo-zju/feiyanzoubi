// 同时段约爬互斥：时间归一化、占用/释放、冲突判定的唯一实现。
// create/update/join/approve/unjoin/reject/remove/cancel 全部经过本模块，禁止各入口复制规则。
//
// 存储：RockUserScheduleDays，一用户一北京时间日期一个文档，确定性 ID（禁止随机 ID）。
// 同一用户同一天的所有占用写操作都读写同一文档，使并发请求在事务层冲突并重试。
const crypto = require("crypto");

const TZ_OFFSET_MS = 8 * 3600 * 1000;
const SLOT_DEFS = [
  { key: "morning", label: "上午", startMin: 10 * 60, endMin: 14 * 60 },
  { key: "afternoon", label: "下午", startMin: 14 * 60, endMin: 18 * 60 },
  { key: "evening", label: "晚上", startMin: 18 * 60, endMin: 22 * 60 }
];
const SLOT_KEYS = SLOT_DEFS.map((d) => d.key);
const SLOT_MAP = SLOT_DEFS.reduce((m, d) => { m[d.key] = d; return m; }, {});
const WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const SCHEMA_VERSION = 1;
const MAX_TX_RETRIES = 5;

function scheduleError(code, message, info) {
  return Object.assign(new Error(message), { code, conflict: info || null });
}

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

function beijingYMD(ms) {
  const d = new Date(Number(ms) + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function dayStartMs(ymd) {
  return Date.parse(`${ymd}T00:00:00+08:00`);
}

function dayEndMs(ymd) {
  return dayStartMs(ymd) + 24 * 3600 * 1000;
}

function addDaysYMD(ymd, days) {
  const ms = dayStartMs(ymd) + days * 24 * 3600 * 1000;
  return beijingYMD(ms);
}

function validYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) &&
    Number.isFinite(dayStartMs(String(v)));
}

function hmToMin(hm) {
  const m = String(hm || "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function minToHM(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// 新区间（[startAt,endAt)）按北京日期切成每天一段；兼容旧跨日数据
function splitByBeijingDay(startAt, endAt) {
  const out = [];
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return out;
  let date = beijingYMD(startAt);
  for (let guard = 0; guard < 16; guard++) {
    const ds = dayStartMs(date);
    const de = ds + 24 * 3600 * 1000;
    const s = Math.max(startAt, ds);
    const e = Math.min(endAt, de);
    if (e > s) out.push({ date, startAt: s, endAt: e });
    if (endAt <= de) break;
    date = beijingYMD(de);
  }
  return out;
}

function overlaps(a, b) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

// 新请求：服务端按 timeSlots 自行派生时间，不信任客户端 startTime/endTime（防伪造绕检）
function normalizeNewSlots(date, rawSlots) {
  if (!validYMD(date)) throw scheduleError("BAD_REQUEST", "日期无效");
  const keys = [];
  (Array.isArray(rawSlots) ? rawSlots : []).forEach((k) => {
    if (SLOT_KEYS.indexOf(k) >= 0 && keys.indexOf(k) < 0) keys.push(k);
  });
  keys.sort((a, b) => SLOT_KEYS.indexOf(a) - SLOT_KEYS.indexOf(b));
  if (!keys.length) throw scheduleError("BAD_REQUEST", "请选择活动时段（上午/下午/晚上）");
  const byDate = {};
  keys.forEach((key) => {
    const def = SLOT_MAP[key];
    const startAt = dayStartMs(date) + def.startMin * 60000;
    const endAt = dayStartMs(date) + def.endMin * 60000;
    (byDate[date] = byDate[date] || []).push({ startAt, endAt });
  });
  const starts = keys.map((k) => SLOT_MAP[k].startMin);
  const ends = keys.map((k) => SLOT_MAP[k].endMin);
  const startTime = minToHM(Math.min.apply(null, starts));
  const endTime = minToHM(Math.max.apply(null, ends));
  return {
    date,
    slots: keys,
    byDate,
    startTime,
    endTime,
    startAt: dayStartMs(date) + Math.min.apply(null, starts) * 60000,
    endAt: dayStartMs(date) + Math.max.apply(null, ends) * 60000,
    durationMin: Math.max.apply(null, ends) - Math.min.apply(null, starts)
  };
}

// 旧客户端/旧数据：显式旧数据兼容分支，按实际起止区间比较（不做时段舍入，避免漏判）
function legacyCandidate(date, startTime, endTime) {
  if (!validYMD(date)) throw scheduleError("BAD_REQUEST", "日期无效");
  const s = hmToMin(startTime);
  const e = hmToMin(endTime);
  if (s == null || e == null || e <= s) throw scheduleError("BAD_REQUEST", "时间段格式错误");
  const startAt = dayStartMs(date) + s * 60000;
  const endAt = dayStartMs(date) + e * 60000;
  const segments = splitByBeijingDay(startAt, endAt);
  const byDate = {};
  segments.forEach((seg) => { (byDate[seg.date] = byDate[seg.date] || []).push({ startAt: seg.startAt, endAt: seg.endAt }); });
  return { date, slots: [], byDate, startTime, endTime, startAt, endAt, durationMin: e - s };
}

function planEndAt(plan) {
  return Number(plan && plan.endAt) ||
    (plan && plan.date && plan.endTime ? Date.parse(`${plan.date}T${plan.endTime}:00+08:00`) : 0);
}

function planJoinDeadline(plan) {
  return Number(plan && plan.joinDeadline) || planEndAt(plan);
}

// 计划文档 → 占用候选：新数据用 timeSlots；旧数据用实际区间（可能跨多日）
function candidateFromPlan(plan) {
  const date = String((plan && plan.date) || "");
  const slots = Array.isArray(plan && plan.timeSlots)
    ? SLOT_KEYS.filter((k) => plan.timeSlots.indexOf(k) >= 0)
    : [];
  if (slots.length) return normalizeNewSlots(date, slots);
  return legacyCandidate(date, plan && plan.startTime, plan && plan.endTime);
}

// 一段区间覆盖了哪些标准时段（用于冲突文案；旧局 13:00–15:00 同时命中上午/下午）
function touchedSlotKeys(date, segment) {
  return SLOT_DEFS.filter((def) => {
    const a = { startAt: dayStartMs(date) + def.startMin * 60000, endAt: dayStartMs(date) + def.endMin * 60000 };
    return overlaps(a, segment);
  }).map((d) => d.key);
}

function describeConflict(date, slotKeys) {
  const keys = SLOT_KEYS.filter((k) => (slotKeys || []).indexOf(k) >= 0);
  const wk = validYMD(date) ? WEEK_LABELS[new Date(dayStartMs(date) + TZ_OFFSET_MS).getUTCDay()] : "";
  const label = keys.map((k) => SLOT_MAP[k].label).join("、");
  if (wk && label) return `${wk}${label}你已有约爬`;
  return "该时段你已有约爬";
}

function dayDocId(openid, date) {
  return "sd_" + crypto.createHash("sha256").update(`${openid}|${date}`).digest("hex").slice(0, 32);
}

async function optionalTxDoc(ref) {
  try {
    return (await ref.get()).data || null;
  } catch (e) {
    if (/document.*(not.*exist|not.*found)|DOCUMENT_NOT_FOUND/i.test(String(e.errMsg || e.message || e.code))) return null;
    throw e;
  }
}

// ---------- 维护开关：回填窗口期冻结约爬写入（旧客户端同样受约束） ----------
let gateCache = { at: 0, blocked: false };
async function assertWritesEnabled(db) {
  const now = Date.now();
  if (now - gateCache.at > 20000) {
    let blocked = false;
    try {
      const r = await db.collection("RockAppConfig").doc("schedule").get();
      blocked = !!(r && r.data && r.data.maintenance);
    } catch (e) { blocked = false; }
    gateCache = { at: now, blocked };
  }
  if (gateCache.blocked) {
    throw scheduleError("SCHEDULE_MAINTENANCE", "约爬系统维护中，暂时不能发起或报名，请稍后再试");
  }
}

function entryLive(entry, plan, now) {
  if (!entry || !plan) return false;
  if (plan.status && plan.status !== "active") return false;
  if (planEndAt(plan) <= now) return false;
  // pending 超过有效申请截止即失效（实时判定，不依赖定时任务）；已确认不受截止影响
  if (entry.status === "pending" && planJoinDeadline(plan) <= now) return false;
  return true;
}

// 读取若干日期的日程文档，事务内核验引用计划的有效状态，返回需回写的清理结果
async function evaluateDays(tx, openid, dates, now) {
  const result = [];
  for (const date of [].concat(dates)) {
    const ref = tx.collection("RockUserScheduleDays").doc(dayDocId(openid, date));
    const doc = await optionalTxDoc(ref);
    const rawEntries = (doc && Array.isArray(doc.entries)) ? doc.entries : [];
    const planIds = [...new Set(rawEntries.map((e) => e && e.planId).filter(Boolean))];
    const plans = new Map();
    for (const planId of planIds) {
      // 计划文档在事务内读取：取消/结束与报名竞争时必然产生事务冲突并重判
      const p = await optionalTxDoc(tx.collection("RockCalendarPlans").doc(planId));
      if (p) plans.set(planId, p);
    }
    const live = [];
    let changed = false;
    for (const entry of rawEntries) {
      if (!entry || !entry.planId) { changed = true; continue; }
      const plan = plans.get(entry.planId);
      if (!entryLive(entry, plan || null, now)) { changed = true; continue; }
      live.push(entry);
    }
    // 同计划同文档去重（历史脏数据保护，确定性保留较新的一条）
    const dedup = new Map();
    live.forEach((entry) => {
      const prev = dedup.get(entry.planId);
      if (!prev || Number(entry.updatedAt || 0) > Number(prev.updatedAt || 0)) dedup.set(entry.planId, entry);
    });
    if (dedup.size !== live.length) changed = true;
    result.push({ date, ref, doc, openid, entries: [...dedup.values()], changed, plans });
  }
  return result;
}

function writeDayDocs(dayInfos) {
  const writes = [];
  dayInfos.forEach((info) => {
    if (!info.changed) return;
    const base = info.doc || { _id: undefined };
    const data = {
      openid: base.openid || info.openid || "",
      date: info.date,
      v: SCHEMA_VERSION,
      entries: info.entries,
      updatedAt: Date.now()
    };
    // 事务内 update 不存在的文档会失败：首次创建必须走 set（确定性 ID 保证并发只成一条）
    writes.push({ ref: info.ref, data, exists: !!info.doc });
  });
  return writes;
}

async function commitDayWrites(dayInfos) {
  for (const w of writeDayDocs(dayInfos)) {
    if (w.exists) await w.ref.update({ data: w.data });
    else await w.ref.set({ data: w.data });
  }
}

// 在已评估的日程中查找与候选区间冲突的有效占用；excludePlanId 跳过本人当前局
function findConflict(dayInfos, candidateByDate, excludePlanId) {
  for (const date of Object.keys(candidateByDate)) {
    const info = dayInfos.find((d) => d.date === date);
    if (!info) continue;
    const candidateSegs = candidateByDate[date] || [];
    for (const entry of info.entries) {
      if (entry.planId === excludePlanId) continue;
      const segs = (Array.isArray(entry.segments) ? entry.segments : [])
        .filter((s) => s && Number.isFinite(s.startAt) && Number.isFinite(s.endAt));
      const hitSeg = segs.find((s) => candidateSegs.some((c) => overlaps(c, s)));
      if (hitSeg) return { date, entry, plan: info.plans.get(entry.planId), hitSeg };
    }
  }
  return null;
}

function buildEntry(candidate, date, status, now) {
  const segs = (candidate.byDate[date] || []).map((s) => ({ startAt: s.startAt, endAt: s.endAt }));
  return {
    planId: "",
    status,
    slots: candidate.slots || [],
    planDate: candidate.date,
    segments: segs,
    updatedAt: now
  };
}

// 冲突 → 统一错误（调用方决定是否带可见 planId）
function conflictError(hit, candidate, options) {
  const opts = options || {};
  // 展示用时段：新数据取已有局时段与候选时段的交集；旧数据取候选区间覆盖的标准时段
  const candidateKeys = touchedSlotKeys(hit.date, hit.hitSeg);
  const existingKeys = Array.isArray(hit.entry.slots) ? hit.entry.slots : [];
  const slotKeys = existingKeys.length
    ? existingKeys.filter((k) => candidateKeys.indexOf(k) >= 0)
    : candidateKeys;
  const info = {
    date: hit.date,
    slots: slotKeys,
    planId: opts.includePlanId ? hit.entry.planId : ""
  };
  return scheduleError("SCHEDULE_CONFLICT", opts.message || describeConflict(hit.date, slotKeys), info);
}

// create/join/approve：检查并建立占用
async function occupy(tx, opts) {
  const { openid, planId, status, candidate, excludePlanId, now } = opts;
  const dates = Object.keys(candidate.byDate).sort();
  const dayInfos = await evaluateDays(tx, openid, dates, now);
  const hit = findConflict(dayInfos, candidate.byDate, excludePlanId);
  if (hit) throw conflictError(hit, candidate, opts.conflictOptions || null);
  dayInfos.forEach((info) => {
    const entry = buildEntry(candidate, info.date, status, now);
    entry.planId = planId;
    const idx = info.entries.findIndex((e) => e.planId === planId);
    if (idx >= 0) info.entries[idx] = entry;
    else info.entries.push(entry);
    info.changed = true;
  });
  return dayInfos;
}

// 幂等修复：重复报名/重复审批不产生第二条占用，也不因历史冲突误伤幂等请求
async function ensureOccupancy(tx, opts) {
  const { openid, planId, status, candidate, now } = opts;
  const dates = Object.keys(candidate.byDate).sort();
  const dayInfos = await evaluateDays(tx, openid, dates, now);
  dayInfos.forEach((info) => {
    const entry = buildEntry(candidate, info.date, status, now);
    entry.planId = planId;
    const idx = info.entries.findIndex((e) => e.planId === planId);
    if (idx >= 0) info.entries[idx] = entry;
    else info.entries.push(entry);
    info.changed = true;
  });
  return dayInfos;
}

// update：原子释放旧占用 + 建立新占用（同一事务）
async function replaceHost(tx, opts) {
  const { openid, planId, candidate, oldDates, now } = opts;
  const newDates = Object.keys(candidate.byDate);
  const allDates = [...new Set([].concat(oldDates || [], newDates))].sort();
  const dayInfos = await evaluateDays(tx, openid, allDates, now);
  const hit = findConflict(dayInfos, candidate.byDate, planId);
  if (hit) throw conflictError(hit, candidate, opts.conflictOptions || null);
  dayInfos.forEach((info) => {
    const before = info.entries.length;
    info.entries = info.entries.filter((e) => e.planId !== planId);
    if (newDates.indexOf(info.date) >= 0) {
      const entry = buildEntry(candidate, info.date, "host", now);
      entry.planId = planId;
      info.entries.push(entry);
      // 同长度替换（如上午改下午，仍在同一天文档）也必须回写
      info.changed = true;
    } else if (info.entries.length !== before) {
      info.changed = true;
    }
  });
  return dayInfos;
}

// 退出/拒绝/移除：只释放目标约爬在指定日期的占用
async function release(tx, opts) {
  const { openid, planId, dates, now } = opts;
  const sorted = [...new Set([].concat(dates || []))].filter(validYMD).sort();
  if (!sorted.length) return [];
  const dayInfos = await evaluateDays(tx, openid, sorted, now);
  dayInfos.forEach((info) => {
    const next = info.entries.filter((e) => e.planId !== planId);
    if (next.length !== info.entries.length) {
      info.entries = next;
      info.changed = true;
    }
  });
  return dayInfos;
}

// 取消后的非事务尽力清理：只用于减少数据量，是否允许参加以事务内计划状态校验为准
async function cleanupPlanOccupancy(db, plan, openids, now) {
  let candidate;
  try { candidate = candidateFromPlan(plan); } catch (e) { return; }
  const dates = Object.keys(candidate.byDate).sort();
  for (const openid of [...new Set((openids || []).filter(Boolean))]) {
    for (const date of dates) {
      const ref = db.collection("RockUserScheduleDays").doc(dayDocId(openid, date));
      try {
        const doc = await optionalTxDoc(ref);
        if (!doc || !Array.isArray(doc.entries)) continue;
        const entries = doc.entries.filter((e) => e && e.planId !== plan._id);
        if (entries.length === doc.entries.length) continue;
        await ref.update({ data: { entries, updatedAt: now || Date.now() } });
      } catch (e) {}
    }
  }
}

function isTransactionConflict(e) {
  if (!e) return false;
  if (Number(e.errCode) === -50202 || Number(e.code) === -50202) return true;
  return /transaction.*(conflict|busy|abort)|database update conflict|resource busy|db.*conflict/i.test(
    String(e.errMsg || e.message || "")
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 有限重试：事务冲突后整段重读重判；耗尽返回可重试失败，绝不按成功处理
async function withRetries(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (!isTransactionConflict(e) || attempt === MAX_TX_RETRIES) throw e;
      await sleep(40 * Math.pow(2, attempt) + Math.floor(Math.random() * 50));
    }
  }
  throw lastErr;
}

module.exports = {
  SLOT_DEFS,
  SLOT_KEYS,
  TZ_OFFSET_MS,
  scheduleError,
  beijingYMD,
  dayStartMs,
  addDaysYMD,
  validYMD,
  hmToMin,
  splitByBeijingDay,
  overlaps,
  normalizeNewSlots,
  legacyCandidate,
  candidateFromPlan,
  planEndAt,
  planJoinDeadline,
  touchedSlotKeys,
  describeConflict,
  dayDocId,
  optionalTxDoc,
  assertWritesEnabled,
  evaluateDays,
  findConflict,
  conflictError,
  occupy,
  ensureOccupancy,
  replaceHost,
  release,
  commitDayWrites,
  cleanupPlanOccupancy,
  isTransactionConflict,
  withRetries
};
