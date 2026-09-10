const cloud = require("wx-server-sdk");
const lifecycle = require("./lifecycle");
const community = require("./community");
const schedule = require("./schedule");
const { ownerOf } = require("./access");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function traceId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ok(data, tid) {
  return { ok: true, data, traceId: tid };
}

function fail(code, message, tid, extra) {
  return { ok: false, error: Object.assign({ code, message }, extra || {}), traceId: tid };
}

function safeText(v) {
  return v == null ? "" : String(v).trim();
}

// issue #35: 云函数端用管理端权限批量把 cloud:// fileID 换成临时 https URL。
// 客户端 wx.cloud.getTempFileURL 受云存储安全规则约束，读他人头像可能被拒
// （现象：自己头像可见、他人头像空白，渲染层报 /pages/.../cloud:// 500）；
// 云函数端为管理端权限，不受存储规则限制。
async function resolveCloudAvatarFields(items, field) {
  if (!Array.isArray(items)) return items;
  const f = field || "avatarUrl";
  const ids = [];
  items.forEach((it) => {
    const v = it && it[f];
    if (v && String(v).indexOf("cloud://") === 0 && ids.indexOf(v) < 0) ids.push(String(v));
  });
  if (!ids.length) return items;
  const urlMap = {};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const r = await cloud.getTempFileURL({ fileList: ids.slice(i, i + 50) });
      ((r && r.fileList) || []).forEach((fi) => {
        if (fi && fi.fileID && fi.tempFileURL) urlMap[fi.fileID] = fi.tempFileURL;
      });
    }
  } catch (e) {}
  return items.map((it) => {
    const v = it && it[f];
    if (v && urlMap[v]) return Object.assign({}, it, { [f]: urlMap[v] });
    return it;
  });
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidYMD(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}

function isValidHM(v) {
  return /^\d{2}:\d{2}$/.test(String(v || ""));
}

function parseHM(hm) {
  const m = String(hm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function todayYMD() {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  return formatYMD(utc8);
}

function addDays(ymd, days) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return formatYMD(d);
}

async function getUser(openid) {
  try {
    const res = await db.collection("RockUsers").where(_.or([{ openid }, { _openid: openid }, { uid: openid }])).limit(1).get();
    return (res && res.data && res.data[0]) || null;
  } catch (e) {
    return null;
  }
}

async function getPrimaryCard(openid) {
  try {
    const res = await db
      .collection("RockCards")
      .where(_.and([_.or([{ ownerOpenid: openid }, { _openid: openid }]), { isPrimary: true }]))
      .limit(1)
      .get();
    return (res && res.data && res.data[0]) || null;
  } catch (e) {
    return null;
  }
}

async function getGym(gymId) {
  if (!gymId) return null;
  try {
    const res = await db.collection("RockGyms").doc(gymId).get();
    return (res && res.data) || null;
  } catch (e) {
    return null;
  }
}

// 查找当前用户已加入的、且关联了指定岩馆的岩友圈
async function getMyCirclesForGym(openid, gymId) {
  if (!openid || !gymId) return [];
  try {
    const cRes = await db
      .collection("RockCircles")
      .where({ status: "active", gymIds: gymId })
      .limit(100)
      .get();
    const circles = (cRes && cRes.data) || [];
    if (!circles.length) return [];
    const cIds = Array.from(new Set(circles.map((c) => String(c._id || "")).filter(Boolean)));
    if (!cIds.length) return [];
    const mRes = await db
      .collection("RockCircleMembers")
      .where({ openid, circleId: _.in(cIds), status: "accepted" })
      .limit(100)
      .get();
    const memberships = (mRes && mRes.data) || [];
    return Array.from(new Set(memberships.map((m) => String(m.circleId || "")).filter(Boolean)));
  } catch (e) {
    return [];
  }
}

// 计划发布成功后，自动在目标岩友圈发一条动态
async function autoPostToCircles(opts) {
  const { planId, circleIds, openid, date, startTime, endTime, gymSnapshot, note } = opts;
  const gymName = (gymSnapshot && gymSnapshot.name) || "";
  const notePart = note ? `（${note}）` : "";
  const content = `🧗 约爬计划 ${date} ${startTime}-${endTime} @${gymName}${notePart}，来报名一起爬！`;
  for (const circleId of circleIds) {
    try {
      await db.collection("RockCirclePosts").add({
        data: {
          circleId,
          openid,
          _openid: openid,
          nickName: "",
          avatarUrl: "",
          content,
          images: [],
          status: "active",
          planId,
          createdAt: Date.now(),
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      });
    } catch (e) {}
  }
}

async function hydrateUserMap(openids) {
  const ids = Array.from(new Set((openids || []).filter(Boolean))).slice(0, 200);
  if (!ids.length) return {};
  try {
    const res = await db
      .collection("RockUsers")
      .where(_.or([{ openid: _.in(ids) }, { _openid: _.in(ids) }, { uid: _.in(ids) }]))
      .limit(200)
      .get();
    const list = (res && res.data) || [];
    const m = {};
    list.forEach((u) => {
      const info = {
        openid: u.openid || u._openid || u.uid || "",
        nickName: u.nickName || "",
        avatarUrl: u.avatarUrl || "",
        displayName: u.displayName || u.nickName || "",
        title: u.title || "",
        // issue #35/#38: 岩友号 hydration 以前缺失，导致 ownerInfo.rockId 恒空、
        // 名片/弹窗里他人 ID 不展示
        rockId: u.rockId || "",
        climbSkills: u.climbSkills || null,
        city: u.city || ""
      };
      // 记录可能只存 openid/_openid/uid 中的某一个，按所有存在的 id 字段建索引，
      // 调用方用任一 id 都能命中
      [u.openid, u._openid, u.uid].forEach((k) => { if (k) m[k] = info; });
    });
    return m;
  } catch (e) {
    return {};
  }
}

function normalizeSkillTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => safeText(t)).filter(Boolean).slice(0, 10);
}

exports.main = async (event) => {
  const tid = traceId();
  try {
    const wxctx = cloud.getWXContext();
    const openid = wxctx.OPENID;
    if (!openid) return fail("AUTH_REQUIRED", "请登录后操作", tid);

    const action = safeText(event && event.action) || "create";
    const payload = (event && event.payload) || {};
    const planId = safeText(event && event.planId);
    if (community.supported.has(action)) return ok(await community.manage({db,openid,event:{...event,action}}),tid);
    if (lifecycle.supported.has(action)) return ok(await lifecycle.manage({db,cloud,openid,event:{...event,action}}),tid);

    const col = db.collection("RockCalendarPlans");
    const now = Date.now();
    const today = todayYMD();
    const maxDate = addDays(today, 13);

    if (action === "create" || action === "update") {
      // 回填维护窗口期冻结发起/改期（旧客户端同样受约束）
      await schedule.assertWritesEnabled(db);
      const mode = safeText(payload.mode) === "outdoor" ? "outdoor" : "gym";
      const gymId = mode === "gym" ? safeText(payload.gymId) : "";
      const outdoorName = mode === "outdoor" ? safeText(payload.outdoorName) : "";
      const date = safeText(payload.date);
      const startTime = safeText(payload.startTime);
      const endTime = safeText(payload.endTime);
      const rawVisibility = safeText(payload.visibility);
      const visibility = ["public", "friends", "circle"].includes(rawVisibility) ? rawVisibility : "public";
      const note = safeText(payload.note).slice(0,1000);
      const capacity = Number(payload.capacity || 4);
      if (!Number.isInteger(capacity) || capacity < 2 || capacity > 12) return fail("BAD_REQUEST","总人数需为 2–12 人（包含发起人）",tid);
      // 时段（上午/下午/晚上，可多选）：白名单去重持久化；startTime/endTime/startAt/endAt
      // 一律在通过基础格式校验后由服务端按时段派生（见下方 candidate），不信任客户端上送值
      const timeSlots = Array.isArray(payload.timeSlots)
        ? [...new Set(payload.timeSlots.map(safeText).filter(k => ["morning","afternoon","evening"].includes(k)))]
        : [];
      const socialFields = {
        schemaVersion:2, title:safeText(payload.title).slice(0,40), capacity,
        joinMode:payload.joinMode === "approval" ? "approval" : "direct",
        timeSlots,
        atmosphereTags:Array.isArray(payload.atmosphereTags) ? payload.atmosphereTags.map(safeText).filter(Boolean).slice(0,3) : [],
        meetingPoint:safeText(payload.meetingPoint).slice(0,100), contact:safeText(payload.contact).slice(0,100)
      };
      const needPartner = !!(payload && payload.needPartner);
      const skillTags = normalizeSkillTags(payload && payload.skillTags);
      if (!skillTags.some(t => ["boulder","lead","toprope","auto"].includes(t))) return fail("BAD_REQUEST","请选择攀爬类型",tid);

      if (!date) return fail("BAD_REQUEST", "缺少 date", tid);
      if (!isValidYMD(date)) return fail("BAD_REQUEST", "date 格式应为 YYYY-MM-DD", tid);
      if (date < today) return fail("BAD_REQUEST", "date 不能早于今天", tid);
      if (date > maxDate) return fail("BAD_REQUEST", "仅支持发布未来 14 天内的计划", tid);
      if (!isValidHM(startTime)) return fail("BAD_REQUEST", "缺少 startTime (HH:mm)", tid);
      if (!isValidHM(endTime)) return fail("BAD_REQUEST", "缺少 endTime (HH:mm)", tid);
      const startMin = parseHM(startTime);
      const endMin = parseHM(endTime);
      if (startMin == null || endMin == null) return fail("BAD_REQUEST", "时间段格式错误", tid);
      if (endMin <= startMin) return fail("BAD_REQUEST", "结束时间需晚于开始时间", tid);
      const durationMin = endMin - startMin;
      if (durationMin < 30) return fail("BAD_REQUEST", "时间段至少 30 分钟", tid);
      if (durationMin > 12 * 60) return fail("BAD_REQUEST", "单次计划不超过 12 小时", tid);
      if (Date.parse(`${date}T${startTime}:00+08:00`) <= now) return fail("DATE_PAST", "请选择尚未开始的时间", tid);

      // startAt/endAt/joinDeadline 一律由服务端按时段派生：
      // 新请求（带 timeSlots）忽略客户端上送的 startTime/endTime，防止伪造时间绕过同时段互斥；
      // 旧客户端/旧数据走显式兼容分支，按真实起止区间比较（不做时段舍入）。
      const candidate = timeSlots.length
        ? schedule.normalizeNewSlots(date, timeSlots)
        : schedule.legacyCandidate(date, startTime, endTime);
      Object.assign(socialFields, {
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        joinDeadline: candidate.startAt
      });

      let gym = null;
      let gymSnapshot = null;
      if (mode === "gym") {
        if (!gymId) return fail("BAD_REQUEST", "请选择岩馆", tid);
        gym = await getGym(gymId);
        if (!gym) return fail("NOT_FOUND", "岩馆不存在", tid);
        gymSnapshot = { name: gym.name || "", city: gym.city || "", address: gym.address || "" };
      } else {
        if (!outdoorName) return fail("BAD_REQUEST", "请填写野攀地点", tid);
      }

      let circleIds = [];
      if (visibility === "circle") {
        if (mode !== "gym" || !gymId) return fail("BAD_REQUEST", "对岩友圈发布需要选择岩馆", tid);
        circleIds = await getMyCirclesForGym(openid, gymId);
        if (!circleIds.length) return fail("NO_CIRCLE", "未加入该岩馆关联的岩友圈，无法对岩友圈发布", tid);
      }

      const user = await getUser(openid);
      const nickName = (user && (user.nickName || user.wechatName || user.name)) || "";
      if(!nickName) return fail("PROFILE_REQUIRED","请先在我的页面填写昵称，让新岩友认识你",tid);
      const avatarUrl = (user && user.avatarUrl) || "";
      const card = await getPrimaryCard(openid);
      const displayName = (card && card.displayName) || nickName || "";
      const title = (card && card.title) || "";
      // issue #35/#38: 快照带上岩友号，旧版快照缺 rockId 导致他人侧 ID 空白
      const rockId = (user && user.rockId) || "";
      const userSnapshot = { nickName, avatarUrl, displayName, title, rockId };

      if (action === "create") {
        const data = {
          ...socialFields, cityKey: safeText(gymSnapshot && gymSnapshot.city).replace(/市$/, ""), confirmedCount:1, isFull:false, participantIds:[openid], joinSchemaVersion:2, version:1,
          uid: openid,
          openid,
          _openid: openid,
          userSnapshot,
          gymId,
          gymSnapshot,
          mode,
          outdoorName,
          date,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          durationMin: candidate.durationMin,
          visibility,
          circleIds,
          note,
          needPartner,
          skillTags,
          status: "active",
          checkinRecordId: "",
          createdAt: now,
          updatedAt: now,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        };
        const requestId=safeText(event.requestId);
        if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return fail("REQUEST_ID_REQUIRED","请更新小程序后发布",tid);
        const createPlanId="p_"+require("crypto").createHash("sha256").update(openid+"|"+requestId).digest("hex").slice(0,32);
        const fingerprint=JSON.stringify(payload);
        // 事务内：计划文档 + 发起人当天日程占用一起提交；并发同段竞争同一条 RockUserScheduleDays，
        // 事务冲突时整段重读重判（有限重试），保证同一用户同一时段只成一个约爬。
        await schedule.withRetries(() => db.runTransaction(async tx=>{
          const ref=tx.collection("RockCalendarPlans").doc(createPlanId), previous=await lifecycle.optionalDoc(ref);
          if(previous){if(previous.requestFingerprint!==fingerprint)throw Object.assign(new Error("本次发布内容已改变，请重新打开发布页"),{code:"REQUEST_CONFLICT"});return;}
          const dayInfos=await schedule.occupy(tx,{openid,planId:createPlanId,status:"host",candidate,now,conflictOptions:{includePlanId:true}});
          await ref.set({data:{...data,requestFingerprint:fingerprint}});
          await schedule.commitDayWrites(dayInfos);
        }));
        return ok({ planId: createPlanId }, tid);
      }

      if (action === "update") {
        if (!planId) return fail("BAD_REQUEST", "缺少 planId", tid);
        const doc = await col.doc(planId).get().catch(() => null);
        const plan = doc && doc.data ? doc.data : null;
        if (!plan) return fail("NOT_FOUND", "计划不存在", tid);
        const owner = plan._openid || plan.uid || "";
        if (owner !== openid) return fail("PERMISSION_DENIED", "无权修改他人计划", tid);
        if (plan.status && plan.status !== "active") return fail("BAD_REQUEST", "该计划状态不可修改", tid);
        const data = {
          ...socialFields, cityKey: safeText(gymSnapshot && gymSnapshot.city).replace(/市$/, ""),
          gymId,
          gymSnapshot,
          // issue #35: 编辑计划时一并刷新发起者快照，避免旧快照里的空头像继续被他人看到
          userSnapshot,
          mode,
          outdoorName,
          date,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          durationMin: candidate.durationMin,
          visibility,
          circleIds,
          note,
          needPartner,
          skillTags,
          updatedAt: now,
          updated_at: db.serverDate()
        };
        // 报名行在事务外读取，事务内与当前计划文档合并出规范成员索引（发起人始终在内）。
        const members = await lifecycle.rows(db,"RockCalendarJoins",{planId});
        await schedule.withRetries(() => db.runTransaction(async tx => {
          const ref=tx.collection("RockCalendarPlans").doc(planId);
          const current=(await ref.get()).data;
          if(!current || current.status !== "active") throw Object.assign(new Error("该约爬已取消"),{code:"INVALID_STATE"});
          if(payload.version != null && Number(payload.version) !== Number(current.version || 0)) throw Object.assign(new Error("约爬已更新，请重新打开编辑"),{code:"PLAN_CHANGED"});
          const confirmedCount=current.joinSchemaVersion===2 ? current.confirmedCount : 1+new Set(members.filter(lifecycle.confirmed).map(j=>j.openid||j._openid||j.uid)).size;
          // 参与者索引 = 发起人 + 有效 pending/confirmed 成员；旧计划缺索引时按报名行推导，
          // 不再让“无人报名的旧计划编辑后发起人从索引消失”。
          const recipientIds=lifecycle.memberIndex(current, members);
          const ownerId=ownerOf(current);
          const nonOwnerMembers=recipientIds.filter(id => id && id !== ownerId);
          if(capacity < confirmedCount) throw Object.assign(new Error("人数不能少于已确认人数"),{code:"CAPACITY_TOO_SMALL"});
          // 可见范围锁定只看非发起人成员：新计划 participantIds 含发起人（长度为 1），
          // 仅发起人时可自由改范围；有待确认/已确认成员时才锁定。
          if(nonOwnerMembers.length && (visibility !== current.visibility || JSON.stringify(circleIds) !== JSON.stringify(current.circleIds || []))) throw Object.assign(new Error("已有岩友报名，暂不能修改可见范围"),{code:"VISIBILITY_LOCKED"});
          // 改期锁：日期/时段是否变化（新数据比 timeSlots，旧数据比起止钟点）
          const oldPlanCandidate=schedule.candidateFromPlan(current);
          const oldSlots=schedule.SLOT_KEYS.filter(k=>(current.timeSlots||[]).indexOf(k)>=0);
          const timeChanged=current.date!==candidate.date ||
            ((oldSlots.length||candidate.slots.length)
              ? JSON.stringify(oldSlots)!==JSON.stringify(candidate.slots)
              : (current.startTime!==candidate.startTime||current.endTime!==candidate.endTime));
          // 存在其他有效成员（待确认/已确认）时禁止改时间：他们的日程已被预留
          if(timeChanged && nonOwnerMembers.length) throw Object.assign(new Error("已有岩友报名或待审批，暂不能修改时间"),{code:"PLAN_TIME_LOCKED"});
          let dayInfos=null;
          if(timeChanged){
            // 仅发起人：同一事务内原子释放旧日期占用、建立新日期占用，排除自身当前局查冲突
            dayInfos=await schedule.replaceHost(tx,{openid,planId,candidate,oldDates:Object.keys(oldPlanCandidate.byDate),now,conflictOptions:{includePlanId:true}});
          }
          const version=Number(current.version || 0)+1;
          await ref.update({data:{...data,version,confirmedCount,joinSchemaVersion:2,participantIds:recipientIds,isFull:!!capacity && confirmedCount>=capacity}});
          if(dayInfos) await schedule.commitDayWrites(dayInfos);
          if(nonOwnerMembers.length) await tx.collection("RockPlanEvents").doc(planId+"_"+version).set({data:{planId,audience:recipientIds,actor:openid,title:"约爬信息有更新，请查看时间和集合位置",gymName:(gymSnapshot||{}).name||"攀岩馆",createdAt:now}});
        }));
        return ok({ planId }, tid);
      }
    }

    return fail("BAD_ACTION", `不支持的 action: ${action}`, tid);
  } catch (e) {
    const extra = e && e.code === "SCHEDULE_CONFLICT" && e.conflict ? { conflict: e.conflict } : null;
    return fail(e.code || "PUBLISH_FAILED", e && e.message ? e.message : "提交失败", tid, extra);
  }
};
