import {test,expect} from '@playwright/test';
async function login(page,user='owner-a'){
 await page.goto('/');await page.getByLabel('示範身分').selectOption(user);
 await page.getByRole('button',{name:'進入示範工作台'}).click();
 await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
}
async function navigate(page,name){
 if(await page.getByRole('button',{name:'開啟導覽'}).isVisible())await page.getByRole('button',{name:'開啟導覽'}).click();
 await page.getByRole('button',{name,exact:false}).click();
}
test('empty tenant page provides independent catalog setup, manual tenant onboarding and staff creation',async({page})=>{
 await page.setViewportSize({width:1440,height:1050});await login(page);
 await page.route('**/api/tenants',async route=>{if(route.request().method()==='GET')await route.fulfill({json:[]});else await route.continue();});
 await page.reload();await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
 await navigate(page,'租戶管理');
 await expect(page.getByRole('button',{name:'＋ 新增租戶',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'新增既有租戶',exact:true})).toBeVisible();
 await page.screenshot({path:'docs/screenshots/desktop-empty-tenants.png',fullPage:true});
 await page.getByRole('button',{name:'設定據點與方案',exact:true}).click();
 await expect(page.getByRole('button',{name:'＋ 新增據點',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'＋ 新增據點',exact:true}).click();
 await page.getByLabel('據點名稱').fill('入口驗收據點');await page.getByLabel('據點地址').fill('虛構地址，僅供測試');
 await page.getByRole('button',{name:'儲存紀錄',exact:true}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.catalog-page')).toContainText('入口驗收據點');
 await page.getByRole('button',{name:'＋ 新增方案',exact:true}).click();
 await page.getByLabel('方案名稱').fill('入口驗收官網方案');await page.getByLabel('功能類型').selectOption('website');
 await page.getByRole('button',{name:'儲存紀錄',exact:true}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.catalog-page')).toContainText('入口驗收官網方案');
 await navigate(page,'租戶管理');await page.getByRole('button',{name:'＋ 新增租戶',exact:true}).click();
 await page.getByLabel('企業名稱',{exact:true}).fill('入口驗收既有租戶');await page.getByLabel('聯絡人',{exact:true}).fill('測試窗口');
 await page.getByLabel('建檔依據',{exact:true}).fill('既有借址服務轉入，虛構驗收資料');await page.unroute('**/api/tenants');
 await page.getByRole('button',{name:'新增租戶',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('入口驗收既有租戶');
 await expect(page.getByRole('dialog')).toContainText('數位服務尚未開通');await page.getByRole('button',{name:'關閉',exact:true}).click();
 await navigate(page,'操作人員');await page.getByRole('button',{name:'＋ 新增操作人員',exact:true}).click();
 await page.getByLabel('人員姓名').fill('入口驗收維運');await page.getByLabel('人員角色').selectOption('operator_service');
 await page.getByRole('button',{name:'新增人員資料',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 const staff=page.locator('.staff-row').filter({hasText:'入口驗收維運'});await expect(staff).toContainText('待綁定登入');await expect(staff.getByRole('button',{name:'恢復',exact:true})).toHaveCount(0);
 await page.screenshot({path:'docs/screenshots/desktop-add-staff.png',fullPage:true});
});
test('mobile new-tenant and catalog entries remain visible and staff roles cannot onboard directly',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page);
 await navigate(page,'租戶管理');await page.getByRole('button',{name:'＋ 新增租戶',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('heading',{name:'新增既有租戶'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/mobile-add-tenant.png',fullPage:true});await page.getByRole('button',{name:'關閉',exact:true}).click();
 await navigate(page,'據點與方案');await expect(page.getByRole('button',{name:'＋ 新增方案',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/screenshots/mobile-catalog.png',fullPage:true});
 await page.getByRole('button',{name:'登出',exact:true}).click();await login(page,'sales-a1');
 await navigate(page,'租戶管理');await expect(page.getByRole('button',{name:'＋ 新增租戶',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'＋ 建立案件',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'開啟導覽'}).click();await expect(page.getByRole('button',{name:'據點與方案',exact:false})).toHaveCount(0);
});
