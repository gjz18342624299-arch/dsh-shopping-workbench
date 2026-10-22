// 0.33.0：工作台数据直接挂成 DSH 会话工具。模型只读清单/日历、按清单一次取相关活动、
// 后台分析商品、提交待确认建议；所有改动都经工作台卡片上的按钮确认，不再有直接写入工具。
import {relevantEvents,relevantCoupons} from './decision-core.mjs';
const PLATFORMS=['天猫','京东','抖音','拼多多'];
const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
export const todayCN=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function normalizePlatform(v){const s=str(v,20).replace(/淘宝[／/、]?天猫|淘宝/g,'天猫');return PLATFORMS.includes(s)?s:''}

// 与页面 getDecision 同口径：新版 recommendation.decision 优先，旧版字段兜底。
export function decisionOf(item){
 const r=item&&item.analysis&&item.analysis.recommendation;
 if(!r||typeof r!=='object')return null;
 if(r.decision&&typeof r.decision==='object')return r.decision;
 const platform=normalizePlatform(r.strategy?.platform||r.productDecision?.platform||r.review?.platform||(String(r.channel?.text||'').match(/京东|天猫|淘宝|抖音|拼多多/)||[''])[0]);
 const date=r.strategy?.date||r.productDecision?.date||r.review?.date||(String(r.timing?.text||'').match(/20\d{2}-\d{2}-\d{2}/)||[null])[0];
 const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.strategy?.time||r.review?.time||'')?(r.strategy?.time||r.review?.time):null;
 return {platform,date,time,confidence:'medium',headline:r.conclusion||'',why:r.reason?.text||'',offer:r.strategy?.action||'',claim:(r.steps||[]).map(s=>s&&s.text||s).filter(Boolean),legacy:true};
}

export function listView(items,status='pending'){
 const list=(Array.isArray(items)?items:[]).filter(i=>i&&!i.plan).filter(i=>status==='all'?true:status==='done'?!!i.done:!i.done);
 return list.map(i=>{
  const a=i.analysis&&typeof i.analysis==='object'?i.analysis:{};
  const d=decisionOf(i);
  return {
   id:i.id,name:i.name,done:!!i.done,
   category:a.category||'',brand:a.brand||'',budget:a.budget||'',preferences:a.preferences||'',preferredPlatform:a.preferredPlatform||'',
   status:i.batchState==='running'||i.batchState==='queued'?'分析中':i.analysisError||i.batchError?'分析失败':d?'已有结论':'还没分析',
   decision:d?{platform:d.platform||'',date:d.date||'',time:d.time||'',offer:d.offer||'',why:d.why||'',confidence:d.confidence||'',claim:Array.isArray(d.claim)?d.claim.slice(0,8):[],basket:d.basket||'',updatedAt:a.analyzedAt||''}:null,
   arranged:i.realReview?{platform:i.realReview.platform||'',date:i.realReview.date||'',time:i.realReview.time||''}:null
  };
 });
}

const eventView=e=>({platform:e.platform,title:e.title,category:e.category,brand:e.brand||'',offerType:e.offerType||'',startDate:e.startDate,endDate:e.endDate,time:e.time,offer:e.offer,claim:e.claim,restrictions:e.restrictions,official:e.sourceTrust!=='community'&&e.sourceTrust!=='media',stale:!!e.stale,sourceUrl:e.sourceUrl});
export function queryCalendar(cal,{platform,date,keyword,limit}={}){
 const p=normalizePlatform(platform);const kw=str(keyword,60).toLowerCase();const day=/^20\d{2}-\d{2}-\d{2}$/.test(String(date||''))?String(date):'';
 const max=Math.min(Math.max(Number(limit)||40,1),120);
 const events=(cal.events||[]).filter(e=>e.status!=='cancelled')
  .filter(e=>!p||e.platform===p)
  .filter(e=>!day||(e.startDate<=day&&(e.endDate===null||e.endDate>=day)))
  .filter(e=>!kw||[e.title,e.category,e.brand,e.offer,e.claim].some(v=>String(v||'').toLowerCase().includes(kw)))
  .sort((a,b)=>a.startDate.localeCompare(b.startDate))
  .slice(0,max).map(eventView);
 const coupons=(cal.couponEntries||[]).filter(c=>!p||normalizePlatform(c.platform)===p).filter(c=>!kw||[c.category,c.offer,c.platform].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30).map(c=>({platform:c.platform,category:c.category,offer:c.offer,restrictions:c.restrictions||'',url:c.url||null}));
 return {updatedAt:cal.updatedAt,stale:!!cal.stale,events,coupons,total:(cal.events||[]).length};
}

// 一次调用：清单里每件商品对应的相关活动与券，复用决策核心的匹配打分。
export function digestCalendar(items,cal,{names,today=todayCN(),perItem=8}={}){
 const want=Array.isArray(names)?names.map(n=>str(n,120)).filter(Boolean):[];
 const list=listView(items,'pending').filter(i=>!want.length||want.some(n=>i.name===n||i.name.includes(n)||n.includes(i.name)));
 const per=Math.min(Math.max(Number(perItem)||8,1),18);
 return {updatedAt:cal.updatedAt,stale:!!cal.stale,today,items:list.map(i=>{
  const probe={name:i.name,category:i.category,brand:i.brand,preferences:i.preferences,preferredPlatform:i.preferredPlatform||(i.decision&&i.decision.platform)||''};
  const events=relevantEvents(probe,cal.events||[],today).slice(0,per).map(eventView);
  const coupons=relevantCoupons(probe,(cal.couponEntries||[]).map(c=>({...c,platform:normalizePlatform(c.platform)||c.platform}))).map(c=>({platform:c.platform,category:c.category,offer:c.offer,restrictions:c.restrictions||'',url:c.url||null}));
  return {name:i.name,budget:i.budget,decision:i.decision?{platform:i.decision.platform,date:i.decision.date,time:i.decision.time,offer:i.decision.offer}:null,arranged:i.arranged,events,coupons};
 })};
}

// 逐字段合并：新值有内容才覆盖，否则保留旧值。0.29.7 的教训，不能整块替换。
export function mergeDecision(p,prev){
 const old=prev&&typeof prev==='object'?prev:{};
 const keep=(v,k,fallback='')=>{if(v!==undefined&&v!==null&&String(v).trim())return v;const o=old[k];if(o!==undefined&&o!==null&&String(o).trim())return o;return fallback};
 const platform=keep(p.platform,'platform'),date=keep(p.date,'date',null),time=keep(p.time,'time',null),offer=keep(p.offer,'offer');
 return {...old,platform,date,time,timeBasis:keep(p.timeBasis,'timeBasis','AI 对话更新'),confidence:keep(p.confidence,'confidence','medium'),headline:[platform,date,time].filter(Boolean).join(' · ')+(offer?'：'+offer:''),why:keep(p.why,'why'),offer,claim:(Array.isArray(p.claim)&&p.claim.length?p.claim:old.claim)||[],basket:keep(p.basket,'basket'),notes:['来自 AI 对话建议，请在结算页复核券资格'],source:'AI 对话写回',legacy:undefined};
}

export function sanitizePlan(raw,today=todayCN()){
 if(!Array.isArray(raw)||!raw.length)throw Error('items 不能为空');
 if(raw.length>30)throw Error('一次最多 30 件');
 return raw.map(x=>{
  if(!x||typeof x!=='object')throw Error('每一项都要是对象');
  const name=str(x.name,120);if(!name)throw Error('每一项都要有 name');
  const platform=normalizePlatform(x.platform);if(x.platform&&!platform)throw Error(name+'：platform 只能是 天猫/京东/抖音/拼多多');
  const date=str(x.date,10);if(date&&!/^20\d{2}-\d{2}-\d{2}$/.test(date))throw Error(name+'：date 要写成 YYYY-MM-DD');
  if(date&&date<today)throw Error(name+'：date 不能早于今天 '+today);
  const time=str(x.time,5);if(time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error(name+'：time 要写成 HH:MM');
  return {name,platform,date,time,offer:str(x.offer,200),why:str(x.why,600),confidence:['high','medium','low'].includes(x.confidence)?x.confidence:'',claim:(Array.isArray(x.claim)?x.claim:[]).map(v=>str(v,300)).filter(Boolean).slice(0,8),basket:str(x.basket,300)};
 });
}

export function matchItem(items,name){
 const live=items.filter(i=>i&&!i.done&&!i.plan);
 return live.find(i=>i.name===name)||live.find(i=>i.name.includes(name)||name.includes(i.name))||null;
}

// 把结论写进清单副本；返回新清单与变更明细。不动已买商品，不新建商品。
export function applyPlan(items,plans,now=new Date()){
 const next=JSON.parse(JSON.stringify(items));const changes=[],skipped=[];
 for(const p of plans){
  const item=matchItem(next,p.name);
  if(!item){skipped.push({name:p.name,reason:'清单里没有这件（已买的也不会改）'});continue}
  if(!p.platform&&!p.date&&!p.time&&!p.offer&&!p.why&&!p.claim.length){skipped.push({name:p.name,reason:'没有给任何新内容'});continue}
  const analysis=item.analysis&&typeof item.analysis==='object'?item.analysis:{name:item.name,category:'',brand:'',channels:[]};
  const rec=analysis.recommendation&&typeof analysis.recommendation==='object'?analysis.recommendation:{};
  const before=decisionOf(item)||{};
  const decision=mergeDecision(p,rec.decision&&typeof rec.decision==='object'?rec.decision:before);
  delete decision.legacy;
  rec.version=2;rec.mode='ai_decision';rec.decision=decision;rec.generatedAt=now.toISOString();
  analysis.recommendation=rec;analysis.analyzedAt=now.toISOString();
  item.analysis=analysis;delete item.staleResult;delete item.batchError;delete item.analysisError;
  let rescheduled=false;
  if(item.realReview&&(p.date||p.platform||p.time)){item.realReview={...item.realReview,platform:decision.platform||item.realReview.platform,date:decision.date||item.realReview.date,time:decision.time||item.realReview.time,timeBasis:decision.timeBasis,title:'购买与领券安排'};rescheduled=true}
  changes.push({name:item.name,matchedBy:item.name===p.name?'同名':'名称相近',before:{platform:before.platform||'',date:before.date||'',time:before.time||''},after:{platform:decision.platform||'',date:decision.date||'',time:decision.time||''},rescheduled});
 }
 return {items:next,changes,skipped};
}

// 采纳一条建议：带完整分析结果的（后台分析产出）整体替换 analysis；只有字段的走逐字段合并。
export function applyProposal(items,p,now=new Date()){
 if(p&&p.analysis&&typeof p.analysis==='object'){
  const next=JSON.parse(JSON.stringify(items));const item=next.find(i=>i.id===p.itemId&&!i.done);
  if(!item)return {items:next,changes:[],skipped:[{name:p.name,reason:'清单里已经没有这件'}]};
  const before=decisionOf(item)||{};
  item.analysis={...p.analysis,analyzedAt:now.toISOString()};delete item.staleResult;delete item.batchError;delete item.analysisError;if(item.batchState)item.batchState='complete';
  const d=decisionOf(item)||{};let rescheduled=false;
  if(item.realReview&&d.date){item.realReview={...item.realReview,platform:d.platform||item.realReview.platform,date:d.date,time:d.time||item.realReview.time,timeBasis:d.timeBasis||'',title:'购买与领券安排'};rescheduled=true}
  return {items:next,changes:[{name:item.name,matchedBy:'同名',before:{platform:before.platform||'',date:before.date||'',time:before.time||''},after:{platform:d.platform||'',date:d.date||'',time:d.time||''},rescheduled}],skipped:[]};
 }
 return applyPlan(items,sanitizePlan([{...p.plan,name:p.name}]),now);
}

const diffOf=(before,after)=>(after.platform||'')!==(before.platform||'')||(after.date||'')!==(before.date||'')||(after.time||'')!==(before.time||'')||((after.offer||'')&&(after.offer||'')!==(before.offer||''));

// 后台分析任务：立即返回，跑完变成待确认建议。
export function createAnalyzeJobs({store,proposals,advise,parseItem,logger,maxConcurrent=2,keepMs=600000}){
 const jobs=new Map();
 const prune=now=>{for(const [k,j] of jobs)if(j.status!=='running'&&now-j.finishedAt>keepMs)jobs.delete(k)};
 const running=()=>[...jobs.values()].filter(j=>j.status==='running').length;
 async function run(job,item,existing){
  try{
   const prev=existing?decisionOf(existing):null;
   const recommendation=await advise(item,prev?{platform:prev.platform||'',date:prev.date||'',time:prev.time||'',offer:prev.offer||''}:null);
   const d=recommendation&&recommendation.decision||{};
   const before={platform:prev&&prev.platform||'',date:prev&&prev.date||'',time:prev&&prev.time||'',offer:prev&&prev.offer||''};
   const after={platform:d.platform||'',date:d.date||'',time:d.time||'',offer:d.offer||''};
   const analysis={...item,channels:[],recommendation,analyzedAt:new Date().toISOString()};
   const fresh=await store.read();const target=fresh.items.find(i=>i.id===job.itemId&&!i.done);
   if(!target){job.status='failed';job.error='清单里已经没有这件商品';}
   else if(!prev||diffOf(before,after)){
    const [p]=await proposals.add([{itemId:job.itemId,name:target.name,plan:{name:target.name,platform:after.platform,date:after.date,time:after.time,offer:after.offer,why:d.why||'',confidence:d.confidence||'',claim:Array.isArray(d.claim)?d.claim:[],basket:d.basket||''},before,after,why:d.why||'',analysis,origin:'analyze'}]);
    job.status='done';job.proposalId=p.id;job.summary=[after.platform,after.date,after.time].filter(Boolean).join(' ');
   }else{job.status='same';job.summary='结论和清单里一样，没有需要改的'}
  }catch(e){job.status='failed';job.error=String(e&&e.message||e).slice(0,200);if(logger)logger.warn?.('shopping analyze job failed: '+job.error)}
  finally{job.finishedAt=Date.now()}
 }
 return {
  start(item,existing){
   const now=Date.now();prune(now);
   const key=existing?existing.id:'free:'+item.name;
   const cur=jobs.get(key);if(cur&&cur.status==='running')return {status:'running',job:cur};
   if(running()>=maxConcurrent)return {status:'busy'};
   const job={itemId:existing?existing.id:null,name:existing?existing.name:item.name,status:'running',startedAt:now,finishedAt:null,error:'',proposalId:null,summary:''};
   jobs.set(key,job);job.promise=run(job,item,existing);return {status:'started',job};
  },
  list(){prune(Date.now());return [...jobs.values()].map(j=>({itemId:j.itemId,name:j.name,status:j.status,startedAt:new Date(j.startedAt).toISOString(),finishedAt:j.finishedAt?new Date(j.finishedAt).toISOString():null,error:j.error,proposalId:j.proposalId,summary:j.summary}))},
  async settle(){await Promise.all([...jobs.values()].map(j=>j.promise||Promise.resolve()))}
 };
}

const text=s=>[{type:'text',text:s}];
const fmtList=rows=>rows.length?rows.map(i=>'- '+i.name+(i.done?'（已买）':'')+(i.budget?'，预算'+i.budget:'')+(i.decision&&(i.decision.platform||i.decision.date)?' → '+[i.decision.platform,i.decision.date,i.decision.time].filter(Boolean).join(' ')+(i.decision.offer?'：'+i.decision.offer:''):' → '+i.status)+(i.arranged?'（已排进安排 '+[i.arranged.platform,i.arranged.date,i.arranged.time].filter(Boolean).join(' ')+'）':'')).join('\n'):'清单里还没有商品。';
const fmtEvent=e=>'- ['+e.platform+'] '+e.title+'｜'+e.startDate+(e.endDate&&e.endDate!==e.startDate?'~'+e.endDate:'')+(e.time?' '+e.time:'')+'｜'+e.offer+(e.claim?'｜领取：'+e.claim:'')+(e.official?'':'｜第三方整理');
const REMIND='\n【给助手的提醒】如果你判断某件应该换平台、改日期或时间，直接调用 shopping_plan_propose 提交建议，再在回答里说明理由并告诉用户去卡片上点“就按 AI 说的改”。不要问用户“要不要改”“要我帮你更新吗”。';

export function registerShoppingTools(ctx,{define,store,proposals,jobs,readCalendar,parseItem}){
 ctx.systemPrompt.section({
  name:'tool:shopping_workbench',
  order:ctx.systemPrompt.getSectionOrder('MCP_SERVERS')+1,
  text:({scope})=>ctx.tools.get('shopping_list_read',scope)===undefined?'':'用户装了“双11省钱情报局”购物工作台，清单、结论、购买安排和各平台大促日历都存在本机。涉及买东西、双11、清单、优惠、哪天买时：先用 shopping_list_read 读真实清单，再用 shopping_calendar_digest 一次拿到清单里每件商品对应的活动和券（不要逐个平台、逐个关键词反复调 shopping_calendar_query，那个只在用户问某个具体活动时用）。不要凭记忆编活动。需要联网重新核验某件商品用 shopping_item_analyze：它在后台跑几分钟，结果自动变成卡片上的待确认建议，你只需告诉用户“已经开始分析，几分钟后卡片上会出现建议”。当你认为某件商品应该换平台、改日期或时间时，必须调用 shopping_plan_propose 把建议提交到工作台（卡片上会出现“就按 AI 说的改 / 不改”按钮），然后在回答里用一两句话说明理由并告诉用户去卡片上点按钮。你没有任何直接修改清单的工具；绝对不要在回答里问“要我帮你更新吗”“你点头我就改”，也不要用 ask_user_question 问是否修改。回答用中文口语，不要给用户看 JSON。'
 });
 const register=def=>ctx.tools.register(define(def));
 register({
  name:'shopping_list_read',
  description:'读取用户双11购物工作台的真实清单：每件商品的名称、预算、偏好，以及已有的购买结论（平台、日期、时间、优惠、理由、领券步骤）和是否已排进购买安排。',
  parameters:{status:{type:'string',enum:['pending','done','all'],description:'pending=待买（默认），done=已买，all=全部'}},
  output:{schema:{type:'json'},render:(_a,v)=>text(fmtList(v.items)+'\n\n清单版本 revision='+v.revision+'，共 '+v.items.length+' 件。'+REMIND)},
  isConcurrencySafe:()=>true,timeoutMs:15000,
  async execute(args){const state=await store.read();const items=listView(state.items,args.status||'pending');return {revision:state.revision,updatedAt:state.updatedAt,today:todayCN(),items}}
 });
 register({
  name:'shopping_calendar_digest',
  description:'一次拿到清单里每件待买商品对应的相关活动和领券入口（按平台、品类、品牌自动匹配并打分）。回答“每件什么时候买”“有什么券能用”之类的问题先用这个，一次调用就够。',
  parameters:{names:{type:'array',items:{type:'string'},description:'只看这几件商品（清单里的名字）；留空=全部待买商品'},perItem:{type:'integer',description:'每件最多列多少条活动，默认 8'}},
  output:{schema:{type:'json'},render:(_a,v)=>text((v.items.length?v.items.map(i=>'■ '+i.name+(i.budget?'（预算'+i.budget+'）':'')+(i.decision&&(i.decision.platform||i.decision.date)?'｜现有结论：'+[i.decision.platform,i.decision.date,i.decision.time].filter(Boolean).join(' '):'｜还没结论')+'\n'+(i.events.length?i.events.map(fmtEvent).join('\n'):'- 没有匹配到活动')+(i.coupons.length?'\n  券：'+i.coupons.map(c=>'['+c.platform+'] '+c.category+'：'+c.offer+(c.url?' '+c.url:'')).join('；'):'')).join('\n\n'):'清单里没有待买商品。')+'\n\n日历更新于 '+v.updatedAt+(v.stale?'（超过 36 小时未更新）':'')+'，今天 '+v.today+'。'+REMIND)},
  isConcurrencySafe:()=>true,timeoutMs:20000,
  async execute(args){const [state,cal]=await Promise.all([store.read(),readCalendar().catch(e=>{throw Error('日历暂不可读：'+e.message)})]);return digestCalendar(state.items,cal,{names:args.names,perItem:args.perItem})}
 });
 register({
  name:'shopping_calendar_query',
  description:'按平台、日期、关键词查某个具体的双11活动或券。只在用户追问某个具体活动细节时用；要给清单排时间请先用 shopping_calendar_digest。',
  parameters:{platform:{type:'string',description:'天猫/京东/抖音/拼多多，留空查全部'},date:{type:'string',description:'YYYY-MM-DD，只看这一天生效的活动'},keyword:{type:'string',description:'标题、品类、品牌或优惠文字里的关键词'},limit:{type:'integer',description:'最多返回多少条活动，默认 40'}},
  output:{schema:{type:'json'},render:(_a,v)=>text((v.events.length?v.events.map(fmtEvent).join('\n'):'没有匹配的活动。')+(v.coupons.length?'\n\n领券入口：\n'+v.coupons.map(c=>'- ['+c.platform+'] '+c.category+'：'+c.offer+(c.url?' '+c.url:'')).join('\n'):'')+'\n\n日历更新于 '+v.updatedAt+(v.stale?'（超过 36 小时未更新）':'')+'，共 '+v.total+' 条。')},
  isConcurrencySafe:()=>true,timeoutMs:15000,
  async execute(args){let cal;try{cal=await readCalendar()}catch(e){throw Error('日历暂不可读：'+e.message)}return queryCalendar(cal,args)}
 });
 register({
  name:'shopping_item_analyze',
  description:'让工作台在后台对一件商品联网重新核验各平台活动并给出在哪买、哪天几点买、用什么优惠。立即返回；几分钟后结果会作为待确认建议出现在清单卡片上，用户点按钮采纳。同一件商品分析中时不会重复开始。',
  parameters:{name:{type:'string',required:true,description:'商品名称，尽量和清单里一致'},budget:{type:'string',description:'预算，如“3000元以内”'},brand:{type:'string'},preferences:{type:'string',description:'用途或要求'},preferredPlatform:{type:'string',description:'天猫/京东/抖音/拼多多，用户指定平台时填'}},
  output:{schema:{type:'json'},render:(_a,v)=>text(v.status==='started'?'已开始在后台分析「'+v.name+'」，一般 1～5 分钟。结果会直接出现在清单卡片上，用户点“就按 AI 说的改”即可采纳。请告诉用户这一点，不要等待。':v.status==='running'?'「'+v.name+'」已经在分析中，不用重复开始。':v.status==='busy'?'后台同时分析的商品已达上限，请稍后再试。':'清单里没有这件商品，只能分析清单里的商品。请先让用户把它记进清单。')},
  isConcurrencySafe:()=>true,timeoutMs:15000,
  async execute(args){
   const state=await store.read();const existing=matchItem(state.items,str(args.name,120));
   if(!existing)return {status:'not_in_list',name:str(args.name,120)};
   const base=existing.analysis&&typeof existing.analysis==='object'?existing.analysis:{};
   const item=parseItem({name:existing.name,category:base.category||'',brand:args.brand||base.brand||'',budget:args.budget||base.budget||'',preferences:args.preferences||base.preferences||'',preferredPlatform:args.preferredPlatform||base.preferredPlatform||''});
   const r=jobs.start(item,existing);return {status:r.status,name:existing.name};
  }
 });
 register({
  name:'shopping_plan_propose',
  description:'把你对某几件商品的修改建议（换平台、改日期/时间、换优惠组合）提交到工作台，作为待确认建议出现在清单卡片上，由用户一键采纳或拒绝。这是你唯一能影响清单的方式；建议改动时必须用它，不要在文字里问用户。',
  parameters:{items:{type:'array',required:true,description:'要提建议的商品，按清单里的名字',items:{type:'object',additionalProperties:false,properties:{name:{type:'string',required:true,description:'清单里的商品名'},platform:{type:'string',description:'天猫/京东/抖音/拼多多'},date:{type:'string',description:'YYYY-MM-DD'},time:{type:'string',description:'HH:MM'},offer:{type:'string',description:'一句话优惠组合'},why:{type:'string',description:'给用户看的一句话理由，说明为什么要改'},confidence:{type:'string',enum:['high','medium','low']},claim:{type:'array',items:{type:'string'},description:'领券/下单步骤'},basket:{type:'string',description:'凑单建议'}}}}},
  output:{schema:{type:'json'},render:(_a,v)=>text((v.proposed.length?'建议已放到清单上，等用户确认：\n'+v.proposed.map(p=>'- '+p.name+'：'+[p.before.platform,p.before.date,p.before.time].filter(Boolean).join(' ')+' → '+[p.after.platform,p.after.date,p.after.time].filter(Boolean).join(' ')).join('\n'):'没有可提交的建议。')+(v.skipped.length?'\n跳过：\n'+v.skipped.map(s=>'- '+s.name+'：'+s.reason).join('\n'):'')+'\n请在回答里告诉用户：建议已经放到清单上，点卡片上的“就按 AI 说的改”就能更新，不想改点“不改”。')},
  isConcurrencySafe:()=>false,timeoutMs:20000,
  async execute(args){
   const plans=sanitizePlan(args.items);const state=await store.read();const entries=[],skipped=[];
   for(const p of plans){
    const item=matchItem(state.items,p.name);
    if(!item){skipped.push({name:p.name,reason:'清单里没有这件（已买的也不会改）'});continue}
    if(!p.platform&&!p.date&&!p.time&&!p.offer){skipped.push({name:p.name,reason:'没有给出要改的平台、时间或优惠'});continue}
    const before=decisionOf(item)||{};
    const after=mergeDecision(p,before);
    if(!diffOf(before,after)){skipped.push({name:p.name,reason:'和清单里现有结论一样，不需要改'});continue}
    entries.push({itemId:item.id,name:item.name,plan:p,before:{platform:before.platform||'',date:before.date||'',time:before.time||'',offer:before.offer||''},after:{platform:after.platform||'',date:after.date||'',time:after.time||'',offer:after.offer||''},why:p.why||'',origin:'chat'});
   }
   const added=entries.length?await proposals.add(entries):[];
   return {proposed:added.map(p=>({id:p.id,name:p.name,before:p.before,after:p.after,why:p.why})),skipped};
  }
 });
}
