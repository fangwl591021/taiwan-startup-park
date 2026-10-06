import {test,expect} from '@playwright/test';
async function login(page,id='owner-a'){
 await page.goto('http://127.0.0.1:8789/');await page.getByLabel('示範身分').selectOption(id);
 await page.getByRole('button',{name:'進入示範工作台'}).click();await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
}
test('navigation retains shell, reuses reads, invalidates after writes and separates identities',async({page})=>{
 const calls=[];await page.route('**/api/**',async route=>{if(route.request().method()==='GET'){calls.push(new URL(route.request().url()).pathname);await new Promise(r=>setTimeout(r,120));}await route.continue();});
 await login(page);await expect(page.locator('.metrics')).toBeVisible();
 expect(calls.filter(p=>p==='/api/dashboard')).toHaveLength(1);
 expect(calls.filter(p=>p==='/api/tenants'||p==='/api/conversations')).toHaveLength(0);
 const sidebar=await page.locator('.sidebar').elementHandle();
 await page.getByRole('button',{name:'租戶管理',exact:true}).click();await expect(page.locator('.tenant-list')).toBeVisible();
 const reads=calls.length;
 await page.getByRole('button',{name:'總覽',exact:true}).click();await expect(page.locator('.metrics')).toBeVisible();
 await page.getByRole('button',{name:'租戶管理',exact:true}).click();await expect(page.locator('.tenant-list')).toBeVisible();
 expect(calls.length).toBe(reads);expect(await sidebar.evaluate(el=>el.isConnected)).toBe(true);
 await page.locator('.tenant-card').filter({hasText:'青鳥數位有限公司'}).click();
 await page.getByRole('button',{name:'開啟租戶維運台 →'}).click();await expect(page.getByRole('heading',{name:'服務接續'})).toBeVisible();
 const opsCount=calls.filter(p=>p.endsWith('/operations')).length,catCount=calls.filter(p=>p==='/api/operations/catalog').length;
 await page.getByRole('button',{name:'地址合約',exact:true}).click();await expect(page.getByRole('heading',{name:'地址合約台帳'})).toBeVisible();
 await page.getByRole('button',{name:'應收與收退款',exact:true}).click();await expect(page.getByRole('heading',{name:'應收與人工收退款'})).toBeVisible();
 expect(calls.filter(p=>p.endsWith('/operations')).length).toBe(opsCount);expect(calls.filter(p=>p==='/api/operations/catalog').length).toBe(catCount);
 await page.getByRole('button',{name:'操作人員',exact:true}).click();await page.getByRole('button',{name:'＋ 新增操作人員'}).click();
 await page.getByLabel('人員姓名').fill('快取更新驗收');await page.getByRole('button',{name:'新增人員資料'}).click();
 await expect(page.locator('#content')).toContainText('快取更新驗收');
 const before=calls.filter(p=>p==='/api/dashboard').length;await page.getByRole('button',{name:'總覽',exact:true}).click();await expect(page.locator('.metrics')).toBeVisible();
 expect(calls.filter(p=>p==='/api/dashboard').length).toBe(before+1);
 await page.getByRole('button',{name:'切換測試帳號',exact:true}).click();await page.getByLabel('示範身分').selectOption('owner-b');await page.getByRole('button',{name:'進入示範工作台'}).click();
 await expect(page.locator('.case-list')).toContainText('B 業者隔離測試企業');await expect(page.locator('.case-list')).not.toContainText('日和設計工作室');
 console.log('PERFORMANCE_NAV '+JSON.stringify({cached_navigation_extra_reads:0,tab_switch_extra_reads:0,simulated_get_delay_ms:120,shell_preserved:true,write_invalidates:true,identity_separated:true}));
});
test('large paged tenant list has bounded DOM, next/previous and server search on desktop/mobile',async({page})=>{
 const all=Array.from({length:123},(_,i)=>({id:'paged-'+i,name:'分頁租戶 '+String(i).padStart(3,'0'),service_owner_name:'測試承辦',request_count:0}));
 await page.route('**/api/tenants?**',async route=>{
  const url=new URL(route.request().url());if(url.searchParams.get('paged')!=='1')return route.continue();
  const q=url.searchParams.get('q')||'',rows=all.filter(x=>x.name.includes(q)),start=Number(url.searchParams.get('cursor')||0),items=rows.slice(start,start+50);
  await route.fulfill({json:{items,total:rows.length,limit:50,next_cursor:start+50<rows.length?String(start+50):null}});
 });
 await login(page);
 for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  if(width<761)await page.getByRole('button',{name:'開啟導覽'}).click();
  await page.getByRole('button',{name:'租戶管理',exact:true}).click();
  await expect(page.locator('.tenant-row')).toHaveCount(50);await expect(page.locator('.list-pagination')).toContainText('共 123 筆');
  await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.locator('.tenant-name').first()).toHaveText('分頁租戶 050');
  await expect(page.locator('.tenant-row')).toHaveCount(50);await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.locator('.tenant-row')).toHaveCount(23);
  await expect(page.getByRole('button',{name:'下一頁',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'上一頁',exact:true}).click();await expect(page.locator('.tenant-row')).toHaveCount(50);
  await page.getByRole('textbox',{name:'搜尋租戶'}).fill('分頁租戶 122');await page.getByRole('button',{name:'搜尋',exact:true}).click();await expect(page.locator('.tenant-row')).toHaveCount(1);
  await expect(page.locator('.tenant-name')).toHaveText('分頁租戶 122');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/screenshots/'+name+'-tenant-paging.png',fullPage:true});
 }
});
