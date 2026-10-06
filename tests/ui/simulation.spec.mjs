import {test,expect} from '@playwright/test';
async function login(page,id){await page.goto('/');await page.getByLabel('示範身分').selectOption(id);await page.getByRole('button',{name:'進入示範工作台'}).click();await expect(page.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();}
test('simulation account switch preserves server role isolation and tutorial is linked',async({page})=>{
 await login(page,'owner-a');
 await expect(page.getByRole('link',{name:'操作教學影片',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'開啟測試帳號模擬',exact:true})).toHaveAttribute('href','https://taiwan-startup-park-demo.fangwl591021.workers.dev/');
 await page.getByRole('button',{name:'切換測試帳號',exact:true}).click();
 await page.getByLabel('示範身分').selectOption('sales-a1');await page.getByRole('button',{name:'進入示範工作台'}).click();
 await expect(page.locator('.case-list')).toContainText('日和設計工作室');
 await expect(page.locator('.case-list')).not.toContainText('森嶼品牌有限公司');
 await expect(page.getByRole('button',{name:'管理員專區',exact:false})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'開啟測試帳號模擬',exact:true})).toHaveCount(0);
 await page.screenshot({path:'docs/screenshots/desktop-simulation-sales.png',fullPage:true});
 await page.getByRole('button',{name:'切換測試帳號',exact:true}).click();
 await page.getByLabel('示範身分').selectOption('owner-b');await page.getByRole('button',{name:'進入示範工作台'}).click();
 await expect(page.locator('.case-list')).toContainText('B 業者隔離測試企業');
 await expect(page.locator('.case-list')).not.toContainText('日和設計工作室');
 await page.getByRole('link',{name:'操作教學影片',exact:true}).click();
 await expect(page.getByRole('heading',{name:'先練一次，再開始服務'})).toBeVisible();
 await expect(page.locator('video source')).toHaveAttribute('src','/tutorial/taiwan-startup-park-tutorial.mp4');
});
test('mobile simulation selector, service scope and tutorial controls fit viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page,'service-a');
 await expect(page.getByRole('button',{name:'成交追蹤',exact:false})).toHaveCount(0);
 await page.getByRole('button',{name:'開啟導覽'}).click();await page.getByRole('button',{name:'租戶管理',exact:false}).click();
 await expect(page.locator('#content')).toContainText('青鳥數位有限公司');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/mobile-simulation-service.png',fullPage:true});
 await page.getByRole('button',{name:'切換測試帳號',exact:true}).click();
 await expect(page.getByLabel('示範身分')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/mobile-simulation-selector.png',fullPage:true});
 await page.goto('/tutorial.html');
 await expect(page.getByRole('link',{name:'下載教學影片'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/screenshots/mobile-tutorial.png',fullPage:true});
});