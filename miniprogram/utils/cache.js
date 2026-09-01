const VERSION_PREFIX = "_cache_v2_";

const CACHE_KEYS = {
  ME_PROFILE: `${VERSION_PREFIX}me_profile`,
  GYM_LIST_PREFIX: `${VERSION_PREFIX}gym_list_`,
  MY_CIRCLES: `${VERSION_PREFIX}my_circles`,
  CARD_SUMMARY: `${VERSION_PREFIX}card_summary`,
  CALENDAR_SUMMARY: `${VERSION_PREFIX}calendar_summary`,
  FRIEND_COMBINED: `${VERSION_PREFIX}friend_combined`,
  STATS_30DAY: `${VERSION_PREFIX}stats_30day`,
  ME_CARD_FINGERPRINT: `${VERSION_PREFIX}me_card_fingerprint`,
  ME_CARD_IMG_PATH: `${VERSION_PREFIX}me_card_img_path`,
  LAST_OPENID: `${VERSION_PREFIX}last_openid_`,
  LAST_GYM_ID: "last_gym_id_v1"
};

function getL1Store() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      if (!app.globalData._cache || !app.globalData._cache.map) {
        app.globalData._cache = { map: new Map(), lastOpenid: "" };
      }
      return app.globalData._cache.map;
    }
  } catch (_) {}
  return new Map();
}

function safeParseJSON(str) {
  try {
    if (str == null || str === "") return null;
    const obj = JSON.parse(str);
    return obj && typeof obj === "object" ? obj : null;
  } catch (_) {
    return null;
  }
}

function safeGetStorage(key) {
  try {
    const v = wx.getStorageSync(key);
    return v || null;
  } catch (_) {
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

function safeRemoveStorage(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (_) {
    return false;
  }
}

function readEntryFromL2(key) {
  const raw = safeGetStorage(key);
  if (!raw) return null;
  const entry = safeParseJSON(typeof raw === "string" ? raw : JSON.stringify(raw));
  if (!entry || entry.v !== 1 || typeof entry.e !== "number") return null;
  return entry;
}

function writeEntryToL2(key, value, expireAt) {
  const entry = { v: 1, d: value, e: expireAt };
  return safeSetStorage(key, entry);
}

async function cacheGet(key, options) {
  const opts = options && typeof options === "object" ? options : {};
  const ttlMin = Number(opts.ttlMin || 0);
  const loader = typeof opts.loader === "function" ? opts.loader : null;
  const forceRefresh = !!opts.forceRefresh;
  const useL2 = opts.useL2 !== false;
  const now = Date.now();

  try {
    if (!forceRefresh) {
      const l1 = getL1Store();
      const l1Entry = l1.get(key);
      if (l1Entry && l1Entry.v === 1 && typeof l1Entry.e === "number" && l1Entry.e > now) {
        return l1Entry.d;
      }
      if (useL2) {
        const l2Entry = readEntryFromL2(key);
        if (l2Entry && l2Entry.e > now) {
          try { l1.set(key, l2Entry); } catch (_) {}
          return l2Entry.d;
        }
      }
    }

    if (!loader) return undefined;
    const freshValue = await loader();
    if (freshValue === undefined) return undefined;
    const expireAt = ttlMin > 0 ? now + Math.floor(ttlMin * 60 * 1000) : now + 60 * 1000;
    try {
      const l1 = getL1Store();
      l1.set(key, { v: 1, d: freshValue, e: expireAt });
    } catch (_) {}
    if (useL2 && ttlMin > 0) {
      writeEntryToL2(key, freshValue, expireAt);
    }
    return freshValue;
  } catch (e) {
    try { console.warn("[cache] get fallback, key=", key, "err=", e && e.message); } catch (_) {}
    if (typeof loader === "function") {
      try { return await loader(); } catch (_) { throw e; }
    }
    throw e;
  }
}

function cacheSet(key, value, ttlMin, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const saveL2 = opts.saveL2 !== false;
    const ttl = Number(ttlMin || 0) > 0 ? Number(ttlMin) : 1;
    const expireAt = Date.now() + Math.floor(ttl * 60 * 1000);
    const entry = { v: 1, d: value, e: expireAt };
    try {
      const l1 = getL1Store();
      l1.set(key, entry);
    } catch (_) {}
    if (saveL2) {
      writeEntryToL2(key, value, expireAt);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function cacheInvalidate(prefixOrKey) {
  try {
    if (!prefixOrKey) return false;
    const target = String(prefixOrKey);
    const l1 = getL1Store();
    const keysToRemoveL1 = [];
    l1.forEach((_, k) => {
      if (k === target || k.indexOf(target) === 0) keysToRemoveL1.push(k);
    });
    keysToRemoveL1.forEach((k) => l1.delete(k));
    try {
      const info = wx.getStorageInfoSync && wx.getStorageInfoSync();
      const allKeys = (info && Array.isArray(info.keys)) ? info.keys : [];
      allKeys.forEach((k) => {
        if (typeof k === "string" && (k === target || k.indexOf(target) === 0)) {
          safeRemoveStorage(k);
        }
      });
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

function cacheClearAll() {
  try {
    try {
      const l1 = getL1Store();
      l1.clear();
    } catch (_) {}
    const info = (() => {
      try { return wx.getStorageInfoSync && wx.getStorageInfoSync(); } catch (_) { return null; }
    })();
    const allKeys = (info && Array.isArray(info.keys)) ? info.keys : [];
    allKeys.forEach((k) => {
      if (typeof k === "string" && k.indexOf(VERSION_PREFIX) === 0) {
        if (k === CACHE_KEYS.LAST_GYM_ID) return;
        safeRemoveStorage(k);
      }
    });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  CACHE_KEYS,
  VERSION_PREFIX,
  get: cacheGet,
  set: cacheSet,
  invalidate: cacheInvalidate,
  clearAll: cacheClearAll
};
