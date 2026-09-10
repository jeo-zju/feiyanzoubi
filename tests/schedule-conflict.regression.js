// 同时段约爬互斥回归：node tests/schedule-conflict.regression.js
// 纯 node + 内存 mock（与 tests/regression.js 同一套），无需云凭证。
// 注意：mock 事务为串行快照，不能替代真实云并发双账号验收（见 SCHEDULE_CONFLICT_ADJUSTMENT_PLAN.md 第 8 节）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const schedule = require(path.join(root, "cloudfunctions/calendar_plan_publish/schedule.js"));

const copy = value => structuredClone(value);
const operator = (op, args) => ({ __op: op, args });
const command = new Proxy({}, { get: (_, op) => (...args) => operator(op, args) });
const field = (row, key) => key.split(".").reduce((r, k) => r == null ? undefined : r[k], row);
function matches(row, query) {
  if (query.__op === "and") return query.args[0].every(q => matches(row, q));
  if (query.__op === "or") return query.args[0].some(q => matches(row, q));
  return Object.entries(query).every(([key, value]) => compare(field(row, key), value));
}
function compare(actual, expected) {
  if (expected && expected.__op) {
    const v = expected.args[0];
    switch (expected.__op) {
      case "in": if(v.length>50) throw new Error("Mock rejects unbounded in query"); return Array.isArray(actual) ? actual.some(x => v.includes(x)) : v.includes(actual);
      case "nin": return !compare(actual, operator("in", [v]));
      case "exists": return (actual !== undefined) === v;
      case "eq": return actual === v;
      case "neq": return actual !== v;
      case "gte": return actual >= v;
      case "lte": return actual <= v;
      case "gt": return actual > v;
      case "lt": return actual < v;
      case "regex": return new RegExp(v.regexp, v.options).test(actual || "");
      default: throw new Error("Unsupported mock operator: " + expected.__op);
    }
  }
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

function database(seed) {
  let state = copy(seed), tail = Promise.resolve();
  const writes = [], queries = [];
  let failure = "";
  function collection(name, store) {
    let where = {}, id, skip = 0, limit = 100, sort = [];
    const q = {
      doc(v) { id = v; return q; }, where(v) { where = v; return q; },
      orderBy(k, d) { sort.push([k,d]); return q; }, skip(v) { skip = v; return q; }, limit(v) { limit = v; return q; },
      async get() {
        const rows = store[name] || [];
        if (id) return { data: copy(rows.find(r => r._id === id) || null) };
        queries.push({name, where, skip, limit});
        const found = rows.filter(r => matches(r, where)).sort((a,b) => {
          for (const [k,d] of sort) { const v = field(a,k) > field(b,k) ? 1 : field(a,k) < field(b,k) ? -1 : 0; if(v) return d === "desc" ? -v : v; } return 0;
        });
        return { data: copy(found.slice(skip, skip + limit)) };
      },
      async count() { return {total: (store[name] || []).filter(r => matches(r,where)).length}; },
      async set({data}) { mutate("set", data); return {_id:id}; },
      async add({data}) { id = data._id || "auto-" + writes.length; mutate("set",data); return {_id:id}; },
      async update({data}) { mutate("update", data); return {stats:{updated:1}}; },
      async remove() { mutate("remove"); return {stats:{removed:1}}; }
    };
    function mutate(kind, data) {
      if (failure === name) throw new Error("injected write failure: " + name);
      if (!store[name]) store[name] = [];
      const rows = store[name], i = rows.findIndex(r => r._id === id);
      if (kind === "remove") { if (i >= 0) rows.splice(i,1); }
      else {
        if(kind === "update" && i < 0) throw new Error("document not found");
        const next = { ...(kind === "update" ? rows[i] : {}), ...copy(data), _id:id };
        if(i < 0) rows.push(next); else rows[i] = next;
      }
      writes.push({name,id,kind});
    }
    return q;
  }
  const db = {
    command, RegExp: value => operator("regex", [value]), serverDate: () => new Date(),
    collection: name => collection(name,state),
    runTransaction(fn) {
      const task = tail.then(async () => {
        const staged = copy(state);
        const result = await fn({ collection: name => collection(name,staged) });
        state = staged;
        return result;
      });
      tail = task.catch(() => {}); return task;
    }
  };
  return { db, writes, queries, data: () => state, fail: name => {failure = name;} };
}

function load(store, openid = "viewer", env = {}) {
  const exports = {};
  const cloud = { init() {}, database: () => store.db, getWXContext: () => ({OPENID:openid}), getTempFileURL: async () => ({fileList:[]}) };
  const filename = path.join(root,"cloudfunctions","calendar_plan_publish","index.js");
  vm.runInNewContext(fs.readFileSync(filename,"utf8"), {
    exports, console, process: { env }, Date, Set, Map,
    require: id => id === "wx-server-sdk" ? cloud : require(id.startsWith(".") ? path.resolve(path.dirname(filename),id) : id)
  }, {filename});
  return exports.main;
}

const checks = [];
function test(name, fn) { checks.push([name,fn]); }

const now = Date.now();
function ymdOffset(days) {
  const d = new Date(now + 8 * 3600000 + days * 86400000);
  return d.toISOString().slice(0, 10);
}
const D = ymdOffset(3);
const hm = hhmm => Date.parse(`${D}T${hhmm}:00+08:00`);

function baseStore() {
  return database({
    RockGyms: [{_id:"gym1",name:"G1",city:"杭州",status:"active"},{_id:"gym2",name:"G2",city:"北京",status:"active"}],
    RockUsers: [
      {openid:"u1",nickName:"U1"},{openid:"u2",nickName:"U2"},
      {openid:"u3",nickName:"U3"},{openid:"owner",nickName:"Owner"}
    ],
    RockCalendarPlans: [], RockCalendarJoins: [], RockUserScheduleDays: []
  });
}
let reqSeq = 0;
async function publish(store, openid, over = {}) {
  reqSeq++;
  const slots = over.timeSlots || ["morning"];
  // 与真实客户端一致：上送由所选时段推导出的 startTime/endTime（服务端仍只信任 slots 派生）
  const derived = slots.length ? schedule.normalizeNewSlots(over.date||D, slots) : null;
  const payload = {
    mode:"gym", gymId:over.gymId||"gym1", date:over.date||D,
    startTime:over.startTime || (derived ? derived.startTime : undefined),
    endTime:over.endTime || (derived ? derived.endTime : undefined),
    timeSlots:slots,
    capacity:over.capacity||6, visibility:over.visibility||"public",
    skillTags:["boulder"], title:"t", joinMode:over.joinMode||"direct"
  };
  return load(store, openid)({
    action: over.action || "create",
    planId: over.planId || "",
    requestId: over.requestId || ("req_"+openid+"_"+reqSeq),
    payload
  });
}
function planDoc(id, over = {}) {
  const slots = over.slots || ["morning"];
  const legacy = over.legacy;
  const startTime = over.startTime || (legacy ? "10:00" : "10:00");
  const endTime = over.endTime || (legacy ? "12:00" : "14:00");
  const startAt = hm(startTime), endAt = hm(endTime);
  return {
    _id:id, openid:over.owner||"owner", _openid:over.owner||"owner", visibility:"public", status:"active",
    date:over.date||D, startTime, endTime, startAt, endAt, joinDeadline:over.joinDeadline!=null?over.joinDeadline:startAt,
    timeSlots: legacy ? [] : slots,
    joinMode:over.joinMode||"direct", capacity:over.capacity||6,
    confirmedCount:over.confirmedCount!=null?over.confirmedCount:1,
    joinSchemaVersion:2, participantIds:over.participantIds||[over.owner||"owner"], version:1,
    gymId:"gym1", gymSnapshot:{name:"G1",city:"杭州"}, skillTags:["boulder"]
  };
}
async function action(store, openid, event) {
  return load(store, openid)(Object.assign({planId:"pA"}, event));
}
// 直接在 RockUserScheduleDays 注入一条占用（模拟历史/回填数据）
function seedEntry(store, openid, plan, status) {
  const cand = schedule.candidateFromPlan(plan);
  const docs = store.data().RockUserScheduleDays || (store.data().RockUserScheduleDays = []);
  Object.keys(cand.byDate).forEach(date => {
    const id = schedule.dayDocId(openid, date);
    let doc = docs.find(d => d._id === id);
    if (!doc) { doc = { _id:id, openid, date, v:1, entries:[] }; docs.push(doc); }
    doc.entries.push({ planId:plan._id, status, slots:cand.slots||[], planDate:cand.date, segments:cand.byDate[date].map(s=>({startAt:s.startAt,endAt:s.endAt})), updatedAt:Date.now() });
  });
}
function entryPlans(store, openid, date = D) {
  const doc = (store.data().RockUserScheduleDays||[]).find(d => d._id === schedule.dayDocId(openid, date));
  return doc ? doc.entries.map(e => ({planId:e.planId, status:e.status, slots:e.slots})) : [];
}

// ---------- 一、schedule.js 纯函数 ----------
test("slots normalize server-side: morning+afternoon -> 10:00-18:00, evening own range", () => {
  const c = schedule.normalizeNewSlots(D, ["evening","morning"]);
  assert.deepEqual(c.slots, ["morning","evening"]);
  assert.equal(c.startTime, "10:00");
  assert.equal(c.endTime, "22:00");
  assert.equal(c.startAt, hm("10:00"));
  assert.equal(c.endAt, hm("22:00"));
});
test("legacy interval uses real clock range and refuses bad times", () => {
  const c = schedule.legacyCandidate(D, "13:00", "15:00");
  assert.deepEqual(c.slots, []);
  assert.equal(c.startAt, hm("13:00"));
  assert.throws(() => schedule.legacyCandidate(D, "25:00", "26:00"), /时间/);
});
test("interval rule: touching endpoints allowed, overlap/contain/intersect rejected", () => {
  const seg = (a,b) => ({startAt:hm(a), endAt:hm(b)});
  assert.equal(schedule.overlaps(seg("10:00","12:00"), seg("12:00","14:00")), false, "endpoint touch");
  assert.equal(schedule.overlaps(seg("10:00","12:00"), seg("11:00","13:00")), true, "intersect");
  assert.equal(schedule.overlaps(seg("10:00","18:00"), seg("11:00","12:00")), true, "contain");
});
test("touchedSlotKeys: legacy 13:00-15:00 hits both morning and afternoon", () => {
  assert.deepEqual(schedule.touchedSlotKeys(D, {startAt:hm("13:00"), endAt:hm("15:00")}).sort(), ["afternoon","morning"]);
  assert.deepEqual(schedule.touchedSlotKeys(D, {startAt:hm("18:00"), endAt:hm("20:00")}), ["evening"]);
});

// ---------- 二、组织 + 组织 ----------
test("host+host: same slot second create rejected with own conflict ref", async () => {
  const s = baseStore();
  const r1 = await publish(s, "u1", {timeSlots:["morning"]});
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await publish(s, "u1", {timeSlots:["morning"], gymId:"gym2"});
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, "SCHEDULE_CONFLICT");
  assert.equal(r2.error.conflict.planId, r1.data.planId, "self conflict may carry visible plan ref");
  assert.deepEqual(r2.error.conflict.slots, ["morning"]);
  assert.equal(s.data().RockCalendarPlans.length, 1, "no second plan written");
});
test("host+host: disjoint slots same day both succeed (multi-select gaps free)", async () => {
  const s = baseStore();
  const a = await publish(s, "u1", {timeSlots:["morning","evening"]});
  assert.equal(a.ok, true, JSON.stringify(a));
  const b = await publish(s, "u1", {timeSlots:["afternoon"]});
  assert.equal(b.ok, true, JSON.stringify(b), "afternoon gap between two slots is not locked");
});
test("host+host: cross-gym/city conflict uses same rule", async () => {
  const s = baseStore();
  await publish(s, "u1", {gymId:"gym1"});
  const r = await publish(s, "u1", {gymId:"gym2"});
  assert.equal(r.error.code, "SCHEDULE_CONFLICT");
});
test("host+host: forged client clock cannot bypass slot-derived occupancy", async () => {
  const s = baseStore();
  reqSeq++;
  const forged = await load(s, "u1")({action:"create", requestId:"forged_1", payload:{
    mode:"gym", gymId:"gym1", date:D, startTime:"23:00", endTime:"23:30",
    timeSlots:["morning"], capacity:6, visibility:"public", skillTags:["boulder"], title:"t", joinMode:"direct"
  }});
  assert.equal(forged.ok, true, JSON.stringify(forged));
  const saved = s.data().RockCalendarPlans[0];
  assert.equal(saved.startTime, "10:00", "server derives start from slots, ignores client clock");
  assert.equal(saved.endTime, "14:00");
  assert.equal(saved.startAt, hm("10:00"));
  const blocked = await publish(s, "u1", {timeSlots:["morning"]});
  assert.equal(blocked.error.code, "SCHEDULE_CONFLICT");
});

// ---------- 三、组织/参加 + 参加 ----------
test("host+join then join+join: direct join occupies; idempotent retries stay single entry", async () => {
  const s = baseStore();
  const r1 = await publish(s, "owner", {timeSlots:["afternoon"]});
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const pA = r1.data.planId;
  const j1 = await action(s, "u2", {action:"join_plan", planId:pA});
  assert.equal(j1.ok, true, JSON.stringify(j1));
  const j2 = await Promise.all([
    action(s, "u2", {action:"join_plan", planId:pA}),
    action(s, "u2", {action:"join_plan", planId:pA})
  ]);
  j2.forEach(r => assert.equal(r.ok, true, JSON.stringify(r)));
  assert.equal(s.data().RockCalendarJoins.filter(j=>j.openid==="u2").length, 1);
  assert.deepEqual(entryPlans(s, "u2"), [{planId:pA, status:"confirmed", slots:["afternoon"]}]);
  // u2 此时不能再参加同时段的另一场（跨馆同规则）
  const pB = (await publish(s, "u3", {timeSlots:["afternoon"], gymId:"gym2"})).data.planId;
  const conflict = await action(s, "u2", {action:"join_plan", planId:pB});
  assert.equal(conflict.error.code, "SCHEDULE_CONFLICT");
  assert.equal(conflict.error.conflict.planId, pA);
});
test("legacy real-range plans: intersect/endpoint-touch rules through joins", async () => {
  const s = baseStore();
  s.data().RockCalendarPlans.push(planDoc("a10", {legacy:true, startTime:"10:00", endTime:"12:00", owner:"owner"}));
  const touch = await action(s, "u2", {action:"join_plan", planId:"a10"});
  assert.equal(touch.ok, true, JSON.stringify(touch));
  s.data().RockCalendarPlans.push(planDoc("b12", {legacy:true, startTime:"12:00", endTime:"14:00", owner:"u3"}));
  const touching = await action(s, "u2", {action:"join_plan", planId:"b12"});
  assert.equal(touching.ok, true, JSON.stringify(touching), "12:00 endpoint may touch");
  s.data().RockCalendarPlans.push(planDoc("c11", {legacy:true, startTime:"11:00", endTime:"13:00", owner:"owner"}));
  const intersect = await action(s, "u3", {action:"join_plan", planId:"c11"});
  assert.equal(intersect.ok, true, JSON.stringify(intersect));
  const conflict = await action(s, "u3", {action:"join_plan", planId:"a10"});
  assert.equal(conflict.error.code, "SCHEDULE_CONFLICT", "10-12 vs 11-13 intersects");
});
test("legacy 13:00-15:00 blocks slot morning and afternoon but not evening", async () => {
  const s = baseStore();
  s.data().RockCalendarPlans.push(planDoc("leg", {legacy:true, startTime:"13:00", endTime:"15:00", owner:"owner"}));
  const join = await action(s, "u2", {action:"join_plan", planId:"leg"});
  assert.equal(join.ok, true, JSON.stringify(join));
  const m = await publish(s, "u2", {timeSlots:["morning"]});
  assert.equal(m.error.code, "SCHEDULE_CONFLICT");
  assert.deepEqual(m.error.conflict.slots.sort(), ["afternoon","morning"]);
  const a = await publish(s, "u2", {timeSlots:["afternoon"]});
  assert.equal(a.error.code, "SCHEDULE_CONFLICT");
  const e = await publish(s, "u2", {timeSlots:["evening"]});
  assert.equal(e.ok, true, JSON.stringify(e));
});

// ---------- 四、pending 预留 / 撤回释放 / 截止 ----------
test("pending application reserves slot without counting capacity; unjoin releases it", async () => {
  const s = baseStore();
  const pA = (await publish(s, "owner", {joinMode:"approval", capacity:2})).data.planId;
  const applied = await action(s, "u2", {action:"join_plan", planId:pA});
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.data.status, "pending");
  assert.deepEqual(entryPlans(s, "u2"), [{planId:pA, status:"pending", slots:["morning"]}]);
  // 自己另一局同段：pending 同样阻挡（组织+参加）
  const other = await publish(s, "u2", {timeSlots:["morning"]});
  assert.equal(other.error.code, "SCHEDULE_CONFLICT");
  // 撤回申请立即释放
  const out = await action(s, "u2", {action:"unjoin_plan", planId:pA});
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(entryPlans(s, "u2"), []);
  const retry = await publish(s, "u2", {timeSlots:["morning"]});
  assert.equal(retry.ok, true, JSON.stringify(retry));
});
test("approve after deadline fails; expired pending entry does not block other plans", async () => {
  const s = baseStore();
  // pA：申请已提交但报名截止已过（endAt 未来），日程里是 pending 死占用
  const pA = planDoc("pA", {owner:"owner", joinMode:"approval", joinDeadline:Date.now()-3600000,
    endTime:"20:00", slots:["morning"], participantIds:["owner"], confirmedCount:1});
  pA.endAt = hm("20:00");
  s.data().RockCalendarPlans.push(pA);
  s.data().RockCalendarJoins.push({_id:"j_u2", planId:"pA", openid:"u2", _openid:"u2", status:"pending", date:D, updatedAt:Date.now()});
  seedEntry(s, "u2", pA, "pending");
  const approve = await action(s, "owner", {action:"approve_joiner", planId:"pA", targetOpenid:"u2"});
  assert.equal(approve.error.code, "JOIN_CLOSED", "deadline-past approval must be rejected");
  // 实时核验时该死占用被清理，不阻挡新局
  s.data().RockCalendarPlans.push(planDoc("pB", {owner:"u3", slots:["morning"]}));
  const join = await action(s, "u2", {action:"join_plan", planId:"pB"});
  assert.equal(join.ok, true, JSON.stringify(join), "expired pending is pruned live");
  assert.deepEqual(entryPlans(s, "u2").map(e=>e.planId), ["pB"]);
});
test("approve conflict hides other plan details from owner", async () => {
  const s = baseStore();
  // u2 已在 pC（回填/历史 confirmed 占用）；pA 收到 u2 的 pending 申请
  const pA = planDoc("pA", {owner:"owner", joinMode:"approval"});
  const pC = planDoc("pC", {owner:"u3"});
  s.data().RockCalendarPlans.push(pA, pC);
  s.data().RockCalendarJoins.push({_id:"j_u2", planId:"pA", openid:"u2", _openid:"u2", status:"pending", date:D, updatedAt:Date.now()});
  seedEntry(s, "u2", pA, "pending");
  seedEntry(s, "u2", pC, "confirmed");
  const r = await action(s, "owner", {action:"approve_joiner", planId:"pA", targetOpenid:"u2"});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SCHEDULE_CONFLICT");
  assert.equal(r.error.message, "该岩友此时段已有安排");
  assert.equal(r.error.conflict.planId, "", "must not leak the conflicting plan id");
  // pending 仍未升级
  assert.equal(s.data().RockCalendarJoins.find(j=>j.openid==="u2").status, "pending");
});
test("reject and remove release the target occupancy", async () => {
  const s = baseStore();
  const pA = (await publish(s, "owner", {joinMode:"approval"})).data.planId;
  await action(s, "u2", {action:"join_plan", planId:pA});
  const rejected = await action(s, "owner", {action:"reject_joiner", planId:pA, targetOpenid:"u2"});
  assert.equal(rejected.ok, true, JSON.stringify(rejected));
  assert.deepEqual(entryPlans(s, "u2"), []);
  // remove confirmed
  const pB = (await publish(s, "owner", {timeSlots:["evening"]})).data.planId;
  await action(s, "u2", {action:"join_plan", planId:pB});
  const removed = await action(s, "owner", {action:"remove_joiner", planId:pB, targetOpenid:"u2"});
  assert.equal(removed.ok, true, JSON.stringify(removed));
  const evening = (store0 => store0) && entryPlans(s, "u2");
  assert.deepEqual(evening, []);
});
test("cancelled plan frees all members' slots for new joins", async () => {
  const s = baseStore();
  const pA = (await publish(s, "owner", {timeSlots:["morning"]})).data.planId;
  await action(s, "u2", {action:"join_plan", planId:pA});
  const cancel = await action(s, "owner", {action:"cancel", planId:pA});
  assert.equal(cancel.ok, true, JSON.stringify(cancel));
  const pB = (await publish(s, "u3", {timeSlots:["morning"]})).data.planId;
  const join = await action(s, "u2", {action:"join_plan", planId:pB});
  assert.equal(join.ok, true, JSON.stringify(join), "dead entry from cancelled plan is ignored/pruned");
});

// ---------- 五、改期 ----------
test("reschedule: owner-only atomic move frees old slot and occupies new slot", async () => {
  const s = baseStore();
  const pA = (await publish(s, "u1", {timeSlots:["morning"]})).data.planId;
  const r = await publish(s, "u1", {action:"update", planId:pA, timeSlots:["afternoon"]});
  assert.equal(r.ok, true, JSON.stringify(r));
  const plans = entryPlans(s, "u1");
  assert.deepEqual(plans, [{planId:pA, status:"host", slots:["afternoon"]}]);
  // 上午已释放：u1 可参加他人上午局
  s.data().RockCalendarPlans.push(planDoc("pM", {owner:"u3", slots:["morning"]}));
  const join = await action(s, "u1", {action:"join_plan", planId:"pM"});
  assert.equal(join.ok, true, JSON.stringify(join));
});
test("reschedule blocked with confirmed member and with pending member", async () => {
  const s = baseStore();
  const pA = (await publish(s, "owner", {joinMode:"direct"})).data.planId;
  await action(s, "u2", {action:"join_plan", planId:pA});
  const locked = await publish(s, "owner", {action:"update", planId:pA, timeSlots:["evening"]});
  assert.equal(locked.error.code, "PLAN_TIME_LOCKED");

  const s2 = baseStore();
  const pB = (await publish(s2, "owner", {joinMode:"approval"})).data.planId;
  await action(s2, "u2", {action:"join_plan", planId:pB});
  const pendingLocked = await publish(s2, "owner", {action:"update", planId:pB, timeSlots:["evening"]});
  assert.equal(pendingLocked.error.code, "PLAN_TIME_LOCKED", "pending member also locks time changes");
});
test("reschedule to an occupied slot conflicts; non-time edits with members still save", async () => {
  const s = baseStore();
  const pA = (await publish(s, "u1", {timeSlots:["morning"]})).data.planId;
  const pB = (await publish(s, "u1", {timeSlots:["evening"]})).data.planId;
  const r = await publish(s, "u1", {action:"update", planId:pA, timeSlots:["evening"]});
  assert.equal(r.error.code, "SCHEDULE_CONFLICT", "own other plan still blocks move");
  // 非时间字段（标题）有成员时仍可编辑
  const pC = (await publish(s, "owner", {timeSlots:["afternoon"]})).data.planId;
  await action(s, "u2", {action:"join_plan", planId:pC});
  const ok = await load(s, "owner")({action:"update", planId:pC, requestId:"edit_title_1", payload:{
    mode:"gym", gymId:"gym1", date:D, startTime:"14:00", endTime:"18:00",
    timeSlots:["afternoon"], capacity:6, visibility:"public", skillTags:["boulder"], title:"new title", joinMode:"direct"
  }});
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(s.data().RockCalendarPlans.find(p=>p._id===pC).title, "new title");
});

// ---------- 六、失败原子性 ----------
test("schedule write failure rolls back plan create (no partial success)", async () => {
  const s = baseStore();
  s.fail("RockUserScheduleDays");
  const r = await publish(s, "u1", {timeSlots:["morning"]});
  assert.equal(r.ok, false);
  assert.equal((s.data().RockCalendarPlans||[]).length, 0, "plan must not exist without occupancy commit");
  assert.equal((s.data().RockUserScheduleDays||[]).length, 0);
});
test("join schedule write failure rolls back join row and plan counters", async () => {
  const s = baseStore();
  const pA = (await publish(s, "owner", {timeSlots:["morning"]})).data.planId;
  s.fail("RockUserScheduleDays");
  const r = await action(s, "u2", {action:"join_plan", planId:pA});
  assert.equal(r.ok, false);
  assert.equal((s.data().RockCalendarJoins||[]).length, 0);
  assert.equal(s.data().RockCalendarPlans.find(p=>p._id===pA).confirmedCount, 1);
});

(async()=>{
  let failures=0;
  for (const [name,fn] of checks) {
    try { await fn(); console.log("PASS "+name); }
    catch(e) { failures++; console.error("FAIL "+name+"\n"+(e.stack||e)); }
  }
  console.log(`${checks.length-failures}/${checks.length} passed`);
  process.exitCode = failures ? 1 : 0;
})();
