// Run with: node tests/regression.js. No cloud credentials or external dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
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
      case "in": return Array.isArray(actual) ? actual.some(x => v.includes(x)) : v.includes(actual);
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

function load(name, store, openid = "viewer", env = {}) {
  const exports = {};
  const cloud = { init() {}, database: () => store.db, getWXContext: () => ({OPENID:openid}), getTempFileURL: async () => ({fileList:[]}) };
  const filename = path.join(root,"cloudfunctions",name,"index.js");
  vm.runInNewContext(fs.readFileSync(filename,"utf8"), {
    exports, console, process: { env }, Date, Set, Map,
    require: id => id === "wx-server-sdk" ? cloud : require(id.startsWith(".") ? path.resolve(path.dirname(filename),id) : id)
  }, {filename});
  return exports.main;
}
const checks = [];
function test(name, fn) { checks.push([name,fn]); }
const future = new Date(Date.now()+86400000).toISOString().slice(0,10);
const plan = { _id:"plan", openid:"host", _openid:"host", visibility:"circle", circleIds:["circle"], date:future, endTime:"22:00", status:"active" };

test("private plan: outsiders cannot join or read members", async () => {
  const s = database({RockCalendarPlans:[plan]}); const main = load("calendar_plan_publish",s);
  for(const action of ["join_plan","get_joiners"]) assert.equal((await main({action,planId:"plan"})).error.code,"FORBIDDEN");
  assert.equal(s.writes.length,0);
});
test("accepted circle member can join, retries and concurrent calls do not duplicate", async () => {
  const s = database({RockCalendarPlans:[plan],RockUsers:[{openid:"viewer",nickName:"Viewer"}],RockCircleMembers:[{openid:"viewer",circleId:"circle",status:"accepted"}]});
  const main = load("calendar_plan_publish",s);
  const results = await Promise.all([main({action:"join_plan",planId:"plan"}),main({action:"join_plan",planId:"plan"})]);
  results.forEach(r=>assert.equal(r.ok,true,JSON.stringify(r)));
  assert.equal(s.data().RockCalendarJoins.length,1);
});
test("expired plans reject new joins", async () => {
  const s=database({RockCalendarPlans:[{...plan,visibility:"public",date:"2020-01-01"}]});
  assert.equal((await load("calendar_plan_publish",s)({action:"join_plan",planId:"plan"})).error.code,"PLAN_ENDED");
});
test("public primary card exposes only safe fields, private cards remain private", async () => {
  const s=database({RockCards:[{_id:"card",status:"active",isPrimary:true,ownerOpenid:"host",createdByOpenid:"host",secret:"hidden",front:{displayName:"Host",wechatId:"secret",showWechat:true},back:{secret:1}}]});
  const main=load("rock_card_get",s);const r=await main({cardId:"card"});
  assert.equal(r.ok,true);assert.equal(r.data.card.front.displayName,"Host");assert.equal(r.data.card.front.wechatId,undefined);assert.equal(r.data.card.back,undefined);assert.equal(r.data.card.ownerOpenid,undefined);
  s.data().RockCards[0].isPrimary=false;
  assert.equal((await main({cardId:"card"})).error.code,"FORBIDDEN");
});
function checkinSeed() { return {RockGyms:[{_id:"gym",status:"active"}],RockGymCycles:[{_id:"cycle",gym_id:"gym",start_date:"2020-01-01",end_date:"2099-01-01"}]}; }
const input = {gymId:"gym",date:new Date().toISOString().slice(0,10),items:{difficulty:{"5.10":2},boulder:{V2:3}},requestId:"request_0001"};
test("multi-type checkin is idempotent and uses one batch", async () => {
  const s=database(checkinSeed());const main=load("checkin_create",s);
  const first=await main(input);assert.equal(first.ok,true,JSON.stringify(first));
  const second=await main(input);assert.equal(second.data.submissionId,first.data.submissionId);
  assert.equal(s.data().RockCheckinRecords.length,2);assert.equal(s.data().RockUserDailyProgress[0].today.boulder.V2,3);
  assert.equal((await main({...input,items:{boulder:{V2:4}}})).error.code,"REQUEST_CONFLICT");
});
test("write failure rolls back records, daily and cycle progress", async () => {
  const s=database(checkinSeed());s.fail("RockUserCycleProgress");
  const r=await load("checkin_create",s)(input);assert.equal(r.ok,false);
  assert.equal((s.data().RockCheckinRecords||[]).length,0);assert.equal((s.data().RockUserDailyProgress||[]).length,0);
});
test("revert only affects specified batch and retry is harmless", async () => {
  const s=database(checkinSeed());const main=load("checkin_create",s);
  const first=await main(input);const second=await main({...input,requestId:"request_0002"});
  assert.equal(second.ok,true,JSON.stringify(second));
  const event={action:"revert_last",submissionId:second.data.submissionId};
  assert.equal((await main(event)).ok,true);assert.equal((await main(event)).data.removedCount,0);
  assert.equal(s.data().RockCheckinRecords.length,2);assert.equal(s.data().RockUserDailyProgress[0].today.boulder.V2,3);
  assert.equal(s.data().RockCheckinSubmissions.find(x=>x._id===first.data.submissionId).status,"active");
  assert.equal((await main({action:"revert_last"})).error.code,"BATCH_REQUIRED");
});
test("revert failure retains original batch and all records", async () => {
  const s=database(checkinSeed());const main=load("checkin_create",s);const r=await main(input);
  s.fail("RockUserCycleProgress");assert.equal((await main({action:"revert_last",submissionId:r.data.submissionId})).ok,false);
  assert.equal(s.data().RockCheckinRecords.length,2);assert.equal(s.data().RockUserDailyProgress[0].today.boulder.V2,3);
});
test("test data function is disabled by default and requires admin when enabled", async () => {
  const s=database({});assert.equal((await load("test_seed_data",s)({action:"seed"})).error.code,"DISABLED");
  assert.equal((await load("test_seed_data",s,"viewer",{ALLOW_TEST_SEED:"true"})({action:"seed"})).error.code,"FORBIDDEN");
  assert.equal(s.writes.length,0);
});
test("gym search can find record beyond first 200, regex characters are literal", async () => {
  const gyms=Array.from({length:205},(_,i)=>({_id:"g"+i,name:"Gym "+i,city:"杭州",updatedAt:205-i}));
  gyms[204].name="岩馆 (A)+";
  const s=database({RockGyms:gyms});const main=load("rock_gym_list",s);
  const r=await main({city:"杭州",keyword:"(A)+"});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.gyms[0]._id,"g204");
});
test("calendar filters city and circle in database", async () => {
  const s=database({RockCalendarPlans:[{...plan,_id:"public",visibility:"public",gymSnapshot:{city:"杭州"}},{...plan,_id:"other",visibility:"public",gymSnapshot:{city:"北京"}}]});
  const r=await load("calendar_query",s)({mode:"calendar",city:"杭州",startDate:future,endDate:future});
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.dateAgg[0].total,1);
});
test("publish date helper does not add eight hours to local date", () => {
  const source=fs.readFileSync(path.join(root,"miniprogram/pages/calendar-publish/index.js"),"utf8");
  assert.ok(!source.includes("Date.now() + 8 * 3600"));
});

// ---- F2: discover 可加入优先排序 + 截止/满员口径 ----
function discoverPlan(id, over = {}) {
  return { _id:id, openid:"host"+id, visibility:"public", status:"active",
    date:future, startTime:over.startTime||"18:00", endTime:"22:00",
    isFull:!!over.isFull, joinDeadline:over.joinDeadline===undefined?Date.now()+86400000:over.joinDeadline, ...over };
}
async function discoverPage(store, event) {
  const r = await load("calendar_query",store)({mode:"discover", startDate:future, endDate:future, ...event});
  assert.equal(r.ok,true,JSON.stringify(r));
  return r.data;
}
test("discover ranks joinable plans first and the segment cursor keeps paging lossless", async () => {
  const joinable=Array.from({length:22},(_,i)=>discoverPlan("j"+String(i+1).padStart(2,"0"),{startTime:i<10?"10:0"+i:"11:00"}));
  const closed=[
    discoverPlan("c1",{isFull:true}),
    discoverPlan("c2",{joinDeadline:1}),
    discoverPlan("c3",{isFull:true,joinDeadline:1})
  ];
  const s=database({RockCalendarPlans:joinable.concat(closed)});
  const p1=await discoverPage(s,{});
  assert.equal(p1.list.length,20);
  assert.deepEqual(p1.list.map(x=>x._id),joinable.slice(0,20).map(x=>x._id),"first page is all joinable");
  const p2=await discoverPage(s,{cursor:p1.cursor});
  assert.equal(p2.hasMore,false);
  const ids=p1.list.map(x=>x._id).concat(p2.list.map(x=>x._id));
  assert.equal(ids.length,25);
  assert.equal(new Set(ids).size,25,"no duplicate across segment boundary");
  assert.deepEqual(p2.list.map(x=>x._id),["j21","j22","c1","c2","c3"],"joinable tail precedes closed segment");
});
test("onlyAvailable excludes full and deadline-closed plans", async () => {
  const legacyOk=discoverPlan("ok2"); delete legacyOk.joinDeadline; // 旧数据缺字段按开场时间兜底，仍可报名
  const s=database({RockCalendarPlans:[
    discoverPlan("ok1"),legacyOk,
    discoverPlan("full",{isFull:true}),discoverPlan("closed",{joinDeadline:1})
  ]});
  const r=await discoverPage(s,{onlyAvailable:true});
  assert.deepEqual(r.list.map(x=>x._id).sort(),["ok1","ok2"]);
});
test("discover projection carries join deadline and full flag for client labels", async () => {
  const s=database({RockCalendarPlans:[discoverPlan("p",{isFull:true,joinDeadline:12345})]});
  const r=await discoverPage(s,{});
  const p=r.list.find(x=>x._id==="p");
  assert.equal(p.isFull,true);
  assert.equal(p.joinDeadline,12345);
});

// ---- F3: mine_list 键集分页（participantIds 成员索引） ----
test("mine_list pages plans via participantIds index and resolves my status", async () => {
  const s=database({
    RockCalendarPlans:[
      {_id:"a",openid:"hostA",status:"active",visibility:"public",date:future,startTime:"18:00",endTime:"22:00",joinSchemaVersion:2,participantIds:["hostA","viewer"],confirmedCount:2},
      {_id:"b",openid:"hostB",status:"active",visibility:"public",date:future,startTime:"19:00",endTime:"22:00",joinSchemaVersion:2,participantIds:["hostB","other"],confirmedCount:2},
      {_id:"c",openid:"viewer",status:"active",visibility:"public",date:future,startTime:"20:00",endTime:"22:00"},
      {_id:"d",openid:"viewer",status:"active",visibility:"public",date:future,startTime:"17:00",endTime:"22:00",joinSchemaVersion:2,participantIds:["viewer"],confirmedCount:1}
    ],
    RockCalendarJoins:[{_id:"ja",planId:"a",openid:"viewer",status:"pending"}]
  });
  const main=load("calendar_plan_publish",s);
  const upcoming=await main({action:"mine_list",tab:"upcoming"});
  assert.equal(upcoming.ok,true,JSON.stringify(upcoming));
  const byId=Object.fromEntries(upcoming.data.list.map(x=>[x._id,x]));
  assert.ok(byId.a && byId.c && byId.d,"member, legacy-owned and v2-owned plans all appear");
  assert.ok(!byId.b,"plan without membership is excluded");
  assert.equal(byId.a.myStatus,"pending");
  assert.equal(byId.c.myStatus,"host");
  assert.equal(byId.d.myStatus,"host");
  const host=await main({action:"mine_list",tab:"host"});
  assert.deepEqual(host.data.list.map(x=>x._id).sort(),["c","d"]);
});

(async()=>{let failures=0;for(const [name,fn] of checks){try{await fn();console.log("PASS "+name);}catch(e){failures++;console.error("FAIL "+name+"\n"+e.stack);}}console.log(`${checks.length-failures}/${checks.length} passed`);process.exitCode=failures?1:0;})();
