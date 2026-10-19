// 购买建议入口：保留 createAdvisor(ctx) 的签名，内部改用一次调用的决策核心。
import {decide} from './decision-core.mjs';
import {readCalendar} from './live-calendar.mjs';
import {publicPage,dayCN} from './dsh-calendar-collector.mjs';
import {readChannelRules} from './channel-policy.mjs';

export function createAdvisor(ctx,{loadCalendar=readCalendar,readPage=publicPage,today=dayCN}={}){
 return async function advise(item,previous=null){
  let calendar;try{calendar=await loadCalendar()}catch{calendar={sources:[],events:[],couponEntries:[]}}
  let rules={};try{rules=await readChannelRules()}catch{}
  return decide(ctx,item,{calendar,today:today(),rules,readPage,previous});
 };
}
