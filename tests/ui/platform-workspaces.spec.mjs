import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' operator workspace maps to address contract and keeps eight source modules visibly pending',async({page})=>{
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台',exact:true}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  if(await page.getByRole('button',{name:'開啟導覽',exact:true}).isVisible())await page.getByRole('button',{name:'開啟導覽',exact:true}).click();
  await page.getByRole('button',{name:'平台工作區',exact:true}).click();await expect(page.getByRole('heading',{name:'平台工作區',exact:true})).toBeVisible();
  await expect(page.locator('[data-pw-detail="pw-op-op-a"]')).toBeVisible();await expect(page.locator('[data-pw-detail="pw-biz-b4"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-platform-workspaces.png',fullPage:true,animations:'disabled',style:'#toast{visibility:hidden!important}'});
  await page.locator('[data-pw-detail="pw-biz-b4"]').click();await expect(page.locator('#modal')).toContainText('2026-10-01 ～ 2027-09-30');
  await expect(page.locator('#modal .pw-modules li')).toHaveCount(8);await expect(page.locator('#modal')).toContainText('整合中，未開通');
  await expect(page.locator('#modal')).toContainText('分潤：待議定');await expect(page.locator('#modal')).toContainText('合約類型待補');
  const detail=await (await page.request.get('http://127.0.0.1:8789/api/platform-workspaces/pw-biz-b4')).json();
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  for(const contract of detail.address.contracts.filter(c=>c.status==='active'&&c.starts_on>today)){
   await expect(page.locator('#modal .pw-contracts li').filter({hasText:contract.starts_on+' ～ '+contract.ends_on})).toContainText('服務尚未開始');
  }

  await page.screenshot({path:'docs/screenshots/'+name+'-platform-workspace-detail.png',fullPage:true,animations:'disabled',style:'#toast{visibility:hidden!important}'});
  await page.getByRole('button',{name:'開啟借址維運台',exact:false}).click();await expect(page.getByRole('heading',{name:'租戶維運',exact:true})).toBeVisible();
 });
 test(name+' enterprise workspace requires explicit membership and hides operator/private controls',async({page})=>{
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台',exact:true}).click();await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  const members=await page.request.get('http://127.0.0.1:8789/api/platform-workspaces/pw-biz-b4/members');expect(members.ok()).toBe(true);const value=await members.json();const version=value.items.find(m=>m.user_id==='business-admin')?.version||0;
  const grant=await page.request.put('http://127.0.0.1:8789/api/platform-workspaces/pw-biz-b4/members/business-admin',{headers:{Origin:'http://127.0.0.1:8789','X-Requested-With':'tsp'},data:{active:true,version,reference:'TEST ONLY browser fixture'}});expect(grant.ok()).toBe(true);
  await page.getByRole('button',{name:'登出',exact:true}).click();await page.getByLabel('示範身分').selectOption('business-admin');await page.getByRole('button',{name:'進入示範工作台',exact:true}).click();
  await expect(page.getByRole('heading',{name:'企業工作區',exact:true})).toBeVisible();await expect(page.locator('[data-pw-detail="pw-biz-b4"]')).toBeVisible();await expect(page.locator('[data-pw-detail="pw-op-op-a"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'聊天室 AI 監控',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'會員 CRM',exact:true})).toHaveCount(0);
  await page.locator('[data-pw-detail="pw-biz-b4"]').click();await expect(page.locator('#modal')).toContainText('2026-10-01 ～ 2027-09-30');await expect(page.locator('#pw-status-form')).toHaveCount(0);await expect(page.locator('[data-pw-address]')).toHaveCount(0);
  const forbidden=await page.request.get('http://127.0.0.1:8789/api/admin/monitor');expect(forbidden.status()).toBe(403);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-enterprise-workspace.png',fullPage:true,animations:'disabled',style:'#toast{visibility:hidden!important}'});
 });
}
