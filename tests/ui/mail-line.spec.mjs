
import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' mail LINE contact binding and preparation-only preview',async({page})=>{
  let binding={status:'unbound',version:0,recipient:null,send_status:'not_enabled',preparation_only:true};
  const calls=[];
  // Only UI contact choices are mocked. Real signed webhook identity, isolation,
  // persistence, CAS and absence of sending are covered by integration tests.
  await page.route('**/api/businesses/b4/mail-line**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/candidates'))return route.fulfill({json:{limit:50,items:[{id:'observed-ui-contact',connection_id:'業者 OA（驗收示範）',identity_hint:'Uaaaa…aaaa',business_name:'青鳥數位有限公司',preview:'已確認此帳號代表企業收件'}]}});
   if(request.method()==='POST'){
    const d=request.postDataJSON();calls.push(d);
    binding={...binding,version:binding.version+1,status:d.action==='unlink'?'unbound':'linked',recipient:d.action==='unlink'?null:{name:d.recipient_name,line_contact_id:d.line_contact_id,connection_id:'業者 OA（驗收示範）',identity_hint:'Uaaaa…aaaa',channel_enabled:true,reference:d.reference}};
   }
   return route.fulfill({json:binding});
  });
  await page.route('**/api/businesses/b4/mail-preview/*',route=>route.fulfill({json:{status:'preview_only',sent:false,binding,mail_status:'received',mail_version:1,notice:'通知推播尚未啟用，沒有發送訊息',text:'青鳥數位有限公司 您好：\n您有一件包裹已由業者代收。\n收件摘要：政府公文與 <script>純文字</script>\n收件時間：2026/10/06 10:30\n請聯絡服務承辦人確認領取或轉寄安排。'}}));
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  async function nav(label){if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:label,exact:false}).first().click();}
  await nav('租戶管理');await page.getByRole('button',{name:'租戶維運台 →',exact:true}).click();await page.getByLabel('目前租戶').selectOption('b4');
  await page.getByRole('button',{name:'信件包裹',exact:true}).click();
  await page.getByRole('button',{name:'綁定通知聯絡人',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('一般 LINE ID 無法直接推播');
  await expect(dialog.locator('input[name="user_id"]')).toHaveCount(0);
  await page.getByLabel('已觀察到的 LINE 來客').selectOption('observed-ui-contact');
  await page.getByLabel('通知聯絡人姓名（請核對本人）').fill('王小姐 · 企業收件');
  await page.getByLabel('綁定確認依據').fill('由企業負責人確認收件聯絡人（虛構驗收）');
  expect(await page.getByLabel('綁定確認依據').getAttribute('required')).not.toBeNull();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-mail-line-binding.png',fullPage:true});
  await page.getByRole('button',{name:'保存通知綁定',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('#ops-panel')).toContainText('王小姐 · 企業收件');
  expect(calls).toHaveLength(1);expect(calls[0].version).toBe(0);expect(calls[0]).not.toHaveProperty('user_id');
  await page.getByRole('button',{name:'預覽 LINE 收件通知',exact:true}).first().click();
  await expect(dialog).toContainText('僅預覽，尚未發送');await expect(dialog.locator('pre')).toContainText('<script>純文字</script>');
  await expect(dialog.locator('script')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'發送通知',exact:true})).toHaveCount(0);
  await page.screenshot({path:'docs/screenshots/'+name+'-mail-notification-preview.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'關閉',exact:true}).click();
  await page.getByRole('button',{name:'管理通知綁定',exact:true}).click();
  await page.getByLabel('解除綁定原因').fill('示範聯絡人更換');
  await page.getByRole('button',{name:'解除通知綁定',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('#ops-panel')).toContainText('尚未綁定通知聯絡人');
  expect(calls).toHaveLength(2);expect(calls[1].action).toBe('unlink');expect(calls[1].version).toBe(1);
 });
}
