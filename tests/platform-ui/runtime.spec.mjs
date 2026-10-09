import {test,expect} from '@playwright/test';
import {deflateSync} from 'node:zlib';
async function login(page,id='owner-a'){const r=await page.request.post('/api/demo/login',{data:{user_id:id},headers:{origin:'http://127.0.0.1:8791','X-Requested-With':'tsp'}});expect(r.status()).toBe(200);}
test('desktop complete source workspace, collapsible navigation and real empty counts',async({page})=>{
 await login(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/platform/?workspace=pw-op-op-a');
 await expect(page.getByRole('heading',{name:'企業數位營運工作區'})).toBeVisible();
 await expect(page.getByText('商城訂單',{exact:true})).toBeVisible();
 await expect(page.locator('body')).not.toContainText('正常連線中');
 for(const label of ['圖文選單專案','模板中心','CRM 客戶管理','行銷活動','商城','旅遊管理','AI 用量','LINE OA 設定','品牌設定'])await expect(page.locator('nav').getByRole('button',{name:label,exact:true})).toBeVisible();
 await page.screenshot({path:'docs/screenshots/desktop-full-platform.png',fullPage:true});
 await page.getByRole('button',{name:'收合或展開工作區選單'}).click();await expect(page.locator('aside')).not.toBeVisible();await page.getByRole('button',{name:'收合或展開工作區選單'}).click();
 await page.locator('nav').getByRole('button',{name:'CRM 客戶管理',exact:true}).click();await expect(page.locator('main')).toContainText('CRM');await page.screenshot({path:'docs/screenshots/desktop-full-platform-crm.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'商城',exact:true}).click();await expect(page.locator('main')).toContainText('商品');await page.screenshot({path:'docs/screenshots/desktop-full-platform-commerce.png',fullPage:true});
});
test('menu chat is reachable on a phone, saves scoped UID grants and offers a return control',async({page})=>{
 await login(page);await page.setViewportSize({width:390,height:844});await page.goto('/platform/?workspace=pw-op-op-a');
 await page.getByRole('button',{name:'收合或展開工作區選單'}).click();await page.locator('nav').getByRole('button',{name:'聊天室修改選單',exact:true}).click();
 await expect(page.getByRole('heading',{name:'聊天室修改選單',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'返回工作區',exact:true}).first()).toBeVisible();
 await page.getByLabel('選單管理員 LINE UID').fill('U'+'d'.repeat(32));await page.getByLabel('選單管理員辨識名稱').fill('虛構測試管理員');await page.getByRole('button',{name:'新增授權'}).click();
 await expect(page.getByText('虛構測試管理員',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/mobile-menu-chat.png',fullPage:true});
 await page.getByRole('button',{name:'停用授權',exact:true}).click();await expect(page.getByRole('button',{name:'重新授權',exact:true})).toBeVisible();
});
test('public upload preserves original bytes, supports coordinate edits and shows success without a push',async({page})=>{
 const account='lineacct_fixture',run='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';let posted=null;
 const crc=data=>{let c=0xffffffff;for(const v of data){c^=v;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),out.length-4);return out;};const h=Buffer.alloc(13);h.writeUInt32BE(2500);h.writeUInt32BE(1686,4);h[8]=8;h[9]=6;const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(1686*(2500*4+1)))),chunk('IEND',Buffer.alloc(0))]);
 await page.addInitScript(()=>{window.liff={id:'123456-fixture',async init(){},isLoggedIn(){return true;},getAccessToken(){return 'fixture-only';},isInClient(){return false;}};});
 await page.route('**/api/line/webhook/menu-upload/**',async route=>{const path=new URL(route.request().url()).pathname;let body;
  if(path.endsWith('/bootstrap'))body={success:true,config:{liffId:'123456-fixture',endpointPath:'/api/line/webhook/menu-upload/page',status:'NOT_RUNTIME_VERIFIED'}};
  else if(path.endsWith('/session'))body={success:true,projectName:'虛構上傳選單',originalWidth:2500,originalHeight:1686,areaCount:1,expiresAt:Date.now()+300000,status:'upload',areaEditVersion:1,areas:[{id:'area-fixture',label:'原按鈕',x:0,y:0,width:2500,height:1686}]};
  else if(path.endsWith('/image')){posted=route.request();body={success:true,jobId:job,phase:'checking'};}
  else if(path.includes('/jobs/'))body={success:true,jobId:job,phase:'succeeded',notificationStatus:'suppressed'};
  else return route.continue();return route.fulfill({json:body,status:path.endsWith('/image')?202:200});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/api/line/webhook/menu-upload/page?'+new URLSearchParams({lineAccountId:account,menuRun:run,menuUpload:'1'}));
 await expect(page.getByText('虛構上傳選單',{exact:true})).toBeVisible();await page.getByLabel('選擇 JPG／PNG 原圖').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
 await expect(page.getByRole('button',{name:'上傳並部署',exact:true})).toBeEnabled();await page.getByRole('button',{name:'上傳並部署',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('圖片已更新並部署');expect(posted.postDataBuffer().equals(png)).toBe(true);expect(JSON.parse(posted.headers()['x-menu-upload-layout']).areas[0].id).toBe('area-fixture');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/screenshots/mobile-menu-upload.png',fullPage:true});await expect(page.getByRole('button',{name:'返回聊天室',exact:true})).toBeVisible();
});
test('mobile drawer, large dark labels, no horizontal overflow, website draft confirmation',async({page})=>{
 await login(page);await page.setViewportSize({width:390,height:844});await page.goto('/platform/?workspace=pw-op-op-a');
 await expect(page.getByRole('heading',{name:'企業數位營運工作區'})).toBeVisible();await expect(page.locator('aside')).not.toBeVisible();
 await page.screenshot({path:'docs/screenshots/mobile-full-platform.png',fullPage:true});
 await page.getByRole('button',{name:'收合或展開工作區選單'}).click();await page.locator('nav').getByRole('button',{name:'官網素材與草稿',exact:true}).click();
 await expect(page.locator('aside')).not.toBeVisible();await page.getByLabel('網站名稱').fill('虛構企業教學用官網');await page.getByLabel('已確認的公司介紹').fill('純測試素材，無真實客戶資料。');await page.getByLabel('社群網址（每行一個 https 網址）').fill('https://example.com/fictional');
 await page.getByRole('button',{name:'生成網站草稿',exact:true}).click();await expect(page.getByRole('heading',{name:'虛構企業教學用官網 · 私有預覽'})).toBeVisible();
 await page.getByRole('button',{name:'確認第 1 版內容'}).click();await expect(page.locator('body')).toContainText('第 2 版 · 已確認');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/mobile-full-platform-sites.png',fullPage:true});
});
test('sales cannot open owner digital workspace or force another operator by URL',async({page})=>{
 await login(page,'sales-a3');await page.goto('/platform/?workspace=pw-op-op-a');await expect(page.getByRole('heading',{name:'數位工作區尚無可用身分'})).toBeVisible();
 const r=await page.request.get('/api/platform-runtime/pw-op-op-b/api/projects');expect(r.status()).toBe(404);
 await expect(page.locator('body')).not.toContainText('聊天室 AI 監控');
});

test('all source modules can be opened on a phone without document overflow',async({page})=>{
 await login(page);await page.setViewportSize({width:390,height:844});await page.goto('/platform/?workspace=pw-op-op-a');
 await expect(page.getByRole('heading',{name:'企業數位營運工作區'})).toBeVisible();
 for(const label of ['圖文選單專案','模板中心','CRM 客戶管理','行銷活動','商城','旅遊管理','AI 用量','LINE OA 設定','品牌設定']){
  await page.getByRole('button',{name:'收合或展開工作區選單'}).click();await page.locator('nav').getByRole('button',{name:label,exact:true}).click();await expect(page.locator('aside')).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label).toBe(true);
 }
});
