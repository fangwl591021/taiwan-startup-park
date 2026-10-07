import type {Env} from './types.js';
import {stmt,fail} from './shared.js';
export type LineSecret={channelSecret?:string;channelAccessToken?:string};
const enc=new TextEncoder();
function keyBytes(env:Env){
 try{const value=env.LINE_CREDENTIALS_KEY||'';if(!/^[A-Za-z0-9+/]{43}=$/.test(value))return null;const raw=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return raw.length===32?raw:null;}catch{return null;}
}
export const credentialStorageReady=(env:Env)=>!!keyBytes(env);
const context=(operator:string,id:string)=>enc.encode('tsp-line-credentials-v1|'+operator+'|'+id);
export async function encryptLineSecret(env:Env,operator:string,id:string,data:LineSecret){
 const raw=keyBytes(env);if(!raw)fail(503,'安全憑證保存尚未就緒，請聯絡系統總管理員');
 const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const value=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(operator,id)},key,enc.encode(JSON.stringify(data)));
 return JSON.stringify({v:1,iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...new Uint8Array(value)))});
}
export async function lineSecret(env:Env,id:string):Promise<LineSecret>{
 const record=await stmt(env,'SELECT operator_id,encrypted_value FROM line_connection_secrets WHERE connection_id=?',id).first<{operator_id:string;encrypted_value:string}>();
 if(record){
  try{
   const raw=keyBytes(env);if(!raw)return {};
   const value=JSON.parse(record.encrypted_value);
   if(value.v!==1||typeof value.iv!=='string'||typeof value.data!=='string')return {};
   const iv=Uint8Array.from(atob(value.iv),c=>c.charCodeAt(0));if(iv.length!==12)return {};
   const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
   const text=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:context(record.operator_id,id)},key,Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)));
   const data=JSON.parse(new TextDecoder().decode(text));
   return typeof data.channelSecret==='string'&&typeof data.channelAccessToken==='string'?{channelSecret:data.channelSecret,channelAccessToken:data.channelAccessToken}:{};
  }catch{return {};} // Never fall back to a stale plaintext secret after an encrypted record exists.
 }
 try{const raw=JSON.parse(env.LINE_CHANNELS_JSON||'{}'),v=raw[id];return v&&typeof v==='object'?{channelSecret:v.channelSecret,channelAccessToken:v.channelAccessToken}:{};}catch{return {};}
}
/** Separate AAD namespace lets Login settings share the storage key without
 * sharing an OA channel, credentials table or identity. Fail closed. */
export async function decryptStoredSecret(env:Env,operator:string,id:string,encrypted:string):Promise<LineSecret>{
 try{
  const raw=keyBytes(env);if(!raw)return {};
  const value=JSON.parse(encrypted);if(value.v!==1||typeof value.iv!=='string'||typeof value.data!=='string')return {};
  const iv=Uint8Array.from(atob(value.iv),c=>c.charCodeAt(0));if(iv.length!==12)return {};
  const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  const text=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:context(operator,id)},key,Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)));
  const data=JSON.parse(new TextDecoder().decode(text));
  return typeof data.channelSecret==='string'?{channelSecret:data.channelSecret}:{};
 }catch{return {};}
}
