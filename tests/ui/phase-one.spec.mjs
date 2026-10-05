import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' phase-one workbench exposes blank reserved terms and only address billing sources',async({page})=>{
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');
  await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  async function nav(label){if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:label,exact:false}).first().click();}
  await nav('據點與方案');
  await expect(page.getByRole('heading',{name:'數位合作與分潤（後續）'})).toBeVisible();
  await expect(page.getByRole('button',{name:'＋ 新增方案'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'＋ 新增據點'})).toBeVisible();
  const fields=page.locator('.revenue-terms input');await expect(fields).toHaveCount(32);
  for(const field of await fields.all()){await expect(field).toHaveValue('');await expect(field).toBeDisabled();}
  await page.screenshot({path:'docs/screenshots/'+name+'-phase1-revenue-terms.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await nav('租戶管理');await page.getByRole('button',{name:'租戶維運台 →',exact:true}).click();
  await page.getByLabel('目前租戶').selectOption('b4');
  await page.getByRole('button',{name:'數位服務（後續）',exact:true}).click();
  await expect(page.getByRole('button',{name:'＋ 新增訂閱'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'確認訂閱'})).toHaveCount(0);
  await page.getByRole('button',{name:'地址合約',exact:true}).click();
  await page.getByRole('button',{name:'建立下一期',exact:true}).first().click();
  await page.getByRole('button',{name:'儲存紀錄',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const draft=page.locator('.ops-card').filter({hasText:'草稿'}).last();
  await draft.getByRole('button',{name:'確認合約'}).click();
  await page.getByLabel('確認／終止依據').fill('第一期虛構續約驗收');
  await page.getByRole('button',{name:'確認變更'}).click();
  await page.getByRole('button',{name:'應收與收退款',exact:true}).click();
  await page.getByRole('button',{name:'＋ 建立應收'}).click();
  await expect(page.getByLabel('帳款來源').locator('option[value^="digital:"]')).toHaveCount(0);
  const source=await page.getByLabel('帳款來源').locator('option[value^="address:"]').last().getAttribute('value');
  await page.getByLabel('帳款來源').selectOption(source);
  await page.getByRole('button',{name:'儲存紀錄',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.ops-card').filter({hasText:'數位訂閱款'}).getByRole('button',{name:'記錄收款／退款'})).toHaveCount(0);
  await page.screenshot({path:'docs/screenshots/'+name+'-phase1-address-billing.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
