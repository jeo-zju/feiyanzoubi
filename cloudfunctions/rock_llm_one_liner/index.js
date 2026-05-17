const cloud = require("wx-server-sdk");
const https = require("https");
const { URL } = require("url");

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

function resolveChatUrl(baseUrl) {
  const b = safeText(baseUrl).replace(/\/+$/, "");
  if (!b) return "";
  if (b.endsWith("/chat/completions")) return b;
  if (b.endsWith("/v1")) return `${b}/chat/completions`;
  if (b.includes("/v1/")) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

function requestJson(urlStr, payload, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = Buffer.from(JSON.stringify(payload || {}));
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search || ""}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
          ...(headers || {})
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch (e) {
            json = null;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, json, raw: body });
            return;
          }
          const msg =
            (json && (json.error && (json.error.message || json.error.msg))) ||
            (json && json.message) ||
            body ||
            `HTTP ${res.statusCode}`;
          const err = new Error(msg);
          err.status = res.statusCode;
          err.raw = body;
          reject(err);
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function normalizeOneLiner(s) {
  const t = safeText(s);
  if (!t) return "";
  const line = t.split(/\r?\n/).map((x) => safeText(x)).filter(Boolean)[0] || "";
  const cleaned = line.replace(/^["“”]+|["“”]+$/g, "").trim();
  if (cleaned.length <= 40) return cleaned;
  return cleaned.slice(0, 40);
}

function systemPrompt(style) {
  const base = [
    "你是攀岩名片文案生成器。",
    "你只输出 1 句中文，不换行，不加引号，不加解释。",
    "字数 18~30 字优先，必要时可更短。",
    "不要脏话，不要人身攻击，不要敏感内容。",
    "要像攀岩圈内人写的，允许黑话、比喻、隐晦的梗。"
  ];
  if (style === "encourage") {
    base.push("风格：鼓励向，像训练搭子一样稳住情绪，带一点俏皮，但整体更温暖。");
  } else {
    base.push("风格：幽默向，风趣+牙尖嘴利但不恶毒，更偏梗与隐晦反讽。");
  }
  return base.join("\n");
}

function userPrompt(input) {
  const story = safeText(input && input.story);
  const name = safeText(input && input.displayName);
  const title = safeText(input && input.title);
  const mbti = safeText(input && input.mbti);
  const gyms = Array.isArray(input && input.gyms) ? input.gyms : [];
  const gymText = gyms
    .map((g) => (g && typeof g === "object" ? safeText(g.name || g.gymName || g.title) : safeText(g)))
    .filter(Boolean)
    .slice(0, 3)
    .join("、");

  const parts = [];
  if (name) parts.push(`名字：${name}`);
  if (title) parts.push(`头衔：${title}`);
  if (mbti) parts.push(`MBTI：${mbti}`);
  if (gymText) parts.push(`常去岩馆：${gymText}`);
  parts.push(`背面故事：${story}`);
  parts.push("请生成名片正面的一句话介绍。");
  return parts.join("\n");
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const story = safeText(event && event.story);
    const style = safeText(event && event.style) === "encourage" ? "encourage" : "humor";
    if (!story) return fail("BAD_REQUEST", "缺少 story", tid);

    const baseUrl = safeText(process.env.LLM_BASE_URL);
    const apiKey = safeText(process.env.LLM_API_KEY);
    const model = safeText(process.env.LLM_MODEL);
    if (!baseUrl || !apiKey || !model) return fail("LLM_NOT_CONFIGURED", "未配置 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL", tid);

    const chatUrl = resolveChatUrl(baseUrl);
    if (!chatUrl) return fail("LLM_NOT_CONFIGURED", "LLM_BASE_URL 无效", tid);

    const payload = {
      model,
      temperature: style === "encourage" ? 0.7 : 0.9,
      max_tokens: 80,
      messages: [
        { role: "system", content: systemPrompt(style) },
        { role: "user", content: userPrompt(event || {}) }
      ]
    };

    const res = await requestJson(
      chatUrl,
      payload,
      {
        Authorization: `Bearer ${apiKey}`
      }
    );

    const content =
      (res && res.json && res.json.choices && res.json.choices[0] && res.json.choices[0].message && res.json.choices[0].message.content) ||
      (res && res.json && res.json.choices && res.json.choices[0] && res.json.choices[0].text) ||
      "";
    const oneLiner = normalizeOneLiner(content);
    if (!oneLiner) return fail("LLM_EMPTY", "生成为空", tid);
    return ok({ oneLiner, style }, tid);
  } catch (e) {
    return fail("LLM_FAILED", e && e.message ? e.message : "生成失败", tid);
  }
};

