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

async function listUsers(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "listUsers",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "加载用户",
      ...(options || {})
    }
  );
}

async function updateUserRole(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "updateUserRole",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "更新角色",
      ...(options || {})
    }
  );
}

async function authDebug(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "authDebug",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "读取权限",
      ...(options || {})
    }
  );
}

async function getDocument(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "getDocument",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "查询文档",
      ...(options || {})
    }
  );
}

async function getGymPermission(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "getGymPermission",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "读取岩馆权限",
      ...(options || {})
    }
  );
}

async function getUserDetail(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "getUserDetail",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "读取用户详情",
      ...(options || {})
    }
  );
}

async function updateUserProfile(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "updateUserProfile",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "保存用户信息",
      ...(options || {})
    }
  );
}

async function updateGymPermission(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "updateGymPermission",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "保存岩馆权限",
      ...(options || {})
    }
  );
}

async function getReviewDetail(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "getReviewDetail",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "读取审核详情",
      ...(options || {})
    }
  );
}

async function updateReviewDetail(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "updateReviewDetail",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "保存审核结果",
      ...(options || {})
    }
  );
}

async function getCardDetail(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "getCardDetail",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "读取名片详情",
      ...(options || {})
    }
  );
}

async function updateCardDetail(params, options) {
  return callCloud(
    "admin_manage",
    {
      action: "updateCardDetail",
      ...(params || {})
    },
    {
      loading: true,
      loadingTitle: "保存名片信息",
      ...(options || {})
    }
  );
}

module.exports = {
  syncGyms,
  healthCheck,
  listReviewQueue,
  reviewQueueItem,
  listUsers,
  updateUserRole,
  authDebug,
  getDocument,
  getGymPermission,
  getUserDetail,
  updateUserProfile,
  updateGymPermission,
  getReviewDetail,
  updateReviewDetail,
  getCardDetail,
  updateCardDetail
};
