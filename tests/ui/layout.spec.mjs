import {test,expect} from '@playwright/test';
for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
 test(name+' readable layout retains fold state and keeps tenant actions reachable',async({page})=>{
  await page.setViewportSize({width,height});
  await page.goto('http://127.0.0.1:8789/');
  await page.getByLabel('示範身分').selectOption('owner-a');
  await page.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
  async function nav(label){if(width<761)await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:label,exact:true}).click();}
  const toggle=page.getByRole('button',{name:'收合成交進度',exact:true});
  const body=page.locator('#'+await toggle.getAttribute('aria-controls'));
  await expect(body).toBeVisible();await toggle.click();await expect(body).toBeHidden();
  await page.screenshot({path:'docs/screenshots/'+name+'-dashboard-folded.png',fullPage:true});
  await nav('租戶管理');await nav('總覽');
  await expect(page.getByRole('button',{name:'展開成交進度',exact:true})).toHaveAttribute('aria-expanded','false');
  await page.getByRole('button',{name:'展開成交進度',exact:true}).click();
  if(width>760){
   const expanded=await page.locator('#main').boundingBox();
   await page.getByRole('button',{name:'收合側欄',exact:true}).click();
   await expect(page.locator('.shell')).toHaveClass(/sidebar-collapsed/);
   const collapsed=await page.locator('#main').boundingBox();expect(collapsed.width).toBeGreaterThan(expanded.width);
   await page.reload();await expect(page.getByRole('button',{name:'展開側欄',exact:true})).toBeVisible();
   await page.screenshot({path:'docs/screenshots/desktop-sidebar-folded.png',fullPage:true});
   await page.getByRole('button',{name:'展開側欄',exact:true}).click();
  }
  await nav('租戶管理');
  const rows=page.locator('.tenant-list .tenant-row');
  await expect(rows.first()).toBeVisible();
  const firstName=await rows.first().locator('.tenant-name').innerText();
  const bounds=await rows.first().boundingBox();expect(bounds.height).toBeLessThanOrEqual(width>760?110:200);
  const contrast=await rows.first().locator('.tenant-field-label').first().evaluate(el=>{
   const c=getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});
   return 1.05/(c[0]*.2126+c[1]*.7152+c[2]*.0722+.05);
  });expect(contrast).toBeGreaterThanOrEqual(7);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-tenant-compact-dark.png',fullPage:true});
  await page.getByRole('textbox',{name:'搜尋租戶'}).fill('不存在的租戶條列驗收');
  await page.getByRole('button',{name:'搜尋',exact:true}).click();
  await expect(page.getByRole('heading',{name:'尚無符合的租戶'})).toBeVisible();
  await page.getByRole('textbox',{name:'搜尋租戶'}).fill(firstName);
  await page.getByRole('button',{name:'搜尋',exact:true}).click();
  await expect(page.locator('.tenant-list .tenant-row')).toHaveCount(1);
  await page.locator('.tenant-card').first().click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'開啟租戶維運台 →'})).toBeVisible();
  const future=dialog.getByRole('button',{name:'展開企業數位服務租用',exact:true});
  await expect(future).toHaveAttribute('aria-expanded','false');
  await expect(dialog.locator('.service-grid')).toBeHidden();
  await future.click();await expect(dialog.locator('.service-grid')).toBeVisible();
  await expect(dialog.getByText('尚未串接 · 未開通 · 分潤待議定').first()).toBeVisible();
  const font=await dialog.locator('.muted').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  expect(font).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-tenant-large-text.png',fullPage:true});
  await dialog.getByRole('button',{name:'收合企業數位服務租用',exact:true}).click();
  await expect(dialog.locator('.service-grid')).toBeHidden();
  await dialog.getByRole('button',{name:'關閉',exact:true}).click();
  await page.locator('.tenant-card').first().click();
  await expect(page.getByRole('dialog').getByRole('button',{name:'展開企業數位服務租用',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'開啟租戶維運台 →'}).click();
  await expect(page.getByLabel('目前租戶')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
