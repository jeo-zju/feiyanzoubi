const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const TEST_USER_OPENIDS = [
  "test_user_1_v", "test_user_2_v", "test_user_3_v", "test_user_4_v",
  "test_user_5_v", "test_user_6_v", "test_user_7_v", "test_user_8_v",
  "test_user_9_v", "test_user_10_v"
];
const TEST_GYM_NAMES = ["飞岩测试馆A_v", "飞岩测试馆B_v"];
const TEST_CIRCLE_NAMES = ["深圳抱石交流_v", "北京难度约爬_v", "新手友好攀岩_v"];

const USER_REGEX = /^test_user_.*_v$/;

function traceId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
function ok(data, tid) { return { ok: true, data, traceId: tid }; }
function fail(code, message, tid) { return { ok: false, error: { code, message }, traceId: tid }; }

function dayOffset(offset, h = 9, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
}
function dateKey(offset) {
  const d = dayOffset(offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h).toString(36).slice(0, 10);
}

const USER_NICKNAMES = [
  "攀岩小v", "抱石老王v", "5.11女神经v", "自由人v", "馆长v",
  "新手小菜鸟v", "线路割草机v", "闪线王v", "岩点收藏家v", "冲坠艺术家v"
];

const AVATAR_COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#84CC16", "#6366F1"];

async function countWhere(collName, where) {
  const r = await db.collection(collName).where(where).count();
  return r.total;
}

async function statusAction(tid) {
  const data = {};
  data.RockUsers = await countWhere("RockUsers", { openid: _.regexp(USER_REGEX) });
  data.RockGyms = await countWhere("RockGyms", { name: _.regexp(/_v$/) });
  data.RockGymCycles = await countWhere("RockGymCycles", { gymName: _.regexp(/_v$/) });
  data.RockCircles = await countWhere("RockCircles", { name: _.regexp(/_v$/) });
  data.RockCircleMembers = await countWhere("RockCircleMembers", { circleName: _.regexp(/_v$/) });
  data.RockFriendships = await countWhere("RockFriendships", _.or([{ fromOpenid: _.regexp(USER_REGEX) }, { toOpenid: _.regexp(USER_REGEX) }]));
  data.RockCheckinRecords = await countWhere("RockCheckinRecords", { openid: _.regexp(USER_REGEX) });
  data.RockUserDailyProgress = await countWhere("RockUserDailyProgress", { openid: _.regexp(USER_REGEX) });
  data.RockUserCycleProgress = await countWhere("RockUserCycleProgress", { openid: _.regexp(USER_REGEX) });
  data.RockCalendarPlans = await countWhere("RockCalendarPlans", { openid: _.regexp(USER_REGEX) });
  data.RockCards = await countWhere("RockCards", { ownerOpenid: _.regexp(USER_REGEX) });
  data.RockCardCredits = await countWhere("RockCardCredits", { openid: _.regexp(USER_REGEX) });
  data.RockCardGifts = await countWhere("RockCardGifts", _.or([{ fromOpenid: _.regexp(USER_REGEX) }, { toOpenid: _.regexp(USER_REGEX) }]));
  data.RockGymWallCards = await countWhere("RockGymWallCards", { gymName: _.regexp(/_v$/) });
  return ok({ counts: data, total: Object.values(data).reduce((a, b) => a + b, 0) }, tid);
}

async function willDeletePreview() {
  const preview = {};
  for (const pair of [
    ["RockUsers", { openid: _.regexp(USER_REGEX) }],
    ["RockGyms", { name: _.regexp(/_v$/) }],
    ["RockGymCycles", { gymName: _.regexp(/_v$/) }],
    ["RockCircles", { name: _.regexp(/_v$/) }],
    ["RockCircleMembers", { circleName: _.regexp(/_v$/) }],
    ["RockFriendships", _.or([{ fromOpenid: _.regexp(USER_REGEX) }, { toOpenid: _.regexp(USER_REGEX) }])],
    ["RockCheckinRecords", { openid: _.regexp(USER_REGEX) }],
    ["RockUserDailyProgress", { openid: _.regexp(USER_REGEX) }],
    ["RockUserCycleProgress", { openid: _.regexp(USER_REGEX) }],
    ["RockCalendarPlans", { openid: _.regexp(USER_REGEX) }],
    ["RockCards", { ownerOpenid: _.regexp(USER_REGEX) }],
    ["RockCardCredits", { openid: _.regexp(USER_REGEX) }],
    ["RockCardGifts", _.or([{ fromOpenid: _.regexp(USER_REGEX) }, { toOpenid: _.regexp(USER_REGEX) }])],
    ["RockGymWallCards", { gymName: _.regexp(/_v$/) }]
  ]) {
    preview[pair[0]] = await countWhere(pair[0], pair[1]);
  }
  return preview;
}

async function removeAll(collName, where) {
  const batchSize = 100;
  let removed = 0;
  while (true) {
    const list = await db.collection(collName).where(where).limit(batchSize).field({ _id: true }).get();
    if (!list.data || list.data.length === 0) break;
    const ids = list.data.map(d => d._id);
    for (const id of ids) {
      try { await db.collection(collName).doc(id).remove(); removed++; } catch (e) {}
    }
    if (list.data.length < batchSize) break;
  }
  return removed;
}

async function cleanupAction(confirm, tid) {
  const willDelete = await willDeletePreview();
  if (confirm !== true) {
    return ok({ mode: "preview_only", note: "传入 confirm:true 才会真的删除，符合 _v / test_user_.*_v 严格匹配", willDelete }, tid);
  }
  const removed = {};
  removed.RockGymWallCards = await removeAll("RockGymWallCards", { gymName: _.regexp(/_v$/) });
  removed.RockCardGifts = await removeAll("RockCardGifts", _.or([{ fromOpenid: _.regexp(USER_REGEX) }, { toOpenid: _.regexp(USER_REGEX) }]));
  removed.RockCardCredits = await removeAll("RockCardCredits", { openid: _.regexp(USER_REGEX) });
  removed.RockCards = await removeAll("RockCards", { ownerOpenid: _.regexp(USER_REGEX) });
  removed.RockCalendarPlans = await removeAll("RockCalendarPlans", { openid: _.regexp(USER_REGEX) });
  removed.RockUserCycleProgress = await removeAll("RockUserCycleProgress", { openid: _.regexp(USER_REGEX) });
  removed.RockUserDailyProgress = await removeAll("RockUserDailyProgress", { openid: _.regexp(USER_REGEX) });
  removed.RockCheckinRecords = await removeAll("RockCheckinRecords", { openid: _.regexp(USER_REGEX) });
  removed.RockFriendships = await removeAll("RockFriendships", _.or([{ fromOpenid: _.regexp(USER_REGEX) }, { toOpenid: _.regexp(USER_REGEX) }]));
  removed.RockCircleMembers = await removeAll("RockCircleMembers", { circleName: _.regexp(/_v$/) });
  removed.RockCircles = await removeAll("RockCircles", { name: _.regexp(/_v$/) });
  removed.RockGymCycles = await removeAll("RockGymCycles", { gymName: _.regexp(/_v$/) });
  removed.RockGyms = await removeAll("RockGyms", { name: _.regexp(/_v$/) });
  removed.RockUsers = await removeAll("RockUsers", { openid: _.regexp(USER_REGEX) });
  return ok({ mode: "confirmed_remove", removed, totalRemoved: Object.values(removed).reduce((a, b) => a + b, 0) }, tid);
}

async function addDocs(coll, docs) {
  const out = [];
  for (const d of docs) {
    try {
      const r = await db.collection(coll).add({ data: d });
      out.push({ _id: r._id, ok: true });
    } catch (e) {
      out.push({ ok: false, error: e.errMsg || String(e) });
    }
  }
  return out;
}

function buildUsers() {
  return TEST_USER_OPENIDS.map((oid, i) => {
    const u = {
      openid: oid,
      uid: oid,
      nickname: USER_NICKNAMES[i],
      avatarColor: AVATAR_COLORS[i],
      avatarUrl: "",
      role: oid === "test_user_5_v" ? "owner" : "user",
      city: ["深圳", "北京", "上海", "深圳", "深圳", "北京", "深圳", "上海", "北京", "深圳"][i],
      bio: [
        "爬了2年，爱抱石。", "目标V7。", "专注难度野攀。", "自由的灵魂~",
        "我是馆长，欢迎来A馆爬。", "刚入门求带。", "每条新线都要割掉。",
        "闪线是第一追求。", "收集造型奇特的岩点。", "冲坠也是一种艺术。"
      ][i],
      createdAt: dayOffset(-i * 2 - 1),
      updatedAt: new Date()
    };
    if (oid === "test_user_5_v") u.isOwner = true;
    return u;
  });
}

async function buildGymsAndCycles() {
  const gyms = TEST_GYM_NAMES.map((n, i) => ({
    name: n,
    city: i === 0 ? "深圳" : "北京",
    ownerOpenid: "test_user_5_v",
    ownerName: "馆长v",
    gymType: i === 0 ? "boulder" : "mixed",
    address: i === 0 ? "深圳市南山区科技园_v" : "北京市朝阳区三里屯_v",
    phone: "13800000000",
    description: i === 0 ? "测试专用抱石馆A_v，含完整线路" : "测试综合馆B_v，含难度墙",
    hardness: 3,
    status: "approved",
    openHours: "10:00-22:00",
    totalLines: 40,
    cycleCount: 2,
    createdAt: dayOffset(-30),
    updatedAt: new Date()
  }));
  const cycles = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const cycleOffset = j === 0 ? 0 : -14;
      const cycle = {
        gymId: "SEED_" + hashStr(TEST_GYM_NAMES[i]),
        gymName: TEST_GYM_NAMES[i],
        name: j === 0 ? "当期测试周期_v" : "上期测试周期_v",
        startDate: dayOffset(cycleOffset),
        endDate: dayOffset(cycleOffset + 13),
        status: "active",
        modes: i === 0 ? ["boulder"] : ["boulder", "difficulty"],
        lines: (i === 0 ? [
          { grade: "V0", count: 8, delta: 1 },
          { grade: "V1", count: 8, delta: 2 },
          { grade: "V2", count: 8, delta: 3 },
          { grade: "V3", count: 8, delta: 4 },
          { grade: "V4", count: 4, delta: 5 },
          { grade: "V5", count: 4, delta: 6 }
        ] : [
          { grade: "5.9", count: 6, delta: 1 },
          { grade: "5.10a", count: 6, delta: 2 },
          { grade: "5.10b", count: 6, delta: 2 },
          { grade: "5.11a", count: 6, delta: 3 },
          { grade: "5.11b", count: 6, delta: 3 },
          { grade: "5.12a", count: 4, delta: 4 }
        ]),
        createdAt: dayOffset(cycleOffset - 1),
        updatedAt: new Date()
      };
      cycles.push(cycle);
    }
  }
  return { gyms, cycles };
}

async function buildCircles() {
  const circles = TEST_CIRCLE_NAMES.map((name, idx) => ({
    name,
    description: [
      "深圳地区抱石爱好者交流圈，每周约爬_v",
      "北京攀岩圈，主攻难度线_v",
      "新手友好，互相带爬不卷_v"
    ][idx],
    visibility: idx === 2 ? "public" : "public",
    avatarColor: AVATAR_COLORS[idx],
    city: ["深圳", "北京", "深圳"][idx],
    memberCount: idx === 0 ? 10 : idx === 1 ? 8 : 5,
    pendingCount: idx === 0 ? 3 : idx === 1 ? 2 : 0,
    gymIds: idx === 1 ? [] : ["SEED_" + hashStr(TEST_GYM_NAMES[0])],
    createdByOpenid: TEST_USER_OPENIDS[idx],
    createdByName: USER_NICKNAMES[idx],
    createdAt: dayOffset(-20 + idx * 3),
    updatedAt: new Date()
  }));
  const circleNames = TEST_CIRCLE_NAMES;
  const members = [];
  const circleOpenidMap = [
    { ci: 0, openids: TEST_USER_OPENIDS.slice(0, 10) },
    { ci: 1, openids: TEST_USER_OPENIDS.slice(0, 8) },
    { ci: 2, openids: TEST_USER_OPENIDS.slice(5, 10) }
  ];
  for (const group of circleOpenidMap) {
    for (let k = 0; k < group.openids.length; k++) {
      const oid = group.openids[k];
      let status = "accepted";
      if (group.ci === 0 && k >= 7) status = "pending";
      if (group.ci === 1 && k >= 6) status = "pending";
      members.push({
        circleName: circleNames[group.ci],
        openid: oid,
        nickname: USER_NICKNAMES[TEST_USER_OPENIDS.indexOf(oid)],
        role: k === 0 ? "admin" : "member",
        status,
        joinedAt: dayOffset(-15 + k),
        createdAt: new Date()
      });
    }
  }
  return { circles, members };
}

function buildFriendships() {
  return [
    { fromOpenid: "test_user_1_v", toOpenid: "test_user_2_v", fromNickname: "攀岩小v", toNickname: "抱石老王v", status: "accepted", createdAt: dayOffset(-10) },
    { fromOpenid: "test_user_2_v", toOpenid: "test_user_3_v", fromNickname: "抱石老王v", toNickname: "5.11女神经v", status: "accepted", createdAt: dayOffset(-8) },
    { fromOpenid: "test_user_1_v", toOpenid: "test_user_4_v", fromNickname: "攀岩小v", toNickname: "自由人v", status: "pending", createdAt: dayOffset(-1) }
  ];
}

const BOULDER_GRADES = ["V2", "V3", "V4", "V5"];
const DIFFICULTY_GRADES = ["5.10a", "5.10b", "5.11a", "5.11c"];

function buildCheckinsAndProgress() {
  const records = [];
  const dailyMap = {};
  const cycleMap = {};
  const userGymOffsets = [
    { u: 0, g: 0, mode: "boulder" },
    { u: 1, g: 0, mode: "boulder" },
    { u: 2, g: 1, mode: "difficulty" },
    { u: 3, g: 0, mode: "boulder" },
    { u: 4, g: 1, mode: "difficulty" },
    { u: 5, g: 1, mode: "boulder" }
  ];
  for (const ug of userGymOffsets) {
    const openid = TEST_USER_OPENIDS[ug.u];
    const gymId = "SEED_" + hashStr(TEST_GYM_NAMES[ug.g]);
    const gymName = TEST_GYM_NAMES[ug.g];
    for (let dayIdx = 0; dayIdx < 14; dayIdx++) {
      if (Math.random() < 0.35) continue;
      const dk = dateKey(-dayIdx);
      const isBoulder = ug.mode === "boulder";
      const pool = isBoulder ? BOULDER_GRADES : DIFFICULTY_GRADES;
      const grade = pool[Math.floor(Math.random() * pool.length)];
      const count = 1 + Math.floor(Math.random() * 4);
      const deltaPer = Math.max(1, pool.indexOf(grade) + 1);
      const totalDelta = count * deltaPer;
      const rec = {
        openid,
        nickname: USER_NICKNAMES[ug.u],
        gymId,
        gymName,
        cycleId: "SEED_CYCLE_" + hashStr(gymName + "cur"),
        cycleName: "当期测试周期_v",
        dateKey: dk,
        mode: isBoulder ? "boulder" : "difficulty",
        items: [{ grade, count, deltaPer, totalDelta }],
        totalCount: count,
        totalDelta,
        note: dayIdx === 0 ? "测试自动生成数据_v" : "",
        createdAt: dayOffset(-dayIdx, 20 - (dayIdx % 6), dayIdx * 3 % 30)
      };
      records.push(rec);
      if (!dailyMap[openid + dk]) dailyMap[openid + dk] = { openid, dateKey: dk, boulderCount: 0, boulderDelta: 0, difficultyCount: 0, difficultyDelta: 0, gyms: new Set(), totalDelta: 0 };
      const dp = dailyMap[openid + dk];
      dp.gyms.add(gymName);
      if (isBoulder) { dp.boulderCount += count; dp.boulderDelta += totalDelta; } else { dp.difficultyCount += count; dp.difficultyDelta += totalDelta; }
      dp.totalDelta += totalDelta;
      const cKey = openid + "|" + gymId;
      if (!cycleMap[cKey]) cycleMap[cKey] = { openid, cycleId: rec.cycleId, cycleName: rec.cycleName, gymId, gymName, boulderCount: 0, boulderDelta: 0, difficultyCount: 0, difficultyDelta: 0, totalDelta: 0 };
      const cp = cycleMap[cKey];
      if (isBoulder) { cp.boulderCount += count; cp.boulderDelta += totalDelta; } else { cp.difficultyCount += count; cp.difficultyDelta += totalDelta; }
      cp.totalDelta += totalDelta;
    }
  }
  const dailyProgress = Object.values(dailyMap).map(d => ({
    ...d,
    gyms: Array.from(d.gyms),
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  const cycleProgress = Object.values(cycleMap).map(c => ({
    ...c,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  return { records, dailyProgress, cycleProgress };
}

function buildCalendarPlans() {
  const plans = [];
  for (let i = 0; i < 8; i++) {
    const openid = TEST_USER_OPENIDS[i % 6];
    const offset = i;
    plans.push({
      openid,
      nickname: USER_NICKNAMES[i % 6],
      dateKey: dateKey(offset),
      startAt: dayOffset(offset, 18 + (i % 3), 0),
      endAt: dayOffset(offset, 20 + (i % 3), 0),
      gymId: "SEED_" + hashStr(TEST_GYM_NAMES[i % 2]),
      gymName: TEST_GYM_NAMES[i % 2],
      visibility: i < 5 ? "public" : "friends",
      needPartner: i === 1 || i === 3 || i === 6,
      note: ["一起抱石冲V！", "求搭档刷难度", "新手约爬，老司机带", "", "周末全天在馆", "只爬难度", "深圳求带", "新线首发"][i],
      mode: i % 3 === 2 ? "difficulty" : "boulder",
      createdAt: dayOffset(offset - 2, 10, 0),
      updatedAt: new Date()
    });
  }
  return plans;
}

function buildCards() {
  const cards = [];
  const credits = [];
  for (let i = 0; i < 6; i++) {
    const openid = TEST_USER_OPENIDS[i];
    const cardId = "SEED_CARD_" + hashStr(openid + "v");
    cards.push({
      ownerOpenid: openid,
      ownerNickname: USER_NICKNAMES[i],
      ownerAvatarColor: AVATAR_COLORS[i],
      title: [
        "坚持就是胜利_v",
        "每条线都要闪_v",
        "慢慢来比较快_v",
        "自由攀登_v",
        "馆长签名卡_v",
        "新手的第一张_v"
      ][i],
      oneLiner: [
        "岩点是路，脚步是诗_v",
        "今天的汗水是明天的V6_v",
        "别想太多，爬就对了_v",
        "高度不可怕，坠落才是开始_v",
        "来A馆免费喝馆长茶_v",
        "第一次上墙，手抖到抓不住_v"
      ][i],
      level: i === 0 ? "V6 / 5.12a" : i === 5 ? "V1 / 5.9" : "V" + (1 + i) + " / 5.11" + String.fromCharCode(96 + i % 4),
      years: i + "年",
      styles: [["抱石", "难度"], ["抱石"], ["难度"], ["野攀"], ["抱石", "速度"], ["抱石", "难度"]][i],
      badge: [
        { label: "目标", value: "V8" },
        { label: "最爱岩馆", value: TEST_GYM_NAMES[i % 2].replace("_v", "") }
      ],
      layout: "classic",
      avatarColor: AVATAR_COLORS[i],
      visible: true,
      isPrimary: true,
      createdAt: dayOffset(-i - 1),
      updatedAt: new Date()
    });
    credits.push({
      openid,
      remaining: 10 - i,
      total: 10 + i,
      updatedAt: new Date()
    });
  }
  return { cards, credits };
}

function buildCardGift() {
  return [{
    giftType: "direct",
    cardId: "SEED_CARD_" + hashStr("test_user_1_v" + "v"),
    fromOpenid: "test_user_1_v",
    fromNickname: "攀岩小v",
    toOpenid: "test_user_2_v",
    toNickname: "抱石老王v",
    status: "pending",
    createdAt: dayOffset(-1, 15, 0)
  }];
}

function buildWallCards() {
  return [0, 2, 4].map(i => ({
    gymId: "SEED_" + hashStr(TEST_GYM_NAMES[0]),
    gymName: TEST_GYM_NAMES[0],
    cardId: "SEED_CARD_" + hashStr(TEST_USER_OPENIDS[i] + "v"),
    ownerOpenid: TEST_USER_OPENIDS[i],
    ownerNickname: USER_NICKNAMES[i],
    slot: i + 1,
    hungAt: dayOffset(-3 + i)
  }));
}

async function seedAction(tid) {
  const existingUsers = await countWhere("RockUsers", { openid: _.regexp(USER_REGEX) });
  const existingGyms = await countWhere("RockGyms", { name: _.regexp(/_v$/) });
  if (existingUsers + existingGyms > 0) {
    return ok({
      mode: "idempotent_skip",
      note: "检测到已有 _v 测试数据，为避免重复新增本次跳过。请先执行 cleanup 再 seed",
      existing: { RockUsers: existingUsers, RockGyms: existingGyms }
    }, tid);
  }
  const usersDocs = buildUsers();
  const batch1 = await addDocs("RockUsers", usersDocs);

  const { gyms, cycles } = await buildGymsAndCycles();
  const batch2Gyms = await addDocs("RockGyms", gyms);
  const batch2Cycles = await addDocs("RockGymCycles", cycles);

  const { circles, members } = await buildCircles();
  const batch3Circles = await addDocs("RockCircles", circles);
  const batch3Members = await addDocs("RockCircleMembers", members);
  const friendships = buildFriendships();
  const batch3Friendships = await addDocs("RockFriendships", friendships);

  const { records, dailyProgress, cycleProgress } = buildCheckinsAndProgress();
  const batch4Records = await addDocs("RockCheckinRecords", records);
  const batch4Daily = await addDocs("RockUserDailyProgress", dailyProgress);
  const batch4Cycle = await addDocs("RockUserCycleProgress", cycleProgress);
  const calPlans = buildCalendarPlans();
  const batch4Calendar = await addDocs("RockCalendarPlans", calPlans);
  const { cards, credits } = buildCards();
  const batch4Cards = await addDocs("RockCards", cards);
  const batch4Credits = await addDocs("RockCardCredits", credits);
  const gifts = buildCardGift();
  const batch4Gifts = await addDocs("RockCardGifts", gifts);
  const walls = buildWallCards();
  const batch4Wall = await addDocs("RockGymWallCards", walls);

  return ok({
    inserted: {
      batch1: { RockUsers: batch1.length },
      batch2: { RockGyms: batch2Gyms.length, RockGymCycles: batch2Cycles.length },
      batch3: { RockCircles: batch3Circles.length, RockCircleMembers: batch3Members.length, RockFriendships: batch3Friendships.length },
      batch4: {
        RockCheckinRecords: batch4Records.length,
        RockUserDailyProgress: batch4Daily.length,
        RockUserCycleProgress: batch4Cycle.length,
        RockCalendarPlans: batch4Calendar.length,
        RockCards: batch4Cards.length,
        RockCardCredits: batch4Credits.length,
        RockCardGifts: batch4Gifts.length,
        RockGymWallCards: batch4Wall.length
      }
    }
  }, tid);
}

exports.main = async (event, context) => {
  const tid = traceId();
  const action = String((event && event.action) || "").trim().toLowerCase();
  try {
    if (process.env.ALLOW_TEST_SEED !== "true") return fail("DISABLED", "测试数据工具未启用", tid);
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail("FORBIDDEN", "仅管理员可调用", tid);
    const user = await db.collection("RockUsers").where({ openid, role: "admin" }).limit(1).get();
    if (!user.data || !user.data.length) return fail("FORBIDDEN", "仅管理员可调用", tid);
    if (action === "status") return statusAction(tid);
    if (action === "cleanup") return cleanupAction((event && event.confirm) === true, tid);
    if (action === "seed") return seedAction(tid);
    return fail("BAD_ACTION", `支持 action: seed | cleanup | status。收到: ${action}`, tid);
  } catch (e) {
    return fail("INTERNAL_ERROR", e.errMsg || e.message || String(e), tid);
  }
};
