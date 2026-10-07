export {};
type Row=Record<string,any>;
const root=document.querySelector<HTMLDivElement>('#app')!;
const dialog=document.querySelector<HTMLDialogElement>('#modal')!;
let me:Row;let page='dashboard';let staff:Row[]=[];let opps:Row[]=[];let tenants:Row[]=[];let chats:Row[]=[];let selectedChat='';let chatLine:Row={bound:false,send_enabled:false};let filter='';let search='';let busy=false;let opsBusiness='';let opsTab='overview';let opsData:Row;let opsCatalog:Row;let revenueTerms:Row[]=[];let lineSettings:Row={connections:[]};
let systemView=false;let platformData:Row={};let platformOffset=0;
const stageNames:Row={contact:'接觸',onboarding:'導入',billing:'收費',won:'成交',paused:'暫緩',lost:'未成交'};
const roleNames:Row={operator_owner:'業者管理員',operator_sales:'業務',operator_service:'維運',operator_finance:'財務',platform_admin:'系統總管理員',business_admin:'企業管理員'};
const moduleNames:Row={website:'品牌官網',store:'獨立商城',line:'LINE OA 串接',crm:'客戶管理 CRM'};
const actionNames:Row={tenant_created:'新增既有租戶',staff_created:'新增操作人員（待綁定）',location_created:'新增登記據點',plan_created:'新增數位方案',plan_status_changed:'變更方案販售狀態',contract_created:'建立地址合約',contract_renewal_created:'建立地址續約',contract_status_changed:'變更合約狀態',contract_terms_changed:'補登合約服務條件',subscription_created:'建立數位訂閱',subscription_status_changed:'變更訂閱狀態',receivable_created:'建立應收單',receivable_voided:'作廢應收單',ledger_recorded:'人工核對收退款',mail_line_recipient_linked:'綁定收件通知聯絡人',mail_line_recipient_unlinked:'解除收件通知綁定',mail_received:'登記信件包裹',mail_status_changed:'更新信件交付',ticket_created:'建立維運需求',ticket_status_changed:'更新維運需求',fixture_created:'建立示範案件',opportunity_created:'建立案件',assignment_changed:'轉交案件',opportunity_updated:'更新案件',opportunity_won:'成交轉租戶',payment_recorded:'人工核對收款',message_attempted:'回覆訊息（本地）',message_retried:'重試訊息（本地）',service_requested:'申請功能',service_cancelled:'取消功能申請',service_assignment_changed:'指派服務承辦',staff_status:'變更人員狀態',line_connection_configured:'新增業者 OA 接收設定',line_connection_updated:'更新 OA 設定／憑證',line_connection_status_changed:'變更 OA 接收開關',line_connection_checked:'確認 OA 憑證連線',line_contact_linked:'分派 LINE 來客',line_message_queued:'加入 LINE 外送佇列',line_message_retry_requested:'請求 LINE 訊息重試'};
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(v:number)=>'NT$ '+Number(v||0).toLocaleString('zh-TW');
const date=(v:string)=>v?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'未安排';
const owner=()=>me?.role==='operator_owner';
const seller=()=>['operator_owner','operator_sales'].includes(me?.role);
const salesView=()=>['operator_owner','operator_sales','operator_finance'].includes(me?.role);
const chatView=()=>['operator_owner','operator_sales','operator_service'].includes(me?.role);
const futureDigital=()=>me?.digital_preview===true;
const canRequest=()=>futureDigital()&&['operator_owner','operator_sales','operator_service'].includes(me?.role);

/** Browser-only layout preferences; no customer data or permissions stored here. */
const layoutKey='tsp-layout-v1';
let layoutPrefs:{sidebar:boolean;sections:Record<string,boolean>}={sidebar:false,sections:{}};
try{const stored=JSON.parse(localStorage.getItem(layoutKey)||'null');if(stored&&typeof stored.sidebar==='boolean'&&stored.sections&&typeof stored.sections==='object')layoutPrefs=stored;}catch{}
function saveLayout(){try{localStorage.setItem(layoutKey,JSON.stringify(layoutPrefs));}catch{}}
function applySidebar(){
 const shell=root.querySelector('.shell');shell?.classList.toggle('sidebar-collapsed',layoutPrefs.sidebar);
 const toggle=root.querySelector<HTMLButtonElement>('[data-action="sidebar-toggle"]');
 if(toggle){toggle.setAttribute('aria-expanded',String(!layoutPrefs.sidebar));toggle.setAttribute('aria-label',layoutPrefs.sidebar?'展開側欄':'收合側欄');toggle.title=layoutPrefs.sidebar?'展開側欄':'收合側欄';const icon=layoutPrefs.sidebar?'☰':'⇤';if(toggle.textContent!==icon)toggle.textContent=icon;}
}
let foldSequence=0;
function makeFold(section:HTMLElement,heading:HTMLElement,key:string,initialOpen=true){
 const title=heading.querySelector('h2,h3')?.textContent?.trim()||heading.textContent?.trim()||'內容';
 const body=document.createElement('div');body.className='fold-body';body.id='fold-body-'+(++foldSequence);
 const nodes=Array.from(section.childNodes).filter(n=>n!==heading);nodes.forEach(n=>body.append(n));section.append(body);
 const toggle=document.createElement('button');toggle.type='button';toggle.className='section-toggle';toggle.dataset.action='fold';toggle.dataset.foldKey=key;toggle.dataset.foldTitle=title;toggle.setAttribute('aria-controls',body.id);
 heading.append(toggle);section.dataset.foldReady='true';
 const open=typeof layoutPrefs.sections[key]==='boolean'?layoutPrefs.sections[key]:initialOpen;
 function update(expanded:boolean){body.hidden=!expanded;toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',(expanded?'收合':'展開')+title);toggle.textContent=expanded?'收合 ▴':'展開 ▾';}
 update(open);
}
function enhanceLayout(container:HTMLElement){
 applySidebar();
 container.querySelectorAll<HTMLElement>('.panel:not([data-fold-ready])').forEach(panel=>{
  if(panel.classList.contains('chat-layout'))return;
  const heading=Array.from(panel.children).find(el=>el.classList.contains('panel-heading')) as HTMLElement|undefined;
  if(!heading)return;const title=heading.querySelector('h2')?.textContent?.trim()||'內容';
  makeFold(panel,heading,[me?.id||'visitor',page,container===dialog?'modal':'page',title].join(':'),true);
 });
 container.querySelectorAll<HTMLElement>('.section-title:not([data-fold-title])').forEach(title=>{
  title.dataset.foldTitle='true';const parent=title.parentElement;if(!parent)return;
  const section=document.createElement('section');section.className='fold-section';
  parent.insertBefore(section,title);const heading=document.createElement('div');heading.className='fold-heading';section.append(heading);heading.append(title);
  while(section.nextSibling){const node=section.nextSibling;if(node instanceof HTMLElement&&(node.matches('.section-title,.revenue-terms')||node.tagName==='SECTION'))break;section.append(node);}
  const name=title.textContent?.trim()||'內容';
  makeFold(section,heading,[me?.id||'visitor',page,container===dialog?'modal':'page',name].join(':'),name!=='企業數位服務租用'||futureDigital());
 });
}
const layoutObserver=new MutationObserver(records=>{
 let mainChanged=false,modalChanged=false;
 for(const record of records)for(const node of record.addedNodes){
  if(!(node instanceof HTMLElement))continue;
  if(!node.matches('.shell,.modal-inner,.panel:not([data-fold-ready]),.section-title:not([data-fold-title])')&&!node.querySelector('.panel:not([data-fold-ready]),.section-title:not([data-fold-title])'))continue;
  if(dialog.contains(node))modalChanged=true;else if(root.contains(node))mainChanged=true;
 }
 if(mainChanged)enhanceLayout(root);if(modalChanged)enhanceLayout(dialog);
});
layoutObserver.observe(root,{childList:true,subtree:true});
layoutObserver.observe(dialog,{childList:true,subtree:true});


let readEpoch=0,viewRevision=0;
const readCache=new Map<string,{until:number;data:any}>();
const pendingReads=new Map<string,{epoch:number;promise:Promise<any>}>();
const READ_TTL=15000;
function clearReads(){readEpoch++;readCache.clear();pendingReads.clear();}
async function api(path:string,method='GET',data?:Row):Promise<any>{
 const reading=method==='GET';
 if(!reading)clearReads();
 const epoch=readEpoch;
 if(reading){
  const hit=readCache.get(path);if(hit&&hit.until>Date.now())return hit.data;
  const pending=pendingReads.get(path);if(pending&&pending.epoch===epoch)return pending.promise;
 }
 const task=(async()=>{
  try{
   const response=await fetch('/api'+path,{method,headers:reading?{}:{'Content-Type':'application/json','X-Requested-With':'tsp'},...(data?{body:JSON.stringify(data)}:{})});
   const value=await response.json();
   if(!response.ok){if(response.status===401||response.status===403)clearReads();throw new Error(value.error||'操作失敗');}
   if(reading){
    if(epoch!==readEpoch)throw new DOMException('資料已更新','AbortError');
    readCache.delete(path);while(readCache.size>=48)readCache.delete(readCache.keys().next().value!);readCache.set(path,{until:Date.now()+READ_TTL,data:value});
   }
   return value;
  }finally{if(!reading)clearReads();}
 })();
 const promise:Promise<any>=task.finally(()=>{if(pendingReads.get(path)?.promise===promise)pendingReads.delete(path);});
 if(reading)pendingReads.set(path,{epoch,promise});
 return promise;
}
let dashboardSnapshot:Row;
const listMeta:Row={},listIndex:Row={pipeline:0,tenants:0,chat:0},listCursors:Row={pipeline:[null],tenants:[null],chat:[null]};
function resetList(kind:string){if(listCursors[kind]){listCursors[kind]=[null];listIndex[kind]=0;}}
function listPath(kind:string){
 const base=({pipeline:'/opportunities',tenants:'/tenants',chat:'/conversations'} as Row)[kind];
 const params=new URLSearchParams({paged:'1',limit:'50'});
 const cursor=listCursors[kind][listIndex[kind]];if(cursor)params.set('cursor',cursor);
 if(kind!=='chat'&&search)params.set('q',search);
 if(kind==='pipeline'&&filter)params.set('stage',filter);
 return base+'?'+params.toString();
}
function pagination(kind:string){
 const meta=listMeta[kind];if(!meta)return '';
 return '<div class="list-pagination" aria-label="列表分頁"><span>共 '+e(meta.total)+' 筆 · 第 '+(listIndex[kind]+1)+' 頁</span><div><button data-list-page="'+kind+'" data-direction="previous" '+(listIndex[kind]===0?'disabled':'')+'>上一頁</button><button data-list-page="'+kind+'" data-direction="next" '+(!meta.next_cursor?'disabled':'')+'>下一頁</button></div></div>';
}
async function loadPageData(){
 const current=page,revision=++viewRevision;
 if(systemView){
  const endpoint=({ 'system-overview':'overview','system-operators':'operators','system-line':'connections','system-settings':'settings','system-revenue':'revenue','system-activity':'activity'} as Row)[current];
  if(!endpoint)return false;
  const suffix=['operators','connections','revenue'].includes(endpoint)?'?offset='+platformOffset+'&q='+encodeURIComponent(search):'';
  const result=await api('/platform/'+endpoint+suffix);if(revision!==viewRevision||page!==current||!systemView)return false;
  platformData=result;return true;
 }
 if(current==='dashboard'){
  const result=await api('/dashboard');if(revision!==viewRevision||page!==current)return false;
  dashboardSnapshot=result.stats;opps=result.opportunities;
 }else if(['pipeline','tenants','chat'].includes(current)){
  const [result,summary]=await Promise.all([api(listPath(current)),current==='pipeline'?api('/dashboard'):Promise.resolve(null)]);
  if(revision!==viewRevision||page!==current)return false;
  listMeta[current]=result;
  if(current==='pipeline'){opps=result.items;dashboardSnapshot=summary.stats;}
  if(current==='tenants')tenants=result.items;
  if(current==='chat')chats=result.items;
 }else if(current==='operations'||current==='integrations'){
  const result=await api('/tenants?paged=1&limit=50');
  if(revision!==viewRevision||page!==current)return false;tenants=result.items;
  if(current==='operations'&&opsBusiness&&!tenants.some(t=>t.id===opsBusiness)){
   const selected=await api('/businesses/'+encodeURIComponent(opsBusiness));
   if(revision!==viewRevision||page!==current)return false;tenants=[selected,...tenants];
  }
  if(current==='integrations'&&chatView()){
   const result=await api('/conversations?paged=1&limit=50');
   if(revision!==viewRevision||page!==current)return false;chats=result.items;
  }
 }
 return revision===viewRevision&&page===current;
}

function toast(message:string){const el=document.querySelector('#toast')!;el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4500);}
function badge(label:string,tone=''){return '<span class="badge '+e(tone)+'">'+e(label)+'</span>';}
function empty(title:string,detail:string,action=''){return '<div class="empty"><span class="empty-icon">＋</span><h3>'+e(title)+'</h3><p>'+e(detail)+'</p>'+action+'</div>';}
function options(rows:Row[],current:string){return rows.map(s=>'<option value="'+e(s.id)+'" '+(s.id===current?'selected':'')+'>'+e(s.name)+(s.active?'':'（停權）')+'</option>').join('');}
function formError(form:HTMLFormElement,msg:string){form.querySelector('.form-error')!.textContent=msg;}
function showModal(html:string){
 dialog.innerHTML='<div class="modal-inner"><button type="button" class="close" data-action="close" aria-label="關閉">×</button>'+html+'</div>';
 if(!dialog.open)dialog.showModal();
}
async function loginScreen(){
 const config=await api('/bootstrap');
 if(!config.demo){
 root.innerHTML='<main class="login"><div class="brand-mark">園</div><p class="eyebrow">TAIWAN STARTUP PARK</p><h1>台灣創業園</h1><h2>'+(config.auth==='cloudflare_access'?'使用企業身分登入':'正式登入尚未設定')+'</h2><p>'+(config.auth==='cloudflare_access'?'通過 Cloudflare Access 驗證後，使用已綁定的個人操作帳號進入工作台。':'請先完成企業登入與人員綁定，系統不提供公開示範登入。')+'</p>'+(config.auth==='cloudflare_access'?'<button class="primary" data-action="access-login">驗證並進入工作台</button>':'')+'<p>LINE 依業者設定；金流尚未串接，AI 尚未啟用。</p></main>';return;
 }
 const users=await api('/demo/users');
 root.innerHTML='<main class="login"><div class="brand-mark">園</div><p class="eyebrow">TAIWAN STARTUP PARK</p><h1>讓每一次成交<br>成為長期的服務關係</h1><p>業者工作台 · 租戶維運驗收版</p><form id="login-form"><label>選擇測試身分<select name="user_id" aria-label="示範身分">'+users.map((u:Row)=>'<option value="'+e(u.id)+'" '+(u.id==='owner-a'?'selected':'')+'>'+e(u.operator_name+' / '+u.name)+'</option>').join('')+'</select></label><button class="primary" type="submit">進入示範工作台</button><p class="form-error" role="alert"></p></form><div class="notice">純虛構資料 · '+(config.sandbox?'獨立測試資料庫，僅限授權管理員':'僅限本機')+'<br>LINE、金流與 AI 尚未串接。</div><p><a href="/tutorial.html">觀看操作教學影片 →</a></p><p class="fine">公司工作通訊將記錄操作人員與服務歷程，供授權管理與服務品質核查；不包含私人通訊。</p></main>';
}
async function start(){
 try{me=await api('/me');systemView=me.platform_access&&(me.role==='platform_admin'||new URL(location.href).searchParams.get('workspace')==='platform');page=systemView?'system-overview':'dashboard';staff=me.role==='platform_admin'?[]:await api('/staff');root.innerHTML='';await refresh();}
 catch(err){if(me&&me.role==='business_admin'){root.innerHTML='<main class="login"><h1>此角色尚未開放工作台</h1><p>目前不提供跨業者存取。</p><button data-action="logout">登出</button></main>';}else if(me?.platform_access){root.innerHTML='<main class="login"><h1>系統後台暫時無法載入</h1><p>'+e((err as Error).message)+'</p><button data-action="access-login">重新登入</button><button data-action="logout">登出</button></main>';}else await loginScreen();}
}
async function refresh(force=false){
 if(force)clearReads();
 if(await loadPageData())render();
}
function render(loading=false){
 if(systemView){renderPlatform(loading);return;}
 const nav=[['dashboard','▦','總覽'],...(salesView()?[['pipeline','↗','成交追蹤']]:[]),['tenants','▤','租戶管理'],...(chatView()?[['chat','◌','工作聊天室']]:[]),...(owner()?[['catalog','▣','據點與方案'],['activity','≡','操作歷程'],['staff','♙','操作人員'],['line-settings','⇄','LINE OA 串接'],['integrations','⇄','整合中心'],['risk','◇','管理員專區']]:[])];
 const title=page==='operations'?'租戶維運':nav.find(n=>n[0]===page)?.[2]||'總覽';
 const shellHtml='<div class="shell"><button class="scrim" data-action="menu-close" aria-label="關閉導覽"></button><aside class="sidebar" id="workspace-sidebar"><a class="brand" href="#" data-page="dashboard"><span class="brand-mark">園</span><span class="brand-label">台灣創業園<small>TAIWAN STARTUP PARK</small></span></a><div class="workspace-label">業者工作台</div><nav>'+nav.map(n=>'<button data-page="'+n[0]+'" class="nav-item '+(page===n[0]||page==='operations'&&n[0]==='tenants'?'active':'')+'" '+(page===n[0]?'aria-current="page"':'')+' aria-label="'+n[2]+'" title="'+n[2]+'"><span aria-hidden="true">'+n[1]+'</span><b class="nav-label">'+n[2]+'</b></button>').join('')+'</nav><div class="learning-links"><a href="/tutorial.html" aria-label="操作教學影片" title="操作教學影片"><span aria-hidden="true">▶</span><span class="link-label">操作教學影片</span></a>'+(me.sandbox?'<a href="https://taiwan-startup-park.fangwl591021.workers.dev/" target="_blank" rel="noopener" aria-label="返回正式工作台" title="返回正式工作台"><span aria-hidden="true">↗</span><span class="link-label">返回正式工作台</span></a>':owner()?'<a href="https://taiwan-startup-park-demo.fangwl591021.workers.dev/" target="_blank" rel="noopener" aria-label="開啟測試帳號模擬" title="開啟測試帳號模擬"><span aria-hidden="true">↗</span><span class="link-label">開啟測試帳號模擬</span></a>':'')+'</div><div class="sidebar-bottom"><span class="status-dot"></span>'+(me.demo?'獨立測試環境':'企業工作環境')+'<small>Operations · 借址第一期</small></div></aside><div class="workspace"><header class="topbar"><button class="sidebar-toggle" data-action="sidebar-toggle" aria-controls="workspace-sidebar" aria-expanded="true" aria-label="收合側欄" title="收合側欄">⇤</button><button class="menu-button" data-action="menu" aria-label="開啟導覽">☰</button><div class="crumb">工作台 <span>/</span> '+e(title)+'</div><div class="identity"><span class="avatar">'+e(me.name.slice(-1))+'</span><div>'+e(me.name)+'<small>'+e(roleNames[me.role])+'</small></div><button class="text-button" data-action="logout">登出</button></div></header><div class="demo-strip">'+(me.demo?'<span>TEST DEMO</span>虛構示範資料 · '+(futureDigital()?'後續數位流程本機預覽 · ':'第一期借址 · ')+(me.sandbox?'與正式資料分開 · ':'')+'LINE／金流尚未串接 · AI 尚未啟用 <button class="text-button" data-action="logout">切換測試帳號</button>':'<span>WORKSPACE</span>第一期 · 借址服務 · LINE 接收依業者設定 · 推播未啟用 · 金流尚未串接 · AI 尚未啟用')+'</div><main id="main"><div class="page-heading"><div><p class="eyebrow">'+e(me.operator_name)+'</p><h1>'+e(title)+'</h1><p class="subtitle">'+e(({dashboard:'把來客、成交與長期服務，放在同一個工作台。',pipeline:'從第一次接觸，到下一段合作。',tenants:'成交是開始，讓服務持續發生。',chat:'每一次回覆，都能追溯實際操作人員。',activity:'每個關鍵操作，保留人員與時間。',staff:'一人一帳號，清楚分工。','line-settings':'設定業者自己的 OA，分開確認憑證與實際接收。',integrations:'確認連線狀態，讓每一位來客都有明確歸屬。',operations:'合約、帳務與日常服務，一次掌握。',catalog:'第一期管理登記據點；數位合作與分潤欄位預留。',risk:'僅業者管理員可存取的獨立工作區。'} as Row)[page])+'</p></div>' +headingActions()+'</div><section id="content"></section><footer>台灣創業園 · 時間以台北時間顯示<span>工作通訊與操作將留存服務歷程</span></footer></main></div></div>';
 if(!root.querySelector('.shell'))root.innerHTML=shellHtml;
 else {
  const template=document.createElement('template');template.innerHTML=shellHtml;
  root.querySelector('.crumb')!.innerHTML=template.content.querySelector('.crumb')!.innerHTML;
  root.querySelector('.page-heading')!.innerHTML=template.content.querySelector('.page-heading')!.innerHTML;
  root.querySelectorAll<HTMLElement>('.nav-item').forEach(item=>{
   const active=item.dataset.page===page||page==='operations'&&item.dataset.page==='tenants';
   item.classList.toggle('active',active);if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
  });
  root.querySelector('.shell')?.classList.remove('menu-open');
 }
 applySidebar();
 if(me.platform_access&&!root.querySelector('[data-workspace="platform"]')){
  const switcher=document.createElement('button');switcher.className='primary workspace-switch';switcher.dataset.workspace='platform';switcher.textContent='系統總後台 →';root.querySelector('.learning-links')?.prepend(switcher);
 }

 const content=document.querySelector('#content')!;
 if(loading){content.innerHTML='<p class="loading">正在載入資料…</p>';return;}
 if(page==='dashboard')content.innerHTML=dashboard();
 if(page==='pipeline')content.innerHTML=pipeline();
 if(page==='tenants')content.innerHTML=tenantList();
 if(page==='chat'){content.innerHTML=chatShell();void loadChat();}
 if(page==='activity')void renderActivity();
 if(page==='staff')content.innerHTML=staffPage();
 if(page==='catalog')void renderCatalog();
 if(page==='risk')void renderRisk();
 if(page==='integrations')void renderIntegrations();
 if(page==='line-settings')void renderLineSettings();
 if(page==='operations')void renderOperations();
}
function headingActions(){
 if(seller()&&['dashboard','pipeline','chat'].includes(page))return '<button class="primary" data-action="new">＋ 建立案件</button>';
 if(page==='tenants'&&owner())return '<button class="primary" data-action="new-tenant">＋ 新增租戶</button>';
 if(page==='tenants'&&seller())return '<button class="primary" data-action="new">＋ 建立案件</button>';
 if(page==='staff'&&owner())return '<button class="primary" data-action="new-staff">＋ 新增操作人員</button>';
 return '';
}
function platformPagination(){return '<div class="list-pagination"><span>共 '+e(platformData.total||0)+' 筆 · 每頁 50 筆</span><div><button data-platform-page="previous" '+(!platformOffset?'disabled':'')+'>上一頁</button><button data-platform-page="next" '+(platformOffset+50>=platformData.total?'disabled':'')+'>下一頁</button></div></div>';}
function platformSearch(){return '<form id="platform-search" class="platform-search"><label>搜尋業者／OA<input name="q" value="'+e(search)+'" maxlength="100" placeholder="輸入業者或 OA 名稱"></label><button type="submit">搜尋</button><p class="form-error" role="alert"></p></form>';}
function renderPlatform(loading=false){
 const nav=[['system-overview','▦','系統總覽'],['system-operators','▤','業者總覽'],['system-line','⇄','業者 OA 串接總覽'],['system-settings','⚙','平台 OA 與通知規劃'],['system-revenue','≡','平台費與分潤'],['system-activity','◇','系統操作歷程']];
 const title=nav.find(n=>n[0]===page)?.[2]||'系統總覽';
 root.innerHTML='<div class="shell"><button class="scrim" data-action="menu-close" aria-label="關閉導覽"></button><aside class="sidebar" id="workspace-sidebar"><div class="brand"><span class="brand-mark">園</span><span class="brand-label">台灣創業園<small>TAIWAN STARTUP PARK</small></span></div><div class="workspace-label">系統總後台 · 平台商</div><nav>'+nav.map(n=>'<button data-page="'+n[0]+'" class="nav-item '+(page===n[0]?'active':'')+'" '+(page===n[0]?'aria-current="page"':'')+' aria-label="'+n[2]+'" title="'+n[2]+'"><span aria-hidden="true">'+n[1]+'</span><b class="nav-label">'+n[2]+'</b></button>').join('')+'</nav><div class="learning-links">'+(me.role!=='platform_admin'?'<button class="primary workspace-switch" data-workspace="operator">返回業者工作台 →</button>':'')+'<a href="https://taiwan-startup-park-demo.fangwl591021.workers.dev/" target="_blank" rel="noopener">開啟測試帳號模擬 ↗</a></div><div class="sidebar-bottom">平台管理 · 與業者工作台分開</div></aside><div class="workspace"><header class="topbar"><button class="sidebar-toggle" data-action="sidebar-toggle" aria-controls="workspace-sidebar" aria-expanded="true" aria-label="收合側欄">⇤</button><button class="menu-button" data-action="menu" aria-label="開啟導覽">☰</button><div class="crumb">系統總後台 <span>/</span> '+e(title)+'</div><div class="identity"><div>'+e(me.name)+'<small>系統總管理員</small></div><button class="text-button" data-action="logout">登出</button></div></header><div class="demo-strip"><span>'+(me.demo?'TEST DEMO':'SYSTEM')+'</span>'+(me.demo?'虛構測試資料 · ':'')+'平台 OA 規劃中 · 推播未啟用 · 金流尚未串接 · AI 尚未啟用</div><main id="main"><div class="page-heading"><div><p class="eyebrow">平台商管理範圍</p><h1>'+e(title)+'</h1><p class="subtitle">業者狀態、平台設定與合作條件，集中管理。</p></div><button data-action="refresh">重新整理</button></div><section id="content">'+(loading?'<p class="loading">正在載入系統資料…</p>':platformContent())+'</section><footer>台灣創業園 · 系統總後台<span>設定變更保留操作人員與時間</span></footer></main></div></div>';
 applySidebar();
}
function platformInput(name:string,label:string,value:unknown,attrs=''){return '<label>'+e(label)+'<input name="'+e(name)+'" value="'+e(value)+'" '+attrs+'></label>';}
function platformContent(){
 if(page==='system-overview'){
  const s=platformData.stats||{};
  return '<div class="metrics">'+[['登錄業者',s.operators,'家'],['業者 OA',s.connections,'組'],['接收開啟',s.receiving,'組'],['曾驗簽接收',s.verified,'組']].map(r=>'<article><span>'+r[0]+'</span><strong>'+e(r[1]||0)+'<small>'+r[2]+'</small></strong></article>').join('')+'</div><section class="panel"><div class="panel-heading"><h2>平台與業者分開管理</h2></div><div class="platform-rows"><article><div><b>平台自己的 LINE OA</b><p>業者招募、開通說明與服務通知。先保存規劃，尚未串接或發送。</p></div><button data-page="system-settings">編輯規劃 →</button></article><article><div><b>各業者自己的 LINE OA</b><p>查看串接狀態與最後接收時間；客戶與聊天仍歸各業者管理。</p></div><button data-page="system-line">查看狀態 →</button></article><article><div><b>平台費與數位分潤</b><p>依業者與服務保留欄位，待議定；本期不收費、不結算。</p></div><button data-page="system-revenue">查看預留 →</button></article></div></section>';
 }
 if(page==='system-operators')return '<section class="panel"><div class="panel-heading"><h2>登錄業者</h2></div>'+platformSearch()+'<p>本期提供業者總覽；新增開通、停用與 SaaS 方案核准流程尚未開放。</p><div class="platform-rows">'+platformData.items.map((o:Row)=>'<article><div><b>'+e(o.name)+'</b><p>操作人員 '+o.staff_count+' 位 · OA '+o.oa_count+' 組</p></div>'+badge('已登錄')+'</article>').join('')+'</div>'+platformPagination()+'</section>';
 if(page==='system-line')return '<section class="panel"><div class="panel-heading"><h2>業者 OA 接收狀態</h2></div>'+platformSearch()+'<p>此處只顯示連線狀態，不顯示憑證、客戶身分或聊天內容。平台 OA 尚未串接，推播未啟用。</p>'+(platformData.items.length?'<div class="platform-rows">'+platformData.items.map((c:Row)=>'<article><div><b>'+e(c.operator_name)+' / '+e(c.name||'未命名 OA')+'</b><p>憑證保存：'+(c.encrypted_credentials?'加密紀錄已存在':'舊版設定或尚未保存')+' · Token 查驗：'+e(c.verified_at?date(c.verified_at):'尚未確認')+'</p><p>最後驗簽接收：'+e(c.last_webhook_at?date(c.last_webhook_at):'尚無成功接收')+'</p></div><div>'+badge(c.enabled?'接收開啟':'接收停用',c.enabled?'green':'')+badge(c.last_webhook_at?'曾驗簽接收':'待驗簽確認',c.last_webhook_at?'green':'amber')+'</div></article>').join('')+'</div>':empty('尚無業者 OA','請由各業者管理員在業者工作台完成 OA 設定。'))+platformPagination()+'</section>';
 if(page==='system-settings'){
  const s=platformData.settings||{};
  return '<section class="panel"><div class="panel-heading"><h2>平台自有 OA 規劃</h2>'+badge('規劃中 · 尚未串接','amber')+'</div><p>用於平台與業者間的服務。此表單只保存規劃，不輸入密鑰、不產生 Webhook，也不發送訊息。</p><form id="platform-settings-form" data-version="'+s.version+'"><div class="form-grid">'+platformInput('oa_name','平台 OA 名稱',s.oa_name,'maxlength="100"')+platformInput('provider_id','規劃 Provider ID',s.provider_id,'inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20"')+platformInput('channel_id','規劃 Channel ID',s.channel_id,'inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20"')+'</div><label>使用目的<textarea name="purpose" maxlength="500">'+e(s.purpose)+'</textarea></label><h3>通知草稿與規劃額度</h3><label>業者加入通知草稿<textarea name="onboarding_template" maxlength="1000">'+e(s.onboarding_template)+'</textarea></label><label>平台服務通知草稿<textarea name="service_template" maxlength="1000">'+e(s.service_template)+'</textarea></label>'+platformInput('monthly_limit','每月規劃發送上限',s.monthly_limit??'','type="number" min="0" max="1000000"')+'<p>空白表示尚未議定。此數字是平台規劃，不代表 LINE 官方額度；正式額度查詢、用量與失敗紀錄尚未串接。發送開關保持未啟用。</p><label>更新依據<textarea name="reference" required maxlength="500" placeholder="例如：平台 OA 用途與通知規劃"></textarea></label><button class="primary" type="submit">保存規劃</button><p class="form-error" role="alert"></p><p>最後更新：'+e(s.updated_at?date(s.updated_at):'尚未設定')+'</p></form></section>';
 }
 if(page==='system-revenue')return '<section class="panel"><div class="panel-heading"><h2>各業者合作與分潤</h2>'+badge('待議定 · 不結算','amber')+'</div>'+platformSearch()+'<p>平台費、雙方分潤、結算週期、生效日與議定依據留空。空白不代表免費或 0%。</p><div class="platform-rows">'+platformData.operators.map((o:Row)=>'<article><div><b>'+e(o.name)+'</b>'+platformData.terms.filter((t:Row)=>t.operator_id===o.id).map((t:Row)=>'<p>'+e(moduleNames[t.module])+'：平台費 '+(t.platform_fee_amount===null?'待議定':money(t.platform_fee_amount))+' · 分潤 '+(t.platform_share_bps===null?'待議定':t.platform_share_bps/100+'%')+'</p>').join('')+'</div>'+badge('本期不收費、不開通')+'</article>').join('')+'</div>'+platformPagination()+'</section>';
 if(page==='system-activity')return '<section class="panel"><div class="panel-heading"><h2>系統設定操作歷程</h2></div><p>只記錄系統設定，業者客戶與聊天歷程留在業者後台。</p>'+(platformData.length?'<div class="platform-rows">'+platformData.map((r:Row)=>'<article><div><b>更新平台 OA／通知規劃</b><p>'+e(r.actor_name)+' · '+e(date(r.created_at))+'</p><p>'+e(JSON.parse(r.detail).reference)+'</p></div></article>').join('')+'</div>':empty('尚無系統設定變更','保存規劃後會記錄實際操作人員與時間。'))+'</section>';
 return '';
}
function dashboard(){
 const open=opps.filter(o=>!['won','lost'].includes(o.stage));
 const stages=['contact','onboarding','billing','won'];
 return '<div class="metrics"><article><span>進行中案件</span><strong>'+(dashboardSnapshot?.open_count||0)+'<small>件</small></strong><p>持續跟進每一次機會</p></article><article><span>待核對收款</span><strong>'+(dashboardSnapshot?.pending_payment_count||0)+'<small>件</small></strong><p>案件階段與收款分開管理</p></article><article><span>已建檔租戶</span><strong>'+(dashboardSnapshot?.tenant_count||0)+'<small>家</small></strong><p>沿用成交企業與聯絡人</p></article><article><span>功能申請中</span><strong>'+(dashboardSnapshot?.request_count||0)+'<small>項</small></strong><p>整合未串接，尚未開通</p></article></div><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><h2>成交進度</h2><button class="text-button" data-page="pipeline" '+(!salesView()?'disabled':'')+'>查看全部 →</button></div><div class="funnel">'+stages.map((s,i)=>'<div><span class="step-number">0'+(i+1)+'</span><b>'+stageNames[s]+'</b><strong>'+(dashboardSnapshot?.stage_counts[s]||0)+'</strong><small>件案件</small></div>').join('')+'</div><div class="panel-heading"><h2>下一步，值得關注</h2><span class="muted">依跟進時間</span></div>'+caseRows(open.slice().sort((a,b)=>(a.followup_at||'z').localeCompare(b.followup_at||'z')).slice(0,4))+'</section><section class="panel service-intro"><span class="section-icon">✧</span><p class="eyebrow">CONTINUING THE CONNECTION</p><h2>先做好借址登記<br>接續長期服務</h2><p>第一期管理借址成交、合約、收款與租戶維運；官網、商城及 LINE OA 串接保留為後續功能。</p><div class="mini-services"><span>品牌官網</span><span>獨立商城</span><span>LINE OA</span><span>CRM</span></div><button data-page="tenants">管理租戶與申請 →</button><small>數位分潤標準待議定，不收費、不開通。</small></section></div><section class="integration-panel"><div><h2>整合狀態</h2><p>連線設定完成前，所有操作均為本地驗收。</p></div><div>'+badge(me.demo?'LINE OA · 尚未串接':'LINE OA · 依對話設定')+badge('金流 · 尚未串接')+badge('AI · 尚未啟用')+'</div></section>';
}
function caseRows(rows:Row[]){
 if(!rows.length)return empty('目前沒有案件','建立客戶與案件，或調整搜尋與階段篩選。',seller()?'<button class="primary" data-action="new">新增第一筆案件</button>':'');
 return '<div class="case-list">'+rows.map(o=>'<button class="case-row" data-opp="'+e(o.id)+'"><span class="company-icon">'+e(o.business_name.slice(0,1))+'</span><span class="case-main"><strong>'+e(o.business_name)+'</strong><small>'+e(o.next_action||o.title)+'</small></span><span class="case-owner">'+e(o.owner_name)+'<small>'+e(date(o.followup_at))+'</small></span>'+badge(stageNames[o.stage],o.stage==='won'?'green':'')+'<span class="row-arrow">›</span></button>').join('')+'</div>';
}
function pipeline(){
 const rows=opps;
 return '<section class="panel"><div class="list-toolbar"><div class="tabs">'+['',...Object.keys(stageNames)].map(s=>'<button data-filter="'+s+'" class="'+(filter===s?'selected':'')+'">'+(s?stageNames[s]:'全部')+' <small>'+(s?dashboardSnapshot?.stage_counts[s]||0:Object.values(dashboardSnapshot?.stage_counts||{}).reduce((n:number,v:any)=>n+Number(v),0))+'</small></button>').join('')+'</div><form id="search-form" class="search"><input name="q" aria-label="搜尋案件" placeholder="搜尋企業或案件" value="'+e(search)+'"><button type="submit" aria-label="搜尋">⌕</button></form></div><div class="list-caption"><span>企業 / 下一步</span><span>負責人 · 跟進時間 · 階段</span></div>'+caseRows(rows)+pagination('pipeline')+'</section>';
}
function tenantList(){
 const rows=tenants;
 return '<section class="panel tenant-panel"><div class="panel-heading"><h2>租戶企業 <span class="count">'+(listMeta.tenants?.total??tenants.length)+'</span></h2>'+(tenants.length?'<button data-operations="'+e(tenants[0].id)+'">租戶維運台 →</button>':'')+'<form id="search-form" class="search"><input name="q" aria-label="搜尋租戶" placeholder="搜尋企業" value="'+e(search)+'"><button type="submit" aria-label="搜尋">⌕</button></form></div>'+(rows.length?'<ul class="tenant-list" aria-label="租戶企業列表">'+rows.map(t=>{const state=serviceState({status:t.contract_status,starts_on:t.service_starts_on,ends_on:t.service_ends_on});return '<li><button class="tenant-card tenant-row" data-tenant="'+e(t.id)+'"><span class="tenant-company"><span class="company-icon" aria-hidden="true">'+e(t.name.slice(0,1))+'</span><strong class="tenant-name">'+e(t.name)+'</strong></span><span class="tenant-status">'+badge(state.label,state.tone)+'<span class="tenant-row-period">'+e(t.service_starts_on&&t.service_ends_on?t.service_starts_on+' ～ '+t.service_ends_on:'服務起迄待補')+'</span>'+'</span><span class="tenant-owner"><span class="tenant-field-label">服務承辦</span><strong>'+e(t.service_owner_name||'尚未指派')+'</strong></span><span class="tenant-requests"><span class="tenant-field-label">功能申請</span><strong>'+e(t.request_count)+' 項</strong></span><span class="tenant-open" aria-hidden="true">查看 ›</span></button></li>';}).join('')+'</ul>':empty('尚無符合的租戶','可建檔既有租戶；新成交客戶仍透過案件轉為租戶。',owner()?'<div class="empty-actions"><button class="primary" data-action="new-tenant">新增既有租戶</button><button data-page="catalog">設定據點與方案</button></div>':seller()?'<button class="primary" data-action="new">建立客戶案件</button>':''))+pagination('tenants')+'</section>';
}
function chatShell(){
 if(!chats.length)return empty('目前沒有可存取的對話','建立案件後即可管理工作對話。LINE 未串接時不會發送訊息。',seller()?'<button class="primary" data-action="new">建立案件與對話</button>':'');
 if(!chats.some(c=>c.id===selectedChat))selectedChat=chats[0].id;
 return '<section class="panel chat-layout"><div class="chat-list"><h2>工作對話 <span class="count">'+(listMeta.chat?.total??chats.length)+'</span></h2>'+chats.map(c=>'<button data-chat="'+e(c.id)+'" class="'+(selectedChat===c.id?'selected':'')+'"><span class="company-icon">'+e(c.business_name.slice(0,1))+'</span><span><b>'+e(c.business_name)+'</b><small>'+e(c.preview||'尚無訊息')+'</small></span></button>').join('')+pagination('chat')+'</div><div id="chat-detail" class="chat-detail"><p class="loading">載入對話…</p></div></section>';
}
async function loadChat(){
 if(!selectedChat)return;
 const id=selectedChat;const [rows,status]=await Promise.all([api('/conversations/'+id+'/messages'),api('/conversations/'+id+'/line-status')]);chatLine=status;if(id!==selectedChat||page!=='chat')return;
 const c=chats.find(c=>c.id===id)!;const target=document.querySelector('#chat-detail');if(!target)return;
 target.innerHTML='<div class="chat-heading"><div><h2>'+e(c.business_name)+'</h2><small>案件負責人：'+e(c.owner_name)+' · 首次接洽：'+e(staff.find(s=>s.id===c.first_agent_id)?.name||(me.demo?'尚無成功模擬回覆':'尚無 API 接受的回覆'))+'</small></div>'+badge(me.demo?'LINE 尚未串接':chatLine.send_enabled?'LINE API 已設定':chatLine.bound?'LINE 外送未啟用':'LINE 尚未綁定',chatLine.send_enabled?'green':'amber')+'<button class="text-button" data-action="refresh">更新訊息</button></div><p class="chat-notice">'+(me.demo?'本地訊息模擬，不會送到 LINE。':'API 接受不代表送達或已讀；狀態不明請重試原訊息，勿另建相同回覆。')+' 原生 OA 後台與私人通訊無法在此歸屬操作者。</p><div class="messages">'+(rows.length?rows.map((m:Row)=>'<article class="message '+(m.direction==='out'?'out':'')+'"><div class="message-meta">'+e(m.actor_name||(m.connection_id?'LINE 客戶':'虛構客戶'))+' · '+e(date(m.created_at))+'</div><div class="bubble">'+e(m.status==='removed'?'此訊息已由客戶收回':m.body)+'</div><small>'+e(m.source==='human'?'人工回覆':m.connection_id?'LINE 客戶':'客戶示範')+' · '+e(({simulated:'本地模擬完成，未發送至 LINE',failed:m.connection_id?'LINE 發送失敗':'模擬發送失敗',received_demo:'示範接收資料',received:'LINE 訊息',removed:'已收回',queued:'等待發送',sending:'發送中',accepted:'LINE API 已接受，非送達或已讀',unknown:'結果未知，請核查或重試原訊息',blocked:'設定或權限變更，已阻擋'} as Row)[m.status])+'</small>'+(['failed','unknown'].includes(m.status)&&m.actor_id===me.id?'<button data-retry="'+e(m.id)+'">'+(m.connection_id?'重試原訊息':'重試模擬')+'</button>':'')+'</article>').join(''):empty('尚無訊息','可使用下方表單模擬回覆。'))+'</div><form id="message-form" class="composer"><label class="sr-only" for="message-body">回覆內容</label><textarea id="message-body" name="body" required maxlength="2000" placeholder="'+(me.demo?'輸入工作回覆（本地模擬）':'輸入回覆內容')+'"></textarea><div>'+(me.demo?'<label class="checkbox"><input type="checkbox" name="simulate_failure">模擬失敗</label>':'<span class="muted">將以目前個人帳號留下紀錄</span>')+'<button class="primary" type="submit" '+(!me.demo&&!chatLine.send_enabled?'disabled':'')+'>'+(me.demo?'模擬回覆':'送出 LINE 訊息')+'</button></div><p class="form-error" role="alert"></p></form>';
}
async function renderActivity(){
 const rows=await api('/activity');const target=document.querySelector('#content');if(page==='activity'&&target)target.innerHTML='<section class="panel"><div class="panel-heading"><h2>最近 100 筆操作</h2><span class="muted">由伺服器記錄</span></div>'+history(rows)+'</section>';
}
function history(rows:Row[]){
 return rows.length?'<ol class="history">'+rows.map(r=>'<li><span class="history-dot"></span><div><b>'+e(actionNames[r.action]||r.action)+'</b><small>'+e(r.actor_name)+' · '+e(date(r.created_at))+'</small><details><summary>檢視紀錄</summary><pre>'+e(r.detail)+'</pre></details></div></li>').join('')+'</ol>':empty('尚無操作紀錄','接洽、轉交、收款與成交會在此保留歷程。');
}
function staffPage(){
 return '<section class="panel"><div class="panel-heading"><h2>操作人員</h2><span class="muted">一人一帳號，停權立即使工作階段失效</span></div>'+staff.map(s=>{
 const pending=!s.login_bound&&(!me.demo||!s.active);
 return '<div class="staff-row"><span class="avatar">'+e(s.name.slice(-1))+'</span><div><b>'+e(s.name)+'</b><small>'+e(roleNames[s.role])+'</small></div>'+badge(pending?'待綁定登入':s.active?'使用中':'已停權',pending?'amber':s.active?'green':'')+(s.role!=='operator_owner'&&!pending?'<button data-staff="'+e(s.id)+'" data-active="'+(s.active?'0':'1')+'">'+(s.active?'停權':'恢復')+'</button>':'')+'</div>';
 }).join('')+'<p class="panel-description">新增人員先保存姓名與分工。完成企業登入身分綁定前，不能登入或接洽客戶；此頁不會寄出邀請。</p></section>';
}
async function renderRisk(){const data=await api('/admin/risk');if(page==='risk')document.querySelector('#content')!.innerHTML='<section class="panel">'+empty(data.message,'目前沒有啟用模型、規則或告警。此畫面不代表已分析，也不判定任何人員風險。')+'</section><section class="panel"><h2>業者 LINE OA 設定</h2><p>連接業者自己的 OA，接收來客及準備租戶收件通知。</p><button class="primary" data-page="line-settings">設定業者 LINE OA →</button></section>';}
async function newOpportunity(businessId=''){
 const businesses=await api('/businesses');
 showModal('<p class="eyebrow">NEW OPPORTUNITY</p><h2>建立成交案件</h2><p class="muted">企業與聯絡人會沿用至租戶管理。</p><form id="opportunity-form"><label>企業來源<select name="business_id" id="business-select"><option value="">建立新企業</option>'+businesses.map((b:Row)=>'<option value="'+e(b.id)+'" '+(b.id===businessId?'selected':'')+'>'+e(b.name)+'</option>').join('')+'</select></label><div id="new-business" '+(businessId?'hidden':'')+'><div class="form-grid"><label>企業名稱<input name="business_name" maxlength="150" '+(!businessId?'required':'')+'></label><label>統編（選填）<input name="registration_no" pattern="[0-9]{8}" maxlength="8"></label><label>聯絡人<input name="contact_name" maxlength="100" '+(!businessId?'required':'')+'></label><label>電話<input name="phone" maxlength="50"></label><label>Email<input type="email" name="email" maxlength="200"></label></div></div><label>案件名稱<input name="title" value="借址登記與企業服務" required maxlength="150"></label><div class="form-grid"><label>案件負責人<select name="owner_id" '+(!owner()?'disabled':'')+'>'+options(staff.filter(s=>['operator_owner','operator_sales'].includes(s.role)&&s.active),me.id)+'</select></label><label>預估金額（NT$）<input type="number" name="amount" value="0" min="0" max="1000000000" required></label><label>來源<input name="source" value="人工建立" required maxlength="100"></label><label>下次跟進（台北時間）<input type="datetime-local" name="followup_at"></label></div><label>下一步<input name="next_action" maxlength="500" placeholder="例：確認登記需求"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">建立案件</button></form>');
}
async function newTenant(){
 showModal('<p class="eyebrow">EXISTING TENANT</p><h2>新增既有租戶</h2><p class="muted">供已在服務中的租戶轉入建檔；不會自動建立成交紀錄、收款、合約或開通數位功能。新洽談客戶請先建立案件。</p><form id="tenant-form"><div class="form-grid"><label>企業名稱<input name="business_name" required maxlength="150"></label><label>統編（選填）<input name="registration_no" pattern="[0-9]{8}" maxlength="8"></label><label>聯絡人<input name="contact_name" required maxlength="100"></label><label>電話<input name="phone" maxlength="50"></label><label>Email<input type="email" name="email" maxlength="200"></label><label>服務承辦人<select name="service_owner_id">'+options(staff.filter(s=>s.active&&['operator_owner','operator_sales','operator_service'].includes(s.role)),me.id)+'</select></label></div><label>建檔依據<input name="reference" required maxlength="500" placeholder="例：既有借址服務客戶轉入"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">新增租戶</button></form>');
}
function newStaff(){
 showModal('<p class="eyebrow">STAFF PROFILE</p><h2>新增操作人員</h2><p class="muted">先建立人員資料。新增後為待綁定登入，完成企業身分綁定前不能登入或負責案件。</p><form id="staff-form"><label>人員姓名<input name="name" required maxlength="100"></label><label>人員角色<select name="role"><option value="operator_sales">業務</option><option value="operator_service">維運</option><option value="operator_finance">財務</option></select></label><p class="form-error" role="alert"></p><button class="primary" type="submit">新增人員資料</button></form>');
}
async function showOpportunity(id:string){
 const o=await api('/opportunities/'+id);const [events,business]=await Promise.all([api('/activity?business_id='+encodeURIComponent(o.business_id)),api('/businesses/'+o.business_id)]);
 const canEdit=seller();const canPay=['operator_owner','operator_finance'].includes(me.role);
 showModal('<p class="eyebrow">OPPORTUNITY</p><h2>'+e(business.name)+'</h2><p>'+e(o.title)+'</p><div class="detail-badges">'+badge(stageNames[o.stage],'green')+badge(o.payment_status==='paid'?'人工核對已收款':'尚未收款',o.payment_status==='paid'?'green':'amber')+badge('LINE／金流尚未串接')+'</div><p class="muted">'+o.contacts.map((c:Row)=>e(c.name)+' · '+e(c.phone)+' · '+e(c.email)).join('<br>')+'</p><form id="edit-form" data-id="'+e(o.id)+'" data-version="'+o.version+'"><div class="form-grid"><label>階段<select aria-label="階段" name="stage" '+(!canEdit||o.stage==='won'?'disabled':'')+'>'+Object.entries(stageNames).filter(([s])=>s!=='won'||o.stage==='won').map(([s,n])=>'<option value="'+s+'" '+(o.stage===s?'selected':'')+'>'+n+'</option>').join('')+'</select></label><label>案件負責人<select name="owner_id" '+(!canEdit?'disabled':'')+'>'+options(staff.filter(s=>['operator_owner','operator_sales'].includes(s.role)&&(s.active||s.id===o.owner_id)),o.owner_id)+'</select></label><label>預估金額（NT$）<input name="amount" type="number" min="0" max="1000000000" value="'+o.amount+'" '+(!canEdit?'disabled':'')+' required></label><label>下次跟進（台北時間）<input name="followup_at" type="datetime-local" value="'+e(o.followup_at?new Date(new Date(o.followup_at).getTime()+8*3600000).toISOString().slice(0,16):'')+'" '+(!canEdit?'disabled':'')+'></label></div><label>下一步<input name="next_action" maxlength="500" value="'+e(o.next_action)+'" '+(!canEdit?'disabled':'')+'></label><label>原因／備註<textarea name="note" maxlength="1000" '+(!canEdit?'disabled':'')+'>'+e(o.note)+'</textarea></label><p class="form-error" role="alert"></p>'+(canEdit?'<button class="primary" type="submit">儲存案件</button>':'')+'</form>'+(canEdit&&o.stage==='billing'?'<div class="handoff"><h3>完成成交，接續租戶服務</h3><p>沿用企業與聯絡人。成交不代表已收款或功能已開通。</p><button class="primary" data-win="'+e(o.id)+'" data-version="'+o.version+'">成交轉租戶</button></div>':'')+(o.stage==='won'?'<div class="handoff"><p>已成交 · 數位功能尚未開通</p><button data-tenant="'+e(o.business_id)+'">查看租戶與功能申請 →</button></div>':'')+(canPay?'<details class="payment"><summary>人工收款核對（未串接金流）</summary><form id="payment-form" data-id="'+e(o.id)+'" data-version="'+o.version+'"><label>付款紀錄<select name="payment_status"><option value="unpaid" '+(o.payment_status==='unpaid'?'selected':'')+'>尚未收款</option><option value="paid" '+(o.payment_status==='paid'?'selected':'')+'>人工核對已收款</option></select></label><label>核對依據<input name="reference" required maxlength="300" placeholder="填寫人工確認依據，不填真實敏感帳號"></label><p class="form-error" role="alert"></p><button type="submit">儲存核對紀錄</button></form></details>':'')+'<h3 class="section-title">操作歷程</h3>'+history(events));
}

const termNames:Row={monthly:'月約',annual:'年約',two_year:'兩年約',custom:'自訂期間'};
const cycleNames:Row={once:'一次繳清',monthly:'每月繳付',quarterly:'每季繳付',half_yearly:'每半年繳付',yearly:'每年繳付',custom:'依個別約定'};
const mailServiceNames:Row={included:'已包含',excluded:'未包含',by_agreement:'另依約定'};
function serviceState(c?:Row){
 if(!c?.status)return {label:'待建立借址合約',tone:'amber'};
 if(c.status==='draft')return {label:'合約待確認',tone:'amber'};
 if(c.status==='ended')return {label:'服務已終止',tone:''};
 if(c.starts_on>today())return {label:'服務尚未開始',tone:''};
 if(c.ends_on<today())return {label:'借址服務已到期',tone:'amber'};
 return {label:'借址服務中',tone:'green'};
}
function renewalHint(c:Row){
 if(c.status==='ended')return '已終止，保留歷程';
 if(c.status==='draft')return '請先確認合約';
 if(c.starts_on>today())return '於 '+c.starts_on+' 開始服務';
 const days=Math.round((Date.parse(c.ends_on+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000);
 if(days<0)return '已到期 '+Math.abs(days)+' 天，請確認續約或遷出';
 if(days===0)return '今日到期，請確認下一期';
 return (days<=60?'待跟進續約 · ':'')+'距到期 '+days+' 天';
}
function serviceFacts(c:Row){
 return '<dl class="tenant-service-facts"><div><dt>服務起日</dt><dd>'+e(c.starts_on)+'</dd></div><div><dt>服務迄日（含當日）</dt><dd>'+e(c.ends_on)+'</dd></div><div><dt>合約類型</dt><dd>'+e(termNames[c.term_kind]||'待補資料')+'</dd></div><div><dt>約定付款週期</dt><dd>'+e(cycleNames[c.payment_cycle]||'待補資料')+'</dd></div>'+(opsMoney()?'<div><dt>本期借址合約總額</dt><dd>'+money(c.amount)+'</dd></div>':'')+'<div><dt>郵件代收</dt><dd>'+e(mailServiceNames[c.mail_service]||'待確認是否包含')+'</dd></div><div class="fact-wide"><dt>到期與續約</dt><dd>'+e(renewalHint(c))+'</dd></div></dl>';
}
function contractServiceRows(contracts:Row[],id?:string){
 return contracts.length?'<div class="tenant-contract-list">'+contracts.map(c=>{const state=serviceState(c);return '<article class="tenant-contract"><div class="tenant-contract-heading"><div><h4>借址登記 · '+e(c.location_name)+'</h4><p>'+e(c.address)+'</p></div>'+badge(state.label,state.tone)+'</div>'+serviceFacts(c)+'<p class="muted">合約依據：'+e(c.reference||'待確認')+(c.renewal_of?' · 續約合約':'')+'</p></article>';}).join('')+'</div>':'<div class="tenant-missing"><b>尚未建立借址合約</b><p>租戶建檔不代表服務已生效。請補登登記據點、服務起迄、合約類型及收費約定。</p>'+(id?'<button class="primary" data-tenant-contract="'+e(id)+'">＋ 補登借址合約</button>':'')+'</div>';
}
function digitalServiceRows(b:Row,id:string){
 return '<div class="service-grid tenant-digital-list" role="list">'+Object.entries(moduleNames).map(([key,name])=>{
  const req=b.services.find((s:Row)=>s.module===key&&s.status==='requested');
  const record=(b.digital_records||[]).find((r:Row)=>r.module===key);
  return '<article role="listitem"><div><h4>'+e(name)+'</h4>'+badge(req?(futureDigital()?'申請中':'既有需求紀錄'):'後續功能',req?'amber':'')+'</div><p>尚未串接 · 未開通 · 分潤待議定</p><dl><div><dt>服務起迄</dt><dd>'+e(record?'既有預覽紀錄：'+record.starts_on+' ～ '+record.ends_on+'（未開通）':'尚未開通，服務期間待確認')+'</dd></div><div><dt>收費方式</dt><dd>月租／年租與平台分潤待議定</dd></div></dl>'+(canRequest()?req?'<button data-cancel="'+e(req.id)+'" data-business="'+e(id)+'">取消申請</button>':'<button data-module="'+key+'" data-business="'+e(id)+'">提出需求</button>':'')+'</article>';
 }).join('')+'</div>';
}
async function showTenant(id:string){
 const [b,summary,events,mailLine]=await Promise.all([api('/businesses/'+id),api('/businesses/'+id+'/service-summary'),api('/activity?business_id='+encodeURIComponent(id)),opsService()?api('/businesses/'+id+'/mail-line'):Promise.resolve(null)]);
 b.digital_records=summary.digital_records||[];const contracts=summary.contracts||[],state=serviceState(contracts[0]);
 showModal('<p class="eyebrow">租戶服務與合約</p><h2>'+e(b.name)+'</h2><div class="detail-badges">'+badge(state.label,state.tone)+badge('數位服務尚未開通')+'</div><h3 class="section-title">借址服務與合約</h3><p class="muted">依合約確認服務期間；合約類型與付款週期分別管理。到期後不會自動續約或扣款。</p>'+contractServiceRows(contracts,seller()?id:undefined)+'<div class="tenant-detail-actions"><button class="primary" data-operations="'+e(id)+'">開啟租戶維運台 →</button>'+(seller()&&contracts.length?'<button data-tenant-contract="'+e(id)+'">＋ 新增借址合約</button>':'')+'</div><h3 class="section-title">聯絡資料與服務承辦</h3><div class="tenant-contact-list">'+b.contacts.map((c:Row)=>'<div><b>'+e(c.name)+'</b><span>'+e(c.phone||'電話待補')+'</span><span>'+e(c.email||'Email 待補')+'</span></div>').join('')+'</div>'+(owner()?'<form id="assignee-form" data-id="'+e(id)+'"><div class="tenant-assignee"><label>服務承辦人<select name="service_owner_id">'+options(staff.filter(s=>s.active&&['operator_owner','operator_sales','operator_service'].includes(s.role)),b.service_owner_id)+'</select></label><button type="submit">指派承辦人</button></div><p class="form-error" role="alert"></p></form>':'<p class="muted">服務承辦：'+e(staff.find(s=>s.id===b.service_owner_id)?.name||'尚未指派')+'</p>')+(mailLine?'<h3 class="section-title">LINE 收件通知</h3>'+mailLineSummary(mailLine,id):'')+'<h3 class="section-title">一次性代辦服務</h3><p class="muted">公司設立、遷址代辦屬另案一次性服務，不等同借址年約。本期未提供獨立代辦收費台帳；是否包含於現有合作，請依實際合約確認。</p><h3 class="section-title">企業數位服務租用</h3><p class="muted">品牌官網、商城與 LINE OA／CRM 為後續服務。費率與平台分潤待議定，第一期不收費、不開通；既有預覽訂閱僅在維運台保留唯讀歷程。</p>'+digitalServiceRows(b,id)+(seller()&&futureDigital()?'<button class="primary" data-upsell="'+e(id)+'">＋ 建立加購案件</button>':'')+'<h3 class="section-title">服務與操作歷程</h3>'+history(events));
}
function formData(form:HTMLFormElement):Row{return Object.fromEntries(new FormData(form));}
function followUTC(value:string){return value?new Date(value+':00+08:00').toISOString():'';}
document.addEventListener('change',event=>{
 const target=event.target as HTMLSelectElement;
 if(target.name==='term_kind'&&target.closest('#ops-form')&&['contract','renew-contract'].includes((target.closest('#ops-form') as HTMLElement).dataset.op||'')){
  const form=target.closest('form')!,start=(form.elements.namedItem('starts_on') as HTMLInputElement).value;
  const months=({monthly:1,annual:12,two_year:24} as Row)[target.value];
  if(start&&months)(form.elements.namedItem('ends_on') as HTMLInputElement).value=calendarEnd(start,months);
 }
 if(target.id==='operations-business'){opsBusiness=target.value;void renderOperations();}
 if(target.id==='business-select'){
  const box=document.querySelector<HTMLElement>('#new-business')!;box.hidden=!!target.value;
  box.querySelectorAll<HTMLInputElement>('input[name="business_name"],input[name="contact_name"]').forEach(i=>i.required=!target.value);
 }
});
document.addEventListener('submit',async event=>{
 const form=event.target as HTMLFormElement;event.preventDefault();if(busy)return;busy=true;
 const button=form.querySelector<HTMLButtonElement>('button[type="submit"]');if(button)button.disabled=true;
 try{
  const d=formData(form);
  if(form.id==='platform-search'){search=d.q;platformOffset=0;await refresh(true);}
  if(form.id==='platform-settings-form'){
   await api('/platform/settings','PATCH',{...d,version:Number(form.dataset.version),monthly_limit:d.monthly_limit===''?null:Number(d.monthly_limit)});
   await refresh(true);toast('平台規劃已保存；尚未串接或發送');
  }
  if(form.id==='mail-line-search'){await showMailLineForm(form.dataset.business!,d.q);}
  if(form.id==='mail-line-form'||form.id==='mail-line-unlink'){
   const businessId=form.dataset.business!,unlink=form.id==='mail-line-unlink';
   await api('/businesses/'+businessId+'/mail-line','POST',{action:unlink?'unlink':'link',version:Number(form.dataset.version),reference:d.reference,...(unlink?{}:{line_contact_id:d.line_contact_id,recipient_name:d.recipient_name})});
   dialog.close();if(page==='operations')await renderOperations();else await showTenant(businessId);
   toast(unlink?'收件通知綁定已解除；沒有發送訊息':'通知聯絡人已保存；實際推播尚未啟用');
  }
  if(form.id==='line-settings-form'){
   const id=form.dataset.id;if(id){d.version=Number(form.dataset.version);if(!d.channel_secret)delete d.channel_secret;if(!d.channel_access_token)delete d.channel_access_token;}
   try{await api('/line/settings'+(id?'/'+id:''),id?'PATCH':'POST',d);}
   finally{for(const key of ['channel_secret','channel_access_token']){const input=form.elements.namedItem(key) as HTMLInputElement;input.value='';delete d[key];}}
   dialog.close();await renderLineSettings();toast('OA 接收設定已保存；請完成 Webhook 設定，推播仍未啟用');
  }
  if(form.id==='line-status-form'){
   await api('/line/settings/'+form.dataset.id+'/status','PATCH',{version:Number(form.dataset.version),enabled:form.dataset.enabled==='1',reference:d.reference});
   dialog.close();await renderLineSettings();toast('接收開關已更新，操作人員已記錄');
  }
  if(form.id==='ops-form'){
   const op=form.dataset.op!,id=form.dataset.id;const version=Number(form.dataset.version);
   const key=form.dataset.requestKey!;
   let path='',method='POST',payload:Row={...d,request_key:key};
   if(op==='contract-terms'){path='/businesses/'+opsBusiness+'/contracts/'+id+'/terms';method='PATCH';payload.version=version;delete payload.request_key;}
   if(op==='contract'||op==='renew-contract'){path='/businesses/'+opsBusiness+'/contracts'+(id?'/'+id+'/renew':'');payload.amount=Number(d.amount);if(id)payload.version=version;}
   if(op==='subscription'||op==='renew-subscription'){path='/businesses/'+opsBusiness+'/subscriptions'+(id?'/'+id+'/renew':'');if(id)payload.version=version;}
   if(op==='invoice'){const [kind,source_id]=d.kind_source.split(':');path='/businesses/'+opsBusiness+'/invoices';payload={kind,source_id,due_on:d.due_on,request_key:key};}
   if(op==='ledger'){path='/businesses/'+opsBusiness+'/invoices/'+id+'/ledger';payload.amount=Number(d.amount);payload.version=version;if(d.direction==='receipt')delete payload.refund_of;}
   if(op==='mail')path='/businesses/'+opsBusiness+'/mail';
   if(op==='ticket')path='/businesses/'+opsBusiness+'/tickets';
   if(op==='location'){path='/operations/locations';delete payload.request_key;}
   if(op==='plan'){path='/operations/plans';delete payload.request_key;payload.amount=Number(d.amount);payload.duration_days=Number(d.duration_days);payload.quota_limit=Number(d.quota_limit);}
   await api(path,method,payload);dialog.close();if(page==='catalog')await renderCatalog();else await renderOperations();toast('紀錄已保存；沒有執行付款、配送或功能開通');
  }
  if(form.id==='ops-state-form'){
   await api('/businesses/'+opsBusiness+'/'+form.dataset.kind+'/'+form.dataset.id,'PATCH',{...d,status:form.dataset.status,version:Number(form.dataset.version)});
   dialog.close();await renderOperations();toast('狀態已更新，實際操作者已記錄');
  }
  if(form.id==='login-form'){await api('/demo/login','POST',d);await start();}
  if(form.id==='search-form'){search=d.q;resetList(page);render(true);await refresh();}
  if(form.id==='tenant-form'){const result=await api('/tenants','POST',d);dialog.close();page='tenants';search='';await refresh();await showTenant(result.business_id);toast('既有租戶已建檔，未自動成交、收款或開通功能');}
  if(form.id==='staff-form'){await api('/staff','POST',d);dialog.close();staff=await api('/staff');render();toast('人員資料已新增，待完成登入身分綁定');}
  if(form.id==='opportunity-form'){
   d.amount=Number(d.amount);d.followup_at=followUTC(d.followup_at);if(!owner())d.owner_id=me.id;
   if(d.business_id){for(const k of ['business_name','registration_no','contact_name','phone','email'])delete d[k];}else delete d.business_id;
   const result=await api('/opportunities','POST',d);dialog.close();await refresh();await showOpportunity(result.id);toast('案件已建立，企業與聯絡人已保存');
  }
  if(form.id==='edit-form'){
   d.version=Number(form.dataset.version);d.amount=Number(d.amount);d.followup_at=followUTC(d.followup_at);
   await api('/opportunities/'+form.dataset.id,'PATCH',d);dialog.close();await refresh();toast('案件已儲存，操作人員已記錄');
  }
  if(form.id==='payment-form'){
   d.version=Number(form.dataset.version);await api('/opportunities/'+form.dataset.id+'/payment','PATCH',d);
   await refresh();await showOpportunity(form.dataset.id!);toast('已保存人工核對紀錄；未進行金流交易');
  }
  if(form.id==='assignee-form'){await api('/businesses/'+form.dataset.id+'/assignee','PATCH',d);await refresh();await showTenant(form.dataset.id!);toast('服務承辦人已更新');}
  if(form.id==='message-form'){
   // Preserve key across network errors; editing text creates a distinct request.
   if(form.dataset.body!==d.body){form.dataset.key=crypto.randomUUID();form.dataset.body=d.body;}
   await api('/conversations/'+selectedChat+'/messages','POST',{body:d.body,idempotency_key:form.dataset.key,...(me.demo?{simulate_failure:d.simulate_failure==='on'}:{})});
   await refresh();toast(me.demo?(d.simulate_failure==='on'?'已記錄模擬失敗，可由原發送人重試':'本地模擬完成，未發送至 LINE'):'已加入外送佇列，請重新整理查看狀態');
  }
 }catch(err){if(form.querySelector('.form-error'))formError(form,(err as Error).message);else toast((err as Error).message);}
 finally{busy=false;if(button)button.disabled=false;}
});
document.addEventListener('click',async event=>{
 const target=(event.target as HTMLElement).closest<HTMLElement>('button,a');if(!target)return;
 const d=target.dataset;try{
 if(d.workspace){
  event.preventDefault();if(d.workspace==='platform'&&!me.platform_access)return;
  systemView=d.workspace==='platform';page=systemView?'system-overview':'dashboard';search='';platformOffset=0;viewRevision++;clearReads();root.innerHTML='';
  const url=new URL(location.href);if(systemView)url.searchParams.set('workspace','platform');else url.searchParams.delete('workspace');window.history.replaceState(null,'',url);render(true);await refresh();return;
 }
 if(d.platformPage){platformOffset=Math.max(0,platformOffset+(d.platformPage==='next'?50:-50));await refresh();return;}
 if(d.tenantContract){opsBusiness=d.tenantContract;opsTab='contracts';dialog.close();page='operations';render(true);await refresh();await renderOperations();if(opsData?.business.id===opsBusiness&&seller())await showOpsForm('contract');}
 if(d.operations){opsBusiness=d.operations;opsTab='overview';dialog.close();page='operations';render(true);await refresh();}
 if(d.opsTab){opsTab=d.opsTab;void renderOperations();}
 if(d.mailLine)await showMailLineForm(d.mailLine);
 if(d.mailPreview)await showMailPreview(d.business!,d.mailPreview);
 if(d.lineNew)showLineSettingsForm();
 if(d.lineEdit)showLineSettingsForm(d.lineEdit);
 if(d.lineCheck){await api('/line/settings/'+d.lineCheck+'/check','POST',{version:Number(d.version)});await renderLineSettings();toast('LINE 憑證已確認；請另外確認 Webhook 實際接收');}
 if(d.lineStatus)showLineStatusForm(d.lineStatus);
 if(d.copyWebhook){const input=document.getElementById(d.copyWebhook) as HTMLInputElement;input.select();try{await navigator.clipboard.writeText(input.value);toast('Webhook 網址已複製');}catch{toast('請複製已選取的 Webhook 網址');}}
 if(d.opsNew)await showOpsForm(d.opsNew,d.id);
 if(d.opsState)showOpsState(d.opsState);
 if(d.opsLedger)await showLedger(d.opsLedger);
 if(d.opsCatalog)await showCatalog();
 if(d.planToggle){await api('/operations/plans/'+d.planToggle,'PATCH',{active:d.active==='1',version:Number(d.version)});if(page==='catalog')await renderCatalog();else {await renderOperations();await showCatalog();}toast('方案狀態已更新；既有訂閱快照不變');}
 if(d.action==='access-login'){await api('/auth/access','POST',{});await start();}
 if(d.action==='sidebar-toggle'){layoutPrefs.sidebar=!layoutPrefs.sidebar;saveLayout();applySidebar();}
 if(d.action==='fold'){const body=document.getElementById(target.getAttribute('aria-controls')||'');if(body){const open=target.getAttribute('aria-expanded')!=='true';body.hidden=!open;target.setAttribute('aria-expanded',String(open));target.setAttribute('aria-label',(open?'收合':'展開')+(d.foldTitle||'內容'));target.textContent=open?'收合 ▴':'展開 ▾';layoutPrefs.sections[d.foldKey!]=open;saveLayout();}}
 if(d.action==='menu')document.querySelector('.shell')?.classList.add('menu-open');
 if(d.action==='menu-close')document.querySelector('.shell')?.classList.remove('menu-open');
 if(d.action==='close')dialog.close();
 if(d.action==='logout'){viewRevision++;clearReads();await api('/logout','POST',{});opps=[];tenants=[];chats=[];staff=[];platformData={};systemView=false;platformOffset=0;for(const kind of ['pipeline','tenants','chat'])resetList(kind);me=undefined as unknown as Row;page='dashboard';search='';filter='';dialog.close();await loginScreen();}
 if(d.page){event.preventDefault();page=d.page;search='';filter='';platformOffset=0;resetList(page);render(true);await refresh();}
 if(d.action==='new')await newOpportunity();
 if(d.action==='new-tenant'&&owner())await newTenant();
 if(d.action==='new-staff'&&owner())newStaff();
 if(d.filter!==undefined){filter=d.filter;resetList('pipeline');render(true);await refresh();}
 if(d.listPage){const kind=d.listPage;if(d.direction==='next'&&listMeta[kind]?.next_cursor){listCursors[kind][listIndex[kind]+1]=listMeta[kind].next_cursor;listIndex[kind]++;}else if(d.direction==='previous'&&listIndex[kind]>0)listIndex[kind]--;render(true);await refresh();}
 if(d.opp)await showOpportunity(d.opp);
 if(d.tenant)await showTenant(d.tenant);
 if(d.chat){selectedChat=d.chat;render();}
 if(d.upsell)await newOpportunity(d.upsell);
 if(d.win){target.setAttribute('disabled','');await api('/opportunities/'+d.win+'/win','POST',{version:Number(d.version)});dialog.close();page='tenants';await refresh();toast('已成交並轉為租戶；功能仍未開通');}
 if(d.module){await api('/businesses/'+d.business+'/services','POST',{module:d.module});await refresh();await showTenant(d.business!);toast('需求已保存，目前仍未開通');}
 if(d.cancel){await api('/businesses/'+d.business+'/services/'+d.cancel,'PATCH',{status:'cancelled'});await refresh();await showTenant(d.business!);toast('申請已取消');}
 if(d.retry){await api('/conversations/'+selectedChat+'/messages/'+d.retry+'/retry','POST',{});await refresh();toast(me.demo?'本地重試完成；沒有新增重複訊息':'已請求原訊息重試，沒有另建訊息');}
 if(d.action==='recover'){target.setAttribute('disabled','');const result=await api('/line/recover','POST',{});await refresh();toast('已處理 '+result.received+' 筆接收事件，外送'+(result.disabled?'未啟用':result.processed+' 筆')+'');}
 if(d.attach){const select=document.querySelector<HTMLSelectElement>('[data-contact-select="'+d.attach+'"]');if(!select?.value)throw new Error('請先選擇案件');await api('/line/inbox/'+d.attach+'/attach','POST',{conversation_id:select.value});await refresh();toast('來客已分派，歷史訊息已加入案件對話');}
 if(d.action==='refresh'){await refresh(true);}
 if(d.staff){await api('/staff/'+d.staff+'/status','PATCH',{active:d.active==='1'});staff=await api('/staff');render();toast('人員狀態已更新');}
 }catch(err){toast((err as Error).message);target.removeAttribute('disabled');}
});
window.addEventListener('unhandledrejection',event=>{event.preventDefault();if(event.reason?.name==='AbortError')return;toast(event.reason?.message||'載入失敗，請重新整理');});
void start().catch(err=>{root.innerHTML='<main class="login"><h1>暫時無法載入</h1><p>'+e(err.message)+'</p><p>請重新整理頁面後再試。</p></main>';});


async function renderLineSettings(){
 if(!owner()||page!=='line-settings')return;
 const target=document.querySelector('#content')!;
 target.innerHTML='<p class="loading">正在載入 LINE OA 設定…</p>';
 try{
  const state=await api('/line/settings');if(page!=='line-settings')return;lineSettings=state;
  target.innerHTML='<section class="panel line-settings-panel"><div class="panel-heading"><h2>業者 LINE OA 串接設定</h2><button class="primary" data-line-new="1" '+(!state.storage_ready?'disabled':'')+'>＋ 新增業者 OA</button></div><p class="panel-description">此處連接借址業者自己的 OA，用於接收來客、分派案件與租戶收件通知準備。租戶付費租用自己的 OA 是後續數位服務。</p><p class="line-setting-notice">'+e(state.note)+'</p>'+(!state.storage_ready?'<p class="line-setting-notice">'+e(state.simulation?'目前為獨立測試區，不接受真實 LINE 憑證；請從側欄返回正式工作台。':'此環境安全保存尚未就緒，不能輸入或保存 LINE 憑證。')+'</p>':'')+(state.connections.length?'<div class="line-settings-list">'+state.connections.map((c:Row)=>'<article class="line-settings-row"><div class="line-settings-row-heading"><h3>'+e(c.name||c.id)+'</h3><div>'+badge(c.enabled?'接收開啟':'接收停用',c.enabled?'green':'')+badge(c.last_webhook_at?'已驗簽接收':'Webhook 尚待確認',c.last_webhook_at?'green':'amber')+badge('推播未啟用','amber')+'</div></div><p>Channel '+e(c.channel_id)+' · Provider '+e(c.provider_id)+'</p><p>憑證：'+(c.signature_configured&&c.token_configured?'已保存，不回顯':'待補齊／無法讀取')+' · Token 最後確認：'+e(c.verified_at?date(c.verified_at):'尚未確認')+'</p><p>Webhook 最後驗簽：'+e(c.last_webhook_at?date(c.last_webhook_at):'尚無成功接收')+'</p>'+(c.webhook_url?'<label>此 OA 的 Webhook 網址<div class="webhook-field"><input readonly id="webhook-'+e(c.id)+'" value="'+e(c.webhook_url)+'"><button data-copy-webhook="webhook-'+e(c.id)+'">複製網址</button></div></label>':'')+'<div class="ops-actions"><button data-line-edit="'+e(c.id)+'" '+(!state.storage_ready?'disabled':'')+'>編輯設定／更換憑證</button><button data-line-check="'+e(c.id)+'" data-version="'+c.version+'" '+(!state.storage_ready?'disabled':'')+'>確認憑證連線</button><button data-line-status="'+e(c.id)+'" '+(!state.storage_ready?'disabled':'')+'>'+(c.enabled?'停用接收':'啟用接收')+'</button></div></article>').join('')+'</div>':empty('尚無業者 OA 設定','新增後將產生專屬 Webhook 網址；保存不等於已收到 LINE 訊息。'))+'</section><section class="panel line-setup-help"><div class="panel-heading"><h2>串接步驟</h2></div><ol><li>在 <a href="https://manager.line.biz/" target="_blank" rel="noopener">LINE Official Account Manager</a> 啟用 Messaging API，並確認使用正確 Provider。</li><li>在 <a href="https://developers.line.biz/console/" target="_blank" rel="noopener">LINE Developers Console</a> 取得 Provider ID、Channel ID、Channel secret 及長期 Channel access token，再於本頁新增 OA。</li><li>複製保存後產生的 Webhook 網址，貼到該 Channel 的 Messaging API 設定；按 Verify，再開啟 Use webhook。</li><li>用客戶 LINE 加入業者 OA，傳一則文字；回本頁重新整理，確認「已驗簽接收」，再到整合中心分派來客或綁定租戶收件聯絡人。</li></ol><p>「確認憑證連線」只查驗 Token 與 OA 資訊，不發送訊息，也不能取代 Webhook 接收驗收。一般 LINE ID 不填在此處。</p><div class="ops-actions"><button data-action="refresh">重新整理設定</button><button data-page="integrations">前往整合中心 →</button></div></section>';
 }catch(error){if(page==='line-settings')target.innerHTML=empty('設定載入失敗',String((error as Error).message));}
}
function showLineSettingsForm(id?:string){
 if(!owner()||!lineSettings.storage_ready)return;
 const c=id?lineSettings.connections.find((c:Row)=>c.id===id):null;if(id&&!c)return;
 const input=(name:string,label:string,value='',extra='')=>'<label>'+label+'<input name="'+name+'" value="'+e(value)+'" '+extra+'></label>';
 showModal('<p class="eyebrow">業者管理員專用 · 業者自有 OA</p><h2>'+(c?'編輯 OA 設定':'新增業者 LINE OA')+'</h2><form id="line-settings-form" data-id="'+e(id||'')+'" data-version="'+(c?.version||1)+'" autocomplete="off">'+input('name','OA 名稱',c?.name||'', 'required maxlength="100"')+(c?'<p>Channel '+e(c.channel_id)+' · Provider '+e(c.provider_id)+'（帳號識別固定，改接另一個 OA 請另建連線）</p>':'<div class="form-grid">'+input('provider_id','Provider ID','','required inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20"')+input('channel_id','Channel ID','','required inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20"')+'</div>')+input('channel_secret',c?'新 Channel secret（留空沿用）':'Channel secret','','type="password" autocomplete="new-password" maxlength="64" '+(c?'':'required'))+input('channel_access_token',c?'新長期 Channel access token（留空沿用）':'長期 Channel access token','','type="password" autocomplete="new-password" maxlength="5000" '+(c?'':'required'))+'<label>設定／更新依據<textarea name="reference" required maxlength="500" placeholder="例如：已由業者 OA 管理員確認授權串接"></textarea></label><p class="muted">憑證以加密形式保存，只有伺服器使用；不回顯、不放入操作歷程。送出後即清除輸入欄位，即使驗證失敗也需重新貼入。新增會開啟接收，但不開啟客戶推播。</p><button class="primary" type="submit">驗證並保存 OA 設定</button><p class="form-error" role="alert"></p></form>');
}
function showLineStatusForm(id:string){
 const c=lineSettings.connections.find((c:Row)=>c.id===id);if(!owner()||!c||!lineSettings.storage_ready)return;
 showModal('<h2>'+(c.enabled?'停用':'啟用')+' OA 接收</h2><p>此開關只管理接收狀態，客戶推播仍未啟用。停用保留來客、租戶綁定及歷程。</p><form id="line-status-form" data-id="'+e(id)+'" data-version="'+c.version+'" data-enabled="'+(c.enabled?'0':'1')+'"><label>操作依據<textarea name="reference" required maxlength="500"></textarea></label><button type="submit" class="primary">確認接收開關</button><p class="form-error" role="alert"></p></form>');
}

async function renderIntegrations(){
 const [state,pending]=await Promise.all([api('/integrations'),api('/line/inbox')]);
 if(page!=='integrations')return;
 const target=document.querySelector('#content')!;
 target.innerHTML='<div class="metrics"><article><span>LINE Channel</span><strong>'+state.line.length+'<small>組</small></strong><p>各業者獨立設定與隔離</p></article><article><span>待處理接收事件</span><strong>'+state.inbox_pending+'<small>筆</small></strong><p>已持久保存，可重新處理</p></article><article><span>待分派來客</span><strong>'+pending.length+'<small>位</small></strong><p>先核對企業再分派案件</p></article><article><span>外送紀錄</span><strong>'+state.outbox.reduce((n:number,r:Row)=>n+r.count,0)+'<small>筆</small></strong><p>API 接受不代表客戶已讀</p></article></div><section class="panel"><div class="panel-heading"><h2>業者 LINE OA 連線</h2>'+'<button class="primary" data-page="line-settings">設定業者 LINE OA →</button>'+badge(me.demo?'本地示範，不對外發訊':'接收與外送分開','amber')+'</div>'+(state.line.length?'<div class="connection-list">'+state.line.map((c:Row)=>'<article class="connection-card"><div><h3>'+e(c.id)+'</h3><p class="muted">Channel '+e(c.channel_id)+' · Provider '+e(c.provider_id)+'</p></div><div class="detail-badges">'+badge(c.signature_configured&&c.enabled?'驗簽已設定':'驗簽尚未設定',c.signature_configured&&c.enabled?'green':'amber')+badge(c.send_enabled?'外送已啟用':'外送未啟用',c.send_enabled?'green':'amber')+'</div><p class="muted">最後接收：'+e(c.last_received?date(c.last_received):'尚無事件')+'</p></article>').join('')+'</div>':empty('LINE OA 尚未串接','請由業者管理員開啟「LINE OA 串接」設定業者 OA，再完成 LINE 後台 Webhook 設定。'))+'<div class="integration-help"><h3>接線前需要完成</h3><p>企業登入與操作帳號綁定 → LINE channel 與驗簽設定 → 測試接收 → 人工確認外送開關。</p><p>租戶自己的 LINE OA、金流與 AI 仍屬後續功能，尚未啟用。</p></div></section><section class="panel inbox-panel"><div class="panel-heading"><div><h2>LINE 來客待分派</h2><p class="muted">只有業者管理員能分派到本業者案件。</p></div><button data-action="recover">處理待收／待送訊息</button></div>'+(pending.length?pending.map((p:Row)=>'<article class="inbox-row"><div><h3>來客 '+e(p.id.slice(0,8))+'</h3><p>'+e(p.preview||'沒有可見文字／已收回')+'</p><small class="muted">'+p.message_count+' 則文字事件 · '+e(p.connection_id)+'</small></div><label>指定案件<select data-contact-select="'+e(p.id)+'" aria-label="指定案件"><option value="">請選擇案件</option>'+chats.map(c=>'<option value="'+e(c.id)+'">'+e(c.business_name+' / '+c.owner_name)+'</option>').join('')+'</select></label><button data-attach="'+e(p.id)+'">確認分派</button></article>').join(''):empty('目前沒有待分派來客','已驗簽的 LINE 文字訊息會先保存；綁定案件後才能由授權人員回覆。'))+'</section><section class="integration-panel"><div><h2>訊息可靠性</h2><p>同一訊息固定重試識別碼；超過重試窗口或次數時保留待核查狀態。</p></div><button data-action="refresh">重新整理狀態</button></section>';
}

const contractLabels:Row={draft:'草稿',active:'已確認',ended:'已終止'};
const subscriptionLabels:Row={pending:'待確認',trial:'試用',active:'訂閱已確認',paused:'已暫停',cancelled:'已取消'};
const mailLabels:Row={received:'已收件',ready:'待領取',collected:'已領取',forwarded:'已轉寄',returned:'已退回'};
const ticketLabels:Row={open:'待處理',in_progress:'處理中',resolved:'已解決',closed:'已結案'};
const periodLabels:Row={current:'期間內',scheduled:'尚未開始',expired:'已到期'};
const opsMoney=()=>['operator_owner','operator_sales','operator_finance'].includes(me.role);
const opsFinance=()=>['operator_owner','operator_finance'].includes(me.role);
const opsService=()=>['operator_owner','operator_sales','operator_service'].includes(me.role);
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const calendarEnd=(value:string,months:number)=>{const d=new Date(value+'T00:00:00Z');const expected=(d.getUTCMonth()+months)%12;d.setUTCMonth(d.getUTCMonth()+months);if(d.getUTCMonth()!==expected)d.setUTCDate(0);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
const after=(value:string,n:number)=>new Date(Date.parse(value+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function opsButton(kind:string,id:string,status:string,label:string){return '<button data-ops-state="'+e(kind+':'+id+':'+status)+'">'+e(label)+'</button>';}
async function renderOperations(){
 const target=document.querySelector('#content');if(!target||page!=='operations')return;
 if(!tenants.length){target.innerHTML=empty('尚無可維運的租戶','請先完成成交並轉為租戶。');return;}
 if(!tenants.some(t=>t.id===opsBusiness))opsBusiness=tenants[0].id;
 const businessId=opsBusiness;
 target.innerHTML='<p class="loading">正在載入租戶維運紀錄…</p>';
 const [data,catalog,mailLine]=await Promise.all([api('/businesses/'+businessId+'/operations'),api('/operations/catalog'),opsService()?api('/businesses/'+businessId+'/mail-line'):Promise.resolve(null)]);
 if(page!=='operations'||opsBusiness!==businessId)return;opsData=data;opsData.mail_line=mailLine;opsCatalog=catalog;
 const tabs=[['overview','服務總覽'],['contracts','地址合約'],...(opsMoney()?[['billing','應收與收退款']]:[]),['subscriptions',futureDigital()?'數位訂閱':'數位服務（後續）'],...(opsService()?[['mail','信件包裹'],['tickets','維運需求']]:[])];
 if(!tabs.some(t=>t[0]===opsTab))opsTab='overview';
 target.innerHTML='<div class="ops-toolbar"><label>目前租戶<select id="operations-business" aria-label="目前租戶">'+tenants.map(t=>'<option value="'+e(t.id)+'" '+(t.id===opsBusiness?'selected':'')+'>'+e(t.name)+'</option>').join('')+'</select></label><div><button data-page="tenants">選擇其他租戶</button>'+badge('資料持久保存','green')+(owner()?'<button data-ops-catalog="1">據點與方案設定</button>':'')+'</div></div><div class="ops-tabs tabs" role="navigation" aria-label="租戶維運分類">'+tabs.map(t=>'<button data-ops-tab="'+t[0]+'" class="'+(opsTab===t[0]?'selected':'')+'">'+t[1]+'</button>').join('')+'</div><div id="ops-panel">'+({overview:opsOverview,contracts:opsContracts,billing:opsBilling,subscriptions:opsSubscriptions,mail:opsMail,tickets:opsTickets} as Row)[opsTab]()+'</div><div class="ops-note">人工管理台帳 · 金流／物流尚未串接 · 數位功能尚未開通。地址合約與數位訂閱各自管理。</div>';
}
function opsOverview(){
 const b=opsData.invoices||[];const address=b.filter((r:Row)=>r.kind==='address'&&r.status==='open').reduce((n:number,r:Row)=>n+r.balance,0);
 const digital=b.filter((r:Row)=>r.kind==='digital'&&r.status==='open').reduce((n:number,r:Row)=>n+r.balance,0);
 return '<section class="panel tenant-overview-contracts"><div class="panel-heading"><h2>借址服務與合約</h2><button data-ops-tab="contracts">管理合約 →</button></div>'+contractServiceRows(opsData.contracts.slice(0,5))+'</section><div class="metrics"><article><span>地址合約</span><strong>'+opsData.contracts.filter((c:Row)=>c.status==='active'&&c.period_status==='current').length+'<small>份期間內</small></strong><p>到期與終止不刪除數位服務</p></article><article><span>數位訂閱</span><strong>'+opsData.subscriptions.length+'<small>筆既有紀錄</small></strong><p>第一期不新增數位收費或開通</p></article><article><span>待領信件／包裹</span><strong>'+opsData.mail.filter((m:Row)=>['received','ready'].includes(m.status)).length+'<small>件</small></strong><p>人工記錄交付，不自動發送通知</p></article><article><span>未結案維運</span><strong>'+opsData.tickets.filter((t:Row)=>t.status!=='closed').length+'<small>件</small></strong><p>依租戶服務承辦權限管理</p></article></div><div class="ops-overview-grid"><section class="panel"><div class="panel-heading"><h2>服務接續</h2><span class="muted">同一企業，持續服務</span></div><div class="ops-summary"><article><span class="company-icon">址</span><div><b>借址服務</b><p>'+opsData.contracts.length+' 份合約台帳，保留各期歷程。</p></div><button data-ops-tab="contracts">管理合約 →</button></article><article><span class="company-icon">雲</span><div><b>企業數位服務</b><p>官網、商城、LINE OA 與 CRM 為後續功能，分潤待議定。</p></div><button data-ops-tab="subscriptions">查看後續規劃 →</button></article></div></section><section class="panel"><div class="panel-heading"><h2>'+(opsMoney()?'分開對帳':'服務權益')+'</h2>'+badge('人工台帳')+'</div>'+(opsMoney()?'<div class="balance-box"><div><span>地址服務待收</span><b>'+money(address)+'</b></div><div><span>數位訂閱待收</span><b>'+money(digital)+'</b></div><small>商城商品款尚未開放，不混入本台帳。</small><button data-ops-tab="billing">查看應收與收退款 →</button></div>':'<div class="balance-box"><p>方案資格符合後，仍須完成實際整合與開通。</p>'+badge('功能未開通','amber')+'</div>')+'</section></div>'+opsSubscriptions(true);
}
function opsContracts(){
 return '<section class="panel"><div class="panel-heading"><h2>地址合約台帳</h2>'+(seller()?'<button class="primary" data-ops-new="contract">＋ 新增合約</button>':'')+'</div><p class="panel-description">登記據點、期間及人工確認依據；此處不產生法律契約或電子簽章。</p>'+(opsData.contracts.length?'<div class="ops-cards">'+opsData.contracts.map((c:Row)=>'<article class="ops-card"><div class="ops-card-top"><span class="company-icon">址</span><div><h3>'+e(c.location_name)+'</h3><p>'+e(c.address)+'</p></div>'+badge(contractLabels[c.status],c.status==='active'?'green':'')+'</div>'+serviceFacts(c)+'<p class="muted">確認依據：'+e(c.reference||'待確認')+(c.renewal_of?' · 續約紀錄':'')+'</p><div class="ops-actions">'+(owner()&&c.status==='draft'?opsButton('contracts',c.id,'active','確認合約'):'')+(owner()&&['draft','active'].includes(c.status)?opsButton('contracts',c.id,'ended','終止／撤回'):'')+(owner()&&c.status!=='ended'?'<button data-ops-new="contract-terms" data-id="'+e(c.id)+'">補登服務條件</button>':'')+(seller()&&c.status!=='draft'?'<button data-ops-new="renew-contract" data-id="'+e(c.id)+'">建立下一期</button>':'')+'</div></article>').join('')+'</div>':empty('尚無地址合約','選擇據點與期間，建立合約台帳。'))+'</section>';
}
function opsSubscriptions(compact=false){
 if(!futureDigital())return digitalReservedPanel();
 const rows=opsData.subscriptions;
 return '<section class="panel ops-section"><div class="panel-heading"><h2>數位訂閱與功能權益</h2>'+(seller()?'<button class="primary" data-ops-new="subscription">＋ 新增訂閱</button>':'')+'</div><p class="panel-description">金額、期限與額度保存為當期快照。暫停、取消、到期與退款會重新影響資格；沒有整合時不開通功能。</p>'+(rows.length?'<div class="ops-cards">'+rows.map((s:Row)=>{
 const right=opsData.entitlements.find((r:Row)=>r.subscription_id===s.id);
 return '<article class="ops-card"><div class="ops-card-top"><span class="company-icon">雲</span><div><h3>'+e(s.plan_name)+'</h3><p>'+e(moduleNames[s.module])+'</p></div>'+badge(subscriptionLabels[s.status],right.commercial_eligible?'green':'')+'</div><div class="ops-facts"><span>當期期間<b>'+e(s.starts_on)+' — '+e(s.ends_on)+'</b></span>'+(opsMoney()?'<span>當期方案價<b>'+money(s.amount)+'</b></span>':'')+'<span>方案額度上限<b>'+s.quota_limit+' · 用量尚未計量</b></span></div><div class="detail-badges">'+badge(periodLabels[right.period_status])+badge(right.commercial_eligible?'訂閱資格符合':right.reason==='payment_required'?'收款未符合':'訂閱資格未符合',right.commercial_eligible?'green':'amber')+badge('功能未開通','amber')+'</div>'+(compact?'':'<div class="ops-actions">'+(owner()?({pending:opsButton('subscriptions',s.id,'trial','開始試用')+opsButton('subscriptions',s.id,'active','確認訂閱')+opsButton('subscriptions',s.id,'cancelled','取消'),trial:opsButton('subscriptions',s.id,'active','確認訂閱')+opsButton('subscriptions',s.id,'paused','暫停')+opsButton('subscriptions',s.id,'cancelled','取消'),active:opsButton('subscriptions',s.id,'paused','暫停')+opsButton('subscriptions',s.id,'cancelled','取消'),paused:opsButton('subscriptions',s.id,'resume','恢復')+opsButton('subscriptions',s.id,'cancelled','取消'),cancelled:''} as Row)[s.status]:'')+(seller()?'<button data-ops-new="renew-subscription" data-id="'+e(s.id)+'">建立續訂</button>':'')+'</div>')+'</article>';
 }).join('')+'</div>':empty('尚無訂閱紀錄','先建立可設定的方案，再為租戶安排期間。'))+'</section>';
}
function opsBilling(){
 const rows=opsData.invoices||[];
 return '<section class="panel"><div class="panel-heading"><h2>應收與人工收退款</h2>'+(opsFinance()?'<button class="primary" data-ops-new="invoice">＋ 建立應收</button>':'')+'</div><p class="panel-description">依地址合約或數位訂閱分開記帳。這是人工應收台帳，不是電子發票；不執行扣款或退款交易。</p>'+(rows.length?'<div class="ops-cards">'+rows.map((r:Row)=>'<article class="ops-card"><div class="ops-card-top"><span class="company-icon">'+(r.kind==='address'?'址':'雲')+'</span><div><h3>'+(r.kind==='address'?'地址服務款':'數位訂閱款')+'</h3><p>付款期限 '+e(r.due_on)+'</p></div>'+badge(({paid:'已核對收足',partial:'部分收款',unpaid:'尚未收款',void:'已作廢'} as Row)[r.payment_status],r.payment_status==='paid'?'green':r.overdue?'amber':'')+'</div><div class="ops-facts"><span>應收總額<b>'+money(r.amount)+'</b></span><span>淨實收<b>'+money(r.net_received)+'</b></span><span>待收餘額<b>'+money(r.status==='void'?0:r.balance)+'</b></span></div>'+(r.overdue?badge('已逾付款期限','amber'):'')+'<div class="ops-actions">'+(opsFinance()?'<button data-ops-ledger="'+e(r.id)+'">查看收退款歷程</button>'+(r.status==='open'&&(r.kind==='address'||futureDigital())?'<button class="primary" data-ops-new="ledger" data-id="'+e(r.id)+'">記錄收款／退款</button>'+opsButton('invoices',r.id,'void','作廢'):''):'')+'</div></article>').join('')+'</div>':empty('尚無應收單','確認地址合約或建立數位訂閱後，由財務建立應收。'))+'</section>';
}

function mailLineSummary(binding:Row,biz:string){
 const r=binding?.recipient;
 return '<div class="mail-line-summary"><div><b>'+(r?'通知聯絡人：'+e(r.name):'尚未綁定通知聯絡人')+'</b><p>'+(r?'業者 OA · '+e(r.connection_id)+' · '+e(r.identity_hint)+(r.channel_enabled?'':' · 通道已停用'):'由管理員從業者 OA 已收到訊息的來客中，核對身分並綁定。')+'</p><p>借址收件通知使用業者 OA；與租戶日後租用自己的 LINE OA 分開。</p></div><div>'+badge('推播未啟用','amber')+(owner()?'<button data-mail-line="'+e(biz)+'">'+(r?'管理通知綁定':'綁定通知聯絡人')+'</button>':'')+'</div></div>';
}
async function showMailLineForm(biz:string,q=''){
 if(!owner())return;
 const [binding,candidates]=await Promise.all([api('/businesses/'+biz+'/mail-line'),api('/businesses/'+biz+'/mail-line/candidates?q='+encodeURIComponent(q))]);
 const r=binding.recipient,items:Row[]=candidates.items;
 showModal('<p class="eyebrow">借址維運 · 業者 LINE OA</p><h2>收件通知聯絡人</h2>'+mailLineSummary(binding,biz)+'<p class="muted">客戶加入業者 OA 並傳訊息後，才能從下方來客中選擇。一般 LINE ID 無法直接推播；管理員需核對來客與租戶的關係，本頁不會發送訊息。</p><form id="mail-line-search" data-business="'+e(biz)+'"><div class="mail-line-search"><label>搜尋來客<input name="q" value="'+e(q)+'" maxlength="100" placeholder="既有企業名稱、OA 通道或來客編號"></label><button type="submit">搜尋</button></div><p class="form-error" role="alert"></p></form>'+(items.length?'<form id="mail-line-form" data-business="'+e(biz)+'" data-version="'+binding.version+'"><label>已觀察到的 LINE 來客<select name="line_contact_id" required><option value="">請核對後選擇來客</option>'+items.map(c=>'<option value="'+e(c.id)+'" '+(c.id===r?.line_contact_id?'selected':'')+'>'+e((c.business_name||'尚未分派企業')+' · '+c.connection_id+' · '+c.identity_hint)+'</option>').join('')+'</select></label><details class="mail-line-candidates"><summary>查看來客最近訊息（最多 50 位）</summary>'+items.map(c=>'<p><b>'+e(c.identity_hint)+' · '+e(c.connection_id)+'</b><br>'+e(c.preview||'尚無文字訊息')+'</p>').join('')+'</details><label>通知聯絡人姓名（請核對本人）<input name="recipient_name" required maxlength="100" value="'+e(r?.name||'')+'"></label><label>綁定確認依據<textarea name="reference" required maxlength="500" placeholder="例如：已向企業負責人確認此帳號為收件通知聯絡人"></textarea></label><p class="muted">每家租戶先設定一位主要通知聯絡人；同一位聯絡人可代表多家企業。更換綁定會保留操作歷程。</p><button type="submit" class="primary">保存通知綁定</button><p class="form-error" role="alert"></p></form>':empty('尚無符合的 LINE 來客','請確認業者 OA 的接收串接，讓客戶加入並傳送訊息；完成身分核對後再綁定。'))+(r?'<form id="mail-line-unlink" data-business="'+e(biz)+'" data-version="'+binding.version+'"><label>解除綁定原因<textarea name="reference" required maxlength="500"></textarea></label><button type="submit">解除通知綁定</button><p class="form-error" role="alert"></p></form>':''));
}
async function showMailPreview(biz:string,id:string){
 const result=await api('/businesses/'+biz+'/mail-preview/'+id);
 showModal('<p class="eyebrow">信件包裹 · 通知準備</p><h2>LINE 收件通知預覽</h2>'+badge('僅預覽，尚未發送','amber')+mailLineSummary(result.binding,biz)+'<p class="mail-preview-notice" role="status">'+e(result.notice)+'</p><pre class="mail-notification-preview">'+e(result.text)+'</pre><p class="muted">此文字供承辦人核對；實際 LINE 推播未啟用，不會建立外送訊息或改變收件狀態。</p>');
}

function opsMail(){
 return '<section class="panel"><div class="panel-heading"><h2>信件與包裹</h2><button class="primary" data-ops-new="mail">＋ 登記收件</button></div><p class="panel-description">待領、自取、轉寄與退回皆留存操作人員。物流及 LINE 推播未啟用；登記收件後可預覽通知，不會發送訊息。</p>'+mailLineSummary(opsData.mail_line,opsBusiness)+(opsData.mail.length?'<div class="ops-cards">'+opsData.mail.map((m:Row)=>'<article class="ops-card"><div class="ops-card-top"><span class="company-icon">'+(m.kind==='package'?'包':'信')+'</span><div><h3>'+e(m.description)+'</h3><p>'+e(m.carrier)+' '+e(m.tracking_no)+'</p></div>'+badge(mailLabels[m.status],['collected','forwarded'].includes(m.status)?'green':'')+'</div><p class="muted">收件：'+e(date(m.created_at))+'</p><p class="muted">交付依據：'+e(m.handoff_reference||'尚未交付')+'</p><div class="ops-actions"><button data-mail-preview="'+e(m.id)+'" data-business="'+e(opsBusiness)+'">預覽 LINE 收件通知</button>'+({received:opsButton('mail',m.id,'ready','標記待領')+opsButton('mail',m.id,'returned','退回'),ready:opsButton('mail',m.id,'collected','確認領取')+opsButton('mail',m.id,'forwarded','記錄轉寄')+opsButton('mail',m.id,'returned','退回'),collected:'',forwarded:'',returned:''} as Row)[m.status]+'</div></article>').join('')+'</div>':empty('目前沒有收件紀錄','收到信件或包裹時，先登記再記錄交付。'))+'</section>';
}
function opsTickets(){
 return '<section class="panel"><div class="panel-heading"><h2>租戶維運需求</h2><button class="primary" data-ops-new="ticket">＋ 建立需求</button></div><p class="panel-description">由此租戶的授權業務／維運承辦處理；保留實際操作人員與解決說明。</p>'+(opsData.tickets.length?'<div class="ops-cards">'+opsData.tickets.map((t:Row)=>'<article class="ops-card"><div class="ops-card-top"><span class="company-icon">務</span><div><h3>'+e(t.title)+'</h3><p>優先順序：'+e(({low:'低',normal:'一般',high:'高'} as Row)[t.priority])+'</p></div>'+badge(ticketLabels[t.status],t.status==='closed'?'green':'')+'</div><p class="ticket-description">'+e(t.description)+'</p>'+(t.resolution?'<p class="muted">處理說明：'+e(t.resolution)+'</p>':'')+'<div class="ops-actions">'+({open:opsButton('tickets',t.id,'in_progress','開始處理')+opsButton('tickets',t.id,'resolved','標記解決'),in_progress:opsButton('tickets',t.id,'resolved','標記解決'),resolved:opsButton('tickets',t.id,'closed','確認結案')+opsButton('tickets',t.id,'open','重新開啟'),closed:''} as Row)[t.status]+'</div></article>').join('')+'</div>':empty('目前沒有維運需求','建立需求，讓服務紀錄保持完整。'))+'</section>';
}

function contractTermFields(c:Row){
 const field=(key:string,label:string,choices:Row)=>'<label>'+label+'<select name="'+key+'" aria-label="'+label+'"><option value="">待確認／待補資料</option>'+Object.entries(choices).map(([value,name])=>'<option value="'+value+'" '+(c[key]===value?'selected':'')+'>'+e(name)+'</option>').join('')+'</select></label>';
 return '<div class="form-grid">'+field('term_kind','合約類型',termNames)+field('payment_cycle','約定付款週期',cycleNames)+field('mail_service','郵件代收',mailServiceNames)+'</div>';
}

async function showOpsForm(op:string,id?:string){
 if(!futureDigital()&&['plan','subscription','renew-subscription'].includes(op)){toast('第一期僅提供借址服務，數位分潤標準待議定。');return;}
 let html='',title='',version=1;
 const input=(name:string,label:string,type='text',value='',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+e(value)+'" '+extra+' required></label>';
 const select=(name:string,label:string,options:string)=>'<label>'+label+'<select name="'+name+'" aria-label="'+label+'" required>'+options+'</select></label>';
 const option=(id:string,label:string)=>'<option value="'+e(id)+'">'+e(label)+'</option>';
 if(['contract','renew-contract'].includes(op)){
  const c=id?opsData.contracts.find((c:Row)=>c.id===id):null;title=c?'建立合約下一期':'新增地址合約';version=c?.version||1;
  const start=c?after(c.ends_on,1):today();
  html=(c?'':select('location_id','登記據點','<option value="">請選擇據點</option>'+opsCatalog.locations.filter((l:Row)=>l.active).map((l:Row)=>option(l.id,l.name)).join('')))+contractTermFields(c||{term_kind:'annual',payment_cycle:'once'})+'<div class="form-grid">'+input('starts_on','開始日','date',start)+input('ends_on','結束日（含當日）','date',calendarEnd(start,({monthly:1,two_year:24} as Row)[c?.term_kind]||12))+'</div>'+input('amount','本期合約總額（NT$）','number',String(c?.amount||0),'min="0" max="1000000000"')+'<p class="muted">期限以實際合約為準，可含贈送期間。付款週期是雙方約定；應收按本期總額建立，可分次人工記錄實收，不會自動扣款或產生月帳單。</p>';
  if(!c)html+='<label>備註<textarea name="note" maxlength="1000"></textarea></label>';
 }
 if(op==='contract-terms'){
  const c=opsData.contracts.find((c:Row)=>c.id===id);title='補登合約服務條件';version=c.version;
  html=contractTermFields(c)+'<label>變更依據<textarea name="note" required maxlength="1000"></textarea></label><p class="muted">補登約定不會修改原合約日期、金額或收款紀錄。舊資料沒有記載的項目可保留待確認。</p>';
 }
 if(['subscription','renew-subscription'].includes(op)){
  const sub=id?opsData.subscriptions.find((s:Row)=>s.id===id):null;title=sub?'建立續訂':'新增數位訂閱';version=sub?.version||1;
  html=select('plan_id','數位服務方案','<option value="">請選擇方案</option>'+opsCatalog.plans.filter((p:Row)=>p.active&&(!sub||p.module===sub.module)).map((p:Row)=>option(p.id,p.name+' · '+money(p.amount)+' / '+p.duration_days+' 天')).join(''))+input('starts_on','開始日','date',sub?after(sub.ends_on,1):today())+'<p class="muted">結束日依方案天數計算（含首末日），價格與額度保存為當期快照。建立後為待確認，功能不會自動開通。</p>';
 }
 if(op==='invoice'){
  title='建立應收單';
  const contracts=opsData.contracts.filter((c:Row)=>c.status==='active'&&c.amount>0&&!opsData.invoices.some((b:Row)=>b.contract_id===c.id));
  const subs=futureDigital()?opsData.subscriptions.filter((s:Row)=>s.status!=='cancelled'&&s.amount>0&&!opsData.invoices.some((b:Row)=>b.subscription_id===s.id)):[];
  html=select('kind_source','帳款來源','<option value="">請選擇合約或訂閱</option>'+contracts.map((c:Row)=>option('address:'+c.id,'地址服務 · '+c.location_name+' · '+money(c.amount))).join('')+subs.map((s:Row)=>option('digital:'+s.id,'數位訂閱 · '+s.plan_name+' · '+money(s.amount))).join(''))+input('due_on','付款期限','date',after(today(),7))+'<p class="muted">金額沿用來源台帳，每期只建立一張應收，可分次核對收款；不是電子發票。</p>';
 }
 if(op==='ledger'){
  const bill=opsData.invoices.find((r:Row)=>r.id===id);version=bill.version;title='人工收款／退款核對';
  const rows=await api('/businesses/'+opsBusiness+'/invoices/'+id+'/ledger');
  html=select('direction','紀錄類型',option('receipt','收款紀錄')+option('refund','退款紀錄'))+input('amount','本次金額（NT$）','number',String(Math.max(1,bill.balance)),'min="1" max="1000000000"')+'<label>退款對應原收款<select name="refund_of" aria-label="退款對應原收款"><option value="">收款時不需選擇</option>'+rows.filter((r:Row)=>r.direction==='receipt').map((r:Row)=>option(r.id,date(r.created_at)+' · '+money(r.amount)+' · '+r.reference)).join('')+'</select></label>'+input('reference','人工核對依據','text','','maxlength="300"')+'<p class="muted">僅保存已由人員核對的紀錄，不執行銀行或金流交易。錯誤收款以對應退款紀錄更正，不能覆寫歷史。</p>';
 }
 if(op==='mail'){title='登記信件／包裹';html=select('kind','收件類型',option('letter','信件')+option('package','包裹'))+input('description','收件摘要','text','','maxlength="300"')+'<div class="form-grid"><label>物流（選填）<input name="carrier" maxlength="100"></label><label>來件單號（選填）<input name="tracking_no" maxlength="100"></label></div>';}
 if(op==='ticket'){title='建立維運需求';html=input('title','需求主旨','text','','maxlength="150"')+'<label>需求內容<textarea name="description" required maxlength="1500"></textarea></label>'+select('priority','優先順序',option('normal','一般')+option('high','高')+option('low','低'));}
 if(op==='location'){title='新增登記據點';html=input('name','據點名稱','text','','maxlength="100"')+input('address','據點地址','text','','maxlength="300"');}
 if(op==='plan'){title='新增數位服務方案';html=input('name','方案名稱','text','','maxlength="100"')+select('module','功能類型',Object.entries(moduleNames).map(([id,label])=>option(id,String(label))).join(''))+'<div class="form-grid">'+input('amount','單期價格（NT$）','number','0','min="0" max="1000000000"')+input('duration_days','單期天數','number','30','min="1" max="3660"')+'</div>'+input('quota_limit','單期額度上限','number','0','min="0" max="1000000000"')+'<p class="muted">額度單位待各模組整合定義，目前不計量用量。既有方案價格不覆寫，改價請建立新方案。</p>';}
 showModal('<p class="eyebrow">TENANT OPERATIONS</p><h2>'+e(title)+'</h2><form id="ops-form" data-op="'+e(op)+'" data-id="'+e(id||'')+'" data-version="'+version+'" data-request-key="'+crypto.randomUUID()+'">'+html+'<p class="form-error" role="alert"></p><button class="primary" type="submit">儲存紀錄</button></form>');
}
function showOpsState(value:string){
 const [kind,id,status]=value.split(':');const group=({contracts:'contracts',subscriptions:'subscriptions',invoices:'invoices',mail:'mail',tickets:'tickets'} as Row)[kind];
 const row=opsData[group].find((r:Row)=>r.id===id);
 const labels:Row={contracts:contractLabels,subscriptions:{...subscriptionLabels,resume:'恢復原狀態'},invoices:{void:'作廢'},mail:mailLabels,tickets:ticketLabels};
 let fields='';
 if(kind==='contracts')fields='<label>確認／終止依據<input name="reference" maxlength="300" required></label><label>備註<textarea name="note" maxlength="1000"></textarea></label>';
 if(['subscriptions','invoices'].includes(kind))fields='<label>處理原因<textarea name="note" maxlength="500" required></textarea></label>';
 if(kind==='mail')fields='<label>交付依據（領取人／轉寄單號／退回原因）<textarea name="handoff_reference" maxlength="500" '+(status==='ready'?'':'required')+'></textarea></label>';
 if(kind==='tickets')fields='<label>處理說明<textarea name="resolution" maxlength="1500" '+(status==='in_progress'?'':'required')+'></textarea></label>';
 showModal('<p class="eyebrow">STATUS & HISTORY</p><h2>'+e(labels[kind][status])+'</h2><p class="muted">狀態異動會保留實際操作人員。此操作不會自動收退款、通知客戶或開通數位功能。</p><form id="ops-state-form" data-kind="'+kind+'" data-id="'+e(id)+'" data-status="'+status+'" data-version="'+row.version+'">'+fields+'<p class="form-error" role="alert"></p><button class="primary" type="submit">確認變更</button></form>');
}
async function showLedger(id:string){
 const rows=await api('/businesses/'+opsBusiness+'/invoices/'+id+'/ledger');
 showModal('<p class="eyebrow">MANUAL LEDGER</p><h2>收退款歷程</h2><p class="muted">只增補紀錄、不覆寫舊資料。付款與退款均為人工核對紀錄。</p>'+(rows.length?'<ol class="history">'+rows.map((r:Row)=>'<li><span class="history-dot"></span><div><b>'+(r.direction==='receipt'?'收款':'退款')+' '+money(r.amount)+'</b><small>'+e(r.actor_name)+' · '+e(date(r.created_at))+'</small><p class="muted">'+e(r.reference)+'</p></div></li>').join('')+'</ol>':empty('尚無收退款紀錄','不會因案件成交而自動當作已收款。')));
}
function revenueTermsMarkup(){
 const labels:Row={partner_name:'合作平台商',platform_fee_amount:'平台費（NT$）',platform_share_bps:'平台端分潤比例（%）',operator_share_bps:'業者端分潤比例（%）',settlement_basis:'結算基準',settlement_cycle:'結算週期',effective_on:'生效日',agreement_reference:'議定文件／依據'};
 return '<section class="revenue-terms"><h3 class="section-title">數位合作與分潤（後續）</h3><p class="muted">官網與 LINE OA 串接前，須與合作平台商議定標準。欄位目前留空，空白不是 0% 或免費；本期不計算、不結算。</p><div class="ops-cards">'+revenueTerms.map(t=>'<article class="ops-card"><h4>'+e(moduleNames[t.module])+'</h4>'+badge('待議定','amber')+'<div class="form-grid">'+Object.entries(labels).map(([key,label])=>'<label>'+label+'<input aria-label="'+e(moduleNames[t.module]+' '+label)+'" value="" placeholder="待議定" disabled></label>').join('')+'</div></article>').join('')+'</div></section>';
}
function digitalReservedPanel(){
 return '<section class="panel"><div class="panel-heading"><h2>數位服務（後續）</h2>'+badge('分潤待議定','amber')+'</div><p class="panel-description">官網、商城、LINE OA 與 CRM 各自租用、各自記錄服務期間；第一期尚未開放收費或開通。費率及平台分潤待與合作商議定。</p>'+digitalServiceRows({services:[],digital_records:opsData.subscriptions},opsBusiness)+(opsData.subscriptions.length?'<h3 class="section-title">既有數位訂閱歷程（唯讀）</h3>'+opsData.subscriptions.map((r:Row)=>'<div class="catalog-row"><div><b>'+e(r.plan_name)+'</b><p class="muted">'+e(r.starts_on)+' — '+e(r.ends_on)+'</p></div>'+badge('本期不收費、不開通')+'</div>').join(''):'')+'</section>';
}

function catalogMarkup(){if(!futureDigital())return '<p class="eyebrow">ADDRESS SERVICES · PHASE ONE</p><h2>據點與方案設定</h2><p class="muted">第一期僅提供借址服務。數位方案程式與歷程保留，收費及開通留待後續。</p><h3 class="section-title">登記據點</h3>'+opsCatalog.locations.map((l:Row)=>'<div class="catalog-row"><div><b>'+e(l.name)+'</b><p class="muted">'+e(l.address)+'</p></div>'+badge(l.active?'使用中':'停用')+'</div>').join('')+'<button data-ops-new="location">＋ 新增據點</button>'+revenueTermsMarkup();return '<p class="eyebrow">OPERATOR CATALOG</p><h2>據點與方案設定</h2><p class="muted">本業者專用；可先建立據點與方案，不需等待租戶成交。既有訂閱保留原方案快照。</p><h3 class="section-title">登記據點</h3>'+opsCatalog.locations.map((l:Row)=>'<div class="catalog-row"><div><b>'+e(l.name)+'</b><p class="muted">'+e(l.address)+'</p></div>'+badge(l.active?'使用中':'停用')+'</div>').join('')+'<button data-ops-new="location">＋ 新增據點</button><h3 class="section-title">數位方案</h3>'+opsCatalog.plans.map((p:Row)=>'<div class="catalog-row"><div><b>'+e(p.name)+'</b><p class="muted">'+e(moduleNames[p.module])+' · '+money(p.amount)+' / '+p.duration_days+' 天 · 額度 '+p.quota_limit+'</p></div>'+badge(p.active?'使用中':'已停售')+'<button data-plan-toggle="'+e(p.id)+'" data-active="'+(p.active?'0':'1')+'" data-version="'+p.version+'">'+(p.active?'停售':'恢復')+'</button></div>').join('')+'<button class="primary" data-ops-new="plan">＋ 新增方案</button>';}
async function showCatalog(){revenueTerms=(await api('/operations/revenue-terms')).terms;showModal(catalogMarkup());}
async function renderCatalog(){
 const target=document.querySelector('#content');if(!target||page!=='catalog'||!owner())return;
 target.innerHTML='<p class="loading">正在載入據點與方案…</p>';
 const [catalog,terms]=await Promise.all([api('/operations/catalog'),api('/operations/revenue-terms')]);
 opsCatalog=catalog;revenueTerms=terms.terms;
 if(page==='catalog')target.innerHTML='<section class="panel catalog-page">'+catalogMarkup()+'</section>';
}
