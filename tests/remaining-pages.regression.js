// Low cost static/VM regression checks for the remaining user pages.
// Run with: node tests/remaining-pages.regression.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
function loadPage(rel, stubs, wx) {
  let page;
  const filename = path.join(root, rel);
  const context = {
    console,
    Page: (definition) => { page = definition; },
    wx,
    getApp: () => ({ globalData: {} }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require: (request) => stubs[request] || require(path.resolve(path.dirname(filename), request))
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  assert.ok(page, `Page was not registered: ${rel}`);
  page.data = structuredClone(page.data || {});
  page.setData = function (next) {
    Object.entries(next || {}).forEach(([key, value]) => {
      const parts = key.split(".");
      let target = this.data;
      parts.slice(0, -1).forEach((part) => { target = target[part] || (target[part] = {}); });
      target[parts.at(-1)] = value;
    });
  };
  return page;
}

(async () => {
  const nav = [];
  const wx = {
    navigateTo: (args) => nav.push(args),
    showToast: () => {},
    setNavigationBarTitle: () => {},
    showModal: () => {},
    showActionSheet: () => {},
    setStorageSync: () => {},
    getStorageSync: () => ""
  };
  const activity = loadPage("miniprogram/pages/activity-records/index.js", {
    "../../services/api/calendar": {},
    "../../services/api/stats": {},
    "../../utils/session": { ensureAppLogin: async () => ({}) },
    "../../utils/cache": { CACHE_KEYS: { CALENDAR_SUMMARY: "calendar", STATS_30DAY: "stats" } }
  }, wx);
  activity.openMoreStats.call(activity);
  assert.equal(activity.data.moreStatsVisible, true);
  activity.closeMoreStats.call(activity);
  assert.equal(activity.data.moreStatsVisible, false);
  activity.goCheckin.call(activity);
  assert.equal(nav.at(-1).url, "/pages/checkin/index");
  assert.doesNotThrow(() => activity.noop.call(activity));

  const gym = loadPage("miniprogram/pages/gym-manage/index.js", {
    "../../services/api/gym": { get: async () => ({ gym: {}, cycles: [] }) },
    "../../services/api/gymOwner": { upsertGym: async () => ({ gymId: "g1" }), manageGym: async () => ({}) },
    "../../utils/session": { ensureAppLogin: async () => ({}), ensureAdminPageAccess: async () => ({}), isAdminUser: () => true },
    "../../utils/date": { today: () => "2026-09-10" },
    "../../utils/format": { safeText: (v) => String(v == null ? "" : v).trim() }
  }, wx);
  gym.data.form = { name: "旧馆", city: "上海", address: "", supportedModes: ["boulder", "difficulty"] };
  gym.onName.call(gym, { detail: { value: "新馆" } });
  assert.equal(gym.data.infoDirty, true);
  assert.equal(gym.data.form.name, "新馆");
  gym.onToggleMode.call(gym, { currentTarget: { dataset: { mode: "lead" } } });
  assert.equal(gym.data.form.supportedModes.includes("lead"), true);
  assert.equal(gym.data.modeOptions.find((x) => x.key === "lead").selected, true);
  gym.onTabChange.call(gym, { detail: { value: "cycle" } });
  assert.equal(gym.data.tab, "cycle");
  gym.data.cycleDirty = true;
  gym.data.cycles = [{ _id: "c1", name: "历史" }];
  gym.onSelectCycle.call(gym, { currentTarget: { dataset: { id: "c1" } } });
  assert.equal(gym.data.cycleEditing, null, "dirty cycle draft must not be replaced");
  gym.data.gymId = "g1";
  gym.data.infoDirty = true;
  gym.loadGym = async function () {};
  await gym.saveGym.call(gym);
  assert.equal(gym.data.infoDirty, false);
  console.log("remaining-pages regression OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
