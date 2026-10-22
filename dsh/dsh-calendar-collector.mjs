import {isPublicWebUrl,assertPublicWebUrl} from './public-web-url.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot,dataPath,commitCalendar,validateCalendar,knownHost,redirectHostRe} from './live-calendar.mjs';
import {sourceHubs,discoverLinks,prioritizePlans,manualOnly} from './promotion-discovery.mjs';
import {createPublicRenderer,proxyArgs} from './dsh-calendar-browser.mjs';

// 把采集失败的原始错误翻译成用户能看懂的一句话；界面上按这句话归类统计。
export function describeFailure(msg){const m=String(msg||'');
 if(/ERR_PROXY_CONNECTION_FAILED/.test(m))return '系统代理未开启，浏览器打不开页面';
 if(/DSH搜索不可用/.test(m))return 'DSH 联网搜索不可用';
 if(/ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_CONNECTION|ECONNREFUSED|ETIMEDOUT|timeout|Timeout|超时|无法访问/i.test(m))return '网站连不上或超时';
 if(/登录|验证|人工|正文不足|动态渲染|未取得完整正文/.test(m))return '页面要登录或人机验证，读不到正文';
 if(/JSON|模型没有返回|模型输出|max-tokens/.test(m))return '模型没有返回完整结果';
 if(/未核验到当年活动/.test(m))return '正文里没有今年的活动信息';
 if(/45分钟|上限/.test(m))return '本批超过时间上限';
 return m.slice(0,80)}
export const dayCN=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function due(settings,state,now=new Date()){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now));if(!settings.enabled||hour<settings.hour)return false;if(state.lastAttemptDay!==dayCN(now))return true;
 // 当天已跑过但一个来源都没读通（通常是网络或代理没开），每 2 小时再试一次，最多 3 次。
 const verified=Number(state.added?.verified||0);const retries=Number(state.retries||0);
 return ['partial','failed','interrupted'].includes(state.phase)&&verified===0&&retries<3&&!!state.lastFinishedAt&&(now.getTime()-Date.parse(state.lastFinishedAt))>=2*3600*1000}
export function htmlText(raw){return String(raw).replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,50000)}
const discover=[
 ['淘宝／天猫','天猫双11 活动时间表 预售 现货 开卖时间 官方 玩法'],
 ['淘宝／天猫','天猫双11 品类券 满减 88VIP 消费券 领取时间 规则'],
 ['京东','京东双11 活动节奏 时间表 跨店满减 惊喜日 官方'],
 ['京东','京东双11 品类日 家电 数码 服饰 补贴 券 时间'],
 ['抖音','抖音双11好物节 活动时间 玩法 消费券 直降 官方'],
 ['拼多多','拼多多双11 百亿补贴 活动时间 玩法 规则'],
 ['什么值得买','site:smzdm.com 双11 攻略 日历 品类券 领券 时间表'],
 ['李佳琦','李佳琦 双11 直播间 排期 预告 清单'],
 ['东方甄选','东方甄选 与辉同行 双11 直播 预告 排期'],
 ['交个朋友','交个朋友 直播间 双11 排期 预告 品牌专场']
];
const hostTrust=url=>{try{const h=new URL(url).hostname;return /(^|\.)smzdm\.com$/.test(h)?'community':/(^|\.)(taobao\.com|tmall\.com|alibabagroup\.com|alimama\.com|jd\.com|jinritemai\.com|douyin\.com|pinduoduo\.com|yangkeduo\.com|weibo\.com)$/.test(h)?'official':'media'}catch{return 'media'}};
const webHosts=['alibabagroup.com','taobao.com','tmall.com','jd.com','jinritemai.com','pinduoduo.com','yangkeduo.com','weibo.com','sina.cn','meione.com','alimama.com','ithome.com','xinhuanet.com','sina.com.cn','smzdm.com','douyin.com'];
export const allowedUrl=isPublicWebUrl;
// 平台自己的域名：只有落在这些域名上的链接才能当作领券地址。
export const platformHosts={'淘宝／天猫':/(^|\.)(taobao\.com|tmall\.com|tb\.cn|alipay\.com)$/,'天猫':/(^|\.)(taobao\.com|tmall\.com|tb\.cn|alipay\.com)$/,'京东':/(^|\.)(jd\.com|jd\.hk|3\.cn)$/,'抖音':/(^|\.)(douyin\.com|jinritemai\.com)$/,'拼多多':/(^|\.)(pinduoduo\.com|yangkeduo\.com)$/};
export function isPlatformHost(url,platform){try{const h=new URL(url).hostname;return !!(platformHosts[platform]||platformHosts[String(platform).replace(/淘宝[／/]?天猫|淘宝/,'淘宝／天猫')])?.test(h)}catch{return false}}
export async function classifyClaimLink(url,platform,signal){
 let current=url;const hops=[];
 for(let hop=0;hop<6;hop++){
  if(isPlatformHost(current,platform))return {verified:true,final:current,note:'落地在平台域名',hops};
  if(!allowedUrl(current))return {verified:false,final:current,note:'跳转到非公开地址',hops};
  let res;try{await assertPublicWebUrl(current);res=await fetch(current,{redirect:'manual',signal,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130','Accept':'text/html,*/*'}})}catch(e){return {verified:false,final:current,note:'无法访问：'+String(e.message).slice(0,60),hops}}
  hops.push(res.status);
  if(res.status>=300&&res.status<400){const loc=res.headers.get('location');if(!loc)return {verified:false,final:current,note:'跳转缺少地址',hops};current=new URL(loc,current).href;continue}
  let body='';try{body=(await res.text()).slice(0,100000)}catch{}
  const meta=body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i)||body.match(/location\.(?:href|replace)\s*[=(]\s*["'](https?:[^"']+)["']/i);
  if(res.ok&&meta){current=new URL(meta[1].replace(/&amp;/g,'&'),current).href;continue}
  return {verified:false,kind:redirectHostRe.test(new URL(current).hostname)?'redirect':'none',final:current,note:res.ok?(redirectHostRe.test(new URL(current).hostname)?'可信跳转页，需真人通过验证后落到平台':'落地页不在平台域名（'+new URL(current).hostname+'）'):'HTTP '+res.status,hops};
 }
 return {verified:false,final:current,note:'跳转次数过多',hops};
}
async function readJson(path,fallback){try{return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
async function saveJson(path,data){const tmp=path+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2)+'\n');await rename(tmp,path)}
export async function publicPage(url,signal){
 if(!allowedUrl(url))throw Error('来源不在允许范围');
 let current=url;
 for(let hop=0;hop<4;hop++){
  if(!allowedUrl(current))throw Error('跳转到未允许的域名');
  await assertPublicWebUrl(current);
  const response=await fetch(current,{redirect:'manual',signal,headers:{Accept:'text/html,application/json,text/plain','User-Agent':'DSH-Shopping-Calendar/0.3 (public promotion reader)'}});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw Error('跳转地址缺失');current=new URL(location,current).href;continue}
  if(!response.ok)throw Error('官方页面HTTP '+response.status);
  if(!/text\/|json|xml/i.test(response.headers.get('content-type')||''))throw Error('该来源是图片或非文本，需要浏览器采集能力');
  let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('页面超过采集大小上限');chunks.push(Buffer.from(chunk))}
  const html=Buffer.concat(chunks).toString('utf8');const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].slice(0,400).map(m=>{try{return {url:new URL(m[1].replace(/&amp;/g,'&'),current).href,text:htmlText(m[2])}}catch{return {url:''}}}).filter(l=>allowedUrl(l.url));return {url:current,text:htmlText(html),links};
 }throw Error('官方页面跳转次数过多');
}
export function createCollector({extract,search,fetchPage=publicPage,now=()=>new Date(),storageRoot=projectRoot,loadData=()=>readJson(dataPath,null),commitData=commitCalendar,rendererFactory=()=>createPublicRenderer(allowedUrl)}){
 const statePath=join(storageRoot,'outputs/calendar-collector-state.json'),configPath=join(storageRoot,'outputs/calendar-collector-settings.json');
 let running=false,activeController,settings={enabled:true,hour:9},state={running:false,phase:'idle',lastAttemptDay:null,lastStartedAt:null,lastFinishedAt:null,checked:0,total:0,failures:[],notice:'DSH运行时每天北京时间09:00采集，每次最多读 12 个来源、45 分钟；当日错过则启动后补采；一个来源都没读通时每 2 小时重试，最多 3 次。'};
 const persist=()=>saveJson(statePath,{...state,running});
 async function init(){await mkdir(join(storageRoot,'outputs'),{recursive:true});settings=await readJson(configPath,settings);state={...state,...await readJson(statePath,{}),running:false};if(state.phase==='running'){state.phase='interrupted';state.lastAttemptDay=null;}return status()}
 function status(){return {...state,running,settings,engine:'DSH后台采集；不依赖Codex',sourceHubs,collectionLimits:{articlesPerRun:12,linksPerHub:3,maxMinutes:45},modelUsage:'正文结构化使用DSH当前默认模型；可能产生该模型的调用费用'};}
 async function configure(input){if(typeof input.enabled!=='boolean'||!Number.isInteger(input.hour)||input.hour<0||input.hour>23)throw Error('调度设置无效');settings={enabled:input.enabled,hour:input.hour};await saveJson(configPath,settings);return status()}
 async function run(reason='manual'){
  if(running)return status();running=true;const started=now();const retries=reason==='daily'&&state.lastAttemptDay===dayCN(started)?Number(state.retries||0)+1:0;state={...state,retries,phase:'running',lastAttemptDay:dayCN(started),lastStartedAt:started.toISOString(),lastFinishedAt:null,checked:0,total:0,failures:[],reason,summary:'',added:null,network:''};await persist();
  const controller=new AbortController();activeController=controller;const timeout=setTimeout(()=>controller.abort(),45*60*1000);let renderer;let before={events:0,coupons:0};let queue=[];let discoveryFailed=0;
  try{
   try{state.network=(await proxyArgs()).note}catch{}
   renderer=await rendererFactory();
   const candidate=validateCalendar(await loadData());const batch=structuredClone(candidate);before={events:batch.events.length,coupons:(batch.couponEntries||[]).length};let skippedManual=0;for(const src of batch.sources)if(manualOnly(src.url)&&src.status!=='historical'){skippedManual++;if(!/需登录/.test(src.note||''))src.note='需登录才能查看，已停止每日自动访问，可手动核对：'+(src.note||'')}state.skippedManual=skippedManual;const plans=batch.sources.filter(s=>s.status!=='historical'&&!manualOnly(s.url)).map(s=>({id:s.id,platform:s.platform,name:s.name,url:s.url,trust:s.trust||'official'}));
   if(search)for(const [platform,query] of discover){if(controller.signal.aborted)break;try{const result=await search(`${started.getFullYear()} ${query}`,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));for(const hit of (result.sources||[]).slice(0,2)){const url=hit.url;if(allowedUrl(url)&&knownHost(url)&&!plans.some(p=>p.url===url))plans.push({id:'discover-'+createHash('sha256').update(url).digest('hex').slice(0,14),platform,name:hit.title||'活动新公告',url,trust:hostTrust(url)})}}catch{discoveryFailed++;if(!state.failures.some(f=>f.stage==='discovery'))state.failures.push({platform:'全部',stage:'discovery',error:'DSH搜索不可用，仍检查固定来源',reason:'DSH 联网搜索不可用'})}}
   state.hubs=[];const pageCache=new Map();
   const readPage=async(url,render=false)=>{if(pageCache.has(url))return pageCache.get(url);let page={text:''};if(!render)try{page=await fetchPage(url,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]))}catch{page={text:''}};if(page.text.length<300)page=await renderer.fetchPage(url,AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]));pageCache.set(url,page);return page};
   for(const hub of sourceHubs){if(controller.signal.aborted)break;try{const page=await readPage(hub.url,!!hub.render);const links=discoverLinks(hub,page,allowedUrl).filter(l=>!manualOnly(l.url));for(const link of links)plans.push({...link,id:'hub-'+createHash('sha256').update(link.platform+'|'+link.url).digest('hex').slice(0,14)});state.hubs.push({...hub,status:page.text.length>=300?'read':'insufficient',discovered:links.length,checkedAt:now().toISOString()})}catch(e){state.hubs.push({...hub,status:'blocked',discovered:0,error:String(e.message).slice(0,100),checkedAt:now().toISOString()})}await persist()}
   queue=prioritizePlans(plans,batch.sources,12);state.total=queue.length;state.deferred=Math.max(0,plans.length-queue.length);await persist();
   for(const plan of queue){
    if(controller.signal.aborted)throw Error('本批采集达到45分钟上限');
    const checkedAt=now().toISOString();let source=batch.sources.find(s=>s.id===plan.id);
    if(!source){source={...plan,evidence:'',checkedAt,status:'not_found',note:''};batch.sources.push(source)}
    try{
     const page=await readPage(plan.url);
     // 登录墙判定只看短页面：值得买等正常文章页的导航栏里也有“验证码”“登录”字样，正文超过 2500 字就当作读到了。
     if(page.text.length<300||page.text.length<2500&&/passport\.weibo|扫码登录|访问异常|安全验证|验证码|enable JavaScript|^Loading\.\.\.$/i.test(page.text))throw Error('页面需要登录、动态渲染或人工验证，未取得完整正文');
     const raw=await extract({platform:plan.platform,url:plan.url,text:page.text.slice(0,22000),links:(page.links||[]).slice(0,120),trust:plan.trust,year:started.getFullYear()},AbortSignal.any([controller.signal,AbortSignal.timeout(170000)]));
     if(!raw||(plan.trust==='community'?raw.community!==true:plan.trust==='media'?raw.media!==true:raw.official!==true)||raw.currentYear!==true||!Array.isArray(raw.events))throw Error('未核验到当年活动正文');
     const normTime=t=>{if(t===null||t===undefined||t==='')return null;const s=String(t).trim();let m=s.match(/^([01]?\d|2[0-3])[:：]([0-5]\d)/);if(m)return m[1].padStart(2,'0')+':'+m[2];m=s.match(/^(?:晚上?|晚间|下午)?\s*(\d{1,2})\s*点(?:(\d{2})分?)?/);if(m){let h=Number(m[1]);if(/晚|下午/.test(s)&&h<12)h+=12;if(h<24)return String(h).padStart(2,'0')+':'+(m[2]||'00')}return null};
     const proposed=raw.events.slice(0,30).map(e=>({...e,time:normTime(e.time),endDate:e.endDate&&/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate))?e.endDate:null,id:typeof e.id==='string'?e.id:'event-'+createHash('sha256').update([plan.id,e.title,e.startDate,e.time].join('|')).digest('hex').slice(0,18),platform:plan.platform,sourceId:plan.id,verifiedAt:checkedAt,status:e.status==='cancelled'?'cancelled':'active'}));
     const next=structuredClone(batch);
     if(Array.isArray(raw.coupons))for(const coupon of raw.coupons.slice(0,30)){
      if(!(page.links||[]).some(l=>l.url===coupon.url)||!allowedUrl(coupon.url)||!coupon.category||!coupon.offer||!coupon.evidenceQuote||!page.text.replace(/\s/g,'').includes(coupon.evidenceQuote.replace(/\s/g,'')))continue;
      const platform=['淘宝／天猫','京东','抖音','拼多多'].includes(coupon.platform)?coupon.platform:plan.platform;
      // 只有最终落在平台自己域名上的链接才作为“去领券”入口；跳转页、推广页、文章页一律不当作领券地址。
      const link=await classifyClaimLink(coupon.url,platform,AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]));
      const record={id:'coupon-'+createHash('sha256').update(plan.id+'|'+coupon.url+'|'+coupon.category).digest('hex').slice(0,16),sourceId:plan.id,platform,category:String(coupon.category).slice(0,200),offer:String(coupon.offer).slice(0,1000),rawUrl:coupon.url,url:link.verified?link.final:link.kind==='redirect'?coupon.url:null,linkKind:link.verified?'platform':link.kind==='redirect'?'redirect':'none',linkNote:link.note,restrictions:String(coupon.restrictions||'适用条件待落地页核对').slice(0,2000),checkedAt,trust:plan.trust||'official',sourceUrl:plan.url,evidenceQuote:coupon.evidenceQuote};
      next.couponEntries||=[];const index=next.couponEntries.findIndex(c=>c.sourceId===plan.id&&(c.rawUrl||c.url)===record.rawUrl&&c.category===record.category);if(index>=0)next.couponEntries[index]=record;else next.couponEntries.push(record);
     }
     Object.assign(next.sources.find(s=>s.id===plan.id),{status:'verified',checkedAt,links:page.links||[],evidence:page.text,note:proposed.length?'已读取公开正文并解析':'已读正文，暂无可确定日期的活动'});
     for(const event of proposed){const old=next.events.findIndex(e=>e.sourceId===event.sourceId&&e.title===event.title&&e.startDate===event.startDate);if(old>=0)next.events[old]={...event,id:next.events[old].id,needsRecheck:false};else next.events.push(event)}
     // Keep the evidence for old events absent from the current page, without renewing their verification time.
     const nextSource=next.sources.find(s=>s.id===plan.id);const missing=next.events.filter(e=>e.sourceId===plan.id&&!nextSource.evidence.replace(/\s/g,'').includes(e.evidenceQuote.replace(/\s/g,'')));
     for(const oldEvent of missing)oldEvent.needsRecheck=true;
     if(missing.length)nextSource.evidence+='\n[历史核验片段，未在本次重读确认]\n'+missing.map(e=>e.evidenceQuote).join('\n');
     validateCalendar(next);Object.assign(batch,next);
     await mkdir(join(storageRoot,'logs/calendar-evidence'),{recursive:true});await writeFile(join(storageRoot,'logs/calendar-evidence',dayCN(started)+'-'+plan.id+'.json'),JSON.stringify({url:plan.url,checkedAt,text:page.text},null,2));
    }catch(error){source=batch.sources.find(s=>s.id===plan.id);Object.assign(source,{status:'blocked',checkedAt,note:String(error.message).slice(0,180),reason:describeFailure(error.message)});state.failures.push({platform:plan.platform,sourceId:plan.id,stage:'read_or_extract',error:source.note,reason:source.reason})}
    state.checked++;await persist();
   }
   batch.updatedAt=now().toISOString();const result=await commitData(batch);state.phase=state.failures.length?'partial':'completed';state.result=result;state.lastFinishedAt=now().toISOString();
   state.added={events:batch.events.length-before.events,coupons:(batch.couponEntries||[]).length-before.coupons,verified:queue.filter(p=>batch.sources.find(s=>s.id===p.id)?.status==='verified').length};
  }catch(error){state.phase='failed';state.lastFinishedAt=now().toISOString();state.failures.push({stage:'batch',error:String(error.message).slice(0,200),reason:describeFailure(error.message)})}
  finally{clearTimeout(timeout);if(renderer?.network?.())state.network=renderer.network();await renderer?.close();activeController=undefined;running=false;state.summary=summarize(state,queue.length,discoveryFailed);await persist()}
  return status();
 }
 // 一句人话说明这一轮到底拿到了什么：读通几个来源、新增几条、受阻原因各几个。
 function summarize(s,total,discoveryFailed){
  const a=s.added||{events:0,coupons:0,verified:0};
  const parts=[s.phase==='failed'?'本轮采集失败':`本轮读通 ${a.verified}/${total} 个来源，新增 ${a.events} 条活动、${a.coupons} 条券`];
  if(s.phase!=='failed'&&a.events===0&&a.coupons===0)parts.push('没有拿到任何新信息');
  const reasons={};for(const f of s.failures)if(f.stage!=='discovery'){const k=f.reason||describeFailure(f.error);reasons[k]=(reasons[k]||0)+1}
  if(Object.keys(reasons).length)parts.push('受阻原因：'+Object.entries(reasons).map(([k,v])=>k+' '+v+' 个').join('，'));
  if(discoveryFailed>=discover.length/2)parts.push('DSH 联网搜索整轮不可用，没有发现新来源');
  if(s.skippedManual)parts.push(s.skippedManual+' 个需登录来源已停止自动访问');if(s.phase!=='failed'&&a.verified===0&&Number(s.retries||0)<3)parts.push('看起来网络没通，2 小时后会自动再试');if(s.network)parts.push(s.network);
  return parts.join('；');
 }
 async function tick(){if(!running&&due(settings,state,now()))return run('daily');return status()}
 return {init,status,configure,run,tick,stop(){activeController?.abort()}};
}

