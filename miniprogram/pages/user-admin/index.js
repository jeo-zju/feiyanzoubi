const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

function normalizeRole(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase();
}

function roleText(value) {
  const role = normalizeRole(value);
  return role || "普通用户";
}

function decorateUser(item) {
  const role = normalizeRole(item && item.role);
  return {
    ...(item || {}),
    role,
    roleText: roleText(role),
    roleDraft: role
  };
}

Page({
  data: {
    items: [],
    page: 1,
    pageSize: 20,
    hasNext: false,
    loading: false,
    savingId: "",
    keyword: "",
    role: "all",
    total: 0,
    filteredTotal: 0,
    roleTabs: [
      { key: "all", label: "全部" },
      { key: "admin", label: "admin" },
      { key: "owner", label: "owner" },
      { key: "empty", label: "普通" }
    ],
    presetRoles: [
      { key: "", label: "普通用户" },
      { key: "owner", label: "owner" },
      { key: "admin", label: "admin" }
    ]
  },
  async onShow() {
    const user = await ensureAdminPageAccess();
    if (!user) return;
    this.loadList({ reset: true });
  },
  onRoleChange(e) {
    const role = e && e.detail ? e.detail.value : "all";
    this.setData({ role }, () => this.loadList({ reset: true }));
  },
  onKeywordInput(e) {
    this.setData({ keyword: e && e.detail ? e.detail.value : "" });
  },
  onSearch() {
    this.loadList({ reset: true });
  },
  async loadList({ reset } = {}) {
    if (this.data.loading) return;
    const page = reset ? 1 : Number(this.data.page || 1);
    this.setData({ loading: true });
    try {
      const res = await backstageApi.listUsers({
        page,
        pageSize: this.data.pageSize,
        keyword: this.data.keyword,
        role: this.data.role
      });
      const rows = Array.isArray(res && res.items) ? res.items.map(decorateUser) : [];
      this.setData({
        items: reset ? rows : (this.data.items || []).concat(rows),
        page: Number(res && res.page) || page,
        hasNext: !!(res && res.hasNext),
        total: Number((res && res.total) || 0),
        filteredTotal: Number((res && res.filteredTotal) || 0)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onMore() {
    if (!this.data.hasNext || this.data.loading) return;
    this.setData({ page: Number(this.data.page || 1) + 1 }, () => this.loadList({ reset: false }));
  },
  updateDraft(id, updater) {
    const items = (this.data.items || []).map((item) => {
      if (String(item._id) !== String(id)) return item;
      return {
        ...item,
        ...updater(item)
      };
    });
    this.setData({ items });
  },
  onDraftRoleInput(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const roleDraft = normalizeRole(e && e.detail ? e.detail.value : "");
    if (!id) return;
    this.updateDraft(id, () => ({ roleDraft }));
  },
  onPickRole(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = dataset.id || "";
    const roleDraft = normalizeRole(dataset.role);
    if (!id) return;
    this.updateDraft(id, () => ({ roleDraft }));
  },
  async onSaveRole(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const current = (this.data.items || []).find((item) => String(item._id) === String(id));
    if (!current || !id) return;
    const nextRole = normalizeRole(current.roleDraft);
    if (nextRole === normalizeRole(current.role)) {
      wx.showToast({ title: "角色未变化", icon: "none" });
      return;
    }

    this.setData({ savingId: id });
    try {
      const res = await backstageApi.updateUserRole({ userId: id, role: nextRole });
      const user = decorateUser((res && res.user) || { ...current, role: nextRole });
      const items = (this.data.items || []).map((item) => (String(item._id) === String(id) ? { ...item, ...user } : item));
      this.setData({ items });

      const app = getApp();
      const appUser = app && app.globalData ? app.globalData.user : null;
      if (appUser && current.openid && String(appUser.openid) === String(current.openid)) {
        app.globalData.user = {
          ...appUser,
          role: user.role
        };
      }

      wx.showToast({ title: "角色已更新", icon: "success" });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || "保存失败", icon: "none" });
    } finally {
      this.setData({ savingId: "" });
    }
  }
});
