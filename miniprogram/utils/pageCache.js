const STORAGE_PREFIX = "page_cache_v1:";

const memoryCache = {};

function stableStringify(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${key}:${stableStringify(value[key])}`).join(",")}}`;
}

function toStorageKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

function buildCacheKey(scope, params) {
  const suffix = stableStringify(params || {});
  return suffix ? `${scope}:${suffix}` : scope;
}

function readCache(key, options) {
  const maxAge = Number(options && options.maxAge) || 0;
  const storageKey = toStorageKey(key);
  let payload = Object.prototype.hasOwnProperty.call(memoryCache, storageKey) ? memoryCache[storageKey] : null;
  if (!payload) {
    try {
      payload = wx.getStorageSync(storageKey) || null;
      if (payload) memoryCache[storageKey] = payload;
    } catch (e) {
      payload = null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  const updatedAt = Number(payload.updatedAt || 0);
  if (!updatedAt) return null;
  const age = Date.now() - updatedAt;
  if (maxAge > 0 && age > maxAge) return null;
  return {
    key,
    age,
    updatedAt,
    data: payload.data
  };
}

function writeCache(key, data) {
  const storageKey = toStorageKey(key);
  const payload = {
    updatedAt: Date.now(),
    data
  };
  memoryCache[storageKey] = payload;
  try {
    wx.setStorageSync(storageKey, payload);
  } catch (e) {}
  return payload;
}

function removeCache(key) {
  const storageKey = toStorageKey(key);
  delete memoryCache[storageKey];
  try {
    wx.removeStorageSync(storageKey);
  } catch (e) {}
}

module.exports = {
  buildCacheKey,
  readCache,
  writeCache,
  removeCache
};
