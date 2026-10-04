type Row=Record<string,any>;
const root=document.querySelector<HTMLDivElement>('#app')!;
const dialog=document.querySelector<HTMLDialogElement>('#modal')!;
let me:Row;let page='dashboard';let staff:Row[]=[];let opps:Row[]=[];let tenants:Row[]=[];let chats:Row[]=[];let selectedChat='';let filter='';let search='';let busy=false;
const stageNames:Row={contact:'接觸',onboarding:'導入',billing:'收費',won:'成交',paused:'暫緩',lost:'未成交'};
const roleNames:Row={operator_owner:'總管理員',operator_sales:'業務',operator_service:'維運',operator_finance:'財務',platform_admin:'平台管理員',business_admin:'企業管理員'};
const moduleNames:Row={website:'品牌官網',store:'獨立商城',line:'LINE OA 串接',crm:'客戶管理 CRM'};
const actionNames:Row={fixture_created:'建立示範案件',opportunity_created:'建立案件',assignment_changed:'轉交案件',opportunity_updated:'更新案件',opportunity_won:'成交轉租戶',payment_recorded:'人工核對收款',message_attempted:'回覆訊息（本地）',message_retried:'重試訊息（本地）',service_requested:'申請功能',service_cancelled:'取消功能申請',service_assignment_changed:'指派服務承辦',staff_status:'變更人員狀態'};
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(v:number)=>'NT$ '+Number(v||0).toLocaleString('zh-TW');
const date=(v:string)=>v?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'未安排';
const owner=()=>me?.role==='operator_owner';
const seller=()=>['operator_owner','operator_sales'].includes(me?.role);
const salesView=()=>['operator_owner','operator_sales','operator_finance'].includes(me?.role);
const chatView=()=>['operator_owner','operator_sales','operator_service'].includes(me?.role);
const canRequest=()=>['operator_owner','operator_sales','operator_service'].includes(me?.role);
async function api(path:string,method='GET',data?:Row):Promise<any>{
 const response=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Requested-With':'tsp'},...(data?{body:JSON.stringify(data)}:{})});
 const value=await response.json();
 if(!response.ok)throw new Error(value.error||'操作失敗');return value;
}
function toast(message:string){const el=document.querySelector('#toast')!;el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4500);}
function badge(label:string,tone=''){return '<span class="badge '+e(tone)+'">'+e(label)+'</span>';}
function empty(title:string,detail:string){return '<div class="empty"><span class="empty-icon">＋</span><h3>'+e(title)+'</h3><p>'+e(detail)+'</p></div>';}
function options(rows:Row[],current:string){return rows.map(s=>'<option value="'+e(s.id)+'" '+(s.id===current?'selected':'')+'>'+e(s.name)+(s.active?'':'（停權）')+'</option>').join('');}
function formError(form:HTMLFormElement,msg:string){form.querySelector('.form-error')!.textContent=msg;}
function showModal(html:string){
 dialog.innerHTML='<div class="modal-inner"><button type="button" class="close" data-action="close" aria-label="關閉">×</button>'+html+'</div>';
 if(!dialog.open)dialog.showModal();
}
async function loginScreen(){
 const config=await api('/bootstrap');
 if(!config.demo){root.innerHTML='<main class="login"><div class="brand-mark">園</div><h1>台灣創業園</h1><h2>正式登入尚未設定</h2><p>此基礎版僅提供本機驗收。請先完成正式身分驗證與整合設定。</p><p>LINE、金流尚未串接；AI 尚未啟用。</p></main>';return;}
 const users=await api('/demo/users');
 root.innerHTML='<main class="login"><div class="brand-mark">園</div><p class="eyebrow">TAIWAN STARTUP PARK</p><h1>讓每一次成交<br>成為長期的服務關係</h1><p>業者工作台 · 第一輪可操作基礎版</p><form id="login-form"><label>選擇本地驗收身分<select name="user_id" aria-label="示範身分">'+users.map((u:Row)=>'<option value="'+e(u.id)+'" '+(u.id==='owner-a'?'selected':'')+'>'+e(u.operator_name+' / '+u.name)+'</option>').join('')+'</select></label><button class="primary" type="submit">進入示範工作台</button><p class="form-error" role="alert"></p></form><div class="notice">純虛構資料 · 僅限本機<br>正式登入、LINE、金流與 AI 尚未串接。</div><p class="fine">公司工作通訊將記錄操作人員與服務歷程，供授權管理與服務品質核查；不包含私人通訊。</p></main>';
}
async function start(){
 try{me=await api('/me');staff=await api('/staff');await refresh();}
 catch(err){if(me&&['platform_admin','business_admin'].includes(me.role)){root.innerHTML='<main class="login"><h1>此角色尚未開放工作台</h1><p>目前不提供跨業者存取。</p><button data-action="logout">登出</button></main>';}else await loginScreen();}
}
async function refresh(){
 const [o,t,c]=await Promise.all([salesView()?api('/opportunities'):Promise.resolve([]),api('/tenants'),chatView()?api('/conversations'):Promise.resolve([])]);
 opps=o;tenants=t;chats=c;render();
}
function render(){
 const nav=[['dashboard','▦','總覽'],...(salesView()?[['pipeline','↗','成交追蹤']]:[]),['tenants','▤','租戶管理'],...(chatView()?[['chat','◌','工作聊天室']]:[]),...(owner()?[['activity','≡','操作歷程'],['staff','♙','操作人員'],['risk','◇','管理員專區']]:[])];
 const title=nav.find(n=>n[0]===page)?.[2]||'總覽';
 root.innerHTML='<div class="shell"><button class="scrim" data-action="menu-close" aria-label="關閉導覽"></button><aside class="sidebar"><a class="brand" href="#" data-page="dashboard"><span class="brand-mark">園</span><span>台灣創業園<small>TAIWAN STARTUP PARK</small></span></a><div class="workspace-label">業者工作台</div><nav>'+nav.map(n=>'<button data-page="'+n[0]+'" class="nav-item '+(page===n[0]?'active':'')+'" '+(page===n[0]?'aria-current="page"':'')+'><span>'+n[1]+'</span>'+n[2]+'</button>').join('')+'</nav><div class="sidebar-bottom"><span class="status-dot"></span>本地驗收環境<small>Foundation · v0.1</small></div></aside><div class="workspace"><header class="topbar"><button class="menu-button" data-action="menu" aria-label="開啟導覽">☰</button><div class="crumb">工作台 <span>/</span> '+e(title)+'</div><div class="identity"><span class="avatar">'+e(me.name.slice(-1))+'</span><div>'+e(me.name)+'<small>'+e(roleNames[me.role])+'</small></div><button class="text-button" data-action="logout">登出</button></div></header><div class="demo-strip"><span>LOCAL DEMO</span>虛構示範資料 · LINE／金流尚未串接 · AI 尚未啟用</div><main id="main"><div class="page-heading"><div><p class="eyebrow">'+e(me.operator_name)+'</p><h1>'+e(title)+'</h1><p class="subtitle">'+e(({dashboard:'把來客、成交與長期服務，放在同一個工作台。',pipeline:'從第一次接觸，到下一段合作。',tenants:'成交是開始，讓服務持續發生。',chat:'每一次回覆，都能追溯實際操作人員。',activity:'每個關鍵操作，保留人員與時間。',staff:'一人一帳號，清楚分工。',risk:'僅總管理員可存取的獨立工作區。'} as Row)[page])+'</p></div>'+(seller()&&['dashboard','pipeline'].includes(page)?'<button class="primary" data-action="new">＋ 建立案件</button>':'')+'</div><section id="content"></section><footer>台灣創業園 · 時間以台北時間顯示<span>工作通訊與操作將留存服務歷程</span></footer></main></div></div>';
 const content=document.querySelector('#content')!;
 if(page==='dashboard')content.innerHTML=dashboard();
 if(page==='pipeline')content.innerHTML=pipeline();
 if(page==='tenants')content.innerHTML=tenantList();
 if(page==='chat'){content.innerHTML=chatShell();void loadChat();}
 if(page==='activity')void renderActivity();
 if(page==='staff')content.innerHTML=staffPage();
 if(page==='risk')void renderRisk();
}
function dashboard(){
 const open=opps.filter(o=>!['won','lost'].includes(o.stage));
 const stages=['contact','onboarding','billing','won'];
 return '<div class="metrics"><article><span>進行中案件</span><strong>'+open.length+'<small>件</small></strong><p>持續跟進每一次機會</p></article><article><span>待核對收款</span><strong>'+opps.filter(o=>o.payment_status==='unpaid'&&['billing','won'].includes(o.stage)).length+'<small>件</small></strong><p>案件階段與收款分開管理</p></article><article><span>服務中租戶</span><strong>'+tenants.length+'<small>家</small></strong><p>沿用成交企業與聯絡人</p></article><article><span>功能申請中</span><strong>'+tenants.reduce((s,t)=>s+t.request_count,0)+'<small>項</small></strong><p>整合未串接，尚未開通</p></article></div><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><h2>成交進度</h2><button class="text-button" data-page="pipeline" '+(!salesView()?'disabled':'')+'>查看全部 →</button></div><div class="funnel">'+stages.map((s,i)=>'<div><span class="step-number">0'+(i+1)+'</span><b>'+stageNames[s]+'</b><strong>'+opps.filter(o=>o.stage===s).length+'</strong><small>件案件</small></div>').join('')+'</div><div class="panel-heading"><h2>下一步，值得關注</h2><span class="muted">依跟進時間</span></div>'+caseRows(open.slice().sort((a,b)=>(a.followup_at||'z').localeCompare(b.followup_at||'z')).slice(0,4))+'</section><section class="panel service-intro"><span class="section-icon">✧</span><p class="eyebrow">CONTINUING THE CONNECTION</p><h2>從借址登記<br>到企業數位服務</h2><p>為已成交租戶接續安排官網、商城與 LINE OA，累積長期服務關係。</p><div class="mini-services"><span>品牌官網</span><span>獨立商城</span><span>LINE OA</span><span>CRM</span></div><button data-page="tenants">管理租戶與申請 →</button><small>本輪僅管理申請，不代表付費或開通。</small></section></div><section class="integration-panel"><div><h2>整合狀態</h2><p>連線設定完成前，所有操作均為本地驗收。</p></div><div>'+badge('LINE OA · 尚未串接')+badge('金流 · 尚未串接')+badge('AI · 尚未啟用')+'</div></section>';
}
function caseRows(rows:Row[]){
 if(!rows.length)return empty('目前沒有案件','建立案件，或調整搜尋與階段篩選。');
 return '<div class="case-list">'+rows.map(o=>'<button class="case-row" data-opp="'+e(o.id)+'"><span class="company-icon">'+e(o.business_name.slice(0,1))+'</span><span class="case-main"><strong>'+e(o.business_name)+'</strong><small>'+e(o.next_action||o.title)+'</small></span><span class="case-owner">'+e(o.owner_name)+'<small>'+e(date(o.followup_at))+'</small></span>'+badge(stageNames[o.stage],o.stage==='won'?'green':'')+'<span class="row-arrow">›</span></button>').join('')+'</div>';
}
function pipeline(){
 const rows=opps.filter(o=>(!filter||o.stage===filter)&&(!search||(o.business_name+o.title).toLowerCase().includes(search.toLowerCase())));
 return '<section class="panel"><div class="list-toolbar"><div class="tabs">'+['',...Object.keys(stageNames)].map(s=>'<button data-filter="'+s+'" class="'+(filter===s?'selected':'')+'">'+(s?stageNames[s]:'全部')+' <small>'+opps.filter(o=>!s||o.stage===s).length+'</small></button>').join('')+'</div><form id="search-form" class="search"><input name="q" aria-label="搜尋案件" placeholder="搜尋企業或案件" value="'+e(search)+'"><button type="submit" aria-label="搜尋">⌕</button></form></div><div class="list-caption"><span>企業 / 下一步</span><span>負責人 · 跟進時間 · 階段</span></div>'+caseRows(rows)+'</section>';
}
function tenantList(){
 const rows=tenants.filter(t=>!search||t.name.toLowerCase().includes(search.toLowerCase()));
 return '<section class="panel"><div class="panel-heading"><h2>租戶企業 <span class="count">'+tenants.length+'</span></h2><form id="search-form" class="search"><input name="q" aria-label="搜尋租戶" placeholder="搜尋企業" value="'+e(search)+'"><button type="submit" aria-label="搜尋">⌕</button></form></div>'+(rows.length?'<div class="tenant-grid">'+rows.map(t=>'<button class="tenant-card" data-tenant="'+e(t.id)+'"><span class="company-icon">'+e(t.name.slice(0,1))+'</span><h3>'+e(t.name)+'</h3>'+badge('已成交','green')+badge('功能未開通')+'<p>服務承辦：'+e(t.service_owner_name||'尚未指派')+'</p><div><span>功能申請</span><b>'+t.request_count+' 項</b></div></button>').join('')+'</div>':empty('尚無符合的租戶','案件完成成交後，企業會出現在這裡。'))+'</section>';
}
function chatShell(){
 if(!chats.length)return empty('目前沒有可存取的對話','新案件會建立一個本地工作對話。');
 if(!chats.some(c=>c.id===selectedChat))selectedChat=chats[0].id;
 return '<section class="panel chat-layout"><div class="chat-list"><h2>工作對話 <span class="count">'+chats.length+'</span></h2>'+chats.map(c=>'<button data-chat="'+e(c.id)+'" class="'+(selectedChat===c.id?'selected':'')+'"><span class="company-icon">'+e(c.business_name.slice(0,1))+'</span><span><b>'+e(c.business_name)+'</b><small>'+e(c.preview||'尚無訊息')+'</small></span></button>').join('')+'</div><div id="chat-detail" class="chat-detail"><p class="loading">載入對話…</p></div></section>';
}
async function loadChat(){
 if(!selectedChat)return;
 const id=selectedChat;const rows=await api('/conversations/'+id+'/messages');if(id!==selectedChat||page!=='chat')return;
 const c=chats.find(c=>c.id===id)!;const target=document.querySelector('#chat-detail');if(!target)return;
 target.innerHTML='<div class="chat-heading"><div><h2>'+e(c.business_name)+'</h2><small>案件負責人：'+e(c.owner_name)+' · 首次接洽：'+e(staff.find(s=>s.id===c.first_agent_id)?.name||'尚無成功模擬回覆')+'</small></div>'+badge('LINE 尚未串接','amber')+'</div><p class="chat-notice">本地訊息模擬，不會送到 LINE。原生 OA 後台與私人通訊無法在此歸屬操作者。</p><div class="messages">'+(rows.length?rows.map((m:Row)=>'<article class="message '+(m.direction==='out'?'out':'')+'"><div class="message-meta">'+e(m.actor_name||'虛構客戶')+' · '+e(date(m.created_at))+'</div><div class="bubble">'+e(m.body)+'</div><small>'+e(m.source==='human'?'人工回覆':'客戶示範')+' · '+e(({simulated:'本地模擬完成，未發送至 LINE',failed:'模擬發送失敗',received_demo:'示範接收資料'} as Row)[m.status])+'</small>'+(m.status==='failed'&&m.actor_id===me.id?'<button data-retry="'+e(m.id)+'">重試模擬</button>':'')+'</article>').join(''):empty('尚無訊息','可使用下方表單模擬回覆。'))+'</div><form id="message-form" class="composer"><label class="sr-only" for="message-body">回覆內容</label><textarea id="message-body" name="body" required maxlength="2000" placeholder="輸入工作回覆（本地模擬）"></textarea><div><label class="checkbox"><input type="checkbox" name="simulate_failure">模擬失敗</label><button class="primary" type="submit">模擬回覆</button></div><p class="form-error" role="alert"></p></form>';
}
async function renderActivity(){
 const rows=await api('/activity');const target=document.querySelector('#content');if(page==='activity'&&target)target.innerHTML='<section class="panel"><div class="panel-heading"><h2>最近 100 筆操作</h2><span class="muted">由伺服器記錄</span></div>'+history(rows)+'</section>';
}
function history(rows:Row[]){
 return rows.length?'<ol class="history">'+rows.map(r=>'<li><span class="history-dot"></span><div><b>'+e(actionNames[r.action]||r.action)+'</b><small>'+e(r.actor_name)+' · '+e(date(r.created_at))+'</small><details><summary>檢視紀錄</summary><pre>'+e(r.detail)+'</pre></details></div></li>').join('')+'</ol>':empty('尚無操作紀錄','接洽、轉交、收款與成交會在此保留歷程。');
}
function staffPage(){
 return '<section class="panel"><div class="panel-heading"><h2>操作人員</h2><span class="muted">停權立即使工作階段失效</span></div>'+staff.map(s=>'<div class="staff-row"><span class="avatar">'+e(s.name.slice(-1))+'</span><div><b>'+e(s.name)+'</b><small>'+e(roleNames[s.role])+'</small></div>'+badge(s.active?'使用中':'已停權',s.active?'green':'')+(s.role!=='operator_owner'?'<button data-staff="'+e(s.id)+'" data-active="'+(s.active?'0':'1')+'">'+(s.active?'停權':'恢復')+'</button>':'')+'</div>').join('')+'</section>';
}
async function renderRisk(){const data=await api('/admin/risk');if(page==='risk')document.querySelector('#content')!.innerHTML='<section class="panel">'+empty(data.message,'目前沒有啟用模型、規則或告警。此畫面不代表已分析，也不判定任何人員風險。')+'</section>';}
async function newOpportunity(businessId=''){
 const businesses=await api('/businesses');
 showModal('<p class="eyebrow">NEW OPPORTUNITY</p><h2>建立成交案件</h2><p class="muted">企業與聯絡人會沿用至租戶管理。</p><form id="opportunity-form"><label>企業來源<select name="business_id" id="business-select"><option value="">建立新企業</option>'+businesses.map((b:Row)=>'<option value="'+e(b.id)+'" '+(b.id===businessId?'selected':'')+'>'+e(b.name)+'</option>').join('')+'</select></label><div id="new-business" '+(businessId?'hidden':'')+'><div class="form-grid"><label>企業名稱<input name="business_name" maxlength="150" '+(!businessId?'required':'')+'></label><label>統編（選填）<input name="registration_no" pattern="[0-9]{8}" maxlength="8"></label><label>聯絡人<input name="contact_name" maxlength="100" '+(!businessId?'required':'')+'></label><label>電話<input name="phone" maxlength="50"></label><label>Email<input type="email" name="email" maxlength="200"></label></div></div><label>案件名稱<input name="title" value="借址登記與企業服務" required maxlength="150"></label><div class="form-grid"><label>案件負責人<select name="owner_id" '+(!owner()?'disabled':'')+'>'+options(staff.filter(s=>['operator_owner','operator_sales'].includes(s.role)&&s.active),me.id)+'</select></label><label>預估金額（NT$）<input type="number" name="amount" value="0" min="0" max="1000000000" required></label><label>來源<input name="source" value="人工建立" required maxlength="100"></label><label>下次跟進（台北時間）<input type="datetime-local" name="followup_at"></label></div><label>下一步<input name="next_action" maxlength="500" placeholder="例：確認登記需求"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">建立案件</button></form>');
}
async function showOpportunity(id:string){
 const o=await api('/opportunities/'+id);const events=await api('/activity?business_id='+encodeURIComponent(o.business_id));const business=await api('/businesses/'+o.business_id);
 const canEdit=seller();const canPay=['operator_owner','operator_finance'].includes(me.role);
 showModal('<p class="eyebrow">OPPORTUNITY</p><h2>'+e(business.name)+'</h2><p>'+e(o.title)+'</p><div class="detail-badges">'+badge(stageNames[o.stage],'green')+badge(o.payment_status==='paid'?'人工核對已收款':'尚未收款',o.payment_status==='paid'?'green':'amber')+badge('LINE／金流尚未串接')+'</div><p class="muted">'+o.contacts.map((c:Row)=>e(c.name)+' · '+e(c.phone)+' · '+e(c.email)).join('<br>')+'</p><form id="edit-form" data-id="'+e(o.id)+'" data-version="'+o.version+'"><div class="form-grid"><label>階段<select name="stage" '+(!canEdit||o.stage==='won'?'disabled':'')+'>'+Object.entries(stageNames).filter(([s])=>s!=='won'||o.stage==='won').map(([s,n])=>'<option value="'+s+'" '+(o.stage===s?'selected':'')+'>'+n+'</option>').join('')+'</select></label><label>案件負責人<select name="owner_id" '+(!canEdit?'disabled':'')+'>'+options(staff.filter(s=>['operator_owner','operator_sales'].includes(s.role)&&(s.active||s.id===o.owner_id)),o.owner_id)+'</select></label><label>預估金額（NT$）<input name="amount" type="number" min="0" max="1000000000" value="'+o.amount+'" '+(!canEdit?'disabled':'')+' required></label><label>下次跟進（台北時間）<input name="followup_at" type="datetime-local" value="'+e(o.followup_at?new Date(new Date(o.followup_at).getTime()+8*3600000).toISOString().slice(0,16):'')+'" '+(!canEdit?'disabled':'')+'></label></div><label>下一步<input name="next_action" maxlength="500" value="'+e(o.next_action)+'" '+(!canEdit?'disabled':'')+'></label><label>原因／備註<textarea name="note" maxlength="1000" '+(!canEdit?'disabled':'')+'>'+e(o.note)+'</textarea></label><p class="form-error" role="alert"></p>'+(canEdit?'<button class="primary" type="submit">儲存案件</button>':'')+'</form>'+(canEdit&&o.stage==='billing'?'<div class="handoff"><h3>完成成交，接續租戶服務</h3><p>沿用企業與聯絡人。成交不代表已收款或功能已開通。</p><button class="primary" data-win="'+e(o.id)+'" data-version="'+o.version+'">成交轉租戶</button></div>':'')+(o.stage==='won'?'<div class="handoff"><p>已成交 · 數位功能尚未開通</p><button data-tenant="'+e(o.business_id)+'">查看租戶與功能申請 →</button></div>':'')+(canPay?'<details class="payment"><summary>人工收款核對（未串接金流）</summary><form id="payment-form" data-id="'+e(o.id)+'" data-version="'+o.version+'"><label>付款紀錄<select name="payment_status"><option value="unpaid" '+(o.payment_status==='unpaid'?'selected':'')+'>尚未收款</option><option value="paid" '+(o.payment_status==='paid'?'selected':'')+'>人工核對已收款</option></select></label><label>核對依據<input name="reference" required maxlength="300" placeholder="填寫人工確認依據，不填真實敏感帳號"></label><p class="form-error" role="alert"></p><button type="submit">儲存核對紀錄</button></form></details>':'')+'<h3 class="section-title">操作歷程</h3>'+history(events));
}
async function showTenant(id:string){
 const b=await api('/businesses/'+id);const events=await api('/activity?business_id='+encodeURIComponent(id));
 showModal('<p class="eyebrow">TENANT SERVICES</p><h2>'+e(b.name)+'</h2><div class="detail-badges">'+badge('已成交','green')+badge('數位服務尚未開通')+'</div><p class="muted">'+b.contacts.map((c:Row)=>e(c.name)+' · '+e(c.phone)).join('<br>')+'</p>'+(owner()?'<form id="assignee-form" data-id="'+e(id)+'"><label>服務承辦人<select name="service_owner_id">'+options(staff.filter(s=>s.active&&['operator_owner','operator_sales','operator_service'].includes(s.role)),b.service_owner_id)+'</select></label><p class="form-error" role="alert"></p><button type="submit">指派承辦人</button></form>':'')+'<h3 class="section-title">企業數位服務租用</h3><p class="muted">本輪可管理需求；申請中不代表付費、訂閱或正式開通。</p><div class="service-grid">'+Object.entries(moduleNames).map(([key,name])=>{const req=b.services.find((s:Row)=>s.module===key&&s.status==='requested');return '<article><h3>'+name+'</h3>'+badge(req?'申請中':'未申請',req?'amber':'')+'<p>尚未串接 · 未開通</p>'+(canRequest()?req?'<button data-cancel="'+e(req.id)+'" data-business="'+e(id)+'">取消申請</button>':'<button data-module="'+key+'" data-business="'+e(id)+'">提出需求</button>':'')+'</article>';}).join('')+'</div>'+(seller()?'<button class="primary" data-upsell="'+e(id)+'">＋ 建立加購案件</button>':'')+'<h3 class="section-title">服務與操作歷程</h3>'+history(events));
}
function formData(form:HTMLFormElement):Row{return Object.fromEntries(new FormData(form));}
function followUTC(value:string){return value?new Date(value+':00+08:00').toISOString():'';}
document.addEventListener('change',event=>{
 const target=event.target as HTMLSelectElement;if(target.id==='business-select'){
  const box=document.querySelector<HTMLElement>('#new-business')!;box.hidden=!!target.value;
  box.querySelectorAll<HTMLInputElement>('input[name="business_name"],input[name="contact_name"]').forEach(i=>i.required=!target.value);
 }
});
document.addEventListener('submit',async event=>{
 const form=event.target as HTMLFormElement;event.preventDefault();if(busy)return;busy=true;
 const button=form.querySelector<HTMLButtonElement>('button[type="submit"]');if(button)button.disabled=true;
 try{
  const d=formData(form);
  if(form.id==='login-form'){await api('/demo/login','POST',d);await start();}
  if(form.id==='search-form'){search=d.q;render();}
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
   await api('/conversations/'+selectedChat+'/messages','POST',{body:d.body,idempotency_key:form.dataset.key,simulate_failure:d.simulate_failure==='on'});
   await refresh();toast(d.simulate_failure==='on'?'已記錄模擬失敗，可由原發送人重試':'本地模擬完成，未發送至 LINE');
  }
 }catch(err){if(form.querySelector('.form-error'))formError(form,(err as Error).message);else toast((err as Error).message);}
 finally{busy=false;if(button)button.disabled=false;}
});
document.addEventListener('click',async event=>{
 const target=(event.target as HTMLElement).closest<HTMLElement>('button,a');if(!target)return;
 const d=target.dataset;try{
 if(d.action==='menu')document.querySelector('.shell')?.classList.add('menu-open');
 if(d.action==='menu-close')document.querySelector('.shell')?.classList.remove('menu-open');
 if(d.action==='close')dialog.close();
 if(d.action==='logout'){await api('/logout','POST',{});me=undefined as unknown as Row;page='dashboard';search='';filter='';dialog.close();await loginScreen();}
 if(d.page){event.preventDefault();page=d.page;search='';filter='';render();}
 if(d.action==='new')await newOpportunity();
 if(d.filter!==undefined){filter=d.filter;render();}
 if(d.opp)await showOpportunity(d.opp);
 if(d.tenant)await showTenant(d.tenant);
 if(d.chat){selectedChat=d.chat;render();}
 if(d.upsell)await newOpportunity(d.upsell);
 if(d.win){target.setAttribute('disabled','');await api('/opportunities/'+d.win+'/win','POST',{version:Number(d.version)});dialog.close();page='tenants';await refresh();toast('已成交並轉為租戶；功能仍未開通');}
 if(d.module){await api('/businesses/'+d.business+'/services','POST',{module:d.module});await refresh();await showTenant(d.business!);toast('需求已保存，目前仍未開通');}
 if(d.cancel){await api('/businesses/'+d.business+'/services/'+d.cancel,'PATCH',{status:'cancelled'});await refresh();await showTenant(d.business!);toast('申請已取消');}
 if(d.retry){await api('/conversations/'+selectedChat+'/messages/'+d.retry+'/retry','POST',{});await refresh();toast('本地重試完成；沒有新增重複訊息');}
 if(d.staff){await api('/staff/'+d.staff+'/status','PATCH',{active:d.active==='1'});staff=await api('/staff');render();toast('人員狀態已更新');}
 }catch(err){toast((err as Error).message);target.removeAttribute('disabled');}
});
window.addEventListener('unhandledrejection',event=>{event.preventDefault();toast(event.reason?.message||'載入失敗，請重新整理');});
void start().catch(err=>{root.innerHTML='<main class="login"><h1>暫時無法載入</h1><p>'+e(err.message)+'</p><p>請重新整理頁面後再試。</p></main>';});
