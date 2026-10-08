import{readFile,stat}from'node:fs/promises';import{createHash}from'node:crypto';
for(const path of ['desktop-full-platform.png','desktop-full-platform-crm.png','desktop-full-platform-commerce.png','mobile-full-platform.png','mobile-full-platform-sites.png']){
 const file='docs/screenshots/'+path,bytes=await readFile(file);if(bytes.length>1000000)throw new Error('Unexpected fixture screenshot size');console.log('PLATFORM_RUNTIME_SCREENSHOT '+JSON.stringify({path:file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')}));
}
