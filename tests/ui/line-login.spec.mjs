import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' unified LINE account: correct channel fields, masked secrets, save and copy URLs',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.route('**/api/platform/line-account',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const response=await route.fetch();if(!response.ok())return route.fulfill({response});
   const d=await response.json();return route.fulfill({json:{...d,storage_ready:true}});
  });
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');await page.getByLabel('示範身分').selectOption('platform');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'系統總覽',exact:true})).toBeVisible();
  if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:'LINE 帳號設定',exact:true}).click();
  await expect(page.getByRole('heading',{name:'平台 LINE 帳號設定',exact:true})).toBeVisible();
  await page.getByLabel('LINE 官方帳號名稱',{exact:true}).fill('台灣創業園（'+name+'虛構）');await page.getByLabel('官方帳號 ID（@帳號）',{exact:true}).fill('@startup_test');
  await page.getByLabel('LINE 登入頻道編號（Channel ID）',{exact:true}).fill('1234567890');await page.getByLabel('LINE 訊息頻道編號（Messaging API Channel ID）',{exact:true}).fill('9876543210');
  await expect(page.locator('#platform-line-form input[type="password"]')).toHaveCount(3);
  const secret=page.getByLabel('LINE 登入頻道密鑰（Channel Secret）',{exact:true});await expect(secret).toHaveAttribute('type','password');
  await expect(page.getByLabel('LINE 訊息接收網址（Webhook）',{exact:true})).toHaveAttribute('readonly','');await expect(page.getByLabel('LINE 登入回呼網址（Callback URL）',{exact:true})).toHaveAttribute('readonly','');
  await page.getByLabel('設定／更新依據',{exact:true}).fill(name+'整合帳號驗收');await secret.fill('A'.repeat(32));await page.getByRole('button',{name:'儲存 LINE 設定',exact:true}).click();
  await expect(page.locator('.form-error')).toContainText('不保存真實憑證');await expect(secret).toHaveValue('');
  await page.getByRole('button',{name:'儲存 LINE 設定',exact:true}).click();await expect(page.locator('#toast')).toContainText('LINE 設定已保存');
  await expect(page.getByLabel('LINE 登入頻道編號（Channel ID）',{exact:true})).toHaveValue('1234567890');await expect(page.getByLabel('LINE 訊息頻道編號（Messaging API Channel ID）',{exact:true})).toHaveValue('9876543210');
  await expect(page.locator('.line-field-title .badge')).toHaveText(['○ 尚未設定','○ 尚未設定','○ 尚未設定']);
  await page.getByRole('button',{name:'複製LINE 訊息接收網址（Webhook）',exact:true}).click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(await page.getByLabel('LINE 訊息接收網址（Webhook）',{exact:true}).inputValue());
  await page.reload();await expect(page.getByRole('heading',{name:'系統總覽',exact:true})).toBeVisible();if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:'LINE 帳號設定',exact:true}).click();
  await expect(page.getByLabel('官方帳號 ID（@帳號）',{exact:true})).toHaveValue('@startup_test');await expect(page.locator('.line-config-status')).toContainText('平台 Webhook 待設定');
  const field=page.locator('.line-field');const first=await field.nth(0).boundingBox(),second=await field.nth(1).boundingBox();expect(width>900?Math.abs(first.y-second.y)<2:second.y>first.y).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/screenshots/'+name+'-line-account-settings.png',fullPage:true});
  await page.route('**/api/platform/line-account',async route=>{const response=await route.fetch();if(!response.ok())return route.fulfill({response});const d=await response.json();return route.fulfill({json:{...d,webhook_enabled:true,last_webhook_at:'2026-10-07T09:00:00.000Z'}});});
  await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(page.locator('.line-config-status')).toContainText('平台 Webhook 已驗簽接收');
  await page.screenshot({path:'docs/screenshots/'+name+'-platform-webhook-verified.png',fullPage:true});
  if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:'平台 OA 來訊',exact:true}).click();
  await expect(page.getByRole('heading',{name:'平台 OA 最新 50 筆事件',exact:true})).toBeVisible();await expect(page.locator('#content')).toContainText('尚無平台來訊');
  await page.route('**/api/platform/line-events',route=>route.fulfill({json:{items:[{event_id:'test-event',kind:'message',source_type:'user',body:'<img src=x onerror="alert(1)"> 客戶詢問借址方案',event_at:1791363600000,received_at:'2026-10-07T09:00:00Z',removed:0}],push_enabled:false}}));
  await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(page.locator('.platform-rows')).toContainText('<img src=x');await expect(page.locator('.platform-rows img')).toHaveCount(0);
  await expect(page.locator('#content')).toContainText('各業者的客戶與聊天仍在各業者工作台');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-platform-oa-inbox.png',fullPage:true});

 });
}
