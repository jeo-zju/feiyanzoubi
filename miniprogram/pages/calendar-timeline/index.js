const calendarApi = require("../../services/api/calendar");
const gymApi = require("../../services/api/gym");
const friendshipApi = require("../../services/api/friendship");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");

const WEEK_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const COLOR_COUNT = 8;

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function parseYMD(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function weekdayOf(ymd) {
  const d = parseYMD(ymd);
  return d ? d.getDay() : 0;
}
function hmToMinutes(hm) {
  const m = String(hm || "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

const START_HOUR = 10;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const PX_PER_HOUR = 120; // rpx，每个 tick 高度 = PX_PER_HOUR，和 WXSS 的 120rpx 保持一致

function colorForUser(uid, idx) {
  let h = idx != null ? idx : 0;
  if (uid) {
    for (let i = 0; i < uid.length; i++) h = (h * 131 + uid.charCodeAt(i)) >>> 0;
  }
  return h % COLOR_COUNT;
}

Page({
  data: {
    date: "",
    dateLabel: "",
    weekLabel: "",
    city: "",
    gymId: "",
    gymLabel: "全部岩馆",
    visibility: "public",
    visibilityLabel: "公开日历",
    publicityPillLabel: "公开日历 ✓",
    userCount: 0,
    userList: [],
    plans: [],
    selectedPlan: null,
    defaultAvatar: DEFAULT_AVATAR,
    hourTicks: [],
    tlWidth: 0,
    colsWidth: 0,
    colWidth: 200,
    friendIds: []
  },

  onLoad(options) {
    const date = safeText(options && options.date) || (() => {
      const d = new Date(Date.now() + 8 * 3600 * 1000);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    })();
    const city = decodeURIComponent(safeText(options && options.city));
    const gymId = safeText(options && options.gymId);
    const visibility = safeText(options && options.visibility) || "public";
    const d = parseYMD(date);
    const dateLabel = d ? `${d.getMonth() + 1}月${d.getDate()}日` : date;
    const weekLabel = WEEK_NAMES[weekdayOf(date)] || "";
    const hourTicks = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      hourTicks.push({ h, label: `${pad2(h)}:00` });
    }
    wx.setNavigationBarTitle({ title: `${dateLabel} · ${weekLabel}` });
    this.setData({
      date,
      dateLabel,
      weekLabel,
      city,
      gymId,
      gymLabel: gymId ? "选中岩馆" : "全部岩馆",
      visibility,
      visibilityLabel: visibility === "friends" ? "我的岩友" : "公开日历",
      publicityPillLabel: visibility === "friends" ? "我的岩友 ✓" : "公开日历 ✓",
      hourTicks,
      tlWidth: 90 + 6 * 200
    });
  },

  async onShow() {
    try { await ensureAppLogin(); } catch (e) {}
    if (this.data.gymId) {
      try {
        const g = await gymApi.get({ gymId: this.data.gymId });
        const name = g && g.gym && (g.gym.name || g.gym.gymName) ? g.gym.name || g.gym.gymName : "选中岩馆";
        this.setData({ gymLabel: name });
      } catch (e) {}
    }
    this.loadFriends();
    this.loadTimeline();
  },

  async loadFriends() {
    try {
      const r = await friendshipApi.list({ pageSize: 100 });
      const ids = new Set();
      ((r && r.accepted) || []).forEach((x) => { if (x.openid) ids.add(x.openid); });
      ((r && r.legacyFollow) || []).forEach((x) => { if (x.openid) ids.add(x.openid); });
      this.setData({ friendIds: Array.from(ids) });
    } catch (e) {}
  },

  async loadTimeline() {
    try {
      const params = {
        date: this.data.date,
        city: this.data.city,
        visibility: this.data.visibility
      };
      if (this.data.gymId) params.filterGymId = this.data.gymId;
      const res = await calendarApi.queryTimeline(params);
      const rawPlans = (res && res.plans) || [];
      const userList = (res && res.userList) || [];
      const friendSet = new Set(this.data.friendIds || []);
      const app = getApp();
      const myUid = (app && app.globalData && app.globalData.openid) || "";
      const userColMap = {};
      userList.forEach((u, i) => { userColMap[u._openid] = i; });

      const uidColors = {};
      userList.forEach((u) => { uidColors[u._openid] = colorForUser(u._openid, userColMap[u._openid]); });

      const colBars = {};
      userList.forEach((u) => { colBars[u._openid] = []; });

      const visiblePlans = [];
      rawPlans.forEach((p) => {
        const uid = p._openid || p.uid || "";
        const gymName = (p.gymSnapshot && p.gymSnapshot.name) || p.outdoorName || "";
        const startMin = hmToMinutes(p.startTime);
        const endMin = hmToMinutes(p.endTime);
        const startOffset = Math.max(0, startMin - START_HOUR * 60);
        const clampedEnd = Math.min(END_HOUR * 60, endMin);
        const topPx = Math.round((startOffset / 60) * PX_PER_HOUR);
        const hMin = Math.max(30, clampedEnd - (START_HOUR * 60 + startOffset));
        const hPx = Math.max(80, Math.round((hMin / 60) * PX_PER_HOUR));
        const rangeText = `${p.startTime}-${p.endTime}`;
        const colorIdx = uidColors[uid] != null ? uidColors[uid] : colorForUser(uid, null);
        const snap = p.userSnapshot || {};
        const plan = {
          id: p._id || `${uid}_${p.date}_${p.startTime}_${p.endTime}`,
          rawPlanId: String(p._id || ""),
          uid,
          date: p.date,
          displayName: snap.displayName || snap.nickName || "",
          nickName: snap.nickName || "",
          avatarUrl: snap.avatarUrl || "",
          rangeText,
          gymName,
          outdoorName: p.outdoorName || "",
          note: p.note || "",
          needPartner: !!p.needPartner,
          skillTags: p.skillTags || [],
          skillText: (p.skillTags || []).join("、"),
          topPx,
          hPx,
          colorIdx,
          isFriend: friendSet.has(uid) || (p.visibility === "friends"),
          isMe: uid === myUid,
          joinedCount: Number(p.joinedCount || 1),
          meJoined: !!p.meJoined
        };
        visiblePlans.push(plan);
        if (userColMap[uid] == null) {
          userColMap[uid] = Object.keys(userColMap).length;
          colBars[uid] = [];
          const newUser = {
            _openid: uid,
            nickName: plan.nickName,
            avatarUrl: plan.avatarUrl,
            displayName: plan.displayName,
            title: ""
          };
          userList.push(newUser);
        }
        colBars[uid].push({
          id: plan.id,
          topPx: plan.topPx,
          hPx: plan.hPx,
          rangeText: plan.rangeText,
          gymName: plan.gymName || plan.outdoorName,
          colorIdx: plan.colorIdx,
          rawPlanId: p._id
        });
      });

      const colList = Object.keys(colBars).map((uid) => {
        const i = userColMap[uid];
        const bars = (colBars[uid] || []).sort((a, b) => a.topPx - b.topPx);
        return { uid, colIdx: i, bars };
      }).sort((a, b) => a.colIdx - b.colIdx);

      const colCount = Math.max(5, colList.length);
      const colWidth = 200;
      const colsWidth = colCount * colWidth;
      const tlWidth = 92 + colsWidth;

      this.setData({
        plans: visiblePlans,
        planMap: visiblePlans.reduce((m, p) => { m[p.id] = p; return m; }, {}),
        userList,
        userCount: userList.length,
        colList,
        colWidth,
        colsWidth,
        tlWidth
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  onTapGymFilter() {
    wx.showActionSheet({
      itemList: ["全部岩馆", "重新选择岩馆"],
      success: (r) => {
        if (r.tapIndex === 0) {
          this.setData({ gymId: "", gymLabel: "全部岩馆" }, () => this.loadTimeline());
        } else {
          wx.navigateTo({ url: "/pages/home/index" });
        }
      }
    });
  },

  onToggleVisibility() {
    const next = this.data.visibility === "public" ? "friends" : "public";
    this.setData({
      visibility: next,
      visibilityLabel: next === "friends" ? "我的岩友" : "公开日历",
      publicityPillLabel: next === "friends" ? "我的岩友 ✓" : "公开日历 ✓"
    }, () => this.loadTimeline());
  },

  onTapAvatar(e) {
    const uid = e.currentTarget.dataset.uid;
    if (!uid) return;
    const plan = (this.data.plans || []).find((p) => p.uid === uid);
    if (plan) this.setData({ selectedPlan: plan });
  },

  onTapBar(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const rid = ds.rawplanid;
    const uid = ds.uid;
    const map = this.data.planMap || {};
    let found = null;
    if (rid) {
      found = Object.values(map).find((p) => p.id === rid);
    }
    if (!found && uid) {
      found = Object.values(map).find((p) => p.uid === uid);
    }
    if (found) this.setData({ selectedPlan: found });
  },

  onTapPublish() {
    const params = [`date=${this.data.date}`];
    if (safeText(this.data.city)) params.push(`city=${encodeURIComponent(safeText(this.data.city))}`);
    if (this.data.gymId) params.push(`gymId=${this.data.gymId}`);
    wx.navigateTo({ url: `/pages/calendar-publish/index?${params.join("&")}` });
  },

  onClosePlan() {
    this.setData({ selectedPlan: null, joinList: [], joinOwner: null });
  },

  async loadSelectedPlanJoiners(planId) {
    if (!planId) return;
    try {
      const r = await calendarApi.getJoiners(planId);
      const ownerInfo = (r && r.ownerInfo) || null;
      const joiners = (r && r.joiners) || [];
      const joined = !!(r && r.joined);
      const isOwner = !!(r && r.isOwner);
      this.setData({ joinOwner: ownerInfo, joinList: joiners, joinCount: Number(r && r.joinedCount ? r.joinedCount : (ownerInfo ? 1 : 0) + joiners.length), selectedPlanJoined: joined });
    } catch (e) {
      this.setData({ joinList: [], joinOwner: null });
    }
  },

  noop() {},

  async onTapBar(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const rid = ds.rawplanid;
    const uid = ds.uid;
    const map = this.data.planMap || {};
    let found = null;
    if (rid) {
      found = Object.values(map).find((p) => p.id === rid || p.rawPlanId === rid);
    }
    if (!found && uid) {
      found = Object.values(map).find((p) => p.uid === uid);
    }
    if (found) {
      this.setData({ selectedPlan: found, joinList: [], joinOwner: null });
      if (found.rawPlanId) this.loadSelectedPlanJoiners(found.rawPlanId);
    }
  },

  async onTapAddFriend() {
    const p = this.data.selectedPlan;
    if (!p || !p.uid) return;
    try {
      const r = await friendshipApi.request({ toOpenid: p.uid });
      const status = (r && r.status) || "ok";
      wx.showToast({ title: friendshipApi.mapRequestStatusToToast(status), icon: "none" });
      this.loadFriends();
      this.setData({ selectedPlan: null });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "操作失败", icon: "none" });
    }
  },

  async onTapCancelMine() {
    const p = this.data.selectedPlan;
    if (!p || !p.id) return;
    const self = this;
    wx.showModal({
      title: "取消这次计划？",
      content: "取消后岩友们在时间轴上就看不到了",
      confirmText: "取消计划",
      confirmColor: "#f28b94",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await calendarApi.publish({ action: "cancel", planId: p.rawPlanId || (p.id.startsWith("plan_") ? "" : p.id) });
          wx.showToast({ title: "已取消", icon: "success" });
          self.setData({ selectedPlan: null });
          self.loadTimeline();
        } catch (e) {
          wx.showToast({ title: e && e.message ? e.message : "取消失败", icon: "none" });
        }
      }
    });
  },

  async onTapJoin() {
    const p = this.data.selectedPlan;
    if (!p || !p.rawPlanId) return;
    const already = this.data.selectedPlanJoined || p.meJoined;
    try {
      if (already) await calendarApi.unjoinPlan(p.rawPlanId); else await calendarApi.joinPlan(p.rawPlanId);
      wx.showToast({ title: already ? "已取消报名" : "报名成功", icon: "success" });
      this.loadSelectedPlanJoiners(p.rawPlanId);
      this.loadTimeline();
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "操作失败", icon: "none" });
    }
  },

  async onTapRemoveJoiner(e) {
    const p = this.data.selectedPlan;
    if (!p || !p.rawPlanId) return;
    const target = safeText(e && e.currentTarget && e.currentTarget.dataset.uid);
    if (!target) return;
    const self = this;
    wx.showModal({
      title: "移除这名报名者？",
      confirmText: "移除",
      confirmColor: "#f28b94",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await calendarApi.removeJoiner(p.rawPlanId, target);
          wx.showToast({ title: "已移除", icon: "success" });
          self.loadSelectedPlanJoiners(p.rawPlanId);
          self.loadTimeline();
        } catch (e) {
          wx.showToast({ title: e && e.message ? e.message : "移除失败", icon: "none" });
        }
      }
    });
  }
});
