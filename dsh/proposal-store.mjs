// 0.32.0：AI 修改建议的待确认存储。只存建议，不动清单；24 小时未处理自动过期。
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const PROPOSAL_TTL_MS=24*3600000;
export function createProposalStore(root){
 const file=join(root,'outputs/ai-proposals.json');
 let chain=Promise.resolve();
 async function readRaw(){try{const d=JSON.parse(await readFile(file,'utf8'));return Array.isArray(d.proposals)?d.proposals:[]}catch(e){if(e.code==='ENOENT')return [];throw e}}
 const live=(list,now)=>list.filter(p=>p&&typeof p.id==='string'&&Date.parse(p.expiresAt)>now);
 async function writeRaw(list){await mkdir(join(root,'outputs'),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,proposals:list},null,2),'utf8');await rename(tmp,file)}
 const serial=fn=>{const op=chain.then(fn);chain=op.catch(()=>{});return op};
 return {
  async list(now=Date.now()){return live(await readRaw(),now)},
  add(entries,now=Date.now()){return serial(async()=>{const list=live(await readRaw(),now);const added=[];for(const e of entries){
   // 同一商品只保留最新一条建议
   for(let i=list.length-1;i>=0;i--)if(list[i].itemId===e.itemId)list.splice(i,1);
   const p={...e,id:randomUUID(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+PROPOSAL_TTL_MS).toISOString()};list.push(p);added.push(p)}
   if(list.length>60)list.splice(0,list.length-60);await writeRaw(list);return added})},
  remove(id,now=Date.now()){return serial(async()=>{const list=live(await readRaw(),now);const i=list.findIndex(p=>p.id===id);const [removed]=i>=0?list.splice(i,1):[null];await writeRaw(list);return removed})},
  removeByItem(itemId,now=Date.now()){return serial(async()=>{const list=live(await readRaw(),now);const kept=list.filter(p=>p.itemId!==itemId);if(kept.length!==list.length)await writeRaw(kept);return list.length-kept.length})}
 };
}
