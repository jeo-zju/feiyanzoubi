const { callCloud } = require("../cloud");

async function syncGyms(params, options) {
  return callCloud("rock_sync_gyms", params || {}, {
    loading: true,
    loadingTitle: "同步中",
    ...(options || {})
  });
}

async function healthCheck(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "health",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "检查中",
      ...(options || {})
    }
  );
}

async function listReviewQueue(params, options) {
  return callCloud(
    "rock_gym_review_queue_manage",
    {
      action: "list",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "加载审核队列",
      ...(options || {})
    }
  );
}

async function reviewQueueItem(params, options) {
  return callCloud(
    "rock_gym_review_queue_manage",
    {
      action: "review",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "提交审核",
      ...(options || {})
    }
  );
}

module.exports = {
  syncGyms,
  healthCheck,
  listReviewQueue,
  reviewQueueItem
};
