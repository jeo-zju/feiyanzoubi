const friendshipApi = require("../../services/api/friendship");
const { ensureAppLogin } = require("../../utils/session");
const { safeText } = require("../../utils/format");
const { DEFAULT_AVATAR } = require("../../utils/constants");
const cache = require("../../utils/cache");

function skillBadgesFrom(u) {
  const s = (u && u.climbSkills) || {};
  const out = [];
  if (s.boulder) out.push(`抱石 ${s.boulder}`);
  if (s.lead) out.push(`先锋 ${s.lead}`);
  if (s.toprope) out.push(`顶绳 ${s.toprope}`);
  if (s.protector) out.push("保护员");
  if (!out.length && (u && u.city)) out.push(u.city);
  return out.slice(0, 3);
}
function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    listTab: "incoming",
    listTabs: [
      { key: "incoming", label: "待处理" },
      { key: "accepted", label: "我的岩友" },
      { key: "outgoing", label: "已发出" }
    ],
    loading: false,
    searchKeyword: "",
    searchMode: false,
    searching: false,
    searchResult: [],
    incoming: [],
    accepted: [],
    outgoing: []
  },

  onLoad(options) {
    const sub = safeText(options && options.sub);
    if (sub === "accepted" || sub === "incoming" || sub === "outgoing") {
      this.setData({ listTab: sub });
    }
  },

  async onShow() {
    try { await ensureAppLogin(); } catch (e) {}
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const r = await friendshipApi.list({ pageSize: 50 });
      const accepted = ((r && r.accepted) || []).map((u) => ({ ...u, skillBadges: skillBadgesFrom(u) }));
      const incoming = ((r && r.incoming) || []).map((u) => ({
        ...u,
        skillBadges: skillBadgesFrom(u),
        createdAtText: fmtTs(u.createdAt)
      }));
      const outgoing = ((r && r.outgoing) || []).map((u) => ({ ...u, skillBadges: skillBadgesFrom(u) }));
      this.setData({ incoming, accepted, outgoing });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onKeywordInput(e) {
    const v = (e && e.detail && e.detail.value) || "";
    this.setData({ searchKeyword: v });
  },

  onClearKw() {
    this.setData({ searchKeyword: "", searchMode: false, searchResult: [] });
  },

  async onSearch() {
    const kw = safeText(this.data.searchKeyword);
    if (!kw) {
      this.setData({ searchMode: false, searchResult: [] });
      return;
    }
    this.setData({ searchMode: true, searching: true });
    try {
      const r = await friendshipApi.search({ keyword: kw, limit: 20 });
      const me = (getApp() && getApp().globalData && (getApp().globalData.me || getApp().globalData.user)) || {};
      const meUid = me.openid || me._openid || "";
      const friends = new Set((this.data.accepted || []).map((x) => x.openid || x._openid).filter(Boolean));
      const outgoings = new Set((this.data.outgoing || []).map((x) => x.toOpenid || x.openid || x._openid).filter(Boolean));
      const incomings = new Set((this.data.incoming || []).map((x) => x.fromOpenid || x.openid || x._openid).filter(Boolean));
      // 云函数 search 返回 { users: [...] }（老版本曾用 { list: [...] }）；用户行标识字段为 openid（老版本曾用 _openid），此处兼容两者
      const rows = (r && (r.users || r.list)) || [];
      const res = rows
        .map((u) => {
          const uid = u.openid || u._openid || "";
          return {
            ...u,
            openid: uid,
            _openid: uid,
            skillBadges: skillBadgesFrom(u),
            isFriend: friends.has(uid),
            outgoing: outgoings.has(uid),
            incoming: incomings.has(uid)
          };
        })
        .filter((u) => u.openid && u.openid !== meUid);
      this.setData({ searchResult: res });
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "搜索失败", icon: "none" });
    } finally {
      this.setData({ searching: false });
    }
  },

  onTabChange(e) {
    const v = (e && e.detail && e.detail.value) || "accepted";
    this.setData({ listTab: v, searchMode: false, searchKeyword: "", searchResult: [] });
  },

  async onRequest(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    try {
      const r = await friendshipApi.request({ toOpenid: id });
      wx.showToast({ title: friendshipApi.mapRequestStatusToToast(r && r.status), icon: "none" });
      this.loadList();
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "发送失败", icon: "none" });
    }
  },

  async onAccept(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    try {
      await friendshipApi.accept({ fromOpenid: id });
      try { cache.invalidate(cache.CACHE_KEYS.FRIEND_COMBINED); } catch (_) {}
      wx.showToast({ title: "已成为岩友 🧗", icon: "success" });
      this.loadList();
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "操作失败", icon: "none" });
    }
  },

  async onReject(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    try {
      await friendshipApi.reject({ fromOpenid: id });
      try { cache.invalidate(cache.CACHE_KEYS.FRIEND_COMBINED); } catch (_) {}
      wx.showToast({ title: "已拒绝", icon: "none" });
      this.loadList();
    } catch (e) {
      wx.showToast({ title: e && e.message ? e.message : "操作失败", icon: "none" });
    }
  },

  async onRemove(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const self = this;
    wx.showModal({
      title: "删除这位岩友？",
      content: "删除后双方将从彼此的岩友列表中移除",
      confirmText: "删除",
      confirmColor: "#f28b94",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await friendshipApi.remove({ openid: id });
          try { cache.invalidate(cache.CACHE_KEYS.FRIEND_COMBINED); } catch (_) {}
          wx.showToast({ title: "已删除", icon: "none" });
          self.loadList();
        } catch (e) {
          wx.showToast({ title: e && e.message ? e.message : "删除失败", icon: "none" });
        }
      }
    });
  },

  onViewCard(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    wx.showToast({ title: "名片页即将上线", icon: "none" });
  }
});
