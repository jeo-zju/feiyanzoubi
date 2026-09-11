// 模拟身份资料的唯一实现（纯函数，无 wx-server-sdk 依赖）：
// 本地导入工具（deploy-tools/scripts/demo-assets-import.js）、demo_data_manage 云函数
// 与回归测试共用，保证“同图片 → 同 demoUserId → 同昵称/能力”跨批次稳定。
//
// 约束（见 DEMO_USERS_AND_PLANS_EXECUTION_PLAN.md §4.2）：
// - ID 使用 demo_ 独立命名空间，绝不伪造微信 OPENID，登录态只由微信可信上下文决定；
// - 昵称来自人工词库组合，避免“官方/馆长/教练”等误导身份；
// - 不生成职业、联系方式、真实姓名、认证徽章；简介最多一句，多数留空。
const crypto = require("crypto");

const DATASET_ID = "demo-core-v1";
const ASSET_VERSION = "v1";
const GENERATOR_VERSION = "g1";
const DEMO_OPENID_PREFIX = "demo_";

function pad4(n) { return String(n).padStart(4, "0"); }
function demoUserIdForIndex(index) { return DEMO_OPENID_PREFIX + pad4(index); }

function demoOpenId(assetSha) {
  return DEMO_OPENID_PREFIX + crypto.createHash("sha256")
    .update(`feiyanzoubi-demo-v1|${assetSha}`).digest("hex").slice(0, 24);
}

function isDemoId(id) {
  return typeof id === "string" && id.indexOf(DEMO_OPENID_PREFIX) === 0;
}

// ---- 可复现随机（mulberry32）----
function hashSeed(text) {
  let h = 2166136261 >>> 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function weightedPick(rnd, entries) {
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rnd() * total;
  for (const e of entries) {
    r -= e[1];
    if (r < 0) return e[0];
  }
  return entries[entries.length - 1][0];
}

// ---- 昵称词库（人工编写；全部为中性物件/动物/状态组合，不暗示身份）----
const NICK_MODIFIERS = [
  "爱爬墙的", "下班就想", "周末常驻", "慢慢", "稳稳", "悄悄", "认真",
  "佛系", "快乐", "蹦跶的", "热爱磕线的", "揣着粉袋的", "踩点很准的", "喜欢挂线的"
];
const NICK_NOUNS = [
  "小壁虎", "考拉", "蜗牛", "柴犬", "橘猫", "章鱼", "松鼠", "企鹅", "水獭", "树懒",
  "萤火虫", "小海鸥", "海盐汽水", "青苔", "镁粉", "支点", "岩点", "快挂", "粉袋",
  "岩壁", "石灰石", "红砂岩", "晚风", "星星", "月亮", "栗子", "年糕", "土豆", "麻薯"
];
const BIO_POOL = [
  "下班爬两小时回血", "周末基本在岩馆", "慢慢爬，不着急",
  "喜欢安静磕线的时间", "抱石使人快乐", "新线见"
];

// 固定主种子的一次性洗牌，保证 1..N 号昵称全局唯一且稳定
const NICKNAME_SEQ = (() => {
  const combos = [];
  NICK_MODIFIERS.forEach((m) => NICK_NOUNS.forEach((n) => combos.push(m + n)));
  return shuffle(combos, mulberry32(hashSeed("demo-nicknames-v1")));
})();

const BOULDER_GRADES = [["V0", 6], ["V1", 12], ["V2", 20], ["V3", 22], ["V4", 18], ["V5", 12], ["V6", 8], ["V7", 2]];
const ROPE_GRADES = [["5.9", 10], ["5.10a", 18], ["5.10b", 22], ["5.10c", 20], ["5.11a", 16], ["5.11b", 10], ["5.11c", 4]];

// index 从 1 开始；asset: {assetSha, fileID}
function buildDemoProfile(index, asset) {
  const a = asset || {};
  const demoUserId = demoUserIdForIndex(index);
  const nickName = NICKNAME_SEQ[(index - 1) % NICKNAME_SEQ.length];
  const rnd = mulberry32(hashSeed(`demo-profile-v1|${index}`));

  const ropeUser = rnd() < 0.25;
  const climbSkills = {};
  let modes, grade, leadCapable = false;
  if (ropeUser) {
    grade = weightedPick(rnd, ROPE_GRADES);
    climbSkills.toprope = grade;
    leadCapable = rnd() < 0.4;
    if (leadCapable) climbSkills.lead = grade;
    modes = ["rope"];
  } else {
    grade = weightedPick(rnd, BOULDER_GRADES);
    climbSkills.boulder = grade;
    modes = ["boulder"];
  }
  const bio = rnd() < 0.2 ? BIO_POOL[Math.floor(rnd() * BIO_POOL.length)] : "";

  return {
    demoUserId,
    openid: a.assetSha ? demoOpenId(a.assetSha) : "",
    avatarFileId: a.fileID || "",
    nickName,
    bio,
    climbSkills,
    demoProfile: { modes, grade, leadCapable }
  };
}

module.exports = {
  DATASET_ID,
  ASSET_VERSION,
  GENERATOR_VERSION,
  DEMO_OPENID_PREFIX,
  demoUserIdForIndex,
  demoOpenId,
  isDemoId,
  hashSeed,
  mulberry32,
  shuffle,
  weightedPick,
  buildDemoProfile
};
