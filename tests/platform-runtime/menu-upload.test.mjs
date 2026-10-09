import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMenuUploadLayout,menuUploadGeometry} from '../../platform/runtime/menu-chat/rich-menu-upload-layout.mjs';
import {initializeMenuUpload,menuUploadEntryFromLocation} from '../../platform/runtime/menu-upload/menu-upload.js';
const endpoint='/api/line/webhook/menu-upload/page',run='11111111-1111-4111-8111-111111111111',entry={lineAccountId:'lineacct_fixture',menuRun:run};
test('LIFF initialization uses the target endpoint, keeps credentials in memory, and rejects an unrelated endpoint',async()=>{
 const location={origin:'https://taiwan-startup-park.fangwl591021.workers.dev',pathname:endpoint,search:'?'+new URLSearchParams({...entry,menuUpload:'1'}).toString()},requests=[];
 const sdk={id:'123456-fixture',async init(){},isLoggedIn(){return true;},getAccessToken(){return 'fixture-only-token';}};
 const bootstrap={success:true,config:{liffId:sdk.id,status:'NOT_RUNTIME_VERIFIED',endpointPath:endpoint}};
 const options={entry,location,apiBase:'',storage:null,loadSdk:async()=>sdk,fetcher:async(url)=>{requests.push(url);return Response.json(bootstrap);}};
 const result=await initializeMenuUpload(options);assert.equal(result.status,'ready');assert.equal(result.token,'fixture-only-token');assert(requests[0].startsWith('/api/line/webhook/menu-upload/bootstrap?'));assert(!requests[0].includes('fixture-only-token'));
 assert.equal(menuUploadEntryFromLocation(location,null).menuRun,run);
 await assert.rejects(initializeMenuUpload({...options,location:{...location,pathname:'/platform/'}}),e=>e.code==='MENU_UPLOAD_LINK_INVALID');
});
test('edited upload geometry preserves the original action, label and ID and rejects action injection, duplicate keys or unknown areas',()=>{
 const action={type:'message',text:'原功能'},snapshot={config:{size:{width:2500,height:1686},areas:[{bounds:{x:0,y:0,width:2500,height:1686},action}]},areas:[{id:'area_original',label:'原標籤',x:0,y:0,width:2500,height:1686}]};
 const input={version:1,width:2500,height:1686,areas:[{id:'area_original',x:30,y:20,width:2400,height:1600}]},layout=parseMenuUploadLayout(JSON.stringify(input),snapshot);
 const result=menuUploadGeometry(snapshot,{width:2500,height:1686},layout);assert.equal(result.mapped[0].id,'area_original');assert.equal(result.mapped[0].label,'原標籤');assert.equal(result.lineAreas[0].action,action);assert.equal(result.lineAreas[0].x,30);
 assert.throws(()=>parseMenuUploadLayout(JSON.stringify({...input,areas:[{...input.areas[0],action:{type:'uri',uri:'https://example.invalid'}}]}),snapshot));
 assert.throws(()=>parseMenuUploadLayout(JSON.stringify({...input,areas:[{...input.areas[0],id:'other'}]}),snapshot));
 assert.throws(()=>parseMenuUploadLayout(JSON.stringify(input).replace('"version":1','"version":1,"version":1'),snapshot));
 assert.throws(()=>menuUploadGeometry(snapshot,{width:2500,height:843},layout));
});
