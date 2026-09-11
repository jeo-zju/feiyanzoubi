// 演示约爬生成器（纯函数，无 wx-server-sdk 依赖）：本地测试与云函数共用。
// 给定 seed、城市、模拟用户池、岩馆列表与已存在局数，确定性地产出未来 14 天的
// 满员约爬描述（不写库）；落库与事务在 run.js。同 seed 同输入 → 同结果。
//
// 规则（DEMO_USERS_AND_PLANS_EXECUTION_PLAN.md §5）：
// - 日期今天..+13（北京时间）：0–2 天 60%，3–6 天 30%，7–13 天 10%
// - 工作日晚上为主；周末下午/晚上为主 + 少量上午；少量连续双时段
// - 同一模拟用户每天最多 1 场、每周最多 3 场；同馆同段默认最多 1 场
// - 容量 2–6（3–4 为主，含发起人）；成员全部来自该城市已分配池
// - 标题自然口语，禁止“急缺/求搭子”类措辞；密度按补差额而非追加
const profile = require("./profile");
const schedule = require("./schedule");

const DENSITY_TARGETS = Object.freeze({ low: 12, medium: 24, high: 40 });
const DAY_BUCKETS = [
  { days: [0, 1, 2], weight: 60 },
  { days: [3, 4, 5, 6], weight: 30 },
  { days: [7, 8, 9, 10, 11, 12, 13], weight: 10 }
];
const CAP_WEIGHTS = [[2, 15], [3, 35], [4, 30], [5, 12], [6, 8]];
const DOUBLE_SLOT_RATE = 0.15;
const WEEKDAY_SLOTS = [["evening", 80], ["afternoon", 18], ["morning", 2]];
const WEEKEND_SLOTS = [["afternoon", 45], ["evening", 40], ["morning", 15]];
const MAX_PER_DAY = 1;
const MAX_PER_WEEK = 3;
const WINDOW_DAYS = 14;

const TITLES = {
  boulder: ["下班一起抱石", "饭后抱石出出汗", "中午摸两条线", "周末抱石放松局", "慢慢磕几条抱石", "夜场抱石走起"],
  rope: ["周末顶绳慢慢爬", "晚上一起挂线", "闲爬顶绳局", "磕线日，慢慢来", "夜场爬绳", "下午绳上见"],
  any: ["一起爬，认识新岩友", "周末岩馆见", "下班岩馆回血局", "随便爬爬流", "新的一周从爬墙开始"]
};
const ATMOSPHERE = [["休闲爬", 50], ["新人友好", 25], ["安静磕线", 15]];

function normalizeDensity(v) {
  if (v === 12 || v === "low") return "low";
  if (v === 40 || v === "high") return "high";
  return "medium";
}

function beijingDateParts(nowMs) {
  const out = [];
  const today = schedule.beijingYMD(nowMs);
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const ymd = schedule.addDaysYMD(today, i);
    // 北京时间星期：0=周日
    const dow = new Date(schedule.dayStartMs(ymd) + schedule.TZ_OFFSET_MS).getUTCDay();
    out.push({ offset: i, date: ymd, dow, weekend: dow === 0 || dow === 6, week: Math.floor(i / 7) });
  }
  return out;
}

// 岩馆能力：只识别白名单模式
function gymModes(gym) {
  const raw = Array.isArray(gym && gym.supportedModes) ? gym.supportedModes.map(String) : [];
  const set = new Set(raw.map((x) => x.toLowerCase()));
  return {
    boulder: set.has("boulder"),
    difficulty: ["difficulty", "lead", "toprope", "auto"].some((k) => set.has(k)),
    ropeKeys: ["lead", "toprope", "auto"].filter((k) => set.has(k))
  };
}

function userKind(user) {
  const modes = (user && user.demoProfile && user.demoProfile.modes) || [];
  return modes[0] === "rope" ? "rope" : "boulder";
}

function pickSlots(rnd, day) {
  const first = profile.weightedPick(rnd, day.weekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS);
  const order = ["morning", "afternoon", "evening"];
  const keys = [first];
  if (rnd() < DOUBLE_SLOT_RATE && first !== "evening") {
    keys.push(order[order.indexOf(first) + 1]);
  }
  return keys;
}

function chooseSkillTags(rnd, flavor, gym) {
  if (flavor === "boulder") return ["boulder"];
  const modes = gymModes(gym);
  const candidates = modes.ropeKeys.length ? modes.ropeKeys : ["toprope"];
  const pick = candidates[Math.floor(rnd() * candidates.length)];
  return [pick === "auto" ? "auto" : pick === "lead" ? (rnd() < 0.6 ? "lead" : "toprope") : "toprope"];
}

function chooseTitle(rnd, flavor) {
  const pool = rnd() < 0.85 ? TITLES[flavor] : TITLES.any;
  return pool[Math.floor(rnd() * pool.length)];
}

// 纯规划。pool: [{openid, demoUserId, nickName, avatarUrl, demoProfile}]；
// gyms: [{gymId, name, city, address, supportedModes}]；existing 为窗口内该城市已存在演示局数。
function generatePlanItems(input) {
  const nowMs = Number(input.nowMs) || Date.now();
  const city = String(input.city || "");
  const density = normalizeDensity(input.density);
  const target = DENSITY_TARGETS[density];
  const existing = Math.max(0, Number(input.existing) || 0);
  const want = Math.max(0, target - existing);
  const seedText = String(input.seed == null ? "" : input.seed);
  const rnd = profile.mulberry32(profile.hashSeed(
    `demo-plans-${profile.GENERATOR_VERSION}|${city}|${seedText}|${schedule.beijingYMD(nowMs)}`
  ));
  const days = beijingDateParts(nowMs);
  const pool = (input.pool || []).filter((u) => u && u.openid);
  const gyms = (input.gyms || []).filter((g) => g && g.gymId);

  // 每用户使用计数（用于挑最空闲的人）与硬约束
  const usageTotal = new Map();
  const dayUsed = new Set(); // openid|offset
  const weekUsed = new Map(); // openid -> Map(week->n)
  const gymSlotUsed = new Set(); // gymId|offset|slot
  const bump = (user, offset, week) => {
    usageTotal.set(user.openid, (usageTotal.get(user.openid) || 0) + 1);
    dayUsed.add(`${user.openid}|${offset}`);
    const m = weekUsed.get(user.openid) || new Map();
    m.set(week, (m.get(week) || 0) + 1);
    weekUsed.set(user.openid, m);
  };
  const available = (user, day) => {
    if (dayUsed.has(`${user.openid}|${day.offset}`)) return false;
    if ((weekUsed.get(user.openid)?.get(day.week) || 0) >= MAX_PER_WEEK) return false;
    return true;
  };

  const items = [];
  const reasons = { poolExhausted: 0, gymFlavorMissing: 0, gymSlotBusy: 0 };
  const maxAttempts = want * 8 + 20;

  for (let attempt = 0; items.length < want && attempt < maxAttempts; attempt++) {
    // 日期按权重桶抽取
    const bucket = profile.weightedPick(rnd, DAY_BUCKETS.map((b) => [b, b.weight]));
    const day = days[bucket.days[Math.floor(rnd() * bucket.days.length)]];
    const slots = pickSlots(rnd, day);
    const flavor = rnd() < 0.75 ? "boulder" : "rope";
    const wantCap = profile.weightedPick(rnd, CAP_WEIGHTS);

    // 该风味在该时段未占满的岩馆
    const gymPool = profile.shuffle(gyms, rnd).filter((g) => {
      const m = gymModes(g);
      return flavor === "boulder" ? m.boulder : m.difficulty;
    });
    if (!gymPool.length) { reasons.gymFlavorMissing++; continue; }
    const gym = gymPool.find((g) => slots.every((s) => !gymSlotUsed.has(`${g.gymId}|${day.offset}|${s}`)));
    if (!gym) { reasons.gymSlotBusy++; continue; }

    // 先风味匹配、再总使用次数最少；容量不足时递减（最少 2 人含发起人）
    const ranked = profile.shuffle(pool, rnd)
      .filter((u) => available(u, day))
      .sort((a, b) => {
        const af = userKind(a) === flavor ? 0 : 1;
        const bf = userKind(b) === flavor ? 0 : 1;
        if (af !== bf) return af - bf;
        return (usageTotal.get(a.openid) || 0) - (usageTotal.get(b.openid) || 0);
      });
    if (ranked.length < 2) { reasons.poolExhausted++; continue; }
    const people = ranked.slice(0, wantCap);
    if (people.length < 2) { reasons.poolExhausted++; continue; }

    const host = people[0];
    const members = people.slice(1);
    const skillTags = chooseSkillTags(rnd, flavor, gym);
    const atmosphere = rnd() < 0.55 ? [profile.weightedPick(rnd, ATMOSPHERE)] : [];
    items.push({
      date: day.date,
      offset: day.offset,
      week: day.week,
      timeSlots: slots,
      gymId: gym.gymId,
      gymSnapshot: { name: gym.name || "", city: gym.city || city, address: gym.address || "" },
      capacity: people.length,
      hostOpenid: host.openid,
      memberOpenids: members.map((u) => u.openid),
      skillTags,
      title: chooseTitle(rnd, flavor),
      atmosphereTags: atmosphere,
      joinMode: "direct",
      meetingPoint: "",
      contact: "",
      note: ""
    });
    people.forEach((u) => bump(u, day.offset, day.week));
    slots.forEach((s) => gymSlotUsed.add(`${gym.gymId}|${day.offset}|${s}`));
  }

  // 输出按日期/起始时段稳定排序，便于预览与逐批落库
  const slotRank = { morning: 0, afternoon: 1, evening: 2 };
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : slotRank[a.timeSlots[0]] - slotRank[b.timeSlots[0]]));
  items.forEach((it, i) => { it.seq = i + 1; });

  return {
    city,
    density,
    target,
    existing,
    wanted: want,
    items,
    shortage: want - items.length,
    reasons,
    window: { start: days[0].date, end: days[days.length - 1].date },
    generatorVersion: profile.GENERATOR_VERSION,
    assetVersion: profile.ASSET_VERSION,
    datasetId: profile.DATASET_ID
  };
}

module.exports = {
  DENSITY_TARGETS,
  WINDOW_DAYS,
  normalizeDensity,
  beijingDateParts,
  gymModes,
  userKind,
  generatePlanItems
};
