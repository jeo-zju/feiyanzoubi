const { callCloud } = require("../cloud");

async function login(userInfo) {
  return callCloud("auth_login", { userInfo: userInfo || null }, { loading: false });
}

module.exports = {
  login
};

