import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' address attention uses live API and opens the correct tenant tab',async({page})=>{
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'借址服務待辦',exact:true})).toBeVisible();
  const created=await page.request.post('http://127.0.0.1:8789/api/businesses/b4/mail',{headers:{origin:'http://127.0.0.1:8789','x-requested-with':'tsp'},data:{kind:'letter',description:'待辦驗收虛構信件',request_key:'attention-ui-'+name}});
  expect(created.status()).toBe(201);await page.getByRole('button',{name:'更新待辦',exact:true}).click();
  const group=page.locator('.attention-grid .panel').filter({has:page.getByRole('heading',{name:/待領信件／包裹/})});
  await expect(group.locator('[data-attention-tab="mail"]').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-address-attention.png',fullPage:true});
  await group.locator('[data-attention-tab="mail"]').first().click();
  await expect(page.getByLabel('目前租戶')).toHaveValue('b4');
  await expect(page.getByRole('heading',{name:'信件與包裹',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'選擇其他租戶',exact:true})).toBeVisible();
 });
}
test('service attention shows assigned service tasks without financial cards',async({page})=>{
 await page.goto('http://127.0.0.1:8789/');await page.getByLabel('示範身分').selectOption('service-a');await page.getByRole('button',{name:'進入示範工作台'}).click();
 await expect(page.getByRole('heading',{name:'借址服務待辦',exact:true})).toBeVisible();
 await expect(page.locator('.attention-grid').getByRole('heading',{name:/逾期地址款/})).toHaveCount(0);
 await expect(page.locator('.attention-grid').getByRole('heading',{name:/待領信件／包裹/})).toBeVisible();
});
