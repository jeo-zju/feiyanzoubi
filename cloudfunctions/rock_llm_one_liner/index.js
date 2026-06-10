const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid) {
  return { ok: false, error: { code, message }, traceId: tid };
}

function safeText(v) {
  return v == null ? "" : String(v).trim();
}

function hash32(s) {
  const str = safeText(s);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(list, seed) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return "";
  return arr[seed % arr.length];
}

function normalizeOneLiner(s) {
  const t = safeText(s);
  if (!t) return "";
  const line = t.split(/\r?\n/).map((x) => safeText(x)).filter(Boolean)[0] || "";
  const cleaned = line.replace(/^["“”]+|["“”]+$/g, "").trim();
  if (cleaned.length <= 40) return cleaned;
  return cleaned.slice(0, 40);
}

function mockOneLiner(style, story) {
  const s = safeText(story);
  const seed = hash32(`${style}|${s}`);

  if (style === "humor") {
    const special = [
      { re: /(牙|嘴|磕|咬)/, text: "这是为数不多的用嘴攀岩者。" },
      { re: /(热身|拉伸)/, text: "热身做得比主线还认真。" },
      { re: /(掉|摔|落|飞出去)/, text: "落点熟练到像回家。" },
      { re: /(横移|横着|traverse)/i, text: "直上不会，横移很稳。" },
      { re: /(脚|脚点|踩)/, text: "脚点谈判专家，落脚全靠嘴。" }
    ];
    for (let i = 0; i < special.length; i++) {
      if (special[i].re.test(s)) return special[i].text;
    }
    const pool = [
      "今天不爬顶也行，姿态先赢。",
      "上墙前很谦虚，上墙后很嘴硬。",
      "动作不一定干净，嘴一定干净利落。",
      "岩点没说话，但我已经吵赢了。",
      "理论都懂，身体随机抽签。"
    ];
    return pick(pool, seed);
  }

  const pool = [
    "稳住呼吸，动作干净，今天也算赢。",
    "别急，下一把就顺了。",
    "你已经很强了，剩下交给节奏。",
    "每次上墙都是进步，别跟自己吵架。",
    "热身到位，脚点清楚，顶点自然来。"
  ];
  return pick(pool, seed);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const story = safeText(event && event.story);
    const style = safeText(event && event.style) === "encourage" ? "encourage" : "humor";
    if (!story) return fail("BAD_REQUEST", "缺少 story", tid);
    const oneLiner = normalizeOneLiner(mockOneLiner(style, story));
    return ok({ oneLiner, style, mocked: true }, tid);
  } catch (e) {
    return fail("LLM_FAILED", e && e.message ? e.message : "生成失败", tid);
  }
};
