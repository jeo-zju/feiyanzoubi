/*
 * 低成本页面 VM 回归：只覆盖页面状态合同，不连接微信或云端。
 * 运行：node tests/publish-settings.regression.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function loadPage(file, mocks) {
  let page;
  const wx = Object.assign({
    showToast() {},
    showModal() {},
    navigateBack() {},
    hideLoading() {}
  }, mocks.wx || {});
  const context = {
    console,
    wx,
    getApp: mocks.getApp || (() => ({ globalData: {} })),
    setTimeout: mocks.setTimeout || ((fn) => { fn(); return 1; }),
    clearTimeout() {},
    Page(config) { page = config; },
    Component() {}
  };
  const source = fs.readFileSync(file, "utf8");
  const sandbox = vm.createContext(context);
  const localRequire = (request) => {
    if (mocks.require && Object.prototype.hasOwnProperty.call(mocks.require, request)) {
      return mocks.require[request];
    }
    throw new Error(`unexpected require in ${file}: ${request}`);
  };
  sandbox.require = localRequire;
  vm.runInContext(`(function(require){${source}\n})(require);`, sandbox, { filename: file });
  assert(page, `Page was not registered for ${file}`);
  page.data = clone(page.data);
  page.setData = function setData(patch, callback) {
    Object.keys(patch || {}).forEach((key) => {
      const parts = key.split(".");
      let target = page.data;
      for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
      target[parts[parts.length - 1]] = patch[key];
    });
    if (callback) callback();
  };
  return page;
}

async function main() {
  const publishCalls = [];
  // 时段模型函数用真实实现，仅固定时间相关的三个函数
  const realPlan = require("../miniprogram/utils/plan");
  const publish = loadPage(path.join(root, "miniprogram/pages/calendar-publish/index.js"), {
    require: {
      "../../services/api/calendar": { publish: async (payload) => { publishCalls.push(payload); return { planId: "p1" }; } },
      "../../services/api/gym": {},
      "../../utils/session": { ensureAppLogin: async () => ({}), syncAppLogin: async () => {} },
      "../../utils/format": { safeText: (v) => String(v == null ? "" : v) },
      "../../utils/cache": { CACHE_KEYS: {}, invalidate() {} },
      "../../utils/plan": Object.assign({}, realPlan, { suggestedTime: () => ({ date: "2099-01-01", startTime: "10:00", endTime: "12:00" }), validateSlot: () => ({ ok: true }), sanitizePrefill: () => ({ date: "2099-01-01", startTime: "10:00", endTime: "12:00" }) }),
      "../../services/cloud": { callCloud: async () => ({}) }
    }
  });

  publish.data.title = "原标题";
  publish.data.note = "说明保留";
  publish.data.meetingPoint = "前台";
  publish.data.contact = "wx_old";
  publish.data.visibility = "friends";
  publish.data.joinMode = "approval";
  publish.openSettings();
  publish.data.dTitle = "新标题";
  publish.data.dAtmosphereTags = ["休闲爬"];
  publish.data.dProtector = true;
  publish.data.dVisibility = "circle";
  publish.data.dJoinMode = "direct";
  publish.applySettings();
  assert.strictEqual(publish.data.settingsSummary, "仅岩友圈可见 · 直接加入");
  assert.strictEqual(publish.data.settingsExtra, "已设标题 · 氛围 休闲爬 · 需要保护员");
  assert.strictEqual(publish.data.title, "新标题");
  assert.strictEqual(publish.data.note, "说明保留");
  assert.strictEqual(publish.data.meetingPoint, "前台");
  assert.strictEqual(publish.data.contact, "wx_old");

  publish.openSettings();
  publish.data.dTitle = "取消后的草稿";
  publish.data.dVisibility = "public";
  publish.data.dJoinMode = "approval";
  publish.closeSettings();
  assert.strictEqual(publish.data.title, "新标题");
  assert.strictEqual(publish.data.visibility, "circle");
  assert.strictEqual(publish.data.joinMode, "direct");

  publish.data.formError = true;
  publish.data.selectedGymId = "g1";
  publish.data.selectedDate = "2099-01-01";
  publish.onPublish();
  assert.strictEqual(publishCalls.length, 0, "formError must prevent publishing");

  let savedProfile;
  const profile = loadPage(path.join(root, "miniprogram/pages/profile-edit/index.js"), {
    require: {
      "../../utils/format": { safeText: (v) => String(v == null ? "" : v) },
      "../../services/api/user": { updateProfile: async (payload) => { savedProfile = payload; return { me: payload }; } },
      "../../services/api/card": { listMy: async () => ({}), upsert: async () => ({}) },
      "../../utils/cache": { CACHE_KEYS: {}, invalidate() {} },
      "../../services/db": { collection: () => ({ where: () => ({ count: async () => ({ total: 0 }) }), add: async () => ({}) }) },
      "../../utils/session": { ensureAppLogin: async () => ({ nickName: "岩友" }), syncAppLogin: async () => {} }
    }
  });
  profile.data.form.nickName = "岩友";
  profile.data.form.avatarUrl = "https://example.com/avatar.png";
  profile.data.displayName = "名片名";
  profile.data.title = "长臂猿";
  profile.data.mbti = "INFJ";
  profile.data.slogan = "一起向上";
  profile.data.wechatId = "wx_keep";
  profile.data.showWechat = true;
  profile.data.xhsId = "xhs_keep";
  profile.data.showXhs = false;
  profile.data.city = "杭州";
  profile.data.heightCm = "178";
  profile.data.armspanCm = "180";
  profile.data.climbSkills = { boulder: "V2", toprope: "5.9", lead: "" };
  await profile.onSave();
  assert.strictEqual(savedProfile.wechatId, "wx_keep");
  assert.strictEqual(savedProfile.showWechat, true);
  assert.strictEqual(savedProfile.xhsId, "xhs_keep");
  assert.strictEqual(savedProfile.showXhs, false);
  assert.strictEqual(savedProfile.title, "长臂猿");
  assert.strictEqual(savedProfile.heightCm, "178");
  assert.strictEqual(savedProfile.armspanCm, "180");

  const mine = loadPage(path.join(root, "miniprogram/pages/calendar-mine/index.js"), {
    require: {
      "../../services/cloud": {},
      "../../utils/session": { ensureAppLogin: async () => ({}) },
      "../../utils/plan": { decorate: (p) => p }
    }
  });
  const status = (input, tab, key, text) => {
    const actual = mine.resolveStatus(input, tab);
    assert.strictEqual(actual.statusKey, key);
    assert.strictEqual(actual.statusText, text);
  };
  status({ status: "cancelled" }, "past", "cancelled", "已取消");
  status({ myStatus: "pending" }, "upcoming", "pending", "等待确认");
  status({ myStatus: "host" }, "upcoming", "host", "我发起的");
  status({ myStatus: "confirmed" }, "past", "ended", "已结束");
  const mineWxml = fs.readFileSync(path.join(root, "miniprogram/pages/calendar-mine/index.wxml"), "utf8");
  ["已取消", "等待确认", "我发起的", "已结束", "已确认参加"].forEach((label) => {
    assert(mineWxml.includes(label) || mineWxml.includes("{{item.statusText}}"), `mine WXML keeps ${label} status path`);
  });
  console.log("publish settings VM regression: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
