import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' system console: distinct role, operator overview and planning-only OA settings',async({page})=>{
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('platform');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'系統總覽',exact:true})).toBeVisible();await expect(page.locator('.identity')).toContainText('系統總管理員');
  await expect(page.getByRole('button',{name:'工作聊天室',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'成交追蹤',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-system-dashboard.png',fullPage:true});
  async function navigate(label){if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:label,exact:true}).click();}
  await navigate('業者總覽');await expect(page.locator('#content')).toContainText('青禾商務中心');await expect(page.locator('#content')).toContainText('晴川商務中心');
  await page.getByLabel('搜尋業者／OA').fill('晴川');await page.getByRole('button',{name:'搜尋',exact:true}).click();await expect(page.locator('.platform-rows')).not.toContainText('青禾商務中心');
  await navigate('業者 OA 串接總覽');await expect(page.locator('#content')).toContainText('不顯示憑證、客戶身分或聊天內容');
  await navigate('平台 OA 與通知規劃');await expect(page.locator('#content')).toContainText('規劃中 · 尚未串接');
  await page.getByLabel('平台 OA 名稱',{exact:true}).fill('平台服務 OA（'+name+'驗收）');await page.getByLabel('規劃 Provider ID').fill('123');await page.getByLabel('規劃 Channel ID').fill('456');
  await page.getByLabel('使用目的').fill('業者加入與平台服務');await page.getByLabel('業者加入通知草稿').fill('歡迎加入，這是規劃草稿。');await page.getByLabel('平台服務通知草稿').fill('平台服務說明草稿。');
  await page.getByLabel('每月規劃發送上限').fill('');await page.getByLabel('更新依據').fill(name+'虛構規劃驗收');
  expect(await page.getByLabel('每月規劃發送上限').inputValue()).toBe('');await expect(page.locator('#platform-settings-form input[type="password"]')).toHaveCount(0);
  await page.getByRole('button',{name:'保存規劃',exact:true}).click();await expect(page.locator('#toast')).toContainText('尚未串接或發送');
  await page.reload();await expect(page.getByRole('heading',{name:'系統總覽',exact:true})).toBeVisible();await navigate('平台 OA 與通知規劃');await expect(page.getByLabel('平台 OA 名稱',{exact:true})).toHaveValue('平台服務 OA（'+name+'驗收）');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/screenshots/'+name+'-system-oa-planning.png',fullPage:true});
  await navigate('平台費與分潤');await expect(page.locator('#content')).toContainText('空白不代表免費或 0%');
  await navigate('系統操作歷程');await expect(page.locator('#content')).toContainText(name+'虛構規劃驗收');
  await page.getByRole('button',{name:'登出',exact:true}).click();await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();await expect(page.locator('.identity')).toContainText('業者管理員');await expect(page.getByRole('button',{name:'系統總後台 →',exact:true})).toHaveCount(0);
 });
}
test('explicitly authorized creator can switch system/operator workspaces without impersonation',async({page})=>{
 await page.route('**/api/me',async route=>{const response=await route.fetch();const me=await response.json();await route.fulfill({json:{...me,platform_access:true}});});
 await page.route('**/api/platform/overview',route=>route.fulfill({json:{stats:{operators:2,connections:0,receiving:0,verified:0}}}));
 await page.goto('http://127.0.0.1:8789/');await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台'}).click();
 await page.getByRole('button',{name:'系統總後台 →',exact:true}).click();await expect(page.getByRole('heading',{name:'系統總覽',exact:true})).toBeVisible();await expect(page).toHaveURL(/workspace=platform/);
 await page.getByRole('button',{name:'返回業者工作台 →',exact:true}).click();await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();await expect(page).not.toHaveURL(/workspace=platform/);
 await expect(page.locator('.identity')).toContainText('業者管理員');
});
