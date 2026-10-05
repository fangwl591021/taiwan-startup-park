import {chromium,expect} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
const OUT='dist/public/tutorial',RAW='.tutorial-recording',FAST=process.env.TUTORIAL_REHEARSAL==='on';
await mkdir(OUT,{recursive:true});await mkdir(RAW,{recursive:true});
const server=spawn(process.execPath,['scripts/dev.mjs'],{env:{...process.env,PORT:'8788',DEMO_DB:':memory:',DIGITAL_PREVIEW:'off'},stdio:['ignore','pipe','pipe']});
let stderr='';server.stderr.on('data',d=>stderr+=d.toString());
let browser,context;
const chapters=[];
try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:8788/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!ready)throw new Error('Tutorial server not ready: '+stderr);
 browser=await chromium.launch({headless:true});
 context=await browser.newContext({viewport:{width:1280,height:900},...(FAST?{}:{recordVideo:{dir:RAW,size:{width:1280,height:900}}}),bypassCSP:true});
 await context.addInitScript(()=>{
  document.addEventListener('DOMContentLoaded',()=>{
   const cursor=document.createElement('div');cursor.id='tutorial-cursor';
   Object.assign(cursor.style,{position:'fixed',zIndex:'2147483646',width:'44px',height:'44px',border:'4px solid #06c755',borderRadius:'50%',pointerEvents:'none',display:'none'});
   document.body.append(cursor);
   document.addEventListener('pointerdown',ev=>{cursor.style.left=(ev.clientX-22)+'px';cursor.style.top=(ev.clientY-22)+'px';cursor.style.display='block';setTimeout(()=>cursor.style.display='none',800);},true);
  });
 });
 const p=await context.newPage(),video=p.video(),began=Date.now();
 const pause=ms=>p.waitForTimeout(FAST?10:ms);
 async function caption(title,detail,ms=4200){
  chapters.push({seconds:(Date.now()-began)/1000,title,detail});
  await p.evaluate(({title,detail,number})=>{
   let el=document.querySelector('#tutorial-caption');if(!el){el=document.createElement('aside');el.id='tutorial-caption';el.setAttribute('popover','manual');document.body.append(el);}
   Object.assign(el.style,{position:'fixed',bottom:'16px',left:'28px',right:'28px',zIndex:'2147483647',background:'rgba(20,48,32,.96)',color:'#fff',borderRadius:'12px',padding:'16px 22px',boxShadow:'0 6px 24px #0003',fontFamily:'system-ui,"Noto Sans CJK TC",sans-serif',pointerEvents:'none',top:'auto',margin:'0',border:'0',maxWidth:'none',boxSizing:'border-box'});
   el.replaceChildren();const heading=document.createElement('div');heading.textContent=String(number).padStart(2,'0')+'  '+title;Object.assign(heading.style,{color:'#8beab0',fontWeight:'700',fontSize:'16px',marginBottom:'4px'});
   const text=document.createElement('div');text.textContent=detail;Object.assign(text.style,{fontSize:'20px',lineHeight:'1.6'});el.append(heading,text);if(el.matches(':popover-open'))el.hidePopover();el.showPopover();
  },{title,detail,number:chapters.length});
  console.log('TUTORIAL_CHAPTER '+chapters.length+' '+title);await pause(ms);
 }
 async function login(id){
  const switcher=p.getByRole('button',{name:'切換測試帳號',exact:true});
  if(await switcher.count())await switcher.click();
  await p.goto('http://127.0.0.1:8788/');await p.getByLabel('示範身分').selectOption(id);
  await p.getByRole('button',{name:'進入示範工作台'}).click();
  await expect(p.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
 }
 async function nav(name){await p.getByRole('button',{name,exact:false}).first().click();await pause(650);}
 async function close(){await p.getByRole('button',{name:'關閉',exact:true}).click();await expect(p.getByRole('dialog')).not.toBeVisible();}
 const company='教學示範企業（虛構）';
 await p.goto('http://127.0.0.1:8788/');
 await caption('測試帳號模擬','正式工作台側欄可開啟測試區；通過原本管理員驗證後，選擇虛構測試身分。',6500);
 await p.getByLabel('示範身分').selectOption('owner-a');
 await caption('從總管理員開始','測試資料與正式客戶分開。請先選「管理員 · 林園長」，不要輸入真實客戶資料。',5500);
 await p.getByRole('button',{name:'進入示範工作台'}).click();
 await expect(p.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
 await caption('工作台總覽','左側切換成交追蹤、租戶與聊天室；上方顯示目前操作人員及 TEST DEMO。',5500);
 await p.getByRole('button',{name:'＋ 建立案件'}).click();
 await p.getByLabel('企業名稱',{exact:true}).pressSequentially(company,{delay:FAST?0:85});
 await p.getByLabel('聯絡人',{exact:true}).fill('示範窗口');
 await p.locator('#opportunity-form select[name="owner_id"]').selectOption('sales-a1');
 await p.getByLabel('預估金額（NT$）',{exact:true}).fill('36000');
 await p.getByLabel('下一步',{exact:true}).fill('確認借址登記需求與適用方案');
 await caption('建立案件','填企業、聯絡人、負責業務與下一步。新洽談先建案件，服務中的舊客戶可直接新增租戶。',6500);
 await p.getByRole('button',{name:'建立案件',exact:true}).click();
 await expect(p.getByRole('dialog').getByRole('heading',{name:company})).toBeVisible();
 await caption('接觸 → 導入','第一次接觸先記錄需求；準備介紹服務時，把階段改成「導入」並儲存。');
 await p.getByLabel('階段',{exact:true}).selectOption('onboarding');
 await p.getByRole('button',{name:'儲存案件'}).click();
 await expect(p.getByRole('dialog')).not.toBeVisible();
 await p.locator('[data-opp]').filter({hasText:company}).click();
 await p.getByLabel('階段',{exact:true}).selectOption('billing');
 await p.getByLabel('下一步',{exact:true}).fill('確認合約與人工收款依據');
 await caption('導入 → 收費','方案確認後進入「收費」。案件階段、收款與功能開通是各自獨立的紀錄。',5500);
 await p.getByRole('button',{name:'儲存案件'}).click();
 await expect(p.getByRole('dialog')).not.toBeVisible();
 await p.locator('[data-opp]').filter({hasText:company}).click();
 await caption('成交轉租戶','按「成交轉租戶」，沿用企業、聯絡人與歷程；成交本身不代表已收款。',5500);
 await p.getByRole('button',{name:'成交轉租戶',exact:true}).click();
 await expect(p.getByRole('heading',{name:'租戶管理',exact:true})).toBeVisible();
 await p.getByRole('button',{name:new RegExp('教學示範企業')}).first().click();
 await caption('第一期只做借址服務','官網、商城與 LINE OA 串接留待後續；分潤欄位先留空，標準議定前不收費、不開通。',5500);
 await p.getByLabel('服務承辦人').selectOption('service-a');
 await p.getByRole('button',{name:'指派承辦人'}).click();
 await caption('指派服務承辦','將已成交租戶交給維運人員；服務承辦與原業務分工會保留在操作歷程。');
 await close();
 await p.getByRole('button',{name:'租戶維運台 →',exact:true}).click();
 await p.getByLabel('目前租戶').selectOption('b4');
 await expect(p.getByRole('heading',{name:'服務接續'})).toBeVisible();
 await caption('租戶維運台','第一期集中管理地址合約、應收帳款、續約、信件包裹與維運需求。',5500);
 await p.getByRole('button',{name:'地址合約',exact:true}).click();
 await p.getByRole('button',{name:'建立下一期',exact:true}).click();
 await caption('建立地址續約','設定下一期起訖日與合約總額，保留前一期歷程；續約不是政府登記核准。',5000);
 await p.getByRole('button',{name:'儲存紀錄',exact:true}).click();await expect(p.getByRole('dialog')).not.toBeVisible();
 const draft=p.locator('.ops-card').filter({hasText:'草稿'});
 await draft.getByRole('button',{name:'確認合約'}).click();
 await p.getByLabel('確認／終止依據').fill('教學示範：虛構地址續約確認');
 await p.getByRole('button',{name:'確認變更'}).click();
 await p.getByRole('button',{name:'應收與收退款',exact:true}).click();
 await p.getByRole('button',{name:'＋ 建立應收'}).click();
 const source=await p.getByLabel('帳款來源').locator('option[value^="address:"]').first().getAttribute('value');
 await p.getByLabel('帳款來源').selectOption(source);
 await caption('建立借址應收','地址合約確認後建立應收；金額沿用合約總額，可以分次記錄人工收款。',5000);
 await p.getByRole('button',{name:'儲存紀錄',exact:true}).click();await expect(p.getByRole('dialog')).not.toBeVisible();
 const bill=p.locator('.ops-card').filter({hasText:'地址服務款'}).first();
 await bill.getByRole('button',{name:'記錄收款／退款'}).click();
 await p.getByLabel('人工核對依據').fill('教學示範：虛構人工收款核對，沒有真實付款');
 await caption('人工核對收款','填入人工核對依據，留下操作者與時間；這不是線上刷卡、扣款或金流交易。',5500);
 await p.getByRole('button',{name:'儲存紀錄',exact:true}).click();await expect(bill).toContainText('已核對收足');
 await p.getByRole('button',{name:'數位服務（後續）',exact:true}).click();
 await caption('後續功能保留','官網、商城、LINE OA 與 CRM 尚未開放收費或開通；既有預覽紀錄只保留為歷程。',6000);
 await nav('工作聊天室');
 await p.locator('[data-chat]').filter({hasText:company}).click();
 await p.getByLabel('回覆內容').pressSequentially('示範回覆：已收到需求，將由維運同仁接續服務。',{delay:FAST?0:55});
 await p.getByLabel('模擬失敗',{exact:true}).check();
 await caption('聊天室模擬回覆','勾選「模擬失敗」來練習重試。測試聊天室不會把訊息送到 LINE。',5500);
 await p.getByRole('button',{name:'模擬回覆',exact:true}).click();await expect(p.locator('.messages')).toContainText('模擬發送失敗');
 await p.getByRole('button',{name:'重試模擬'}).click();await expect(p.locator('.messages')).toContainText('本地模擬完成，未發送至 LINE');
 await caption('誰回覆，有紀錄','訊息顯示虛構操作人員、時間與狀態；重試沿用原訊息，不新增重複回覆。',5500);
 await nav('操作歷程');await expect(p.locator('#content')).toContainText('成交轉租戶');
 await caption('查看操作歷程','建立案件、轉交、成交、服務承辦、地址續約與人工帳務，都保留操作人員及時間。',5500);
 await p.getByRole('button',{name:'切換測試帳號',exact:true}).click();
 await p.getByLabel('示範身分').selectOption('sales-a1');
 await caption('切換測試身分','按頂端「切換測試帳號」。現在切換成業務 S1，驗證個人承辦範圍。');
 await p.getByRole('button',{name:'進入示範工作台'}).click();await expect(p.getByRole('heading',{name:'總覽',exact:true})).toBeVisible();
 await expect(p.locator('.case-list')).toContainText('日和設計工作室');await expect(p.locator('.case-list')).not.toContainText('森嶼品牌有限公司');
 await caption('業務只能看自己的案件','S1 可看自己負責的案件；S2 的森嶼案件不會出現。管理員專區也不提供給業務。',6000);
 await login('service-a');await nav('租戶管理');
 await caption('維運只看分派的租戶','維運不顯示成交追蹤或財務工作，只能處理已分派租戶的日常服務與需求。',5500);
 await login('finance-a');await nav('租戶管理');
 await caption('財務分工','財務處理借址合約、應收與人工收退款；聊天室不提供給財務角色。',5000);
 await login('owner-b');await expect(p.locator('.case-list')).toContainText('B 業者隔離測試企業');
 await expect(p.locator('.case-list')).not.toContainText('日和設計工作室');
 await caption('跨業者隔離','B 業者管理員只能看到 B 業者企業，不能因管理員角色而查看 A 業者資料。',6000);
 await login('owner-a');await nav('據點與方案');
 await expect(p.getByRole('button',{name:'＋ 新增據點'})).toBeVisible();
 await expect(p.getByRole('heading',{name:'數位合作與分潤（後續）'})).toBeVisible();
 await caption('據點與預留分潤','建立借址登記據點。數位合作平台商、平台費、分潤比例與結算條件先留空，等待議定。',5000);
 await nav('操作人員');
 await p.getByRole('button',{name:'＋ 新增操作人員'}).click();
 await p.getByLabel('人員姓名').fill('教學示範新同仁');
 await p.getByLabel('人員角色').selectOption('operator_sales');
 await caption('新增操作人員','新增人員只先建立姓名與分工，狀態為「待綁定登入」，不會直接取得正式登入權限。',5500);
 await p.getByRole('button',{name:'新增人員資料'}).click();await expect(p.locator('#content')).toContainText('待綁定登入');
 await p.screenshot({path:'docs/screenshots/desktop-tutorial-staff.png',fullPage:true});
 await caption('開始練習','從管理員建案，再切換其他角色驗證分工。教學頁可重播與下載；返回正式工作台前確認網址。',7000);
 const end=(Date.now()-began)/1000;
 await context.close();context=null;
 if(FAST){console.log('TUTORIAL_JOURNEY_REHEARSAL_PASSED');}else{
 const raw=await video.path(),mp4=OUT+'/taiwan-startup-park-tutorial.mp4';
 execFileSync('ffmpeg',['-y','-i',raw,'-an','-c:v','libx264','-preset','veryfast','-crf','30','-pix_fmt','yuv420p','-r','20','-movflags','+faststart',mp4],{stdio:'ignore',timeout:120000});
 const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height','-of','json',mp4],{encoding:'utf8'}));
 const duration=Number(info.format.duration),stream=info.streams[0];
 assert(duration>120&&duration<360);assert.equal(stream.codec_name,'h264');assert.equal(stream.width,1280);assert.equal(stream.height,900);
 assert((await stat(mp4)).size<24*1024*1024,'MP4 exceeds Worker asset limit');
 execFileSync('ffmpeg',['-y','-ss','18','-i',mp4,'-frames:v','1',OUT+'/poster.jpg'],{stdio:'ignore'});
 await mkdir('docs/tutorial',{recursive:true});
 for(const seconds of [18,65,125])execFileSync('ffmpeg',['-y','-ss',String(seconds),'-i',mp4,'-frames:v','1','-q:v','6','docs/tutorial/frame-'+seconds+'.jpg'],{stdio:'ignore'});
 for(const seconds of [65,125])console.log('TUTORIAL_PREVIEW_'+seconds+' '+(await readFile('docs/tutorial/frame-'+seconds+'.jpg')).toString('base64'));
 const stamp=s=>{const ms=Math.round(s*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,sec=Math.floor(ms/1000)%60;return [h,m,sec].map(x=>String(x).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');};
 let vtt='WEBVTT\n\n';chapters.forEach((c,i)=>vtt+=(i+1)+'\n'+stamp(c.seconds)+' --> '+stamp(chapters[i+1]?.seconds??end)+'\n'+c.title+'：'+c.detail+'\n\n');
 await writeFile(OUT+'/captions.vtt',vtt);
 const report={type:'actual Playwright screen recording',language:'zh-TW',narration:false,fictional_data_only:true,duration_seconds:duration,bytes:Number(info.format.size),codec:stream.codec_name,width:stream.width,height:stream.height,chapters};
 await writeFile(OUT+'/media-report.json',JSON.stringify(report,null,2));
 await writeFile('docs/tutorial/TRANSCRIPT.md','# 台灣創業園操作教學（中文字幕版）\n\n'+chapters.map(c=>'- '+stamp(c.seconds)+' **'+c.title+'**：'+c.detail).join('\n')+'\n');
 // Confirm the built player can actually load the MP4 and mobile controls do not overflow.
 const check=await browser.newContext(),desktop=await check.newPage();await desktop.goto('http://127.0.0.1:8788/tutorial.html');
 await desktop.locator('video').evaluate(v=>new Promise((resolve,reject)=>{v.addEventListener('loadedmetadata',()=>resolve(v.duration),{once:true});v.addEventListener('error',()=>reject(new Error('video decode failed')),{once:true});v.load();setTimeout(()=>reject(new Error('video metadata timed out')),15000);}));
 await expect(desktop.locator('video')).toBeVisible();
 await desktop.screenshot({path:'docs/screenshots/desktop-tutorial-player.png',fullPage:true});
 await desktop.setViewportSize({width:390,height:844});assert(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await desktop.screenshot({path:'docs/screenshots/mobile-tutorial-player.png',fullPage:true});
 await check.close();
 console.log('TUTORIAL_MEDIA_VALIDATED '+JSON.stringify({duration_seconds:duration,bytes:Number(info.format.size),chapters:chapters.length,codec:'h264',actual_recording:true}));
 }
}finally{
 if(context)await context.close();if(browser)await browser.close();server.kill('SIGTERM');
}
