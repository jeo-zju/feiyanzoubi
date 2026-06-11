const { login } = require("../services/api/auth");

function storeAppUser(user) {
  const app = getApp();
  if (app && app.globalData) app.globalData.user = user || null;
  return user || null;
}

async function syncAppLogin(userInfo) {
  const res = await login(userInfo || null);
  const user = res && res.user ? res.user : res;
  return storeAppUser(user);
}

async function ensureAppLogin() {
  const app = getApp();
  const currentUser = app && app.globalData ? app.globalData.user : null;
  if (currentUser && currentUser.openid) return currentUser;
  return syncAppLogin(null);
}

module.exports = {
  ensureAppLogin,
  syncAppLogin,
  storeAppUser
};
