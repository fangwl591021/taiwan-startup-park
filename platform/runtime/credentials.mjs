import {encryptLineSecret,decryptStoredSecret} from '../../dist/line-credentials.js';
const fields=['line_login_channel_secret','line_bot_channel_secret','line_bot_channel_access_token'];
export function credentialDatabase(db,env,operatorId,workspaceId){
 async function row(r){if(!r||typeof r!=='object')return r;const result={...r};for(const field of fields)if(result[field]){
  if(result.workspace_id&&result.workspace_id!==workspaceId)throw new Error('CREDENTIAL_SCOPE_DENIED');
  const v=await decryptStoredSecret(env,'__platform_runtime__:'+operatorId,workspaceId+':'+field,result[field]);result[field]=v.channelSecret||null;
 }return result;}
 function prepare(sql,args=[]){const raw=db.prepare(sql).bind(...args);return{
  bind(...values){return prepare(sql,values);},async first(column){const value=await raw.first(column);return row(value);},
  async all(){const d=await raw.all();return{...d,results:await Promise.all((d.results||[]).map(row))};},
  run(){return raw.run();},raw
 };}
 return{prepare,batch(statements){return db.batch(statements.map(s=>s.raw||s));}};
}
export async function encryptAccountBody(req,env,operatorId,workspaceId){
 if(!req.headers.get('content-type')?.includes('application/json'))throw Object.assign(new Error('請使用 JSON'),{status:415});
 const text=await req.text();if(text.length>16000)throw Object.assign(new Error('內容過長'),{status:413});
 const body=JSON.parse(text);
 if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('設定格式錯誤'),{status:400});
 const keys={lineLoginChannelSecret:'line_login_channel_secret',lineBotChannelSecret:'line_bot_channel_secret',lineBotChannelAccessToken:'line_bot_channel_access_token'};
 for(const [key,field]of Object.entries(keys))if(body[key])body[key]=await encryptLineSecret(env,'__platform_runtime__:'+operatorId,workspaceId+':'+field,{channelSecret:String(body[key])});
 // Saved credentials are configuration, never proof of a live connection.
 body.status='disconnected';body.webhookEnabled=false;
 return JSON.stringify(body);
}
