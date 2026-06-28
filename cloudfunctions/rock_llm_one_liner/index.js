const https = require("https");
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

function boolEnv(name) {
  return /^(1|true|yes|on)$/i.test(safeText(process.env[name]));
}

function getConfig(event) {
  const apiKey = safeText(process.env.DEEPSEEK_API_KEY) || safeText(process.env.OPENAI_API_KEY);
  const baseUrl =
    safeText(process.env.DEEPSEEK_BASE_URL) ||
    safeText(process.env.OPENAI_BASE_URL) ||
    safeText(event && event.baseUrl) ||
    "https://api.deepseek.com";
  const model =
    safeText(process.env.DEEPSEEK_MODEL) ||
    safeText(process.env.OPENAI_MODEL) ||
    safeText(event && event.model) ||
    "deepseek-chat";
  const forceMock = boolEnv("DEEPSEEK_USE_MOCK") || !!(event && event.forceMock);
  return { apiKey, baseUrl, model, forceMock };
}

function buildPrompt(payload) {
  const story = safeText(payload && payload.story);
  const style = safeText(payload && payload.style) === "encourage" ? "encourage" : "humor";
  const displayName = safeText(payload && payload.displayName) || "岩友";
  const title = safeText(payload && payload.title) || "攀岩爱好者";
  const mbti = safeText(payload && payload.mbti);
  const gyms = Array.isArray(payload && payload.gyms)
    ? payload.gyms
        .map((item) => {
          if (!item) return "";
          if (typeof item === "string") return safeText(item);
          return safeText(item.name || item.gymName || item.title || item.gymId);
        })
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const persona =
    style === "humor"
      ? "你是攀岩社区里嘴很毒但不冒犯人的文案助手，擅长写轻吐槽、机灵、带一点黑话感的名片一句话。"
      : "你是攀岩社区里温柔鼓励型的文案助手，擅长写真诚、轻松、有力量感的名片一句话。";
  const rules = [
    "请只输出一句中文，不要解释。",
    "长度控制在 8 到 24 个汉字内，绝对不要超过 40 个字符。",
    "不要带引号、书名号、emoji、换行、序号。",
    "不要复述用户原文的大段内容，要提炼成适合名片展示的短句。",
    "内容要像攀岩人会说的话，允许少量攀岩语感，但不要太生硬。"
  ].join("\n");
  const profile = [
    `名字：${displayName}`,
    `标签：${title}${mbti ? ` / ${mbti}` : ""}`,
    gyms.length ? `常去岩馆：${gyms.join("、")}` : "常去岩馆：未提供",
    `故事素材：${story}`
  ].join("\n");
  return `${persona}\n${rules}\n\n资料：\n${profile}`;
}

function buildRequestBody(payload, model) {
  const style = safeText(payload && payload.style) === "encourage" ? "encourage" : "humor";
  return {
    model,
    temperature: style === "humor" ? 1.15 : 0.9,
    max_tokens: 64,
    stream: false,
    messages: [
      {
        role: "system",
        content: "你是一个帮攀岩用户写名片一句话文案的助手。输出必须简短、自然、适合展示在名片上。"
      },
      {
        role: "user",
        content: buildPrompt(payload)
      }
    ]
  };
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers,
        timeout: 15000
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 500;
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (e) {
            parsed = null;
          }
          if (statusCode < 200 || statusCode >= 300) {
            const message =
              (parsed && parsed.error && (parsed.error.message || parsed.error.code)) ||
              raw ||
              `HTTP_${statusCode}`;
            const err = new Error(`DeepSeek 请求失败: ${message}`);
            err.code = "DEEPSEEK_HTTP_ERROR";
            err.statusCode = statusCode;
            err.body = parsed || raw;
            reject(err);
            return;
          }
          resolve(parsed || {});
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("DeepSeek 请求超时"));
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function extractMessageContent(message) {
  if (!message) return "";
  const direct = message.content;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) {
    const text = direct
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        if (typeof item === "object") return safeText(item.text || item.content || item.value);
        return "";
      })
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  return safeText(message.reasoning_content || message.reasoning || message.output_text);
}

async function callDeepSeek(payload, config) {
  const base = safeText(config && config.baseUrl).replace(/\/+$/, "");
  const endpoint = `${base}/chat/completions`;
  const body = buildRequestBody(payload, safeText(config && config.model) || "deepseek-chat");
  const res = await postJson(
    endpoint,
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body
  );
  const content =
    res &&
    res.choices &&
    res.choices[0] &&
    res.choices[0].message
      ? extractMessageContent(res.choices[0].message)
      : "";
  return normalizeOneLiner(content);
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
    const config = getConfig(event);

    if (config.forceMock) {
      const oneLiner = normalizeOneLiner(mockOneLiner(style, story));
      return ok({ oneLiner, style, mocked: true, provider: "mock" }, tid);
    }
    if (!config.apiKey) {
      return fail("LLM_NOT_CONFIGURED", "未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY", tid);
    }

    let oneLiner = await callDeepSeek(event || {}, config);
    if (!oneLiner) {
      oneLiner = normalizeOneLiner(mockOneLiner(style, story));
      return ok({ oneLiner, style, mocked: true, provider: "mock_fallback", model: config.model }, tid);
    }
    return ok({ oneLiner, style, mocked: false, provider: "deepseek", model: config.model }, tid);
  } catch (e) {
    return fail("LLM_FAILED", e && e.message ? e.message : "生成失败", tid);
  }
};
