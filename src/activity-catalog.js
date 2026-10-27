// Activity coordinates use the existing campus ENU frame. No source geometry is changed.
export const ACTIVITY_WORKS = Object.freeze([
  {id:'library',name:'书境图书馆',description:'走进书境，探索原有旅程与书中游戏。',url:'/works/library/',ready:'runtime_ready'},
  {id:'wanyan',name:'黑神话.晚言',description:'进入晚言的真实 Unity 网页游戏。',url:'/works/wanyan/',ready:'runtime_ready'},
  {id:'tasay',name:'过拟合恋人',description:'一段逐渐偏离预期的恋爱与 Meta 恐怖体验。',url:'/works/tasay/',ready:'page_opened'},
]);
export const ACTIVITY_PHASES = Object.freeze([
  {id:'explore',label:'自由探索',guidance:'自由探索校园，靠近光柱进入作品。'},
  {id:'gather',label:'集合',guidance:'请留意主持人通知，前往指定集合地点。'},
  {id:'film',label:'短片',guidance:'请看向现场主屏幕，一起观看短片。'},
  {id:'share',label:'分享',guidance:'请听主持人引导，分享你的体验。'},
]);
export function activityPortals(){
  const positions=[[561.85,-337.92],[449.91,-119.96],[58.19,17.55]];
  return ACTIVITY_WORKS.map((work,i)=>({id:`point-${work.id}`,workId:work.id,label:work.name,description:work.description,url:work.url,x:positions[i][0],z:positions[i][1],radius:16,enabled:true,startAt:null,endAt:null}));
}
