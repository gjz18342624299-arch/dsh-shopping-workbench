// Fixed discovery entrances; article contents are fetched and verified separately.
export const sourceHubs=[
 {id:'zdm-home',name:'值得买首页',platform:'什么值得买',url:'https://www.smzdm.com/',trust:'community'},
 {id:'zdm-selected',name:'值得买优惠精选',platform:'什么值得买',url:'https://www.smzdm.com/jingxuan/',trust:'community'},
 {id:'tmall-notices',name:'阿里官方活动公告',platform:'淘宝／天猫',url:'https://www.alibabagroup.com/zh-CN',trust:'official'},
 {id:'jd-notices',name:'京东官方帮助中心',platform:'京东',url:'https://helpcenter.jd.com/',trust:'official'},
 {id:'douyin-school',name:'抖音电商学习中心',platform:'抖音',url:'https://school.jinritemai.com/',trust:'official'},
 {id:'pdd-home',name:'拼多多官网',platform:'拼多多',url:'https://www.pinduoduo.com/',trust:'official'}
];
export function discoverLinks(hub,page,allow){
 const seen=new Set();return (page.links||[]).filter(l=>{
  if(!allow(l.url)||seen.has(l.url)||!l.text||!(/双\s*(?:11|十一)|大促|领券|消费券|促销|补贴|品类日|品牌日|开门红|预售|秒杀/.test(l.text)))return false;
  const u=new URL(l.url);if(hub.trust==='community'&&(!(u.hostname==='www.smzdm.com'||u.hostname==='post.smzdm.com')||!/^\/p\//.test(u.pathname)))return false;
  seen.add(l.url);return true;
 }).slice(0,3).map(l=>({...hub,id:undefined,name:l.text.slice(0,180),url:l.url}));
}
export function prioritizePlans(plans,existing,limit=24){
 const checked=new Map(existing.map(s=>[s.id,Date.parse(s.checkedAt)||0]));
 const unique=new Map();for(const p of plans){const key=p.platform+'|'+p.url;if(!unique.has(key))unique.set(key,p)}
 return [...unique.values()].sort((a,b)=>(checked.get(a.id)||0)-(checked.get(b.id)||0)).slice(0,limit);
}
