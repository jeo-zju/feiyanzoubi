const { login } = require("../services/api/user");
const cache = require("./cache");

function storeAppUser(user) {
  const app = getApp();
  if (app && app.globalData) app.globalData.user = user || null;
  return user || null;
}

async function syncAppLogin(userInfo) {
  const res = await login(userInfo || null);
  const user = res && res.user ? res.user : res;
  const app = getApp();
  const newOpenid = user && user.openid ? String(user.openid) : "";
  try {
    const lastOpenid = (app && app.globalData && app.globalData._cache && app.globalData._cache.lastOpenid)
      ? String(app.globalData._cache.lastOpenid) : "";
    if (newOpenid && lastOpenid && newOpenid !== lastOpenid) {
      try {
        if (app && typeof app.cacheClearAll === "function") app.cacheClearAll();
        else cache.clearAll();
      } catch (_) {}
    }
    if (app && app.globalData) {
      if (!app.globalData._cache) app.globalData._cache = { map: new Map(), lastOpenid: "" };
      app.globalData._cache.lastOpenid = newOpenid;
    }
  } catch (_) {}
  return storeAppUser(user);
}

async function ensureAppLogin() {
  const app = getApp();
  const currentUser = app && app.globalData ? app.globalData.user : null;
  if (currentUser && currentUser.openid) return currentUser;
  return syncAppLogin(null);
}

function isAdminUser(user) {
  return String((user && user.role) || "").trim().toLowerCase() === "admin";
}

function leaveRestrictedPage() {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  if (Array.isArray(pages) && pages.length > 1) {
    wx.navigateBack({ delta: 1 });
    return;
  }
  wx.switchTab({ url: "/pages/me/index" });
}

async function ensureAdminPageAccess() {
  try {
    const user = await ensureAppLogin();
    if (isAdminUser(user)) return user;
    wx.showToast({ title: "仅管理员可进入", icon: "none" });
  } catch (e) {
    wx.showToast({ title: "登录失效", icon: "none" });
  }
  leaveRestrictedPage();
  return null;
}

module.exports = {
  ensureAppLogin,
  syncAppLogin,
  storeAppUser,
  isAdminUser,
  ensureAdminPageAccess
};
