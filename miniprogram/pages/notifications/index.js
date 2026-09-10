const {callCloud}=require("../../services/cloud");const {ensureAppLogin}=require("../../utils/session");

function pad2(n){return n<10?"0"+n:""+n;}
function timeText(ts){
  const d=new Date(Number(ts)||0), now=new Date();
  const hm=pad2(d.getHours())+":"+pad2(d.getMinutes());
  const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  if(sameDay(d,now))return "今天 "+hm;
  const yest=new Date(now);yest.setDate(now.getDate()-1);
  if(sameDay(d,yest))return "昨天 "+hm;
  if(d.getFullYear()===now.getFullYear())return (d.getMonth()+1)+"月"+d.getDate()+"日";
  return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
}

Page({
  data:{list:[],loading:false,error:"",page:0,hasMore:false,seenAt:0,hasUnread:false},
  onShow(){this.load(true);},
  onReachBottom(){if(this.data.hasMore&&!this.data.loading)this.load(false);},
  async onPullDownRefresh(){try{await this.load(true);}finally{wx.stopPullDownRefresh();}},
  async load(reset){
    if(this.data.loading)return;
    const page=reset?1:this.data.page+1;
    this.setData({loading:true,error:""});
    try{
      await ensureAppLogin();
      const r=await callCloud("calendar_plan_publish",{action:"notices",page},{silent:true});
      const mapped=(r.list||[]).map(x=>({...x,timeText:timeText(x.createdAt)}));
      const list=(reset?[]:this.data.list).concat(mapped);
      this.setData({list,page,hasMore:r.hasMore,seenAt:r.seenAt,hasUnread:list.some(x=>x.unread)});
    }catch(_){
      this.setData({error:"通知暂时加载失败"});
    }finally{
      this.setData({loading:false});
    }
  },
  retry(){this.load(true);},
  open(e){wx.navigateTo({url:"/pages/plan-detail/index?planId="+encodeURIComponent(e.currentTarget.dataset.id)});},
  async markRead(){
    try{
      await callCloud("calendar_plan_publish",{action:"read_notices",seenAt:this.data.seenAt},{silent:true});
      this.setData({list:this.data.list.map(x=>({...x,unread:false})),hasUnread:false});
    }catch(_){wx.showToast({title:"操作失败，请重试",icon:"none"});}
  }
});
