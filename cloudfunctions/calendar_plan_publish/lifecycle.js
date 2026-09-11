const crypto = require("crypto");
const { ownerOf, canViewPlan, endAt } = require("./access");
const schedule = require("./schedule");
const guard = require("./demo-guard");
const idFor = (planId, openid) => "j_" + crypto.createHash("sha256").update(planId + "|" + openid).digest("hex").slice(0, 32);
const confirmed = row => row && ["joined", "confirmed"].includes(row.status);
function joinTime(row) {
  return Math.max(...[row.updatedAt,row.updated_at,row.createdAt,row.created_at].map(value => {
    if (value == null) return 0;
    const numeric=Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed=Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }));
}
function legacyParticipants(joins) {
  const latest=new Map();
  (Array.isArray(joins) ? joins : []).forEach((join,index) => {
    const uid=join && (join.openid || join._openid || join.uid);
    if(!uid) return;
    const candidate={join,index,time:joinTime(join)};
    const previous=latest.get(uid);
    const candidateEnded=!confirmed(join) && join.status !== "pending";
    const previousEnded=previous && !confirmed(previous.join) && previous.join.status !== "pending";
    // Equal/unknown revisions prefer a terminal state; remaining ties follow the
    // stable _id order supplied by rows(), making corrupt legacy duplicates deterministic.
    if(!previous || candidate.time > previous.time ||
      (candidate.time === previous.time && candidateEnded && !previousEnded) ||
      (candidate.time === previous.time && candidateEnded === previousEnded && candidate.index > previous.index)) latest.set(uid,candidate);
  });
  return [...latest].filter(([,item])=>confirmed(item.join)||item.join.status === "pending").map(([uid])=>uid);
}
// 参与者索引（与通知受众分开维护）：发起人始终在内，其余为最新状态
// pending/confirmed(joined) 的有效成员；cancelled/removed/rejected 不在内。
// 只有 schema v2 且 participantIds 为数组时才信任事务内索引；
// 旧计划（缺字段/非 v2）按每条报名的最新状态推导。
function memberIndex(plan, joins) {
  const ids = new Set();
  const add = value => { if (typeof value === "string" && value) ids.add(value); };
  add(ownerOf(plan));
  const indexed = plan && Number(plan.joinSchemaVersion) === 2 && Array.isArray(plan.participantIds);
  (indexed ? plan.participantIds : legacyParticipants(joins)).forEach(add);
  return [...ids];
}
function cancellationAudience(plan, joins, extras) {
  const audience = new Set(memberIndex(plan, joins));
  (Array.isArray(extras) ? extras : []).forEach(value => {
    if (typeof value === "string" && value) audience.add(value);
  });
  return [...audience];
}
const error = (code, message) => Object.assign(new Error(message), { code });
async function optionalDoc(ref) {
  try { return (await ref.get()).data || null; }
  catch (e) {
    if (/document.*(not.*exist|not.*found)|DOCUMENT_NOT_FOUND/i.test(String(e.errMsg || e.message || e.code))) return null;
    throw e;
  }
}
async function rows(db, name, where) {
  const out = [];
  for (let skip = 0; ; skip += 100) {
    const r = await db.collection(name).where(where).orderBy("_id", "asc").skip(skip).limit(100).get();
    out.push(...r.data);
    if (r.data.length < 100) return out;
  }
}
async function blocked(db, a, b) {
  const r = await db.collection("RockUserBlocks").where(db.command.or([
    { openid:a, targetOpenid:b }, { openid:b, targetOpenid:a }
  ])).limit(1).get();
  return r.data.length > 0;
}
function profile(user) {
  user = user || {};
  return {
    openid: user.openid || user._openid || user.uid || "",
    nickName: user.nickName || "", displayName: user.displayName || user.nickName || "岩友",
    avatarUrl: user.avatarUrl || "", rockId: user.rockId || "", title: user.title || "",
    climbSkills: user.climbSkills || {}, city: user.city || ""
  };
}
async function getProfile(db, openid) {
  const r = await db.collection("RockUsers").where(db.command.or([{openid},{_openid:openid},{uid:openid}])).limit(1).get();
  return profile(r.data[0] || {openid});
}
async function avatars(cloud, list) {
  const ids = [...new Set(list.map(x => x.avatarUrl).filter(x => String(x).startsWith("cloud://")))];
  const urls = {};
  for (let i=0;i<ids.length;i+=50) {
    const r = await cloud.getTempFileURL({fileList:ids.slice(i,i+50)});
    (r.fileList || []).forEach(x => { if (x.tempFileURL) urls[x.fileID] = x.tempFileURL; });
  }
  return list.map(x => ({...x, avatarUrl: urls[x.avatarUrl] || (String(x.avatarUrl).startsWith("cloud://") ? "" : x.avatarUrl)}));
}
function summary(plan, count) {
  return {
    _id:plan._id, title:plan.title || "一起爬，认识新岩友", gymId:plan.gymId || "",
    gymSnapshot:plan.gymSnapshot || {}, date:plan.date, startTime:plan.startTime, endTime:plan.endTime,
    timeSlots:Array.isArray(plan.timeSlots) ? plan.timeSlots : [],
    startAt:Number(plan.startAt) || Date.parse(`${plan.date}T${plan.startTime}:00+08:00`), endAt:endAt(plan),
    status:plan.status || "active", visibility:plan.visibility, note:plan.note || "",
    skillTags:plan.skillTags || [], atmosphereTags:plan.atmosphereTags || [],
    capacity:plan.capacity || null, confirmedCount:count, joinedCount:count,
    joinMode:plan.joinMode || "direct", joinDeadline:Number(plan.joinDeadline) || endAt(plan),
    version:Number(plan.version || 0)
  };
}
const supported = new Set(["detail", "join_plan", "unjoin_plan", "get_joiners", "cancel", "remove_joiner", "approve_joiner", "reject_joiner"]);

async function manage({db,cloud,openid,event}) {
  const action=event.action, planId=String(event.planId || "");
  if (!planId) throw error("BAD_REQUEST", "缺少约爬编号");
  const ref=db.collection("RockCalendarPlans").doc(planId);
  const plan=await optionalDoc(ref);
  if (!plan) throw error("NOT_FOUND", "约爬不存在或已删除");
  // 演示局一键隐藏开关：对真实用户与“旧链接”统一呈现“已删除”，与真实约爬删除后的反馈一致
  if (guard.isDemoPlan(plan) && !(await guard.demoShowAll(db))) throw error("NOT_FOUND", "约爬不存在或已删除");
  const owner=ownerOf(plan), isOwner=owner===openid;
  if (action !== "unjoin_plan" && !await canViewPlan(db,plan,openid)) throw error("FORBIDDEN", "你暂时无法查看这场约爬");
  const joins=await rows(db,"RockCalendarJoins",{planId});
  const byUser=new Map();
  joins.forEach(j => { const uid=j.openid || j._openid || j.uid; if(uid && (!byUser.has(uid) || confirmed(j))) byUser.set(uid,j); });
  const mine=byUser.get(openid);
  const count=1+[...byUser].filter(([uid,j])=>uid!==owner && confirmed(j)).length;
  if (action === "detail" || action === "get_joiners") {
    const accepted=[...byUser].filter(([uid,j])=>uid!==owner && confirmed(j)).map(([,j])=>j);
    const pending=isOwner ? [...byUser.values()].filter(j=>j.status === "pending") : [];
    const userIds=[owner,...accepted.map(j=>j.openid),...pending.map(j=>j.openid)];
    const userMap={};
    for(let i=0;i<userIds.length;i+=50) {
      const ids=userIds.slice(i,i+50);
      const r=await db.collection("RockUsers").where(db.command.or([{openid:db.command.in(ids)},{_openid:db.command.in(ids)},{uid:db.command.in(ids)}])).limit(100).get();
      r.data.forEach(u=>{for(const key of [u.openid,u._openid,u.uid]) if(key) userMap[key]=profile(u);});
    }
    const member = j => ({...(userMap[j.openid] || profile({...j.userSnapshot,openid:j.openid})), joinId:j._id, joinedAt:j.createdAt || 0});
    const resolved=await avatars(cloud,[userMap[owner] || profile({...plan.userSnapshot,openid:owner}),...accepted.map(member),...pending.map(member)]);
    // canRelate=false：客户端不展示“加岩友/私信”等不可用入口；模拟身份不建立任何社交关系
    const withRelate = (u) => ({...u, canRelate: !guard.isDemoId(u.openid)});
    const ownerInfo={...withRelate(resolved[0]),isOwner:true};
    const isBlocked = openid && !isOwner ? await blocked(db,openid,owner) : false;
    const contactAllowed=(isOwner || confirmed(mine)) && !isBlocked;
    return {
      planId, plan:summary(plan,count), isOwner, ownerInfo,
      joiners:resolved.slice(1,accepted.length+1).map(withRelate), pending:resolved.slice(accepted.length+1).map(withRelate),
      joined: isOwner || confirmed(mine), joinedCount:count,
      myStatus:isOwner ? "host" : (mine && (confirmed(mine) ? "confirmed" : mine.status)) || "none",
      meetingPoint:contactAllowed ? plan.meetingPoint || "" : "",
      contact:contactAllowed ? plan.contact || "" : "", isBlocked
    };
  }
  if (!openid) throw error("AUTH_REQUIRED", "请登录后操作");
  // 模拟身份（demo_ 合成 openid，不可能来自真实微信登录态）不得发起任何写入——纵深防御
  await guard.assertRealActor(openid);
  // 回填维护窗口期冻结所有报名/审批/退出类写入（旧客户端同样受约束）；只读 detail/get_joiners 已提前返回
  await schedule.assertWritesEnabled(db);
  if (["cancel","remove_joiner","approve_joiner","reject_joiner"].includes(action) && !isOwner) throw error("FORBIDDEN", "仅发起人可操作");
  const target=["remove_joiner","approve_joiner","reject_joiner"].includes(action) ? String(event.targetOpenid || "") : openid;
  if (action !== "cancel" && (!target || target === owner)) throw error("BAD_REQUEST", "不能对发起人执行此操作");
  // 模拟身份不存在可被审批/移除的申请
  if (target !== openid && guard.isDemoId(target)) throw error("INVALID_STATE", "该申请已处理或取消");
  const denied = ["join_plan","approve_joiner"].includes(action) ? await blocked(db,target,owner) : false;
  if(denied) throw error("BLOCKED", "当前无法报名该约爬");
  if (["join_plan","approve_joiner"].includes(action) && (plan.status !== "active" || endAt(plan) <= Date.now())) throw error("PLAN_ENDED", "约爬已结束或取消");
  const user=action === "join_plan" ? await getProfile(db,openid) : null;
  if(action === "join_plan" && !user.nickName && user.displayName === "岩友") throw error("PROFILE_REQUIRED", "先填写昵称，让岩友认识你");
  const candidate=byUser.get(target);
  const joinId=candidate ? candidate._id : idFor(planId,target);
  // 事务冲突时整段重读重判（有限重试）；耗尽重试返回失败，绝不按成功处理。
  const txResult=await schedule.withRetries(()=>db.runTransaction(async tx => {
    const planRef=tx.collection("RockCalendarPlans").doc(planId);
    const current=await optionalDoc(planRef);
    if(!current) throw error("NOT_FOUND","约爬不存在");
    if(current.visibility !== plan.visibility || JSON.stringify(current.circleIds) !== JSON.stringify(plan.circleIds)) throw error("PLAN_CHANGED","约爬已更新，请刷新后重试");
    // 演示局只读硬门槛：即使容量被篡改/成员被清理，真实用户也只能得到普通“名额已满”，绝不产生写入
    if((action==="join_plan"||action==="approve_joiner") && guard.isDemoPlan(current)) throw error("PLAN_FULL","名额已满，看看其他约爬吧");
    // 当前局时间区间（新数据按 timeSlots 派生；旧数据按真实起止钟点）——日程占用的唯一依据
    const schedCandidate=schedule.candidateFromPlan(current);
    const currentCount=current.joinSchemaVersion === 2 ? current.confirmedCount : count;
    const joinRef=tx.collection("RockCalendarJoins").doc(joinId);
    const previous=await optionalDoc(joinRef);
    let status=previous ? previous.status : "none", nextCount=currentCount;
    let notice="";
    if(action === "cancel") {
      if(current.status === "cancelled") return {planId,cancelled:true};
      notice="发起人取消了约爬";
    } else if(action === "unjoin_plan") {
      if(!previous || ["cancelled","removed","rejected"].includes(status)) return {planId,joined:false,status};
      if(confirmed(previous)) nextCount--;
      status="cancelled"; notice="有岩友取消了报名";
    } else {
      if(current.status !== "active" || endAt(current) <= Date.now()) throw error("PLAN_ENDED","约爬已结束或取消");
      if(["join_plan","approve_joiner"].includes(action) && (Number(current.joinDeadline) || endAt(current)) <= Date.now()) throw error("JOIN_CLOSED","报名已截止");
      if(action === "join_plan") {
        if(previous && (confirmed(previous) || status === "pending")) {
          // 幂等重放：补齐可能缺失的日程占用，不做冲突检查，不产生第二条占用
          const repair=await schedule.ensureOccupancy(tx,{openid:target,planId,status:confirmed(previous)?"confirmed":"pending",candidate:schedCandidate,now:Date.now()});
          await schedule.commitDayWrites(repair);
          return {planId,joined:confirmed(previous),status:confirmed(previous)?"confirmed":status,joinId};
        }
        if(status === "removed") throw error("REMOVED","发起人已移除本次报名");
        // 统一合同：满员即暂停新申请，直接报名与审批报名一致。已提交的待确认申请
        // 保留不占位；有人退出释放名额后发起人再确认（approve 仍走下面的容量校验）。
        if(current.capacity && currentCount >= Number(current.capacity)) throw error("PLAN_FULL","名额已满，看看其他约爬吧");
        status=current.joinMode === "approval" ? "pending" : "confirmed";
        if(status === "confirmed") nextCount++;
        notice=status === "pending" ? "有新的约爬申请等待确认" : "有新岩友加入了约爬";
      } else if(action === "approve_joiner") {
        if(confirmed(previous)) {
          // 幂等重放：占用升级为 confirmed，不做冲突检查，不产生第二条占用
          const repair=await schedule.ensureOccupancy(tx,{openid:target,planId,status:"confirmed",candidate:schedCandidate,now:Date.now()});
          await schedule.commitDayWrites(repair);
          return {planId,status:"confirmed"};
        }
        if(!previous || status !== "pending") throw error("INVALID_STATE","该申请已处理或取消");
        status="confirmed"; nextCount++; notice="你的约爬申请已通过";
      } else if(action === "reject_joiner") {
        if(status === "rejected") return {planId,status};
        if(status !== "pending") throw error("INVALID_STATE","该申请已处理或取消");
        status="rejected"; notice="发起人暂未接受你的申请";
      } else if(action === "remove_joiner") {
        if(!previous || status === "removed") return {planId,removed:true};
        if(confirmed(previous)) nextCount--;
        status="removed"; notice="发起人移除了你的报名";
      }
      if(current.capacity && nextCount > current.capacity) throw error("PLAN_FULL","名额已满，看看其他约爬吧");
    }
    // 日程占用变更（与报名行、计划计数同一事务提交）：
    // - join direct→confirmed / approval→pending：预留所选段（pending 预留时段但不占名额）
    // - approve pending→confirmed：实时校验目标岩友此时段无其他有效安排（错误不泄露对方冲突局详情）
    // - unjoin/reject/remove：只释放目标人在本局日期的占用；cancel 不逐人释放，以计划 cancelled 状态为权威
    let schedDayInfos=null;
    if(action !== "cancel") {
      if((action==="join_plan"||action==="approve_joiner") && (status==="confirmed"||status==="pending")) {
        schedDayInfos=await schedule.occupy(tx,{
          openid:target, planId, status, candidate:schedCandidate, excludePlanId:planId, now:Date.now(),
          conflictOptions: action==="approve_joiner" ? {message:"该岩友此时段已有安排"} : {includePlanId:true}
        });
      } else if(["unjoin_plan","reject_joiner","remove_joiner"].includes(action)) {
        schedDayInfos=await schedule.release(tx,{openid:target,planId,dates:Object.keys(schedCandidate.byDate),now:Date.now()});
      }
    }
    const now=Date.now(), version=Number(current.version || 0)+1;
    if(action !== "cancel") {
      const data={ planId,openid:target,_openid:target,planOwnerOpenid:owner,date:current.date,status,updatedAt:now,updated_at:db.serverDate() };
      if(previous) await joinRef.update({data});
      else await joinRef.set({data:{...data,userSnapshot:user || {},createdAt:now,created_at:db.serverDate()}});
    }
    const members=new Set(cancellationAudience(current,joins));
    if(action!=="cancel") {
      if(status==="confirmed" || status==="pending") members.add(target); else members.delete(target);
    }
    await planRef.update({data:{ status:action === "cancel" ? "cancelled" : current.status,confirmedCount:Math.max(1,nextCount),isFull:!!current.capacity && nextCount>=current.capacity,participantIds:[...members],joinSchemaVersion:2,version,updatedAt:now }});
    if(schedDayInfos) await schedule.commitDayWrites(schedDayInfos);
    // One durable event per state transition. Notification UI queries audience, without an external push dependency.
    const audience=action === "cancel" ? [...members] : [isOwner ? target : owner];
    if(audience.length) await tx.collection("RockPlanEvents").doc(`${planId}_${version}`).set({data:{planId,audience:[...new Set(audience)],actor:openid,title:notice,createdAt:now,gymName:(current.gymSnapshot||{}).name || "攀岩馆"}});
    return {planId,joined:status === "confirmed",status,joinId,removed:status === "removed",cancelled:action === "cancel"};
  }));
  if(action==="cancel" && txResult && txResult.cancelled){
    // 取消以计划 cancelled 状态为准入权威（其他用户报名时事务内实时核验）；
    // 这里仅做事后尽力清理，减少 RockUserScheduleDays 死占用，不决定准入。
    try{ await schedule.cleanupPlanOccupancy(db, plan, cancellationAudience(plan,joins), Date.now()); }catch(e){}
  }
  return txResult;
}
module.exports={supported,manage,summary,rows,profile,avatars,blocked,confirmed,memberIndex,cancellationAudience,optionalDoc};
