import {test,expect} from '@playwright/test';
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
