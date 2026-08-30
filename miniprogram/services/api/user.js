const { callCloud } = require("../cloud");

async function login(payload) {
  return callCloud("user_manage", { action: "login", userInfo: payload || null }, { loading: false });
}

async function updateProfile(payload) {
  return callCloud("user_manage", { action: "update", payload: payload || {} }, { loading: true });
}

async function getMe() {
  return callCloud("user_manage", { action: "me" }, { loading: false });
}

module.exports = { login, updateProfile, getMe };
