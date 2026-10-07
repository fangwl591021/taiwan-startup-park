import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' system LINE Login settings use Login credentials and callback, not OA token or webhook',async({page})=>{
  // Local fixture has no real encryption key. Expose the enabled input to verify
  // failure clears it, then save non-secret draft through the real local API.
  await page.route('**/api/platform/line-login',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const response=await route.fetch();if(!response.ok())return route.fulfill({response});
   const d=await response.json();return route.fulfill({json:{...d,storage_ready:true,callback_url:'https://taiwan-startup-park.fangwl591021.workers.dev/api/auth/line/callback'}});
  });
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');await page.getByLabel('示範身分').selectOption('platform');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'系統總覽',exact:true})).toBeVisible();
  if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:'LINE Login 登入設定',exact:true}).click();
  await expect(page.getByRole('heading',{name:'LINE Login 登入 API',exact:true})).toBeVisible();
  const id=page.getByLabel('LINE Login Channel ID（client_id）',{exact:true}),secret=page.getByLabel('LINE Login Channel secret（client_secret）',{exact:true});
  await id.fill('1234567890');await page.getByLabel('LINE Login Provider ID（選填）').fill('123456789');
  await expect(secret).toHaveAttribute('type','password');await expect(page.getByLabel('預定 Callback URL（redirect_uri）')).toHaveAttribute('readonly','');
  await expect(page.getByLabel('規劃登入權限（scope）')).toHaveValue('openid profile');
  await expect(page.locator('#platform-login-form input[name="channel_access_token"]')).toHaveCount(0);
  await page.getByLabel('設定／更新依據').fill(name+'虛構 Login 規劃');await secret.fill('a'.repeat(32));await page.getByRole('button',{name:'保存 LINE Login 設定',exact:true}).click();
  await expect(page.locator('.form-error')).toContainText('不保存真實登入密鑰');await expect(secret).toHaveValue('');
  await page.getByRole('button',{name:'保存 LINE Login 設定',exact:true}).click();await expect(page.locator('#toast')).toContainText('登入流程尚未啟用');
  await expect(page.getByLabel('LINE Login Channel ID（client_id）')).toHaveValue('1234567890');await expect(page.locator('#content')).toContainText('尚未經 OAuth 流程驗證');
  await expect(page.getByRole('button',{name:'使用 LINE 登入',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/screenshots/'+name+'-line-login-settings.png',fullPage:true});
 });
}
