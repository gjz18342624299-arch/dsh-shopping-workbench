import {assertPublicWebUrl} from './public-web-url.mjs';
import {access,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {connect} from 'node:net';
import {projectRoot} from './live-calendar.mjs';
// 环境变量里挂着代理但代理没开时，Chromium 会报 ERR_PROXY_CONNECTION_FAILED 而 Node 的 fetch 不受影响。
// 启动浏览器前先探测代理端口，连不上就让浏览器直连，采集不再整轮空转。
export async function proxyArgs(env=process.env){
 const raw=env.HTTPS_PROXY||env.https_proxy||env.HTTP_PROXY||env.http_proxy||'';
 if(!raw)return {args:[],note:'未配置系统代理，浏览器直连'};
 let host,port;try{const u=new URL(raw);host=u.hostname;port=Number(u.port)||(u.protocol==='https:'?443:80)}catch{return {args:['--no-proxy-server'],note:'代理地址无法解析，浏览器直连'}}
 const reachable=await new Promise(resolve=>{const s=connect({host,port});const done=v=>{s.destroy();resolve(v)};s.once('connect',()=>done(true));s.once('error',()=>done(false));s.setTimeout(1500,()=>done(false))});
 return reachable?{args:[],note:'浏览器经系统代理 '+host+':'+port}:{args:['--no-proxy-server'],note:'系统代理 '+host+':'+port+' 未开启，浏览器已改为直连'};
}
// An isolated headless renderer owned by this collector. It never attaches to a user's browser.
export async function createPublicRenderer(allow){
 let context;let stopped=false;let network='';
 async function createContext(){
  if(stopped)throw Error('采集器已停止');if(context)return context;
  const {chromium}=await import('playwright-core');
  const proxy=await proxyArgs();network=proxy.note;
  const bases=[process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA].filter(Boolean);
  const candidates=[...bases.map(b=>join(b,'Microsoft/Edge/Application/msedge.exe')),...bases.map(b=>join(b,'Google/Chrome/Application/chrome.exe')),'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/microsoft-edge','/usr/bin/google-chrome','/usr/bin/chromium'];
  let executablePath;for(const path of candidates)try{await access(path);executablePath=path;break}catch{}
  if(!executablePath)throw Error('本机没有找到 Edge 或 Chrome，动态页面无法采集；静态页面仍会读取');
  const profile=join(projectRoot,'work/dsh-collector-browser');await mkdir(profile,{recursive:true});
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-first-run','--disable-sync','--disable-background-networking',...proxy.args]});context=await browser.newContext({acceptDownloads:false,viewport:{width:1280,height:900}});const closeContext=context.close.bind(context);context.close=async()=>{try{await closeContext()}finally{await browser.close()}};return context;
 }
 let contextPromise;
 async function getContext(){if(!contextPromise)contextPromise=createContext().catch(error=>{contextPromise=undefined;throw error});return contextPromise}
 async function fetchPage(url,signal){
  if(!allow(url))throw Error('非公开促销页面');await assertPublicWebUrl(url);const ctx=await getContext();const page=await ctx.newPage();
  const abort=()=>void page.close().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
  try{
   await page.route('**/*',async route=>{const r=route.request();if(/^https?:/.test(r.url()))try{await assertPublicWebUrl(r.url())}catch{return route.abort()};if(r.isNavigationRequest()&&r.frame()===page.mainFrame()&&!allow(r.url()))return route.abort();if(['media','font'].includes(r.resourceType()))return route.abort();return route.continue()});
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});
   // Wait for useful rendered body text rather than treating HTTP 200 or a title as an article.
   await page.waitForFunction(()=>{const t=document.body?.innerText||'';return t.length>300&&/2026|双11|双十一/.test(t)},{},{timeout:12000}).catch(()=>{});
   const text=(await page.locator('body').innerText({timeout:3000})).replace(/\s+/g,' ').trim().slice(0,50000);
   if(text.length<180||/安全验证|验证码|访问异常/.test(text))throw Error('页面正文不足或需要人工验证');
   const links=await page.locator('a[href]').evaluateAll(es=>es.map(e=>({text:e.innerText,url:e.href})).filter(x=>x.text&&x.url.startsWith('https:')).slice(0,150));if(!allow(page.url()))throw Error('页面跳转到未允许位置');return {url:page.url(),text,links:links.filter(x=>allow(x.url))};
  }finally{signal.removeEventListener('abort',abort);await page.close().catch(()=>{})}
 }
 async function close(){stopped=true;await context?.close().catch(()=>{});context=undefined}
 return {fetchPage,close,network:()=>network};
}


