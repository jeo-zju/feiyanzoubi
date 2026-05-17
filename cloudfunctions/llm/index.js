const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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

function pick(list, n) {
  const arr = list.slice(0);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr.slice(0, n);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const prompt = safeText(event && event.prompt);
    const dictRes = await db.collection("RockBlackTalkDictionary").limit(200).get();
    const list = (dictRes && dictRes.data) || [];
    const words = pick(
      list
        .map((x) => safeText(x.word || x.text || x.value))
        .filter(Boolean),
      6
    );
    const content = prompt
      ? `收到：${prompt}\n\n${words.length ? `今日关键词：${words.join("、")}\n` : ""}建议：先热身，再上墙，稳住节奏。`
      : `${words.length ? `今日关键词：${words.join("、")}\n` : ""}建议：热身到位，动作干净，收操别忘。`;
    return ok({ content }, tid);
  } catch (e) {
    return fail("LLM_FAILED", e && e.message ? e.message : "生成失败", tid);
  }
};

