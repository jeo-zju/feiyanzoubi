function ownerOf(plan) {
  return String((plan && (plan.openid || plan._openid || plan.uid)) || "");
}

async function canViewPlan(db, plan, openid) {
  if (!plan) return false;
  const owner = ownerOf(plan);
  if (openid && owner === openid) return true;
  if (plan.visibility === "public") return true;
  if (!openid) return false;
  const _ = db.command;
  if (plan.visibility === "friends") {
    const res = await db.collection("RockFriendships").where(_.and([
      { status: "accepted" },
      _.or([{ fromOpenid: openid, toOpenid: owner }, { fromOpenid: owner, toOpenid: openid }])
    ])).limit(1).get();
    return !!(res.data && res.data.length);
  }
  if (plan.visibility === "circle" && Array.isArray(plan.circleIds) && plan.circleIds.length) {
    const res = await db.collection("RockCircleMembers").where({
      openid, circleId: _.in(plan.circleIds), status: "accepted"
    }).limit(1).get();
    return !!(res.data && res.data.length);
  }
  return false;
}

function endAt(plan) {
  return Number(plan.endAt) || Date.parse(`${plan.date}T${plan.endTime}:00+08:00`);
}

module.exports = { ownerOf, canViewPlan, endAt };
