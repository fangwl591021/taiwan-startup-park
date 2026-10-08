// CI screenshots come exclusively from seeded local SQLite/Playwright fixtures.
// Fixed allowlist; no browser cookies, production URLs or credentials are exported.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const names=['desktop-platform-workspaces.png','mobile-platform-workspaces.png','desktop-platform-workspace-detail.png','mobile-platform-workspace-detail.png','desktop-enterprise-workspace.png','mobile-enterprise-workspace.png'];
for(const name of names){
 const bytes=await readFile(new URL('../docs/screenshots/'+name,import.meta.url));
 if(bytes.length>1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Unexpected workspace screenshot: '+name);
 console.log('WORKSPACE_SCREENSHOT '+JSON.stringify({path:'docs/screenshots/'+name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')}));
}
