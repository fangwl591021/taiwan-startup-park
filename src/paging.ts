import type {Env} from './types.js';
import {stmt,fail} from './shared.js';
type Query={select:string;from:string;where:string;args:unknown[];time:string;id:string;timeKey:string};
export async function listPage(env:Env,url:URL,q:Query){
 const raw=url.searchParams.get('limit')||'50';
 if(!/^\d{1,3}$/.test(raw)||Number(raw)<1||Number(raw)>100)fail(400,'每頁筆數須為 1 至 100');
 const limit=Number(raw),cursor=url.searchParams.get('cursor');let values:string[]=[];
 if(cursor){
  try{if(cursor.length>512||!/^[A-Za-z0-9+/]+=*$/.test(cursor))throw Error();
   const value=JSON.parse(atob(cursor));
   if(!Array.isArray(value)||value.length!==2||value.some(v=>typeof v!=='string'||!v||v.length>200))throw Error();
   values=value;
  }catch{fail(400,'分頁位置無效');}
 }
 const seek=values.length?' AND ('+q.time+'<? OR ('+q.time+'=? AND '+q.id+'<?))':'';
 const result=await env.DB.batch([
  stmt(env,'SELECT '+q.select+' FROM '+q.from+' WHERE '+q.where+seek+' ORDER BY '+q.time+' DESC,'+q.id+' DESC LIMIT ?',...q.args,...(values.length?[values[0],values[0],values[1]]:[]),limit+1),
  stmt(env,'SELECT COUNT(*) AS total FROM '+q.from+' WHERE '+q.where,...q.args)
 ]);
 const rows=result[0].results,items=rows.slice(0,limit),last=items.at(-1);
 return {items,total:Number(result[1].results[0]?.total||0),limit,has_more:rows.length>limit,next_cursor:rows.length>limit&&last?btoa(JSON.stringify([last[q.timeKey],last.id])):null};
}
