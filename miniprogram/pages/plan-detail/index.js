const {callCloud}=require("../../services/cloud");
const {ensureAppLogin}=require("../../utils/session");
const {decorate}=require("../../utils/plan");
const cache=require("../../utils/cache");
Page({
 data:{planId:"",loading:true,error:"",detail:null,plan:null,busy:false,buttonLabel:"报名一起爬",buttonDisabled:false,stateText:"",
  // 二轮紧凑版：成员摘要/发起人技能/规则文案
  memberAvatars:[],ownerSkillText:"",joinRuleText:"",timeText:"",
  // 底栏模式：again 再约 / share 邀请 / join 报名申请 / status 紧凑状态条
  barMode:"join",stateBarTitle:"",stateBarSub:"",showCancel:false,
  // 长文折叠
  titleLong:false,noteLong:false,titleExpanded:false,noteExpanded:false,
  // 弹层
  membersOpen:false,pendingOpen:false,moreOpen:false},
 onLoad(q){this.setData({planId:String(q.planId||"")});},onShow(){this.load();},
 async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
 onShareAppMessage(){const p=this.data.plan||{};return {title:p.title||"一起爬，认识新岩友",path:"/pages/plan-detail/index?planId="+encodeURIComponent(this.data.planId)};},
 async load(){this.setData({loading:true,error:""});try{const d=await callCloud("calendar_plan_publish",{action:"detail",planId:this.data.planId},{silent:true});const p=decorate(d.plan);let text="",label="报名一起爬",disabled=false;const ended=p.endAt<=Date.now();if(p.status==='cancelled'){text="这场约爬已取消";label="已取消";disabled=true;}else if(ended){text="这场约爬已结束，期待下次一起爬";label="已结束";disabled=true;}else if(d.myStatus==='confirmed'){text="你已确认参加，记得查看集合信息";label="取消报名";}else if(d.myStatus==='pending'){text="申请已提交，等待发起人确认。确认前还未约成。";label="取消申请";}else if(d.myStatus==='removed'){text="发起人已移除你的报名";label="无法再次报名";disabled=true;}else if(d.isBlocked){text="当前无法报名该约爬";disabled=true;label="无法报名";}else if((p.joinDeadline||p.endAt)<=Date.now()){text="报名已截止";label="报名已截止";disabled=true;}else if(p.full){text=p.joinMode==='approval'?"名额已满，暂不接受新申请":"名额已满，看看其他约爬吧";label="名额已满";disabled=true;}else if(p.joinMode==='approval'){label="申请加入";text="发起人确认后才算约成，申请不占名额";}
// 二轮：成员摘要头像（发起人在前，最多三个，全部来自已返回数据）
const owner=d.ownerInfo||{};
const memberAvatars=[owner].concat(d.joiners||[]).filter(Boolean).slice(0,3).map(u=>({openid:u.openid,avatarUrl:u.avatarUrl||"/images/avatar.png"}));
// 发起人常爬信息：只用接口已有字段
const skills=owner.climbSkills||{};
const ownerSkillText=Object.keys(skills).filter(k=>k!=="protector"&&skills[k]).map(k=>String(skills[k])).join(" · ");
const joinRuleText=this.buildJoinRule(p);
// 底栏模式与紧凑状态条
let barMode="status",stateBarTitle="",stateBarSub="",showCancel=false;
if(p.status==='cancelled'||ended){barMode="again";}
else if(d.isOwner){barMode="share";}
else if(d.myStatus==='confirmed'){barMode="status";stateBarTitle="已确认参加";stateBarSub="结果与变更请查看「我的 → 约爬通知」";showCancel=true;}
else if(d.myStatus==='pending'){barMode="status";stateBarTitle="等待发起人确认";stateBarSub="确认前还未约成 · 结果请查看「我的 → 约爬通知」";showCancel=true;}
else if(disabled){barMode="status";
  if(d.myStatus==='removed')stateBarTitle="你已被移出这场约爬";
  else if(d.isBlocked)stateBarTitle="当前无法报名该约爬";
  else if((p.joinDeadline||p.endAt)<=Date.now())stateBarTitle="报名已截止";
  else stateBarTitle="名额已满";
}else barMode="join";
this.setData({detail:d,plan:p,stateText:text,buttonLabel:label,buttonDisabled:disabled,ended,memberAvatars,ownerSkillText,joinRuleText,timeText:p.timeSlotText||(p.startTime+"–"+p.endTime),barMode,stateBarTitle,stateBarSub,showCancel,titleLong:(p.title||"").length>24,noteLong:(p.note||"").length>60,titleExpanded:false,noteExpanded:false});}catch(e){this.setData({error:e.code==='FORBIDDEN'?"这场约爬仅向指定岩友开放":e.code==='NOT_FOUND'?"这场约爬不存在或已删除":"约爬暂时加载失败，请重试"});}finally{this.setData({loading:false});}},
// 报名方式 + 截止规则一行：截止依据实际 joinDeadline，缺失才按活动开始兜底
buildJoinRule(p){
  const mode=p.joinMode==='approval'?"发起人确认后加入":"有名额即可加入";
  const end=Number(p.endAt)||0,dl=Number(p.joinDeadline)||end;
  let dlTxt="活动开始时截止报名";
  if(end&&dl&&Math.abs(dl-end)>60000){
    const dt=new Date(dl);
    const pad=n=>(n<10?"0"+n:String(n));
    dlTxt=`${dt.getMonth()+1}月${dt.getDate()}日 ${pad(dt.getHours())}:${pad(dt.getMinutes())} 截止`;
  }
  return mode+" · "+dlTxt;
},
toggleTitle(){this.setData({titleExpanded:!this.data.titleExpanded});},
toggleNote(){this.setData({noteExpanded:!this.data.noteExpanded});},
openMembers(){this.setData({membersOpen:true});},
closeMembers(){this.setData({membersOpen:false});},
openPending(){this.setData({pendingOpen:true});},
closePending(){this.setData({pendingOpen:false});},
openMore(){this.setData({moreOpen:true});},
closeMore(){this.setData({moreOpen:false});},
onEditTap(){this.setData({moreOpen:false});this.edit();},
onCancelTap(){this.setData({moreOpen:false});this.cancel();},
onReportTap(){this.setData({moreOpen:false});this.report();},
onBlockTap(){this.setData({moreOpen:false});this.block();},
 async act(action,targetOpenid){if(this.data.busy)return;this.setData({busy:true});try{await ensureAppLogin();await callCloud("calendar_plan_publish",{action,planId:this.data.planId,targetOpenid},{silent:true});cache.invalidate(cache.CACHE_KEYS.CALENDAR_SUMMARY);try{getApp().globalData.plansDirty=true;}catch(_){}await this.load();wx.showToast({title:"已更新",icon:"success"});}catch(e){const conflictTitle=action==='approve_joiner'?"无法通过申请":action==='join_plan'?"该时段已有安排":"暂未完成";if(e.code==='PROFILE_REQUIRED'){wx.showModal({title:"让新岩友认识你",content:"先填写昵称，再回来报名。",confirmText:"填写资料",success:r=>{if(r.confirm)wx.navigateTo({url:"/pages/profile-edit/index"});}});}else if(e.code==='SCHEDULE_CONFLICT'){// 本地状态不因失败而改动（reload 只在成功后发生）；审批失败文案不泄露对方冲突局详情
wx.showModal({title:conflictTitle,content:e.message||"该时段已有安排，请调整后再试",showCancel:false});}else if(e.code==='SCHEDULE_MAINTENANCE'){wx.showModal({title:"约爬系统维护中",content:e.message||"暂时不能操作，请稍后再试",showCancel:false});}else wx.showModal({title:"暂未完成",content:e.message||"请稍后重试",showCancel:false});}finally{this.setData({busy:false});}},
 mainAction(){if(this.data.buttonDisabled)return;const status=this.data.detail.myStatus;if(status==='confirmed'||status==='pending'){wx.showModal({title:"取消本次报名？",content:"发起人会在站内收到通知。",success:r=>{if(r.confirm)this.act('unjoin_plan');}});}else if((this.data.plan||{}).joinMode==='approval'){// 申请类报名确认一次：申请后预留此时段但不占名额，发起人确认才算约成
wx.showModal({title:"申请加入这场约爬？",content:"提交申请后将为你预留此时段（不占名额）；发起人确认后才算约成。",confirmText:"提交申请",success:r=>{if(r.confirm)this.act('join_plan');}});}else this.act('join_plan');},
 approve(e){this.act('approve_joiner',e.currentTarget.dataset.id);},reject(e){this.act('reject_joiner',e.currentTarget.dataset.id);},
 remove(e){const id=e.currentTarget.dataset.id;wx.showModal({title:"移除这位岩友？",content:"对方会收到站内通知，名额将释放。",success:r=>{if(r.confirm)this.act('remove_joiner',id);}});},
 cancel(){wx.showModal({title:"取消这场约爬？",content:"已报名的岩友会收到站内通知。",confirmText:"取消约爬",success:r=>{if(r.confirm)this.act('cancel');}});},
 edit(){wx.navigateTo({url:"/pages/calendar-publish/index?planId="+encodeURIComponent(this.data.planId)});},
 again(){const p=this.data.plan;const q=["gymId="+encodeURIComponent(p.gymId||""),"city="+encodeURIComponent((p.gymSnapshot||{}).city||""),"skillTags="+encodeURIComponent((p.skillTags||[]).join(",")),"atmosphere="+encodeURIComponent((p.atmosphereTags||[]).join(",")),"timeSlots="+encodeURIComponent((p.timeSlots||[]).join(",")),"capacity="+encodeURIComponent(p.capacity?String(p.capacity):""),"joinMode="+encodeURIComponent(p.joinMode==="approval"?"approval":"direct"),"again=1"].join("&");wx.navigateTo({url:"/pages/calendar-publish/index?"+q});},
 addFriend(e){const target=e.currentTarget.dataset.id;wx.showModal({title:"添加为岩友",content:"向这位岩友发送好友申请？",success:async r=>{if(!r.confirm)return;try{await ensureAppLogin();await require("../../services/api/friendship").request({toOpenid:target});wx.showToast({title:"已发送申请",icon:"success"});}catch(e){wx.showToast({title:e.message||"申请失败",icon:"none"});}}});},
 copyContact(){wx.setClipboardData({data:this.data.detail.contact});},
 // v2：底部弹层用 catchtap 阻止冒泡，空 handler 仅作事件占位
 noop(){},
 report(){wx.showModal({title:"举报约爬",editable:true,placeholderText:"请说明原因，便于管理员处理",success:async r=>{if(!r.confirm||!r.content.trim())return;try{await ensureAppLogin();await callCloud("calendar_plan_publish",{action:"report",planId:this.data.planId,reason:r.content},{silent:true});wx.showToast({title:"已提交举报",icon:"success"});}catch(e){wx.showToast({title:e.message||"提交失败",icon:"none"});}}});},
 block(){wx.showModal({title:"屏蔽这位发起人？",content:"双方将无法新增报名或好友申请。已报名的约爬可先取消；你也可以在我的页面解除屏蔽。",success:async r=>{if(!r.confirm)return;try{await callCloud("calendar_plan_publish",{action:"block",targetOpenid:this.data.detail.ownerInfo.openid},{silent:true});await this.load();}catch(e){wx.showToast({title:e.message||"操作失败",icon:"none"});}}});}
});
