const backstageApi = require("../../services/api/backstage");
const { ensureAdminPageAccess } = require("../../utils/session");

const DEFAULT_COLLECTIONS = [
  "RockUsers",
  "RockGyms",
  "RockGymCycles",
  "RockGymSourceRecords",
  "RockGymSyncRuns",
  "RockGymReviewQueue",
  "RockCheckinRecords",
  "RockUserDailyProgress",
  "RockUserCycleProgress",
  "RockComments",
  "RockFriendships",
  "RockBlackTalkDictionary"
];

function pretty(value) {
  try {
    return JSON.stringify(value == null ? null : value, null, 2);
  } catch (e) {
    return String(value == null ? "" : value);
  }
}

Page({
  data: {
    loading: false,
    error: "",
    docId: "",
    collectionIndex: 0,
    collections: DEFAULT_COLLECTIONS,
    resultText: "",
    resultCollection: "",
    resultId: "",
    found: false,
    searched: false
  },
  async onShow() {
    await ensureAdminPageAccess();
  },
  onDocIdInput(e) {
    this.setData({ docId: e && e.detail ? e.detail.value : "" });
  },
  onCollectionChange(e) {
    const collectionIndex = Number(e && e.detail ? e.detail.value : 0) || 0;
    this.setData({ collectionIndex });
  },
  async onSearch() {
    const docId = String(this.data.docId || "").trim();
    const collection = this.data.collections[this.data.collectionIndex] || "";
    if (!collection || !docId) {
      wx.showToast({ title: "请先选择集合并输入 ID", icon: "none" });
      return;
    }

    this.setData({ loading: true, error: "", searched: true });
    try {
      const res = await backstageApi.getDocument({ collection, id: docId });
      const collections = Array.isArray(res && res.allowedCollections) && res.allowedCollections.length ? res.allowedCollections : this.data.collections;
      this.setData({
        collections,
        resultCollection: collection,
        resultId: docId,
        found: !!(res && res.found),
        resultText: pretty(res && res.document),
        error: ""
      });
    } catch (e) {
      const error = (e && e.message) || "查询失败";
      this.setData({
        error,
        resultCollection: collection,
        resultId: docId,
        found: false,
        resultText: ""
      });
      wx.showToast({ title: error, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
  onCopyResult() {
    if (!this.data.resultText) {
      wx.showToast({ title: "暂无结果", icon: "none" });
      return;
    }
    wx.setClipboardData({ data: this.data.resultText });
  }
});
