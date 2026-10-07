import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' owner OA settings: clear entry, protected credentials, webhook proof and receive-only controls',async({page})=>{
  let state={storage_ready:true,simulation:false,push_enabled:false,mail_push_enabled:false,note:'設定只開放接收；郵件推播維持未啟用。',connections:[]},saved;
  const requests=[];
  // Fake OA credentials exist only in this UI test. Backend tests verify real
  // encryption, HMAC reception, owner/operator scope and no message sending.
  await page.route('**/api/line/settings**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()!=='GET'){
    const d=req.postDataJSON();requests.push({path,data:d});
    if(req.method()==='POST'&&path.endsWith('/settings')){
     saved={id:'ui-oa',name:d.name,provider_id:d.provider_id,channel_id:d.channel_id,version:1,enabled:true,signature_configured:true,token_configured:true,verified_at:'2026-10-07T02:30:00Z',last_webhook_at:null,webhook_url:'https://taiwan-startup-park.fangwl591021.workers.dev/api/line/webhook/ui-oa'};
     state.connections=[saved];
    }else if(path.endsWith('/status')){saved.enabled=d.enabled;saved.version++;}
    else if(req.method()==='PATCH'){saved.name=d.name;saved.version++;}
    else if(path.endsWith('/check'))saved.version++;
   }
   return route.fulfill({json:state});
  });
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();
  await page.getByRole('button',{name:'LINE OA 串接',exact:true}).click();
  await expect(page.getByRole('heading',{name:'業者 LINE OA 串接設定',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'＋ 新增業者 OA',exact:true}).click();
  const dialog=page.getByRole('dialog');await page.getByLabel('OA 名稱',{exact:true}).fill('台灣創業園收件服務（驗收示範）');
  await page.getByLabel('Provider ID',{exact:true}).fill('123456789');await page.getByLabel('Channel ID',{exact:true}).fill('1234567890');
  await page.getByLabel('Channel secret',{exact:true}).fill('a'.repeat(32));await page.getByLabel('長期 Channel access token',{exact:true}).fill('t'.repeat(80));
  await expect(page.getByLabel('Channel secret',{exact:true})).toHaveAttribute('type','password');
  await page.getByLabel('設定／更新依據').fill('由業者管理員核對授權（虛構驗收）');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-line-oa-settings-form.png',fullPage:true});
  await page.getByRole('button',{name:'驗證並保存 OA 設定',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('.line-settings-row')).toContainText('Webhook 尚待確認');await expect(page.locator('.line-settings-row')).toContainText('推播未啟用');
  await expect(page.locator('.webhook-field input')).toHaveValue(/api\/line\/webhook\/ui-oa/);
  expect(await page.locator('#content').textContent()).not.toContain('t'.repeat(80));
  await page.getByRole('button',{name:'確認憑證連線',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(2);await expect(page.locator('.line-settings-row')).toContainText('Webhook 尚待確認');
  saved.last_webhook_at='2026-10-07T02:35:00Z';await page.getByRole('button',{name:'重新整理設定',exact:true}).click();
  await expect(page.locator('.line-settings-row')).toContainText('已驗簽接收');
  await page.screenshot({path:'docs/screenshots/'+name+'-line-oa-settings-webhook.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'編輯設定／更換憑證',exact:true}).click();
  await expect(page.getByLabel('新 Channel secret（留空沿用）')).toHaveValue('');
  await expect(page.getByLabel('新長期 Channel access token（留空沿用）')).toHaveValue('');
  await page.getByLabel('OA 名稱',{exact:true}).fill('企業收件專用 OA（驗收示範）');await page.getByLabel('設定／更新依據').fill('更新名稱驗收');
  await page.getByRole('button',{name:'驗證並保存 OA 設定',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect(requests[2].data).not.toHaveProperty('channel_secret');expect(requests[2].data).not.toHaveProperty('channel_access_token');
  await page.getByRole('button',{name:'停用接收',exact:true}).click();await page.getByLabel('操作依據').fill('停用驗收');
  await page.getByRole('button',{name:'確認接收開關',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('.line-settings-row')).toContainText('接收停用');
  state={...state,storage_ready:false,simulation:true};await page.getByRole('button',{name:'重新整理設定',exact:true}).click();
  await expect(page.getByRole('button',{name:'＋ 新增業者 OA',exact:true})).toBeDisabled();
  await expect(page.locator('#content')).toContainText('不接受真實 LINE 憑證');
  await page.getByRole('button',{name:'登出',exact:true}).click();
  await page.getByLabel('示範身分').selectOption('sales-a1');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'LINE OA 串接',exact:true})).toHaveCount(0);
 });
}
