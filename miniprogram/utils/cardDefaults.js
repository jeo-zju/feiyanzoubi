const { safeText } = require("./format");

const TITLE_OPTIONS = [
  "长臂猿",
  "理论攀岩者",
  "小短手",
  "小短腿",
  "脚点哲学家",
  "热身冠军",
  "落点收藏家",
  "复盘型选手",
  "保护点强迫症",
  "岩点谈判专家",
  "只会横移的",
  "观众席 MVP"
];

const ONE_LINER_OPTIONS = [
  "顶绳热身",
  "别问，问就是脚点没擦",
  "再试一次就过",
  "今天状态在线",
  "这个点太滑了",
  "手套忘带了",
  "走线有点骚",
  "我不累，我只是缺氧",
  "先休息三分钟",
  "这条线有点恶意",
  "落点不讲武德",
  "我会，但今天不想"
];

function hashSeed(text) {
  const value = safeText(text) || "rock";
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 131 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickBySeed(list, seedText, fallback) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return fallback || "";
  const idx = hashSeed(seedText) % arr.length;
  return safeText(arr[idx]) || fallback || "";
}

function getDefaultCardPreview(user) {
  const info = user && typeof user === "object" ? user : {};
  const openid = safeText(info.openid);
  const nickName = safeText(info.nickName);
  const seedBase = openid || nickName || "rock";
  return {
    displayName: nickName || "岩友",
    title: pickBySeed(TITLE_OPTIONS, `${seedBase}:title`, "长臂猿"),
    gymLabel: "浪迹天涯",
    oneLiner: pickBySeed(ONE_LINER_OPTIONS, `${seedBase}:one`, "再试一次就过")
  };
}

module.exports = {
  TITLE_OPTIONS,
  ONE_LINER_OPTIONS,
  getDefaultCardPreview
};
