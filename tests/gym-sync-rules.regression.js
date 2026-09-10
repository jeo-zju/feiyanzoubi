/**
 * 岩馆同步纯规则回归测试
 *
 * 在本地 Node 环境运行，不依赖 wx-server-sdk、不发网络请求、不写数据库。
 * 验证 GYM_SYNC_INITIALIZATION_PLAN.md 第 3 节「本地最小复现结果」中的 6 个问题已修复。
 *
 * 运行：node tests/gym-sync-rules.regression.js
 */

const assert = require("assert");

const {
  assessPoiRelevance,
  normalizePoi,
  normalizeName,
  buildSourceLinkId
} = require("../cloudfunctions/rock_sync_gyms/normalize");
const {
  distanceInMeters,
  scoreGymCandidate,
  canAutoMerge,
  normalizeExistingGym
} = require("../cloudfunctions/rock_sync_gyms/match");
const { buildGymPatch, isFieldProtected, buildNewGymDoc } = require("../cloudfunctions/rock_sync_gyms/write");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL: ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log("G1 纯规则回归测试\n");

// ---------- 问题 1：同城同名远距离误合并 ----------
console.log("问题1: 同城同名、地址不同且相距数十公里不应自动合并");

test("同名不同地址远距离 得分<1.2 且无独立证据 → 不可自动合并", () => {
  const existing = {
    _id: "g1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "北京市朝阳区望京街1号",
    phone: "",
    lat: 39.99,
    lng: 116.47,
    sourceRefs: [],
    status: "active"
  };
  const item = {
    provider: "tencent",
    providerPoiId: "poi2",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "北京市海淀区中关村大街1号",
    phone: "",
    lat: 39.98,
    lng: 116.31
  };
  const { score, evidence } = scoreGymCandidate(existing, item);
  // 同名 0.5 + 原始同名 0.3 = 0.8，距离约 14km 不加分
  assert.ok(score < 1.2, `分数 ${score} 应 < 1.2`);
  assert.ok(!canAutoMerge({ score, evidence }), "不应自动合并");
});

test("同名同地址近距离 可自动合并", () => {
  const existing = {
    _id: "g1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "北京市朝阳区望京街1号",
    phone: "010-12345678",
    lat: 39.99,
    lng: 116.47,
    sourceRefs: [],
    status: "active"
  };
  const item = {
    provider: "tencent",
    providerPoiId: "poi2",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "北京市朝阳区望京街1号",
    phone: "010-12345678",
    lat: 39.9901,
    lng: 116.4701
  };
  const { score, evidence } = scoreGymCandidate(existing, item);
  // 同名0.5+原名0.3+地址0.4+电话0.4+坐标100m0.5 = 2.1
  assert.ok(score >= 1.2, `分数 ${score} 应 >= 1.2`);
  assert.ok(canAutoMerge({ score, evidence }), "应可自动合并");
});

// ---------- 问题 2：坐标缺失归零导致 0 米 ----------
console.log("\n问题2: 坐标缺失不应归零计算为 0 米");

test("两组缺失坐标 distanceInMeters 返回 null", () => {
  const dist = distanceInMeters(null, null, 0, 0);
  assert.strictEqual(dist, null, "缺失坐标应返回 null");
});

test("一组有效一组缺失 返回 null", () => {
  const dist = distanceInMeters(39.9, 116.4, null, null);
  assert.strictEqual(dist, null, "部分缺失应返回 null");
});

test("normalizePoi 坐标缺失保持 null", () => {
  const poi = { id: "p1", title: "测试岩馆", category: "运动健身:攀岩馆", location: {} };
  const item = normalizePoi(poi, { city: "北京市", keyword: "攀岩" });
  assert.strictEqual(item.lat, null, "lat 缺失应为 null");
  assert.strictEqual(item.lng, null, "lng 缺失应为 null");
});

// ---------- 问题 3：人工地址电话被覆盖 ----------
console.log("\n问题3: claimedByOwner 馆的人工字段不应被自动覆盖");

test("buildGymPatch 不覆盖已认领馆的 address/phone/city", () => {
  const existing = {
    _id: "g1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "馆长修正的地址",
    phone: "馆长电话",
    lat: 39.99,
    lng: 116.47,
    claimedByOwner: true,
    ownerOpenid: "owner123",
    sourceRefs: [],
    status: "active",
    syncMeta: { firstSeenAt: 100, lastSeenAt: 100 }
  };
  const item = {
    provider: "tencent",
    providerPoiId: "poi1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "上海市",
    address: "地图返回的新地址",
    phone: "地图电话",
    lat: 31.23,
    lng: 121.47,
    supportedModes: ["boulder"],
    modeConfidence: 0.8,
    relevanceDecision: "accepted",
    venueType: "climbing_venue"
  };
  const patch = buildGymPatch(existing, item, "batch1", Date.now());
  assert.ok(!patch.address, "已认领馆 address 不应被覆盖");
  assert.ok(!patch.phone, "已认领馆 phone 不应被覆盖");
  assert.ok(!patch.city, "已认领馆 city 不应被覆盖");
  assert.ok(!patch.lat, "已认领馆 lat 不应被覆盖");
  assert.ok(patch.sourceRefs, "sourceRefs 应更新");
});

test("未认领馆 地址可更新", () => {
  const existing = {
    _id: "g1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "旧地址",
    phone: "",
    lat: null,
    lng: null,
    claimedByOwner: false,
    sourceRefs: [],
    status: "active",
    syncMeta: {}
  };
  const item = {
    provider: "tencent",
    providerPoiId: "poi1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "新地址",
    phone: "010-111",
    lat: 39.99,
    lng: 116.47,
    supportedModes: [],
    modeConfidence: 0,
    relevanceDecision: "accepted",
    venueType: "climbing_venue"
  };
  const patch = buildGymPatch(existing, item, "batch1", Date.now());
  assert.strictEqual(patch.address, "新地址", "未认领馆 address 应更新");
  assert.strictEqual(patch.phone, "010-111", "未认领馆 phone 应更新");
});

// ---------- 问题 4：新馆 reviewState 区分实体与模式 ----------
console.log("\n问题4: 实体存疑的新馆不应直接 approved");

test("relevanceDecision=needs_review 的新馆 reviewState=pending_review", () => {
  const item = {
    provider: "tencent",
    providerPoiId: "poi1",
    name: "攀岩装备体验中心",
    normalizedName: normalizeName("攀岩装备体验中心"),
    city: "北京市",
    address: "xxx",
    phone: "",
    lat: 39.9,
    lng: 116.4,
    supportedModes: ["boulder"],
    modeConfidence: 0.8,
    relevanceDecision: "needs_review",
    relevanceReason: "疑似用品/办公场所",
    venueType: "retail_or_office"
  };
  const doc = buildNewGymDoc(item, "batch1", Date.now());
  assert.strictEqual(doc.reviewState, "pending_review", "实体存疑应 pending_review");
  assert.strictEqual(doc.status, "active", "状态保持 active");
});

test("relevanceDecision=accepted 且有模式 的新馆 reviewState=approved", () => {
  const item = {
    provider: "tencent",
    providerPoiId: "poi2",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    address: "xxx",
    phone: "",
    lat: 39.9,
    lng: 116.4,
    supportedModes: ["boulder"],
    modeConfidence: 0.8,
    relevanceDecision: "accepted",
    venueType: "climbing_venue"
  };
  const doc = buildNewGymDoc(item, "batch1", Date.now());
  assert.strictEqual(doc.reviewState, "approved", "实体确认应 approved");
});

// ---------- 问题 5：实体分型盲点 ----------
console.log("\n问题5: 实体分型不应把装备店/办公室/游乐设施当岩馆");

test("攀岩装备体验中心 → needs_review (retail_or_office)", () => {
  const r = assessPoiRelevance({ title: "攀岩装备体验中心", category: "运动健身:体育用品" }, { keyword: "攀岩" });
  assert.strictEqual(r.decision, "needs_review", `应 needs_review，实际 ${r.decision}`);
});

test("攀岩俱乐部办公室 → needs_review (training_or_club)", () => {
  const r = assessPoiRelevance({ title: "攀岩俱乐部办公室", category: "运动健身:其他" }, { keyword: "攀岩" });
  assert.strictEqual(r.decision, "needs_review", `应 needs_review，实际 ${r.decision}`);
});

test("儿童乐园攀岩项目 → needs_review (amusement_attraction)", () => {
  const r = assessPoiRelevance({ title: "儿童乐园攀岩项目", category: "运动健身:其他" }, { keyword: "攀岩" });
  assert.strictEqual(r.decision, "needs_review", `应 needs_review，实际 ${r.decision}`);
});

test("极限运动中心 → needs_review (极限运动不等于攀岩)", () => {
  const r = assessPoiRelevance({ title: "极限运动中心", category: "运动健身:极限运动" }, { keyword: "攀岩" });
  assert.strictEqual(r.decision, "needs_review", `应 needs_review，实际 ${r.decision}`);
});

test("酒店内对外攀岩馆 → needs_review (受限场所需核实)", () => {
  const r = assessPoiRelevance({ title: "向上攀岩馆（某酒店店）", category: "运动健身:攀岩馆" }, { keyword: "攀岩" });
  assert.strictEqual(r.decision, "needs_review", `酒店内岩馆应 needs_review，实际 ${r.decision}`);
});

test("明确攀岩馆 → accepted", () => {
  const r = assessPoiRelevance({ title: "向山攀岩馆", category: "运动健身:攀岩馆" }, { keyword: "攀岩" });
  assert.strictEqual(r.decision, "accepted", `应 accepted，实际 ${r.decision}`);
});

// ---------- 问题 6：来源映射 ID 确定性 ----------
console.log("\n问题6: 来源映射 ID 确定性且不依赖截断 sourceRefs");

test("buildSourceLinkId 对同 provider+poiId 稳定", () => {
  const id1 = buildSourceLinkId("tencent", "poi123");
  const id2 = buildSourceLinkId("tencent", "poi123");
  assert.strictEqual(id1, id2, "同输入应同 ID");
  assert.ok(id1.length > 0, "ID 非空");
});

test("buildSourceLinkId 不同 poiId 不同", () => {
  const id1 = buildSourceLinkId("tencent", "poi123");
  const id2 = buildSourceLinkId("tencent", "poi456");
  assert.notStrictEqual(id1, id2, "不同 poiId 应不同 ID");
});

// ---------- 额外：匹配顺序中精确来源优先 ----------
console.log("\n额外: 精确来源 ID 匹配返回最高分");

test("sourceRefs 精确匹配 score=10", () => {
  const existing = {
    _id: "g1",
    name: "向上攀岩馆",
    normalizedName: normalizeName("向上攀岩馆"),
    city: "北京市",
    sourceRefs: [{ provider: "tencent", providerPoiId: "poi1" }],
    status: "active"
  };
  const item = {
    provider: "tencent",
    providerPoiId: "poi1",
    name: "其他名字",
    normalizedName: "other",
    city: "北京市",
    address: "",
    phone: "",
    lat: null,
    lng: null
  };
  const { score } = scoreGymCandidate(existing, item);
  assert.strictEqual(score, 10, "精确来源匹配应为 10");
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
