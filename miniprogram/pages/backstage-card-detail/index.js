const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

function pretty(value) {
  try {
    return JSON.stringify(value == null ? null : value, null, 2);
  } catch (e) {
    return String(value == null ? "" : value);
  }
}

function makeDraft(card) {
  const item = card || {};
  return {
    ownerOpenid: item.ownerOpenid || "",
    status: item.status || "draft",
    isPrimary: !!item.isPrimary
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    error: "",
    query: "",
    searched: false,
    found: false,
    resultTitle: "",
    card: null,
    ownerUser: null,
    creatorUser: null,
    rawCardText: "",
    draft: makeDraft(null),
    statusTabs: [
      { key: "active", label: "active" },
      { key: "draft", label: "draft" }
    ]
  },
  async onShow() {
    await ensureAdminPageAccess();
  },
  onQueryInput(e) {
    this.setData({ query: e && e.detail ? e.detail.value : "" });
  },
  computeResultTitle(res) {
    const query = String(this.data.query || "").trim();
    const found = !!(res && res.found);
    const card = (res && res.card) || null;
    const front = card && card.front ? card.front : {};
    const display = String(front.displayName || "").trim();
    if (found && display) return display;
    if (query) return query;
    return "未知名片";
  },
  applyDetail(res) {
    const card = (res && res.card) || null;
    this.setData({
      found: !!(res && res.found),
      resultTitle: this.computeResultTitle(res),
      card,
      ownerUser: (res && res.ownerUser) || null,
      creatorUser: (res && res.creatorUser) || null,
      rawCardText: pretty(res && res.rawCard),
      draft: makeDraft(card),
      error: ""
    });
  },
  async onSearch() {
    const query = String(this.data.query || "").trim();
    if (!query) {
      wx.showToast({ title: "请输入名片 ID", icon: "none" });
      return;
    }
    this.setData({ loading: true, error: "", searched: true });
    try {
      const res = await backstageApi.getCardDetail({ cardId: query });
      this.applyDetail(res);
    } catch (e) {
      const error = (e && e.message) || "查询失败";
      this.setData({
        error,
        found: false,
        resultTitle: query || "未知名片",
        card: null,
        ownerUser: null,
        creatorUser: null,
        rawCardText: "",
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
  onStatusChange(e) {
    const status = e && e.detail ? e.detail.value : "draft";
    const currentDraft = this.data.draft || {};
    this.setData({
      draft: {
        ...currentDraft,
        status,
        isPrimary: status === "active" ? !!currentDraft.isPrimary : false
      }
    });
  },
  onTogglePrimary() {
    const currentDraft = this.data.draft || {};
    if (currentDraft.status !== "active" || !String(currentDraft.ownerOpenid || "").trim()) {
      wx.showToast({ title: "active 且有 owner 才能设主卡", icon: "none" });
      return;
    }
    this.setData({
      draft: {
        ...currentDraft,
        isPrimary: !currentDraft.isPrimary
      }
    });
  },
  async onSave() {
    const card = this.data.card;
    if (!card || !card._id) return;

    const draft = this.data.draft || {};
    this.setData({ saving: true });
    try {
      await backstageApi.updateCardDetail({
        cardId: card._id,
        ownerOpenid: draft.ownerOpenid || "",
        status: draft.status || "draft",
        isPrimary: !!draft.isPrimary
      });
      const res = await backstageApi.getCardDetail({ cardId: card._id }, { loading: false });
      this.applyDetail(res);
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  onCopyRaw() {
    if (!this.data.rawCardText) {
      wx.showToast({ title: "暂无数据", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.rawCardText });
  }
});
