// Run with: node tests/calendar-report-cancel.regression.js
// In-memory regression coverage only; this does not validate the real cloud SDK.
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { manage: manageCommunity } = require(path.join(root, "cloudfunctions/calendar_plan_publish/community"));
const { manage: manageLifecycle } = require(path.join(root, "cloudfunctions/calendar_plan_publish/lifecycle"));

const clone = value => structuredClone(value);
const op = (name, args) => ({ __op: name, args });
const command = new Proxy({}, { get: (_, name) => (...args) => op(name, args) });
const identity = row => row.openid || row._openid || row.uid || "";

function matches(row, query) {
  if (!query || !Object.keys(query).length) return true;
  if (query.__op === "or") return query.args[0].some(item => matches(row, item));
  if (query.__op === "and") return query.args[0].every(item => matches(row, item));
  return Object.entries(query).every(([key, expected]) => {
    const actual = row[key];
    if (expected && expected.__op === "in") return expected.args[0].includes(actual);
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
  });
}

function database(seed) {
  let state = clone(seed);
  let tail = Promise.resolve();
  let beforeTransaction = null;
  let failedCollection = "";
  function collection(name, store, transaction = false) {
    let id = "", query = {}, limit = 100, skip = 0;
    const ref = {
      doc(value) { id = String(value); return ref; },
      where(value) {
        if (transaction) throw new Error("mock cloud transaction does not support query reads");
        query = value; return ref;
      },
      orderBy() { return ref; },
      limit(value) { limit = value; return ref; },
      skip(value) { skip = value; return ref; },
      async get() {
        const rows = store[name] || [];
        if (id) return { data: clone(rows.find(row => row._id === id) || null) };
        return { data: clone(rows.filter(row => matches(row, query)).slice(skip, skip + limit)) };
      },
      async set({ data }) { write("set", data); },
      async update({ data }) { write("update", data); }
    };
    function write(kind, data) {
      if (failedCollection === name) throw new Error("injected write failure: " + name);
      if (!store[name]) store[name] = [];
      const index = store[name].findIndex(row => row._id === id);
      if (kind === "update" && index < 0) throw new Error("document not found");
      const next = { ...(kind === "update" ? store[name][index] : {}), ...clone(data), _id: id };
      if (index < 0) store[name].push(next); else store[name][index] = next;
    }
    return ref;
  }
  const db = {
    command,
    serverDate: () => new Date(),
    collection: name => collection(name, state),
    runTransaction(fn) {
      const task = tail.then(async () => {
        if (beforeTransaction) {
          const hook = beforeTransaction;
          beforeTransaction = null;
          await hook(state);
        }
        const staged = clone(state);
        const result = await fn({ collection: name => collection(name, staged, true) });
        state = staged;
        return result;
      });
      tail = task.catch(() => {});
      return task;
    }
  };
  return {
    db,
    data: () => state,
    beforeNextTransaction: hook => { beforeTransaction = hook; },
    failWritesTo: name => { failedCollection = name; }
  };
}

const cloud = { getTempFileURL: async () => ({ fileList: [] }) };
const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const basePlan = {
  _id: "plan", openid: "host", _openid: "host", status: "active", visibility: "public",
  date: future, startTime: "18:00", endTime: "22:00", version: 4,
  gymSnapshot: { name: "Test Gym" }
};

async function cancelSeed(planOverrides = {}) {
  const store = database({
    RockUsers: [
      { _id: "admin-user", openid: "admin", role: "admin" },
      { _id: "host-user", openid: "host" },
      { _id: "reporter-user", openid: "reporter" },
      { _id: "confirmed-user", openid: "confirmed" },
      { _id: "pending-user", openid: "pending" },
      { _id: "outsider-user", openid: "outsider" }
    ],
    RockCalendarPlans: [{ ...basePlan, ...planOverrides }],
    RockCalendarJoins: [
      { _id: "confirmed-join", planId: "plan", openid: "confirmed", status: "confirmed" },
      { _id: "pending-join", planId: "plan", _openid: "pending", status: "pending" },
      { _id: "legacy-joined", planId: "plan", uid: "legacy-joined", status: "joined", updatedAt: 3 },
      { _id: "duplicate-active-old", planId: "plan", openid: "duplicate", status: "joined", updatedAt: 1 },
      { _id: "duplicate-cancelled-new", planId: "plan", openid: "duplicate", status: "cancelled", updatedAt: 2 },
      { _id: "current-cancelled-old", planId: "plan", openid: "current", status: "cancelled", updatedAt: 1 },
      { _id: "current-joined-new", planId: "plan", openid: "current", status: "joined", updatedAt: 2 },
      { _id: "rejected-join", planId: "plan", openid: "rejected", status: "rejected" },
      { _id: "cancelled-join", planId: "plan", openid: "cancelled", status: "cancelled" }
    ],
    RockReports: [{ _id: "report", planId: "plan", openid: "reporter", status: "pending" }],
    RockPlanEvents: []
  });
  const result = await manageCommunity({ db: store.db, openid: "admin", event: { action: "resolve_report", reportId: "report", resolution: "cancel_plan" } });
  assert.deepEqual(result, { resolved: true });
  return store;
}

async function testAudienceForCurrentPlan() {
  const store = await cancelSeed({ participantIds: ["host", "confirmed", "pending", "confirmed"], joinSchemaVersion: 2 });
  const event = store.data().RockPlanEvents[0];
  assert.deepEqual(new Set(event.audience), new Set(["host", "reporter", "confirmed", "pending"]));
  assert.equal(event.audience.length, 4, "audience must be deduplicated");
  assert.equal(event.contact, undefined);
  assert.equal(event.meetingPoint, undefined);
  assert.equal(event.wechatId, undefined);
  for (const openid of event.audience) assert.ok(openid, "audience must not contain empty identities");
}

async function testLegacyPlanRetryAndNoticePrivacy() {
  const store = await cancelSeed();
  const firstEvent = clone(store.data().RockPlanEvents);
  assert.deepEqual(new Set(firstEvent[0].audience), new Set(["host", "reporter", "confirmed", "pending", "legacy-joined", "current"]));
  assert.ok(!firstEvent[0].audience.includes("duplicate"), "newer cancelled record must override an older joined record");
  assert.equal(store.data().RockCalendarPlans[0].version, 5);

  const retry = await manageCommunity({ db: store.db, openid: "admin", event: { action: "resolve_report", reportId: "report", resolution: "cancel_plan" } });
  assert.deepEqual(retry, { resolved: true });
  assert.deepEqual(store.data().RockPlanEvents, firstEvent, "retry must not create or rewrite an event");
  assert.equal(store.data().RockCalendarPlans[0].version, 5, "retry must not increment the plan version");

  const outsider = await manageCommunity({ db: store.db, openid: "outsider", event: { action: "notices" } });
  assert.equal(outsider.list.length, 0, "unrelated users cannot read the cancellation notice");
  const pending = await manageCommunity({ db: store.db, openid: "pending", event: { action: "notices" } });
  assert.equal(pending.list.length, 1);
}

async function testAmbiguousParticipantIndexFallsBackToJoinState() {
  const store = await cancelSeed({ participantIds: ["host", "stale-index-member"] });
  const audience = store.data().RockPlanEvents[0].audience;
  assert.ok(!audience.includes("stale-index-member"));
  assert.ok(audience.includes("legacy-joined"));
  assert.ok(audience.includes("pending"));
}

async function testStaleJoinSnapshotCannotRestoreDepartedMember() {
  const store = database({
    RockUsers: [{ _id: "new-user", openid: "new-member", nickName: "New" }],
    RockCalendarPlans: [{ ...basePlan, participantIds: ["host", "departed"], joinSchemaVersion: 2 }],
    RockCalendarJoins: [{ _id: "departed-join", planId: "plan", openid: "departed", status: "confirmed" }],
    RockPlanEvents: []
  });
  store.beforeNextTransaction(state => {
    state.RockCalendarPlans[0].participantIds = ["host"];
    state.RockCalendarPlans[0].version++;
    state.RockCalendarJoins[0].status = "cancelled";
    state.RockCalendarJoins[0].updatedAt = 10;
  });
  const result = await manageLifecycle({ db: store.db, cloud, openid: "new-member", event: { action: "join_plan", planId: "plan" } });
  assert.equal(result.status, "confirmed");
  assert.deepEqual(store.data().RockCalendarPlans[0].participantIds, ["host", "new-member"]);
}

async function testAdminCancelUsesCurrentIndexAfterStaleSnapshot() {
  const store = database({
    RockUsers: [{ _id: "admin-user", openid: "admin", role: "admin" }],
    RockCalendarPlans: [{ ...basePlan, participantIds: ["host", "departed"], joinSchemaVersion: 2 }],
    RockCalendarJoins: [{ _id: "departed-join", planId: "plan", openid: "departed", status: "confirmed" }],
    RockReports: [{ _id: "report", planId: "plan", openid: "reporter", status: "pending" }],
    RockPlanEvents: []
  });
  store.beforeNextTransaction(state => {
    state.RockCalendarPlans[0].participantIds = ["host", "late-member"];
    state.RockCalendarPlans[0].version++;
    state.RockCalendarJoins[0].status = "cancelled";
    state.RockCalendarJoins.push({ _id: "late-join", planId: "plan", openid: "late-member", status: "confirmed" });
  });
  await manageCommunity({ db: store.db, openid: "admin", event: { action: "resolve_report", reportId: "report", resolution: "cancel_plan" } });
  const audience = store.data().RockPlanEvents[0].audience;
  assert.deepEqual(new Set(audience), new Set(["host", "late-member", "reporter"]));
  assert.ok(!audience.includes("departed"), "stale query snapshot must not notify a departed member");
}

async function testEventFailureRollsBackCancellation() {
  const store = database({
    RockUsers: [{ _id: "admin-user", openid: "admin", role: "admin" }],
    RockCalendarPlans: [{ ...basePlan, participantIds: ["host"], joinSchemaVersion: 2 }],
    RockCalendarJoins: [],
    RockReports: [{ _id: "report", planId: "plan", openid: "reporter", status: "pending" }],
    RockPlanEvents: []
  });
  store.failWritesTo("RockPlanEvents");
  await assert.rejects(
    manageCommunity({ db: store.db, openid: "admin", event: { action: "resolve_report", reportId: "report", resolution: "cancel_plan" } }),
    /injected write failure/
  );
  assert.equal(store.data().RockCalendarPlans[0].status, "active");
  assert.equal(store.data().RockCalendarPlans[0].version, 4);
  assert.equal(store.data().RockReports[0].status, "pending");
  assert.equal(store.data().RockPlanEvents.length, 0);
}

async function testEventFailureRollsBackOwnerCancellation() {
  const store = database({
    RockCalendarPlans: [{ ...basePlan, participantIds: ["host", "confirmed"], joinSchemaVersion: 2 }],
    RockCalendarJoins: [{ _id: "confirmed-join", planId: "plan", openid: "confirmed", status: "confirmed" }],
    RockPlanEvents: []
  });
  store.failWritesTo("RockPlanEvents");
  await assert.rejects(
    manageLifecycle({ db: store.db, cloud, openid: "host", event: { action: "cancel", planId: "plan" } }),
    /injected write failure/
  );
  assert.equal(store.data().RockCalendarPlans[0].status, "active");
  assert.equal(store.data().RockCalendarPlans[0].version, 4);
  assert.equal(store.data().RockPlanEvents.length, 0);
}

async function testCancelledPlanRejectsJoinAndApproval() {
  const store = await cancelSeed();
  await assert.rejects(
    manageLifecycle({ db: store.db, cloud, openid: "outsider", event: { action: "join_plan", planId: "plan" } }),
    error => error && error.code === "PLAN_ENDED"
  );
  await assert.rejects(
    manageLifecycle({ db: store.db, cloud, openid: "host", event: { action: "approve_joiner", planId: "plan", targetOpenid: "pending" } }),
    error => error && error.code === "PLAN_ENDED"
  );
  assert.equal(store.data().RockCalendarJoins.find(row => identity(row) === "pending").status, "pending");
}

(async () => {
  const tests = [
    ["admin cancellation reaches current participants", testAudienceForCurrentPlan],
    ["legacy participant fallback is private and retry-safe", testLegacyPlanRetryAndNoticePrivacy],
    ["ambiguous member index falls back to current legacy join state", testAmbiguousParticipantIndexFallsBackToJoinState],
    ["stale join snapshot cannot restore a departed member", testStaleJoinSnapshotCannotRestoreDepartedMember],
    ["admin cancellation prefers the current member index", testAdminCancelUsesCurrentIndexAfterStaleSnapshot],
    ["event failure rolls back admin cancellation", testEventFailureRollsBackCancellation],
    ["event failure rolls back owner cancellation", testEventFailureRollsBackOwnerCancellation],
    ["cancelled plan rejects joins and approvals", testCancelledPlanRejectsJoinAndApproval]
  ];
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("PASS " + name); }
    catch (error) { console.error("FAIL " + name + "\n" + error.stack); }
  }
  console.log(`${passed}/${tests.length} passed`);
  process.exitCode = passed === tests.length ? 0 : 1;
})();
