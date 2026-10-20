// Fixed discovery entrances; article contents are fetched and verified separately.
export const sourceHubs=[
 {id:'zdm-selected',name:'值得买优惠精选',platform:'什么值得买',url:'https://www.smzdm.com/jingxuan/',trust:'community',cap:8},
 {id:'zdm-post',name:'值得买社区攻略',platform:'什么值得买',url:'https://post.smzdm.com/',trust:'community',cap:8},
 {id:'zdm-home',name:'值得买首页',platform:'什么值得买',url:'https://www.smzdm.com/',trust:'community',cap:4},
 {id:'jd-home',name:'京东首页会场入口',platform:'京东',url:'https://www.jd.com/',trust:'official',cap:4,render:true},
 {id:'tmall-notices',name:'阿里官方活动公告',platform:'淘宝／天猫',url:'https://www.alibabagroup.com/zh-CN',trust:'official',cap:3,render:true},
 {id:'douyin-school',name:'抖音电商学习中心',platform:'抖音',url:'https://school.jinritemai.com/',trust:'official',cap:3,render:true},
 {id:'pdd-home',name:'拼多多官网（无公开公告页，拼多多以值得买与媒体整理为准）',platform:'拼多多',url:'https://www.pinduoduo.com/',trust:'official',cap:2,render:true}
];
// 需要登录才能看的来源：不再每天去撞登录墙，只保留历史证据，由人手动核对。
export const manualOnlyHost=/(^|\.)(weibo\.com|learn-jdm\.jd\.com|daxue\.taobao\.com|open\.pinduoduo\.com)$/;
export const manualOnly=url=>{try{return manualOnlyHost.test(new URL(url).hostname)}catch{return false}};
export function discoverLinks(hub,page,allow){
 const seen=new Set();return (page.links||[]).filter(l=>{
  if(!allow(l.url)||seen.has(l.url)||!l.text||!(/双\s*(?:11|十一)|大促|领券|消费券|促销|补贴|品类日|品牌日|开门红|预售|秒杀/.test(l.text)))return false;
  const u=new URL(l.url);if(hub.trust==='community'&&(!(u.hostname==='www.smzdm.com'||u.hostname==='post.smzdm.com')||!/^\/p\//.test(u.pathname)))return false;
  seen.add(l.url);return true;
 }).slice(0,hub.cap||3).map(l=>({...hub,id:undefined,name:l.text.slice(0,180),url:l.url}));
}
export function prioritizePlans(plans,existing,limit=24){
 const checked=new Map(existing.map(s=>[s.id,Date.parse(s.checkedAt)||0]));
 const unique=new Map();for(const p of plans){const key=p.platform+'|'+p.url;if(!unique.has(key))unique.set(key,p)}
 return [...unique.values()].sort((a,b)=>(checked.get(a.id)||0)-(checked.get(b.id)||0)).slice(0,limit);
}
