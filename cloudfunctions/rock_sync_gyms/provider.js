/**
 * 岩馆同步 - 地图来源采集模块
 *
 * 负责与腾讯位置服务 API 交互，不涉及数据库写入。
 */

const https = require("https");
const { safeText } = require("./normalize");

const TENCENT_CATEGORY_FILTER = "category=运动健身";
const REQUEST_INTERVAL_MS = 350;

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 12000,
        headers: {
          Accept: "application/json"
        }
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP_${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(raw || "{}"));
          } catch (e) {
            reject(new Error("MAP_RESPONSE_PARSE_FAILED"));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("MAP_REQUEST_TIMEOUT"));
    });
    req.on("error", reject);
  });
}

function buildTencentSearchUrl(params) {
  const query = new URLSearchParams();
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value == null || value === "") return;
    query.set(key, String(value));
  });
  return `https://apis.map.qq.com/ws/place/v1/search?${query.toString()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/**
 * 拉取腾讯地图搜索结果。
 * 429/短暂服务错误采用指数退避加抖动（最多 3 次），鉴权/配置错误直接抛出。
 */
async function fetchTencentSearch(apiKey, city, keyword, pageIndex, pageSize, attempt) {
  const url = buildTencentSearchUrl({
    key: apiKey,
    keyword,
    boundary: `region(${city},0)`,
    filter: TENCENT_CATEGORY_FILTER,
    page_size: pageSize,
    page_index: pageIndex,
    output: "json"
  });
  const maxAttempts = attempt ? 1 : 3;
  let lastErr = null;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await requestJson(url);
      if (!response || Number(response.status) !== 0) {
        const message = safeText(response && response.message) || "地图接口调用失败";
        const statusCode = safeText(response && response.status);
        const err = new Error(message);
        err.code = `MAP_${statusCode || "FAILED"}`;
        // 鉴权/配置错误直接抛
        if (statusCode === "311" || statusCode === "110" || statusCode === "111" || statusCode === "112") {
          throw err;
        }
        lastErr = err;
        continue;
      }
      return response;
    } catch (e) {
      const code = safeText(e && e.code);
      // 429 或网络错误退避重试
      if (i < maxAttempts - 1 && (code === "HTTP_429" || code === "MAP_REQUEST_TIMEOUT" || !code)) {
        const delay = REQUEST_INTERVAL_MS * Math.pow(2, i) + Math.floor(Math.random() * 100);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("MAP_REQUEST_FAILED");
}

module.exports = {
  REQUEST_INTERVAL_MS,
  TENCENT_CATEGORY_FILTER,
  requestJson,
  buildTencentSearchUrl,
  sleep,
  fetchTencentSearch
};
