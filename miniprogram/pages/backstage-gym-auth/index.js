const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

function pretty(value) {
  try {
    return JSON.stringify(value == null ? null : value, null, 2);
  } catch (e) {
    return String(value == null ? "" : value);
  }
}

function toText(list) {
  return Array.isArray(list) ? list.join("\n") : "";
}

function makeDraft(gym) {
  const item = gym || {};
  return {
    ownerOpenid: item.ownerOpenid || "",
    owner_uid: item.owner_uid || "",
    managers: toText(item.managers),
    managerOpenids: toText(item.managerOpenids),
    manager_uids: toText(item.manager_uids)
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    error: "",
    gymId: "",
    searched: false,
    found: false,
    gym: null,
    rawGymText: "",
    draft: makeDraft(null)
  },
  async onShow() {
    await ensureAdminPageAccess();
  },
  onGymIdInput(e) {
    this.setData({ gymId: e && e.detail ? e.detail.value : "" });
  },
  async onSearch() {
    const gymId = String(this.data.gymId || "").trim();
    if (!gymId) {
      wx.showToast({ title: "请先输入岩馆 ID", icon: "none" });
      return;
    }

    this.setData({ loading: true, error: "", searched: true });
    try {
      const res = await backstageApi.getGymPermission({ gymId });
      this.setData({
        found: !!(res && res.found),
        gym: (res && res.gym) || null,
        rawGymText: pretty(res && res.rawGym),
        error: "",
        draft: makeDraft(res && res.gym)
      });
    } catch (e) {
      const error = (e && e.message) || "查询失败";
      this.setData({
        error,
        found: false,
        gym: null,
        rawGymText: "",
        draft: makeDraft(null)
      });
      wx.showToast({ title: error, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onDraftInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : "";
    if (!key) return;
    this.setData({
      draft: {
        ...(this.data.draft || {}),
        [key]: e && e.detail ? e.detail.value : ""
      }
    });
  },
  async onSave() {
    const gym = this.data.gym;
    if (!gym || !gym._id) return;

    const draft = this.data.draft || {};
    this.setData({ saving: true });
    try {
      const res = await backstageApi.updateGymPermission({
        gymId: gym._id,
        ownerOpenid: draft.ownerOpenid || "",
        owner_uid: draft.owner_uid || "",
        managers: draft.managers || "",
        managerOpenids: draft.managerOpenids || "",
        manager_uids: draft.manager_uids || ""
      });
      const nextGym = (res && res.gym) || gym;
      this.setData({
        gym: nextGym,
        draft: makeDraft(nextGym),
        rawGymText: pretty(res && res.rawGym)
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  onCopyResult() {
    if (!this.data.rawGymText) {
      wx.showToast({ title: "暂无结果", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.rawGymText });
  }
});
