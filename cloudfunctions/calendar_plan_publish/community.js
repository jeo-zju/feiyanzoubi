const {rows,summary,confirmed,cancellationAudience,optionalDoc} = require("./lifecycle");
const {ownerOf,canViewPlan} = require("./access");
const schedule=require("./schedule");
const error=(code,message)=>Object.assign(new Error(message),{code});
const supported=new Set(["mine_list","notices","read_notices","block","unblock","blocks","report","reports","resolve_report"]);
async function manage({db,openid,event}) {
  if(!openid) throw error("AUTH_REQUIRED","请登录后操作");
  const _=db.command, action=event.action;
  if(action === "mine_list") {
    const now=new Date(Date.now()+8*3600000).toISOString(), today=now.slice(0,10), hm=now.slice(11,16);
    const ended=event.tab === "past";
    const own=_.or([{openid},{_openid:openid},{uid:openid}]);
    // 键集分页直接命中计划集合，范围三取并集：
    //  1) participantIds 成员索引（joinSchemaVersion=2，事务内维护，含发起人）；
    //  2) 本人发起的计划（不依赖 schema 版本，索引异常时自己的活动仍可见）；
    //  3) 旧数据兼容：完整分页扫描本人报名所在计划，覆盖 participantIds 尚未回填的旧计划。
    //     这是迁移完成前的明确临时读放大；不会以隐式上限隐藏更早活动，也不会声称已自然收敛。
    let legacyPlanIds=[];
    if(event.tab !== "host") {
      // A terminal row can coexist with an older valid row. Include all rows in
      // the paginated compatibility read and resolve the latest state per plan;
      // filtering before resolving would resurrect cancelled/removed members.
      const latest=new Map();
      const timeOf=row=>Math.max(...[row.updatedAt,row.updated_at,row.createdAt,row.created_at].map(v=>{
        if(v==null)return 0; const n=Number(v); if(Number.isFinite(n))return n;
        const d=Date.parse(v); return Number.isFinite(d)?d:0;
      }));
      const oldRows=await rows(db,"RockCalendarJoins",_.or([{openid},{_openid:openid},{uid:openid}]));
      oldRows.forEach((row,index)=>{
          const pid=String(row.planId||""); if(!pid)return;
          const previous=latest.get(pid), t=timeOf(row);
          const ended=!(["pending","confirmed","joined"].includes(row.status));
          const prevEnded=previous && !(["pending","confirmed","joined"].includes(previous.row.status));
          if(!previous || t>previous.time || (t===previous.time && ended && !prevEnded)) latest.set(pid,{row,time:t,index});
        });
      legacyPlanIds=[...latest].filter(([,v])=>["pending","confirmed","joined"].includes(v.row.status)).map(([pid])=>pid);
    }
    const timeFilter = ended
      ? _.or([{date:_.lt(today)},{date:today,endTime:_.lte(hm)},{status:"cancelled"}])
      : _.and([{status:"active"},_.or([{date:_.gt(today)},{date:today,endTime:_.gt(hm)}])]);
    const dir = ended ? "desc" : "asc";
    let cDate="",cStart="",cId="";
    if(event.cursor) {
      let c;
      try { c=JSON.parse(String(event.cursor)); } catch (_) { throw error("BAD_REQUEST","分页参数无效，请刷新"); }
      if(!Array.isArray(c)||c.length!==3||c.some(x=>typeof x!=="string")) throw error("BAD_REQUEST","分页参数无效，请刷新");
      [cDate,cStart,cId]=c;
    }
    const keyset=cDate ? (ended
      ? _.or([{date:_.lt(cDate)},{date:cDate,startTime:_.lt(cStart)},{date:cDate,startTime:cStart,_id:_.lt(cId)}])
      : _.or([{date:_.gt(cDate)},{date:cDate,startTime:_.gt(cStart)},{date:cDate,startTime:cStart,_id:_.gt(cId)}])) : null;
    const limit=20;
    // Each source is capped at limit+1, then merged globally before slicing. Legacy
    // IDs are chunked to keep every in query bounded; slicing each chunk first would
    // lose records that belong ahead of another chunk's page boundary.
    const sourceScopes=[];
    if(event.tab === "host") sourceScopes.push(own);
    else {
      sourceScopes.push(_.or([{participantIds:openid},own]));
      for(let i=0;i<legacyPlanIds.length;i+=50) sourceScopes.push({_id:_.in(legacyPlanIds.slice(i,i+50))});
    }
    const candidates=[];
    for(const source of sourceScopes) {
      const sourceParts=[source,timeFilter]; if(keyset) sourceParts.push(keyset);
      const r=await db.collection("RockCalendarPlans").where(_.and(sourceParts))
        .orderBy("date",dir).orderBy("startTime",dir).orderBy("_id",dir).limit(limit+1).get();
      candidates.push(...r.data);
    }
    const unique=new Map(candidates.map(p=>[String(p._id),p]));
    const compare=(a,b)=>{
      for(const key of ["date","startTime","_id"]) {
        const av=String(a[key]||""),bv=String(b[key]||"");
        if(av!==bv) return (av>bv?1:-1)*(ended?-1:1);
      }
      return 0;
    };
    const ordered=[...unique.values()].sort(compare);
    const pagePlans=ordered.slice(0,limit);
    const hasMore=ordered.length>limit;
    // 仅按本页 20 个计划查询当前用户全部报名状态（in 小集合），再解析最新状态。
    const planIds=pagePlans.map(p=>p._id);
    const joinRows = planIds.length
      ? await rows(db,"RockCalendarJoins",_.and([{planId:_.in(planIds)},_.or([{openid},{_openid:openid},{uid:openid}])]))
      : [];
    const joined=new Map();
    const joinTime=j=>Math.max(...[j.updatedAt,j.updated_at,j.createdAt,j.created_at].map(v=>{
      if(v==null)return 0; const n=Number(v); if(Number.isFinite(n))return n;
      const d=Date.parse(v); return Number.isFinite(d)?d:0;
    }));
    joinRows.forEach((j,index)=>{
      const previous=joined.get(j.planId), t=joinTime(j);
      const endedState=!(["pending","confirmed","joined"].includes(j.status));
      const previousEnded=previous && !(["pending","confirmed","joined"].includes(previous.row.status));
      if(!previous || t>previous.time || (t===previous.time && endedState && !previousEnded)) joined.set(j.planId,{row:j,time:t,index});
    });
    const list=pagePlans.map(p=>{
      const entry=joined.get(p._id), j=entry&&entry.row, host=ownerOf(p)===openid;
      return {...summary(p,Number(p.confirmedCount||1)),isOwner:host,myStatus:host?"host":confirmed(j)?"confirmed":(j&&j.status)||"none",gymName:(p.gymSnapshot||{}).name||"攀岩馆"};
    });
    const last=pagePlans[pagePlans.length-1];
    return {list,hasMore,cursor:last?JSON.stringify([last.date,last.startTime,last._id]):""};
  }
  if(action === "notices") {
    const page=Math.max(1,Math.floor(Number(event.page)||1));
    const [r,u]=await Promise.all([
      db.collection("RockPlanEvents").where({audience:openid}).orderBy("createdAt","desc").orderBy("_id","asc").skip((page-1)*20).limit(21).get(),
      db.collection("RockUsers").where({openid}).limit(1).get()
    ]);
    const readAt=Number((u.data[0]||{}).noticesReadAt||0);
    return {list:r.data.slice(0,20).map(x=>({_id:x._id,planId:x.planId,title:x.title,gymName:x.gymName,createdAt:x.createdAt,unread:x.createdAt>readAt})),hasMore:r.data.length>20,seenAt:Date.now()};
  }
  if(action === "read_notices") {
    const r=await db.collection("RockUsers").where({openid}).limit(1).get();
    if(r.data[0]) await db.collection("RockUsers").doc(r.data[0]._id).update({data:{noticesReadAt:Math.min(Date.now(),Math.max(Number(r.data[0].noticesReadAt||0),Number(event.seenAt)||0))}});
    return {read:true};
  }
  if(action === "blocks") {
    const list=await rows(db,"RockUserBlocks",{openid});
    return {list:list.map(x=>({_id:x._id,targetOpenid:x.targetOpenid,name:x.name||"已屏蔽的岩友"}))};
  }
  if(action === "block" || action === "unblock") {
    const target=String(event.targetOpenid||"");
    if(!target || target === openid) throw error("BAD_REQUEST","请选择其他岩友");
    const id=require("crypto").createHash("sha256").update(openid+"|"+target).digest("hex").slice(0,32);
    const ref=db.collection("RockUserBlocks").doc(id);
    if(action === "unblock") {if(await optionalDoc(ref))await ref.remove();return {blocked:false};}
    const user=await db.collection("RockUsers").where(_.or([{openid:target},{_openid:target}])).limit(1).get();
    if(!user.data[0]) throw error("NOT_FOUND","岩友不存在");
    await ref.set({data:{openid,targetOpenid:target,name:user.data[0].displayName||user.data[0].nickName||"岩友",createdAt:Date.now()}});
    return {blocked:true};
  }
  if(action === "report") {
    const planId=String(event.planId||""), reason=String(event.reason||"").trim().slice(0,500);
    const p=planId ? await optionalDoc(db.collection("RockCalendarPlans").doc(planId)) : null;
    if(!p || !await canViewPlan(db,p,openid)) throw error("FORBIDDEN","无法举报该约爬");
    if(!reason) throw error("BAD_REQUEST","请填写举报原因");
    const day=new Date().toISOString().slice(0,10);
    const id=require("crypto").createHash("sha256").update(openid+"|"+planId+"|"+day).digest("hex").slice(0,32);
    const ref=db.collection("RockReports").doc(id);
    await db.runTransaction(async tx=>{
      const report=tx.collection("RockReports").doc(id);
      if(await optionalDoc(report)) return;
      await report.set({data:{openid,planId,reason,status:"pending",createdAt:Date.now(),snapshot:{title:p.title||"约爬",note:p.note||"",owner:ownerOf(p),gymName:(p.gymSnapshot||{}).name||""}}});
    });
    return {reported:true};
  }
  if(action === "reports" || action === "resolve_report") {
    const u=await db.collection("RockUsers").where({openid,role:"admin"}).limit(1).get();
    if(!u.data.length) throw error("FORBIDDEN","仅管理员可处理举报");
    if(action === "reports") {
      const r=await db.collection("RockReports").where({status:"pending"}).orderBy("createdAt","asc").limit(50).get();
      return {list:r.data};
    }
    const reportId=String(event.reportId||""), resolution=String(event.resolution||"");
    if(!["dismiss","cancel_plan"].includes(resolution)) throw error("BAD_REQUEST","请选择处理方式");
    // Cloud database transactions are kept to document reads. Join query results are
    // merged with the current participantIds inside the transaction so a concurrent
    // successful join is still represented by the plan document.
    const reportSnapshot=resolution === "cancel_plan" ? await optionalDoc(db.collection("RockReports").doc(reportId)) : null;
    const joins=reportSnapshot ? await rows(db,"RockCalendarJoins",{planId:reportSnapshot.planId}) : [];
    const result=await db.runTransaction(async tx=>{
      const ref=tx.collection("RockReports").doc(reportId), report=await optionalDoc(ref);
      if(!report) throw error("NOT_FOUND","举报不存在");
      if(report.status !== "pending") return {resolved:true};
      let cancelledPlan=null, cancelledAudience=[];
      if(resolution === "cancel_plan") {
        const planRef=tx.collection("RockCalendarPlans").doc(report.planId), p=await optionalDoc(planRef);
        if(p) {
          const audience=cancellationAudience(p,reportSnapshot && reportSnapshot.planId === report.planId ? joins : [],[report.openid]);
          await planRef.update({data:{status:"cancelled",moderatedAt:Date.now(),version:Number(p.version||0)+1}});
          await tx.collection("RockPlanEvents").doc("report_"+reportId).set({data:{planId:report.planId,audience,actor:openid,title:"管理员已下架被举报的约爬",gymName:(p.gymSnapshot||{}).name||"",createdAt:Date.now()}});
          cancelledPlan=p; cancelledAudience=audience;
        }
      }
      await ref.update({data:{status:"resolved",resolution,handledBy:openid,handledAt:Date.now()}});
      return {resolved:true,cancelledPlan,cancelledAudience};
    });
    // 管理员下架与发起人取消同规则：计划 cancelled 状态为准入权威，这里仅事后尽力清理日程死占用
    if(result.cancelledPlan){
      try{ await schedule.cleanupPlanOccupancy(db,result.cancelledPlan,result.cancelledAudience,Date.now()); }catch(e){}
    }
    return {resolved:true};
  }
}
module.exports={supported,manage};
