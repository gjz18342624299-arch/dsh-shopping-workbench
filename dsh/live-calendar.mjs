import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// 数据目录由宿主通过 cordis.patch.yml 的 dshHomePath() 注入；服务端 apply() 启动时调用 setDataRoot()。
export let projectRoot='';
export let dataPath='';
export function setDataRoot(root){if(typeof root!=='string'||!root.trim())throw Error('工作台数据目录未配置');projectRoot=root;dataPath=join(root,'outputs/marketing-calendar.json');return root}
const platformHostRe={'淘宝／天猫':/(^|\.)(taobao\.com|tmall\.com|tb\.cn|alipay\.com)$/,'京东':/(^|\.)(jd\.com|jd\.hk|3\.cn)$/,'抖音':/(^|\.)(douyin\.com|jinritemai\.com)$/,'拼多多':/(^|\.)(pinduoduo\.com|yangkeduo\.com)$/};
// 可信跳转器：值得买等站点的推广跳转页，脚本或滑块验证后才落到平台，自动核验不了，但对真人可用；保留并如实标注。
export const redirectHostRe=/(^|\.)(go\.smzdm\.com|s\.click\.taobao\.com|uland\.taobao\.com|m\.tb\.cn|u\.jd\.com|jingfen\.jd\.com|3\.cn|v\.douyin\.com|mobile\.yangkeduo\.com)$/;
export const knownHost=url=>{try{const u=new URL(url);return u.protocol==='https:'&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch{return false}};
// 读出时统一整理券条目：平台域名链接为 platform；可信跳转页为 redirect（保留）；文章、新闻页不当作领券地址。
export function sanitizeCoupon(c){let url=c.url||null;let kind=c.linkKind;if(kind!=='platform'&&kind!=='redirect'){let h='';try{h=new URL(url||'').hostname}catch{}kind=(platformHostRe[c.platform]||/$^/).test(h)?'platform':redirectHostRe.test(h)?'redirect':'none';if(kind==='none')url=null}return {...c,rawUrl:c.rawUrl||c.url||null,url,linkKind:url?kind:'none'}}
const platforms=new Set(['淘宝／天猫','京东','抖音','拼多多','李佳琦','东方甄选','交个朋友','与辉同行']);
const requiredPlatforms=[...platforms];platforms.add('什么值得买');
const hosts=['alibabagroup.com','taobao.com','tmall.com','jd.com','jinritemai.com','douyin.com','pinduoduo.com','yangkeduo.com','weibo.com','sina.cn','meione.com','alimama.com','ithome.com','xinhuanet.com','sina.com.cn','smzdm.com','ebrun.com','36kr.com','sohu.com','163.com','thepaper.cn','qq.com','cnbeta.com.tw','zol.com.cn','pconline.com.cn'];
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T00:00:00+08:00'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const timestamp=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&!isNaN(Date.parse(s))&&Date.parse(s)<=Date.now()+300000;
 const str=(s,max=4000)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const official=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false}};
const norm=s=>s.replace(/\s+/g,'').normalize('NFKC');
export function validateCalendar(data){
 if(data?.version!==1||data.timezone!=='Asia/Shanghai'||!timestamp(data.updatedAt)||!Array.isArray(data.sources)||!Array.isArray(data.events)||data.sources.length>300||data.events.length>3000)throw Error('日历结构或更新时间无效');
 const sources=new Map();
 for(const s of data.sources){if(!str(s.id,100)||sources.has(s.id)||!platforms.has(s.platform)||!str(s.name,200)||!official(s.url)||!timestamp(s.checkedAt)||!['verified','blocked','not_found','historical'].includes(s.status)||typeof s.evidence!=='string'||s.evidence.length>50000)throw Error('来源字段无效：'+s.id);if(new URL(s.url).hostname.endsWith('smzdm.com')&&s.trust!=='community')throw Error('值得买来源必须标记第三方整理');if(s.status==='verified'&&s.evidence.length<12)throw Error('官方来源缺少正文证据');sources.set(s.id,s)}
 const ids=new Set();
 for(const e of data.events){const s=sources.get(e.sourceId);if(!str(e.id,120)||ids.has(e.id)||!s||!platforms.has(e.platform)||e.platform!==s.platform||!str(e.title,200)||!str(e.category,200)||!date(e.startDate)||(e.endDate!==null&&(!date(e.endDate)||e.endDate<e.startDate))||!timestamp(e.verifiedAt)||!['active','cancelled'].includes(e.status)||!str(e.evidenceQuote,8000)||!norm(s.evidence).includes(norm(e.evidenceQuote)))throw Error('活动字段或正文证据无效：'+e.id);if(e.time!==null&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.time))throw Error('活动时刻无效');for(const key of ['offer','claim','restrictions'])if(!str(e[key],3000))throw Error('缺少活动字段：'+key);ids.add(e.id)}
 for(const p of requiredPlatforms)if(!data.sources.some(s=>s.platform===p))throw Error('缺少平台覆盖状态：'+p);
 return data;
}
export function viewCalendar(data,now=new Date()){
 validateCalendar(data);return {...data,stale:now-Date.parse(data.updatedAt)>36*3600000,sources:data.sources.map(s=>({...s,stale:now-Date.parse(s.checkedAt)>36*3600000})),couponEntries:(data.couponEntries||[]).map(sanitizeCoupon),events:data.events.map(e=>({...e,sourceUrl:data.sources.find(s=>s.id===e.sourceId).url,sourceTrust:data.sources.find(s=>s.id===e.sourceId).trust||'official',stale:!!e.needsRecheck||now-Date.parse(e.verifiedAt)>36*3600000||data.sources.find(s=>s.id===e.sourceId).status!=='verified'}))};
}
export async function readCalendar(){const raw=await readFile(dataPath,'utf8');if(Buffer.byteLength(raw)>8*1024*1024)throw Error('日历数据过大');return viewCalendar(JSON.parse(raw.replace(/^\uFEFF/,'')))}
export async function commitCalendar(candidate){
 validateCalendar(candidate);const lockPath=join(projectRoot,'work/marketing-calendar.lock');let lock;try{lock=await open(lockPath,'wx')}catch{throw Error('另一批更新正在提交，请稍后重试')}
 const tmp=dataPath+'.'+process.pid+'.tmp';
 try{let previous;try{previous=JSON.parse((await readFile(dataPath,'utf8')).replace(/^\uFEFF/,''));validateCalendar(previous)}catch(e){if(e.code!=='ENOENT')throw e}
 if(previous){if(Date.parse(candidate.updatedAt)<Date.parse(previous.updatedAt))throw Error('拒绝旧批次覆盖新批次');const candidateIds=new Set(candidate.events.map(e=>e.id));for(const e of previous.events)if(!candidateIds.has(e.id))throw Error('不能静默删除旧活动，请保留并按官方证据标记cancelled');await mkdir(join(projectRoot,'logs/calendar-history'),{recursive:true});await writeFile(join(projectRoot,'logs/calendar-history',Date.now()+'-'+process.pid+'.json'),JSON.stringify(previous,null,2))}
 await mkdir(dirname(dataPath),{recursive:true});await writeFile(tmp,JSON.stringify(candidate,null,2)+'\n','utf8');validateCalendar(JSON.parse(await readFile(tmp,'utf8')));await rename(tmp,dataPath);
 const digest=createHash('sha256').update(JSON.stringify(candidate.events)).digest('hex');await writeFile(join(projectRoot,'logs/marketing-calendar-last-run.json'),JSON.stringify({updatedAt:candidate.updatedAt,events:candidate.events.length,coverage:candidate.sources.map(s=>({platform:s.platform,status:s.status,checkedAt:s.checkedAt})),digest},null,2));return {events:candidate.events.length,sources:candidate.sources.length,digest};
 }finally{await unlink(tmp).catch(()=>{});await lock.close();await unlink(lockPath)}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 if(!projectRoot)setDataRoot(process.env.DSH_SHOPPING_ROOT||process.cwd());
 try{if(process.argv[2]==='commit'){const p=process.argv[3];if(!p)throw Error('请提供候选JSON路径');console.log(JSON.stringify(await commitCalendar(JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,'')))))}else{const d=await readCalendar();console.log(JSON.stringify({events:d.events.length,sources:d.sources.length,updatedAt:d.updatedAt,stale:d.stale,coverage:d.sources.map(s=>({platform:s.platform,status:s.status}))},null,2))}}catch(e){console.error(e.message);process.exitCode=1}
}

