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
const plan = { _id:"plan", openid:"host", _openid:"host", visibility:"circle", circleIds:["circle"], date:future, startTime:"10:00", endTime:"22:00", status:"active" };

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

// ---- R1: 成员索引统一 + mine_list 旧成员兼容（45+ 条新旧混合，跨页不重不漏） ----
function r1Seed() {
  const plans=[], joins=[];
  const base=id=>({_id:id,openid:"host"+id,_openid:"host"+id,visibility:"public",status:"active",date:future,startTime:"18:00",endTime:"22:00",skillTags:["boulder"],gymSnapshot:{name:"G"+id,city:"杭州"}});
  for(let i=1;i<=20;i++){const id="m"+String(i).padStart(2,"0");plans.push({...base(id),joinSchemaVersion:2,participantIds:["host"+id,"viewer"],confirmedCount:2});joins.push({_id:"j_"+id,planId:id,openid:"viewer",_openid:"viewer",status:"confirmed",date:future});}
  for(let i=21;i<=35;i++){const id="m"+String(i).padStart(2,"0");plans.push({...base(id),capacity:6});joins.push({_id:"j_"+id,planId:id,openid:"viewer",_openid:"viewer",status:i%3===0?"pending":(i%3===1?"confirmed":"joined"),date:future});}
  for(let i=36;i<=40;i++){const id="m"+String(i).padStart(2,"0");plans.push({...base(id),openid:"viewer",_openid:"viewer",capacity:6});}
  for(let i=41;i<=45;i++){const id="m"+String(i).padStart(2,"0");plans.push({...base(id),capacity:6});}
  plans.push({...base("m46"),openid:"viewer",_openid:"viewer",date:"2020-01-01",capacity:6});
  plans.push({...base("m47"),capacity:6});joins.push({_id:"j_m47",planId:"m47",openid:"viewer",_openid:"viewer",status:"removed",date:future});
  plans.push({...base("m48"),status:"cancelled",joinSchemaVersion:2,participantIds:["hostm48","viewer"],confirmedCount:2});
  plans.push({...base("m49"),date:"2020-01-01",capacity:6});
  plans.push({...base("m50"),capacity:6});joins.push({_id:"j_m50",planId:"m50",openid:"viewer",_openid:"viewer",status:"cancelled",date:future});
  return {RockCalendarPlans:plans,RockCalendarJoins:joins};
}
test("R1 mine_list: 45 mixed plans page losslessly across tabs, removed/cancelled never return", async () => {
  const s=database(r1Seed());const main=load("calendar_plan_publish",s,"viewer");
  const p1=await main({action:"mine_list",tab:"upcoming"});
  assert.equal(p1.ok,true,JSON.stringify(p1));
  assert.equal(p1.data.list.length,20);
  assert.equal(p1.data.hasMore,true);
  const p2=await main({action:"mine_list",tab:"upcoming",cursor:p1.data.cursor});
  assert.equal(p2.data.hasMore,false);
  const ids=p1.data.list.concat(p2.data.list).map(x=>x._id);
  assert.equal(ids.length,40);
  assert.equal(new Set(ids).size,40,"no duplicate or missing across pages");
  assert.deepEqual(ids,Array.from({length:40},(_,i)=>"m"+String(i+1).padStart(2,"0")));
  const byId=Object.fromEntries(p1.data.list.concat(p2.data.list).map(x=>[x._id,x]));
  assert.equal(byId.m01.myStatus,"confirmed","v2 member resolves confirmed");
  assert.equal(byId.m21.myStatus,"pending","legacy pending join is visible");
  assert.equal(byId.m22.myStatus,"confirmed","legacy confirmed join is visible");
  assert.equal(byId.m23.myStatus,"confirmed","legacy joined status maps to confirmed");
  assert.equal(byId.m36.myStatus,"host","own legacy plan is visible without index");
  assert.ok(!ids.includes("m47"),"removed member does not reappear in upcoming");
  assert.ok(!ids.includes("m50"),"cancelled join does not reappear in upcoming");
  const host=await main({action:"mine_list",tab:"host"});
  assert.deepEqual(host.data.list.map(x=>x._id),["m36","m37","m38","m39","m40"],"host tab uses own scope only");
  const past=await main({action:"mine_list",tab:"past"});
  assert.deepEqual(past.data.list.map(x=>x._id),["m48","m46"],"cancelled membership and own past plan land in past tab");
});
test("R1 edit: legacy plan keeps owner in member index; visibility lock counts only non-owners", async () => {
  const s=database({
    RockCalendarPlans:[
      {_id:"legacy1",openid:"owner1",_openid:"owner1",visibility:"public",status:"active",date:future,startTime:"10:00",endTime:"12:00",capacity:6,joinMode:"direct",skillTags:["boulder"],gymId:"gym",gymSnapshot:{name:"G",city:"杭州"}},
      {_id:"legacy2",openid:"owner2",_openid:"owner2",visibility:"public",status:"active",date:future,startTime:"10:00",endTime:"12:00",capacity:6,joinMode:"direct",skillTags:["boulder"],gymId:"gym",gymSnapshot:{name:"G",city:"杭州"}},
      {_id:"solo3",openid:"owner3",_openid:"owner3",visibility:"public",status:"active",date:future,startTime:"10:00",endTime:"12:00",capacity:6,joinMode:"direct",skillTags:["boulder"],gymId:"gym",gymSnapshot:{name:"G",city:"杭州"},joinSchemaVersion:2,participantIds:["owner3"],confirmedCount:1}
    ],
    RockCalendarJoins:[{_id:"j_legacy2",planId:"legacy2",openid:"viewer",_openid:"viewer",status:"confirmed",date:future}],
    RockGyms:[{_id:"gym",name:"G",city:"杭州",status:"active"}],
    RockUsers:[{openid:"owner1",nickName:"H1"},{openid:"owner2",nickName:"H2"},{openid:"owner3",nickName:"H3"}]
  });
  const payload={mode:"gym",gymId:"gym",date:future,startTime:"18:00",endTime:"20:00",capacity:6,visibility:"friends",skillTags:["boulder"],title:"t",joinMode:"direct"};
  const r1=await load("calendar_plan_publish",s,"owner1")({action:"update",planId:"legacy1",payload});
  assert.equal(r1.ok,true,JSON.stringify(r1));
  const saved=s.data().RockCalendarPlans.find(p=>p._id==="legacy1");
  assert.deepEqual(saved.participantIds,["owner1"],"legacy plan edit restores owner in index");
  assert.equal(saved.joinSchemaVersion,2);
  const r2=await load("calendar_plan_publish",s,"owner2")({action:"update",planId:"legacy2",payload});
  assert.equal(r2.ok,false);
  assert.equal(r2.error.code,"VISIBILITY_LOCKED","non-owner member locks visibility change");
  const r3=await load("calendar_plan_publish",s,"owner3")({action:"update",planId:"solo3",payload});
  assert.equal(r3.ok,true,JSON.stringify(r3),"plan with only owner can still change visibility");
});

// ---- R2: 满员/截止报名合同（direct/approval × 有名额/满员 × 截止前/后） ----
function joinStore(over={}) {
  return database({
    RockCalendarPlans:[{_id:"jp",openid:"host",_openid:"host",visibility:"public",status:"active",
      date:over.date||future,startTime:over.startTime||"18:00",endTime:over.endTime||"22:00",joinMode:over.joinMode||"direct",
      capacity:over.capacity!=null?over.capacity:3,confirmedCount:over.confirmedCount!=null?over.confirmedCount:1,
      joinSchemaVersion:2,participantIds:over.participantIds||["host"],
      joinDeadline:over.joinDeadline===undefined?Date.now()+86400000:over.joinDeadline,
      gymSnapshot:{city:"杭州"},skillTags:["boulder"]}],
    RockUsers:[{openid:"viewer",nickName:"Viewer"},{openid:"alice",nickName:"Alice"},{openid:"bob",nickName:"Bob"},{openid:"carol",nickName:"Carol"}]
  });
}
test("R2 join matrix: direct/approval with slots behave per contract", async () => {
  const direct=joinStore();
  const rd=await load("calendar_plan_publish",direct,"viewer")({action:"join_plan",planId:"jp"});
  assert.equal(rd.ok,true,JSON.stringify(rd));assert.equal(rd.data.status,"confirmed");
  const dp=direct.data().RockCalendarPlans[0];
  assert.equal(dp.confirmedCount,2);assert.ok(dp.participantIds.includes("viewer"));
  const approval=joinStore({joinMode:"approval"});
  const ra=await load("calendar_plan_publish",approval,"viewer")({action:"join_plan",planId:"jp"});
  assert.equal(ra.ok,true,JSON.stringify(ra));assert.equal(ra.data.status,"pending");
  const ap=approval.data().RockCalendarPlans[0];
  assert.equal(ap.confirmedCount,1,"pending application does not occupy a slot");
  assert.ok(ap.participantIds.includes("viewer"),"pending applicant stays in member index");
  assert.equal(ap.isFull,false);
});
test("R2 full plans reject both direct and approval joins without mutating count", async () => {
  for(const joinMode of ["direct","approval"]) {
    const s=joinStore({joinMode,capacity:2,confirmedCount:2,participantIds:["host","a"]});
    const r=await load("calendar_plan_publish",s,"viewer")({action:"join_plan",planId:"jp"});
    assert.equal(r.ok,false);assert.equal(r.error.code,"PLAN_FULL",joinMode+" full must reject");
    const p=s.data().RockCalendarPlans[0];
    assert.equal(p.confirmedCount,2,joinMode+" count unchanged after rejected join");
    assert.ok(!(s.data().RockCalendarJoins||[]).some(j=>j.openid==="viewer"),joinMode+" no join row written");
  }
});
test("R2 deadline closed (explicit and endAt fallback) rejects joins", async () => {
  const closed=joinStore({joinDeadline:Date.now()-1000});
  assert.equal((await load("calendar_plan_publish",closed,"viewer")({action:"join_plan",planId:"jp"})).error.code,"JOIN_CLOSED");
  const yesterday=new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10);
  const ended=joinStore({date:yesterday,startTime:"18:00",endTime:"22:00",joinDeadline:null});
  assert.equal((await load("calendar_plan_publish",ended,"viewer")({action:"join_plan",planId:"jp"})).error.code,"PLAN_ENDED","missing deadline falls back to endAt");
});
test("R2 discover treats null and zero deadline as endAt fallback", async () => {
  const plans=[discoverPlan("null",{joinDeadline:null}),discoverPlan("zero",{joinDeadline:0})];
  const r=await discoverPage(database({RockCalendarPlans:plans}),{onlyAvailable:true});
  assert.deepEqual(r.list.map(x=>x._id),["null","zero"]);
});
test("R1 legacy duplicate terminal row does not resurrect membership", async () => {
  const s=database({RockCalendarPlans:[{_id:"dup",openid:"host",_openid:"host",status:"active",visibility:"public",date:future,startTime:"18:00",endTime:"22:00"}],RockCalendarJoins:[
    {_id:"old",planId:"dup",openid:"viewer",status:"confirmed",date:future,updatedAt:1},
    {_id:"new",planId:"dup",openid:"viewer",status:"cancelled",date:future,updatedAt:2}
  ]});
  const r=await load("calendar_plan_publish",s,"viewer")({action:"mine_list",tab:"upcoming"});
  assert.equal(r.data.list.length,0);
});
test("R1 legacy compatibility scans beyond 200 rows for upcoming and past plans", async () => {
  const plans=[], joins=[];
  for(let i=0;i<205;i++) {
    const id="noise"+String(i).padStart(3,"0");
    plans.push({_id:id,openid:"other"+i,status:"active",visibility:"public",date:future,startTime:"18:00",endTime:"22:00"});
    joins.push({_id:"a"+String(i).padStart(3,"0"),planId:id,openid:"viewer",status:"cancelled",date:future,updatedAt:i+1});
  }
  plans.push({_id:"zz_upcoming",openid:"hostU",status:"active",visibility:"public",date:future,startTime:"18:00",endTime:"22:00"});
  joins.push({_id:"zz_upcoming_join",planId:"zz_upcoming",openid:"viewer",status:"confirmed",date:future,updatedAt:9999});
  plans.push({_id:"zz_past",openid:"hostP",status:"active",visibility:"public",date:"2020-01-01",startTime:"18:00",endTime:"22:00"});
  joins.push({_id:"zz_past_join",planId:"zz_past",openid:"viewer",status:"confirmed",date:"2020-01-01",updatedAt:10000});
  const s=database({RockCalendarPlans:plans,RockCalendarJoins:joins});
  const main=load("calendar_plan_publish",s,"viewer");
  const upcoming=await main({action:"mine_list",tab:"upcoming"});
  const upcomingIds=[]; let page=upcoming;
  while(true) { upcomingIds.push(...page.data.list.map(x=>x._id)); if(!page.data.hasMore)break; page=await main({action:"mine_list",tab:"upcoming",cursor:page.data.cursor}); }
  assert.ok(upcomingIds.includes("zz_upcoming"),"valid legacy relation after 200 rows remains discoverable");
  const past=await main({action:"mine_list",tab:"past"});
  const pastIds=[]; let pastPage=past;
  while(true) { pastIds.push(...pastPage.data.list.map(x=>x._id)); if(!pastPage.data.hasMore)break; pastPage=await main({action:"mine_list",tab:"past",cursor:pastPage.data.cursor}); }
  assert.ok(pastIds.includes("zz_past"),"valid old historical relation remains discoverable");
});
test("R2 idempotent retries never duplicate or flip status", async () => {
  const approval=joinStore({joinMode:"approval"});
  const main=load("calendar_plan_publish",approval,"viewer");
  const a=await main({action:"join_plan",planId:"jp"});const b=await main({action:"join_plan",planId:"jp"});
  assert.equal(a.data.status,"pending");assert.equal(b.data.status,"pending");
  assert.equal(approval.data().RockCalendarJoins.filter(j=>j.openid==="viewer").length,1);
  const direct=joinStore();
  const dm=load("calendar_plan_publish",direct,"viewer");
  await dm({action:"join_plan",planId:"jp"});const retry=await dm({action:"join_plan",planId:"jp"});
  assert.equal(retry.data.status,"confirmed");
  assert.equal(direct.data().RockCalendarJoins.filter(j=>j.openid==="viewer").length,1);
});
test("R2 pending applications survive fullness; approval beyond capacity is rejected", async () => {
  const s=joinStore({joinMode:"approval",capacity:2,confirmedCount:1,participantIds:["host"]});
  const joinAs=uid=>load("calendar_plan_publish",s,uid)({action:"join_plan",planId:"jp"});
  const a1=await joinAs("alice");assert.equal(a1.data.status,"pending");
  const b1=await joinAs("bob");assert.equal(b1.data.status,"pending");
  const host=load("calendar_plan_publish",s,"host");
  const approveBob=await host({action:"approve_joiner",planId:"jp",targetOpenid:"bob"});
  assert.equal(approveBob.ok,true,JSON.stringify(approveBob));
  assert.equal(s.data().RockCalendarPlans[0].confirmedCount,2);
  assert.equal((await joinAs("carol")).error.code,"PLAN_FULL","new application rejected when full");
  const aRetry=await joinAs("alice");
  assert.equal(aRetry.ok,true);assert.equal(aRetry.data.status,"pending","existing pending application is preserved");
  const approveAlice=await host({action:"approve_joiner",planId:"jp",targetOpenid:"alice"});
  assert.equal(approveAlice.ok,false);assert.equal(approveAlice.error.code,"PLAN_FULL","approve beyond capacity is rejected");
  assert.equal(s.data().RockCalendarPlans[0].confirmedCount,2);
});
test("R2 unjoining a confirmed member frees the slot for new joins", async () => {
  const s=joinStore({capacity:2,confirmedCount:2,participantIds:["host","a"]});
  if(!s.data().RockCalendarJoins) s.data().RockCalendarJoins=[];
  s.data().RockCalendarJoins.push({_id:"j_a",planId:"jp",openid:"a",_openid:"a",status:"confirmed",date:future});
  assert.equal((await load("calendar_plan_publish",s,"viewer")({action:"join_plan",planId:"jp"})).error.code,"PLAN_FULL");
  const unjoin=await load("calendar_plan_publish",s,"a")({action:"unjoin_plan",planId:"jp"});
  assert.equal(unjoin.ok,true,JSON.stringify(unjoin));
  assert.equal(s.data().RockCalendarPlans[0].confirmedCount,1);
  const again=await load("calendar_plan_publish",s,"viewer")({action:"join_plan",planId:"jp"});
  assert.equal(again.ok,true,JSON.stringify(again));assert.equal(again.data.status,"confirmed");
});

// ---- R3: discover 段边界与旧版三段游标 ----
test("R3 discover: exactly 20 joinable ends paging; legacy 3-part cursor still pages", async () => {
  const twenty=Array.from({length:20},(_,i)=>discoverPlan("t"+String(i+1).padStart(2,"0"),{startTime:"10:00"}));
  const s1=database({RockCalendarPlans:twenty});
  const only=await discoverPage(s1,{});
  assert.equal(only.list.length,20);
  assert.equal(only.hasMore,true,"server probes the closed segment once joinable is exhausted");
  const tail=await discoverPage(s1,{cursor:only.cursor});
  assert.equal(tail.list.length,0,"closed segment is empty");
  assert.equal(tail.hasMore,false);
  assert.equal(tail.cursor,"");
  const plans=Array.from({length:22},(_,i)=>discoverPlan("k"+String(i+1).padStart(2,"0"),{startTime:"10:00"}));
  plans.push(discoverPlan("kz",{isFull:true}));
  const s2=database({RockCalendarPlans:plans});
  const p1=await discoverPage(s2,{});
  assert.equal(p1.list.length,20);
  const last=p1.list[19];
  const legacyCursor=JSON.stringify([last.date,last.startTime,last._id]);
  const p2=await discoverPage(s2,{cursor:legacyCursor});
  const ids=p1.list.concat(p2.list).map(x=>x._id);
  assert.equal(new Set(ids).size,23,"legacy cursor pages without duplication");
  assert.deepEqual(p2.list.map(x=>x._id),["k21","k22","kz"],"legacy cursor resumes in joinable segment then closes");
});

// ---- R5: 发布预填清洗 + 提交前校验（固定时钟纯函数） ----
const planUtil=require(path.join(root,"miniprogram","utils","plan.js"));
test("R5 suggestedTime: fixed clock for afternoon, late night, month and year rollover", () => {
  const mk=(m,d,h,min)=>new Date(2025,m-1,d,h,min);
  assert.deepEqual(planUtil.suggestedTime(undefined,mk(3,10,14,0)),{date:"2025-03-10",startTime:"15:00",endTime:"17:00"});
  assert.deepEqual(planUtil.suggestedTime(undefined,mk(3,10,20,30)),{date:"2025-03-10",startTime:"21:00",endTime:"23:00"});
  assert.deepEqual(planUtil.suggestedTime(undefined,mk(3,10,22,30)),{date:"2025-03-11",startTime:"19:00",endTime:"21:00"});
  assert.deepEqual(planUtil.suggestedTime(undefined,mk(1,31,22,30)),{date:"2025-02-01",startTime:"19:00",endTime:"21:00"},"cross-month");
  assert.deepEqual(planUtil.suggestedTime(undefined,mk(12,31,22,30)),{date:"2026-01-01",startTime:"19:00",endTime:"21:00"},"cross-year");
});
test("R5 validateSlot: date range, duration and not-started boundaries", () => {
  const now=new Date(2025,2,10,12,0);
  const slot=(over={})=>planUtil.validateSlot({date:"2025-03-12",startTime:"19:00",endTime:"21:00",...over},now);
  assert.equal(slot().ok,true);
  assert.equal(slot({date:"2020-01-01"}).code,"DATE_PAST","illegal/past prefill date is rejected not silently used");
  assert.equal(slot({date:"2025-13-40"}).code,"DATE_INVALID");
  assert.equal(slot({date:"2025-03-24"}).code,"DATE_TOO_FAR","day 14 is outside the window");
  assert.equal(slot({date:"2025-03-23"}).ok,true,"day 13 is the last valid day");
  assert.equal(slot({startTime:"19:00",endTime:"19:25"}).code,"DURATION_SHORT");
  assert.equal(slot({startTime:"19:00",endTime:"19:30"}).ok,true,"30 minutes is the minimum");
  assert.equal(slot({startTime:"10:00",endTime:"22:00"}).ok,true,"12 hours is the maximum");
  assert.equal(slot({startTime:"09:00",endTime:"22:00"}).code,"DURATION_LONG");
  assert.equal(slot({startTime:"20:00",endTime:"19:00"}).code,"TIME_ORDER","cross-midnight is not supported");
  assert.equal(slot({startTime:"25:00",endTime:"26:00"}).code,"TIME_INVALID");
  assert.equal(slot({date:"2025-03-10",startTime:"10:00",endTime:"12:00"}).code,"NOT_STARTED","elapsed slot today is caught before submit");
});
test("R5 capacity and prefill sanitizing use whitelists", () => {
  [1,0,13,20,2.5,NaN].forEach(v=>assert.equal(planUtil.sanitizeCapacity(v),null,String(v)+" must be rejected"));
  [2,12,"4"].forEach(v=>assert.equal(planUtil.sanitizeCapacity(v),Number(v)));
  const now=new Date(2025,2,10,14,0);
  const clean=planUtil.sanitizePrefill({date:"2020-01-01",skillTags:"boulder,xxx,lead",atmosphere:"休闲爬,瞎爬",capacity:20,joinMode:"approval"},now);
  assert.equal(clean.dateAdjusted,true);
  assert.equal(clean.date,"2025-03-10");assert.deepEqual(clean.skillTags,["boulder","lead"],"unknown types are dropped, valid ones kept");
  assert.deepEqual(clean.atmosphereTags,["休闲爬"]);
  assert.equal(clean.capacity,null,"capacity 20 prefill is dropped instead of capping silently");
  assert.equal(clean.joinMode,"approval");
  const empty=planUtil.sanitizePrefill({date:"2025-03-10",capacity:5},now);
  assert.equal(empty.skillTags,null,"no type in prefill must not wipe page default type");
  assert.equal(empty.capacity,5);assert.equal(empty.dateAdjusted,false);
});
test("R5 decorate and mergeListById enforce full/closed contract and paging dedup", () => {
  const full=planUtil.decorate({capacity:2,confirmedCount:2,joinDeadline:Date.now()+86400000,endAt:Date.now()+86400000});
  assert.equal(full.full,true);assert.equal(full.joinable,false);
  const closed=planUtil.decorate({capacity:4,confirmedCount:1,joinDeadline:1,endAt:Date.now()+86400000});
  assert.equal(closed.joinClosed,true);assert.equal(closed.joinable,false);
  const openLegacy=planUtil.decorate({capacity:4,confirmedCount:1,endAt:Date.now()+86400000});
  assert.equal(openLegacy.joinable,true,"missing deadline falls back to endAt");
  const merged=planUtil.mergeListById([{_id:1},{_id:2}],[{_id:2},{_id:3}]);
  assert.deepEqual(merged.map(x=>x._id),[1,2,3],"cross-page duplicates collapse by _id");
});

// ============ D2: demo identity server-side isolation ============
// 守卫模块经 harness 的 Node require 加载，测试里用同一缓存实例重置展示开关缓存
const guardReset = name => require(path.join(root,"cloudfunctions",name,"demo-guard.js")).resetShowCache();
const demoPlanBase = {
  _id:"demop", openid:"demo_0001", _openid:"demo_0001", uid:"demo_0001",
  dataOrigin:"demo", datasetId:"demo-core-v1", runId:"r1",
  status:"active", visibility:"public", date:future, startTime:"18:00", endTime:"22:00",
  joinMode:"direct", schemaVersion:2, joinSchemaVersion:2,
  capacity:2, confirmedCount:2, isFull:true, participantIds:["demo_0001","demo_0002"],
  gymSnapshot:{name:"测试岩馆",city:"测试城"}, userSnapshot:{nickName:"模拟甲"}
};
const demoJoinRow = {_id:"dj1", planId:"demop", openid:"demo_0002", status:"confirmed", date:future, userSnapshot:{nickName:"模拟乙"}};

test("D2 full demo plan: real join gets ordinary PLAN_FULL and zero writes", async () => {
  const s=database({RockUsers:[{openid:"viewer",nickName:"真实岩友"}],RockCalendarPlans:[demoPlanBase],RockCalendarJoins:[demoJoinRow]});
  const main=load("calendar_plan_publish",s,"viewer");
  const r=await main({action:"join_plan",planId:"demop"});
  assert.equal(r.ok,false);assert.equal(r.error.code,"PLAN_FULL","demo full plan surfaces the ordinary full error");
  assert.equal(s.writes.length,0,"no join/plan/schedule write may be created");
});
test("D2 tampered demo plan (free capacity) still rejects every join/approve", async () => {
  const tampered={...demoPlanBase,capacity:99,confirmedCount:1,isFull:false,participantIds:["demo_0001"]};
  const s=database({RockUsers:[{openid:"viewer",nickName:"真实岩友"}],RockCalendarPlans:[tampered],RockCalendarJoins:[]});
  const main=load("calendar_plan_publish",s,"viewer");
  const r=await main({action:"join_plan",planId:"demop"});
  assert.equal(r.ok,false);assert.equal(r.error.code,"PLAN_FULL","in-transaction demo gate beats tampered counters");
  assert.equal(s.writes.length,0);
});
test("D2 demo plan detail hides social entries via canRelate=false", async () => {
  const s=database({RockCalendarPlans:[demoPlanBase],RockCalendarJoins:[demoJoinRow]});
  const r=await load("calendar_plan_publish",s,"viewer")({action:"detail",planId:"demop"});
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.data.ownerInfo.canRelate,false,"host is not friend-addable");
  assert.equal(r.data.joiners.length,1);
  assert.equal(r.data.joiners[0].canRelate,false,"joiners are not friend-addable");
  assert.equal(r.data.meetingPoint,"","contact info stays hidden");
});
test("D2 showAll=false makes demo plans disappear behind old links", async () => {
  guardReset("calendar_plan_publish");
  const s=database({RockAppConfig:[{_id:"demo",showAll:false}],RockCalendarPlans:[demoPlanBase],RockCalendarJoins:[demoJoinRow]});
  const main=load("calendar_plan_publish",s,"viewer");
  for(const action of ["detail","get_joiners","join_plan"]) {
    const r=await main({action,planId:"demop"});
    assert.equal(r.ok,false,action);assert.equal(r.error.code,"NOT_FOUND",action+" reads as deleted");
  }
  assert.equal(s.writes.length,0);
  guardReset("calendar_plan_publish");
});
test("D2 discover/calendar exclude demo plans only while hidden", async () => {
  const realPlan={_id:"realp",openid:"hostU",status:"active",visibility:"public",date:future,startTime:"19:00",endTime:"21:00",confirmedCount:1};
  guardReset("calendar_query");
  const hidden=database({RockAppConfig:[{_id:"demo",showAll:false}],RockCalendarPlans:[demoPlanBase,realPlan]});
  const hd=await load("calendar_query",hidden,"viewer")({mode:"discover"});
  assert.deepEqual(hd.data.list.map(p=>p._id),["realp"],"hidden demo plan absent from discover");
  const cal=await load("calendar_query",hidden,"viewer")({mode:"calendar"});
  assert.equal(cal.data.dateAgg.find(d=>d.date===future).total,1,"calendar aggregation counts real plans only");
  guardReset("calendar_query");
  const shown=database({RockCalendarPlans:[demoPlanBase,realPlan]});
  const sd=await load("calendar_query",shown,"viewer")({mode:"discover"});
  assert.deepEqual(sd.data.list.map(p=>p._id).sort(),["demop","realp"],"default (no config) keeps demo plans visible");
});
test("D2 friendship: demo targets cannot be requested/accepted and never appear in search", async () => {
  const s1=database({RockFriendships:[]});
  const req=await load("friendship_manage",s1,"viewer")({action:"request",toOpenid:"demo_0002"});
  assert.equal(req.ok,false);assert.equal(req.error.code,"BLOCKED");
  assert.equal(s1.writes.length,0,"no friendship row created");
  const s2=database({RockFriendships:[]});
  const acc=await load("friendship_manage",s2,"viewer")({action:"accept",fromOpenid:"demo_0002"});
  assert.equal(acc.ok,false);assert.equal(acc.error.code,"NOT_FOUND");
  assert.equal(s2.writes.length,0);
  const s3=database({RockUsers:[
    {_id:"u1",openid:"real1",nickName:"岩甲"},
    {_id:"u2",openid:"demo_0002",accountType:"demo",nickName:"岩乙"}
  ]});
  const sr=await load("friendship_manage",s3,"viewer")({action:"search",keyword:"岩"});
  assert.deepEqual(sr.data.users.map(u=>u.openid),["real1"],"demo users excluded from search");
});
test("D2 direct card gift to a demo identity is refused", async () => {
  const s=database({RockCards:[{_id:"c1",createdByOpenid:"viewer",ownerOpenid:"",status:"draft"}]});
  const r=await load("rock_card_gift_manage",s,"viewer")({action:"create_direct",cardId:"c1",toOpenid:"demo_0002"});
  assert.equal(r.ok,false);assert.equal(r.error.code,"BAD_REQUEST");
  assert.equal(s.writes.length,0);
});
test("D2 circle approve/reject/remove refuse demo targets", async () => {
  const s=database({RockCircles:[{_id:"c1",adminOpenid:"viewer"}],RockCircleMembers:[]});
  const r=await load("circle_manage",s,"viewer")({action:"approve",circleId:"c1",openid:"demo_0003"});
  assert.equal(r.ok,false);assert.equal(r.error.code,"BAD_REQUEST");
  assert.equal(s.writes.length,0);
});
test("D2 admin user list and totals exclude demo identities", async () => {
  const s=database({RockUsers:[
    {_id:"x1",openid:"real1",nickName:"岩甲",updatedAt:300},
    {_id:"x2",openid:"real2",nickName:"岩丙",updatedAt:200},
    {_id:"x3",openid:"demo_0001",accountType:"demo",nickName:"模拟甲",updatedAt:400}
  ]});
  const r=await load("admin_manage",s,"42098a0769e3423400183ddf36230f95")({action:"listUsers",page:1,pageSize:20});
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.data.total,2,"total counts real users only");
  assert.deepEqual(Array.from(r.data.items,u=>u.openid).sort(),["real1","real2"]);
  const role=await load("admin_manage",s,"42098a0769e3423400183ddf36230f95")({action:"updateUserRole",userId:"x3",role:"admin"});
  assert.equal(role.ok,false);assert.equal(role.error.code,"FORBIDDEN","demo user cannot receive roles");
});
test("D2 synthetic demo_ openid cannot drive any write entry", async () => {
  const s=database({RockCalendarPlans:[{_id:"realp",openid:"host",_openid:"host",status:"active",visibility:"public",date:future,startTime:"19:00",endTime:"21:00"}]});
  const r=await load("calendar_plan_publish",s,"demo_0009")({action:"unjoin_plan",planId:"realp"});
  assert.equal(r.ok,false);assert.equal(r.error.code,"FORBIDDEN");
  assert.equal(s.writes.length,0);
});

// ============ D3: demo plan generator + atomic full-plan transaction ============
const demoGen = require(path.join(root,"cloudfunctions","demo_data_manage","generator.js"));
const demoProfileMod = require(path.join(root,"cloudfunctions","demo_data_manage","profile.js"));

test("D3 pure generator: reproducible, constrained, deficit based", () => {
  const mkPool = n => { const out=[]; for(let i=1;i<=n;i++){const pr=demoProfileMod.buildDemoProfile(i,{assetSha:"s"+i});out.push({openid:"demo_"+String(i).padStart(4,"0"),nickName:pr.nickName,demoProfile:pr.demoProfile});} return out; };
  const gyms=[1,2,3,4,5,6].map(i=>({gymId:"g"+i,name:"岩馆"+i,city:"杭州",supportedModes:i%4===0?["difficulty","lead"]:["boulder","difficulty","toprope"]}));
  const nowMs=Date.parse("2025-06-16T12:00:00+08:00");
  const args={seed:"abc",city:"杭州",pool:mkPool(30),gyms,existing:0,density:"medium",nowMs};
  const r=demoGen.generatePlanItems(args);
  assert.equal(r.items.length,24,"medium density fills 24");
  const perDay=new Set(), perWeek=new Map(), gymSlot=new Set();
  r.items.forEach(it=>{
    const all=[it.hostOpenid].concat(it.memberOpenids);
    assert.equal(all.length,it.capacity);assert.equal(new Set(all).size,all.length,"members distinct");
    assert.ok(it.capacity>=2&&it.capacity<=6);
    assert.ok(it.skillTags.some(t=>["boulder","lead","toprope","auto"].includes(t)),"core skill tag present");
    all.forEach(u=>{
      assert.ok(!perDay.has(u+"|"+it.date),"max 1 plan/day per user");perDay.add(u+"|"+it.date);
      const k=u+"|"+Math.floor(it.offset/7);perWeek.set(k,(perWeek.get(k)||0)+1);
    });
    it.timeSlots.forEach(s=>{assert.ok(!gymSlot.has(it.gymId+"|"+it.date+"|"+s),"gym/slot unique");gymSlot.add(it.gymId+"|"+it.date+"|"+s);});
  });
  [...perWeek.values()].forEach(n=>assert.ok(n<=3,"max 3 plans/week per user"));
  const r2=demoGen.generatePlanItems(args);
  assert.deepEqual(r2.items,r.items,"same seed/input → same plan");
  const r3=demoGen.generatePlanItems({...args,existing:20});
  assert.equal(r3.items.length,4,"deficit mode tops up to target, never appends");
  const r4=demoGen.generatePlanItems({...args,city:"小城",pool:mkPool(6),gyms:gyms.slice(0,2),density:"high"});
  assert.ok(r4.items.length<40&&r4.shortage>0,"small pool reduces volume and reports shortage");
});

test("D3 end-to-end: full plans atomically carry joins and schedule occupancy", async () => {
  const mkDemoUsers=[];
  for(let i=1;i<=24;i++){
    const pr=demoProfileMod.buildDemoProfile(i,{assetSha:"a".repeat(8)+i});
    mkDemoUsers.push({_id:"du"+i,openid:"demo_"+String(i).padStart(4,"0"),accountType:"demo",datasetId:"demo-core-v1",
      nickName:pr.nickName,displayName:pr.nickName,avatarUrl:"cloud://env/demo/"+i+".jpg",
      demoProfile:pr.demoProfile,demoCity:"",demoAllocated:false});
  }
  const gyms=[1,2,3,4].map(i=>({_id:"gym"+i,name:"杭州岩馆"+i,city:"杭州",address:"路"+i,supportedModes:["boulder","difficulty","toprope"]}));
  const seed={RockUsers:mkDemoUsers,RockGyms:gyms,RockCalendarPlans:[],RockCalendarJoins:[],RockUserScheduleDays:[],RockDemoRuns:[]};
  const s=database(seed);
  const admin="42098a0769e3423400183ddf36230f95";
  const call=load("demo_data_manage",s,admin,{ALLOW_DEMO_DATA:"true"});

  const preview=await call({action:"preview",city:"杭州",density:"low",seed:"e2e1"});
  assert.equal(preview.ok,true,JSON.stringify(preview));
  assert.equal(preview.data.toCreate,12,JSON.stringify(preview.data.reasons));
  assert.ok(preview.data.shortage===0);

  const gen=await call({action:"generate",city:"杭州",density:"low",seed:"e2e1",idempotencyKey:"k1"});
  assert.equal(gen.ok,true,JSON.stringify(gen));
  assert.equal(gen.data.status,"running","first call processes one batch only");
  assert.equal(gen.data.created,6);

  let summary=gen.data;
  for(let guard=0;guard<10&&summary.status!=="done";guard++){
    const c=await call({action:"generate_continue",runId:summary.runId});
    assert.equal(c.ok,true,JSON.stringify(c));summary=c.data;
  }
  assert.equal(summary.status,"done");assert.equal(summary.created,12);assert.equal(summary.failed,0);

  const plans=s.data().RockCalendarPlans;
  assert.equal(plans.length,12);
  const joins=s.data().RockCalendarJoins;
  plans.forEach(p=>{
    assert.equal(p.dataOrigin,"demo");assert.equal(p.participationPolicy,"read_only_demo");
    assert.equal(p.isFull,true);assert.equal(p.confirmedCount,p.capacity);
    assert.equal(p.participantIds.length,p.capacity,"fullness backed by real participants");
    assert.ok(p.joinDeadline>Date.now());
    const mine=joins.filter(j=>j.planId===p._id);
    assert.equal(mine.length,p.capacity-1,"one confirmed join row per non-host participant");
    mine.forEach(j=>{
      assert.ok(["joined","confirmed"].includes(j.status));
      assert.ok(p.participantIds.includes(j.openid));
      assert.equal(j._openid,j.openid);assert.equal(j.planOwnerOpenid,p.openid);
    });
    // 确定性 joinId
    mine.forEach(j=>{const expect="j_"+require("crypto").createHash("sha256").update(p._id+"|"+j.openid).digest("hex").slice(0,32);assert.equal(j._id,expect);});
  });
  // 日程占用：全体成员（含发起人）每人每局一条，引用计划均存在
  const days=s.data().RockUserScheduleDays;
  let entryCount=0;
  const planIds=new Set(plans.map(p=>p._id));
  days.forEach(d=>{
    (d.entries||[]).forEach(e=>{entryCount++;assert.ok(planIds.has(e.planId),"occupancy references a real demo plan");});
  });
  const expectEntries=plans.reduce((n,p)=>n+p.capacity,0);
  assert.equal(entryCount,expectEntries,"host+members each occupy exactly one entry");
  // 用掉的模拟用户已稳定领取到该城市
  const claimed=s.data().RockUsers.filter(u=>u.demoAllocated===true);
  assert.ok(claimed.length>=6);claimed.forEach(u=>assert.equal(u.demoCity,"杭州"));

  // 幂等：同 idempotencyKey 重放不产生第二份数据
  const again=await call({action:"generate",city:"杭州",density:"low",seed:"e2e1",idempotencyKey:"k1"});
  assert.equal(again.ok,true);assert.equal(again.data.runId,summary.runId);
  assert.equal(s.data().RockCalendarPlans.length,12,"replay creates no extra plans");

  // 权限与环境开关
  const s2=database(seed);
  const blocked=await load("demo_data_manage",s2,"someone",{ALLOW_DEMO_DATA:"true"})({action:"preview",city:"杭州"});
  assert.equal(blocked.ok,false);assert.equal(blocked.error.code,"FORBIDDEN");
  const disabled=await load("demo_data_manage",s2,admin,{})({action:"preview",city:"杭州"});
  assert.equal(disabled.ok,false);assert.equal(disabled.error.code,"DISABLED");

  // 无环境变量时，RockAppConfig/demo.featureEnabled=true 可作为运维开关；false/缺省仍关闭
  const s3=database(Object.assign({},seed,{RockAppConfig:[{_id:"demo",featureEnabled:true}]}));
  const viaConfig=await load("demo_data_manage",s3,admin,{})({action:"assets_status"});
  assert.equal(viaConfig.ok,true,"config switch enables feature without env var");
  const s4=database(Object.assign({},seed,{RockAppConfig:[{_id:"demo",featureEnabled:false}]}));
  const viaConfigOff=await load("demo_data_manage",s4,admin,{})({action:"assets_status"});
  assert.equal(viaConfigOff.error.code,"DISABLED");
});

test("D3 join write failure rolls back plan and all occupancies (no fake fullness)", async () => {
  const mk=[];
  for(let i=1;i<=12;i++){const pr=demoProfileMod.buildDemoProfile(i,{assetSha:"b".repeat(8)+i});mk.push({_id:"ru"+i,openid:"demo_"+String(i).padStart(4,"0"),accountType:"demo",nickName:pr.nickName,demoProfile:pr.demoProfile,demoCity:"",demoAllocated:false});}
  const gyms=[{_id:"gym1",name:"馆",city:"杭州",supportedModes:["boulder","difficulty"]}];
  const s=database({RockUsers:mk,RockGyms:gyms,RockCalendarPlans:[],RockCalendarJoins:[],RockUserScheduleDays:[],RockDemoRuns:[]});
  s.fail("RockCalendarJoins");
  const admin="42098a0769e3423400183ddf36230f95";
  const call=load("demo_data_manage",s,admin,{ALLOW_DEMO_DATA:"true"});
  const gen=await call({action:"generate",city:"杭州",density:"low",seed:"e2efail",idempotencyKey:"kfail"});
  assert.equal(gen.ok,true);
  assert.ok(gen.data.failed>=1);assert.equal(gen.data.created,0);
  assert.equal(s.data().RockCalendarPlans.length,0,"no plan survives aborted transaction");
  assert.equal(s.data().RockCalendarJoins.length,0);
  assert.equal(s.data().RockUserScheduleDays.length,0,"no orphan occupancy survives aborted transaction");
});

test("D4 hide flips global config; cleanup removes exactly the run's demo data", async () => {
  const mk=[];
  for(let i=1;i<=24;i++){const pr=demoProfileMod.buildDemoProfile(i,{assetSha:"c".repeat(8)+i});mk.push({_id:"cu"+i,openid:"demo_"+String(i).padStart(4,"0"),accountType:"demo",nickName:pr.nickName,demoProfile:pr.demoProfile,demoCity:"",demoAllocated:false});}
  const gyms=[1,2,3,4].map(i=>({_id:"gym"+i,name:"杭州岩馆"+i,city:"杭州",supportedModes:["boulder","difficulty","toprope"]}));
  const realPlan={_id:"realplan",openid:"realhost",dataOrigin:"real",datasetId:"other",cityKey:"杭州",
    date:new Date(Date.now()+86400000).toISOString().slice(0,10),status:"active",participantIds:["realhost"],capacity:1,confirmedCount:1,
    startAt:Date.now()+86400000,endAt:Date.now()+86500000,dateKey:""};
  const s=database({RockUsers:mk,RockGyms:gyms,RockCalendarPlans:[realPlan],RockCalendarJoins:[],RockUserScheduleDays:[],RockDemoRuns:[],RockAppConfig:[]});
  const admin="42098a0769e3423400183ddf36230f95";
  const call=load("demo_data_manage",s,admin,{ALLOW_DEMO_DATA:"true"});

  const hide=await call({action:"hide"});
  assert.equal(hide.ok,true);assert.equal(hide.data.showAll,false);
  assert.equal(s.data().RockAppConfig[0]._id,"demo");assert.equal(s.data().RockAppConfig[0].showAll,false);
  const show=await call({action:"show_all"});
  assert.equal(show.data.showAll,true);assert.equal(s.data().RockAppConfig.length,1,"config upsert keeps single doc");
  await call({action:"hide"});

  let g=await call({action:"generate",city:"杭州",density:"low",seed:"d4clean",idempotencyKey:"kd4"});
  for(let i=0;i<10&&g.data.status!=="done";i++){g=await call({action:"generate_continue",runId:g.data.runId});}
  assert.equal(g.data.status,"done");
  const demoCount=s.data().RockCalendarPlans.filter(p=>p.dataOrigin==="demo").length;
  assert.equal(demoCount,12);
  const totalEntries=s.data().RockUserScheduleDays.reduce((n,d)=>n+d.entries.length,0);

  const needConfirm=await call({action:"cleanup",runId:g.data.runId});
  assert.equal(needConfirm.ok,false);assert.equal(needConfirm.error.code,"CONFIRM_REQUIRED");

  const c=await call({action:"cleanup",runId:g.data.runId,confirm:true});
  assert.equal(c.ok,true,JSON.stringify(c));
  assert.equal(c.data.status,"cleaned");
  assert.equal(c.data.cleanupStats.plansRemoved,12);
  assert.ok(c.data.cleanupAnomalies.length===0,JSON.stringify(c.data.cleanupAnomalies));
  assert.equal(s.data().RockCalendarPlans.length,1,"real plan untouched");
  assert.equal(s.data().RockCalendarPlans[0]._id,"realplan");
  assert.equal(s.data().RockCalendarJoins.length,0);
  assert.equal(s.data().RockUserScheduleDays.reduce((n,d)=>n+d.entries.length,0),0,"all demo occupancy released");
  assert.equal(c.data.cleanupStats.occupancyReleased,totalEntries);

  // 幂等重清：无新增删除、无异常
  const again=await call({action:"cleanup",runId:g.data.runId,confirm:true});
  assert.equal(again.data.status,"cleaned");
  assert.equal(again.data.cleanupStats.plansRemoved,12);
  assert.equal(s.data().RockCalendarPlans.length,1);
  // 已清理任务的续跑不得复活任何计划
  const cont=await call({action:"generate_continue",runId:g.data.runId});
  assert.equal(cont.data.status,"cleaned");
  assert.equal(s.data().RockCalendarPlans.length,1);
});

test("D4 cleanup scope-guard refuses non-demo plan ids", async () => {
  const runApi=require(path.join(root,"cloudfunctions","demo_data_manage","run.js"));
  const realPlan={_id:"stranger",dataOrigin:"real",datasetId:"other",participantIds:["h"],capacity:1,
    date:new Date(Date.now()+86400000).toISOString().slice(0,10),status:"active"};
  const s=database({RockCalendarPlans:[realPlan],RockCalendarJoins:[],RockUserScheduleDays:[],
    RockDemoRuns:[{_id:"r1",status:"done",datasetId:"demo-core-v1",cityKey:"杭州",items:[1,2],planIds:["stranger","missing"]}]});
  const api=runApi.createRunApi({db:s.db,cloud:{}});
  const r=await api.cleanup({runId:"r1",confirm:true},{openid:"admin"});
  assert.equal(r.status,"cleaned");
  assert.equal(s.data().RockCalendarPlans.length,1,"non-demo plan never deleted");
  assert.equal(r.cleanupAnomalies.some(a=>a.planId==="stranger"&&a.kind==="SCOPE_GUARD"),true);
  assert.equal(r.cleanupStats.missingPlans,1);
});

(async()=>{let failures=0;for(const [name,fn] of checks){try{await fn();console.log("PASS "+name);}catch(e){failures++;console.error("FAIL "+name+"\n"+e.stack);}}console.log(`${checks.length-failures}/${checks.length} passed`);process.exitCode=failures?1:0;})();
