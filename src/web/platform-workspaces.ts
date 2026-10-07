type Row=Record<string,any>;
type Dependencies={api:(path:string,method?:string,data?:Row)=>Promise<any>;e:(value:unknown)=>string;badge:(label:string,tone?:string)=>string;me:()=>Row;modal:(html:string)=>void;toast:(message:string)=>void;refresh:()=>Promise<void>;openAddress:(id:string)=>Promise<void>;serviceState:(contract:Row)=>{label:string;tone:string}};
export function platformWorkspaces(d:Dependencies){
 let query='',cursors:(string|null)[]=[null],index=0,snapshot:Row={},identity='';
 const fingerprint=()=>[d.me().id,d.me().operator_id,d.me().role].join(':');
 function resetIdentity(){const current=fingerprint();if(current!==identity){identity=current;query='';cursors=[null];index=0;snapshot={};}}
 function path(){resetIdentity();const p=new URLSearchParams({limit:'50'});if(query)p.set('q',query);if(cursors[index])p.set('cursor',cursors[index]!);return '/platform-workspaces?'+p;}
 function render(data:Row){
  resetIdentity();snapshot=data;
  const e=d.e,items=data.items||[];
  return '<section class="panel pw-panel"><div class="panel-heading"><h2>工作區 <span class="count">'+e(data.total)+'</span></h2><form id="pw-search-form" class="search"><input name="q" aria-label="搜尋平台工作區" placeholder="搜尋業者／企業" maxlength="100" value="'+e(query)+'"><button type="submit" aria-label="搜尋平台工作區">⌕</button></form></div><p class="pw-note">業者 OA 與進駐企業 OA 各自管理。企業成交後沿用原資料；數位權益另行核准。</p>'+(items.length?'<ul class="pw-list" aria-label="平台工作區列表">'+items.map((w:Row)=>'<li><div><strong>'+e(w.name)+'</strong><span>'+e(w.scope_kind==='operator'?'業者工作區':'進駐企業工作區')+' · '+e(w.access==='borrowed_address_service'?'借址服務管理':w.access==='enterprise_membership'?'企業管理授權':'業者管理')+'</span></div><div class="pw-state">'+d.badge(w.status==='active'?'工作區有效':'工作區暫停',w.status==='active'?'green':'amber')+d.badge('原平台整合中','amber')+'</div><button data-pw-detail="'+e(w.id)+'" aria-label="查看 '+e(w.name)+' 工作區">查看 →</button></li>').join('')+'</ul>':'<p class="empty">尚無可存取的工作區。企業管理帳號須先取得該企業授權。</p>')+'<div class="list-pagination"><span>共 '+e(data.total)+' 筆 · 第 '+(index+1)+' 頁</span><div><button data-pw-page="previous" '+(!index?'disabled':'')+'>上一頁</button><button data-pw-page="next" '+(!data.next_cursor?'disabled':'')+'>下一頁</button></div></div></section><section class="panel pw-panel"><div class="panel-heading"><h2>完整平台整合狀態</h2></div><p class="pw-note">Smart-Menu 的 8 個模組完整保留，執行路由尚在整合。LINE、金流與 AI 的開通會分別確認；未議定費率與分潤保持空白。</p><p>既有借址成交、合約、郵件與維運仍在原工作台使用。</p></section>';
 }
 async function detail(id:string){
  const epoch=fingerprint(),w=await d.api('/platform-workspaces/'+encodeURIComponent(id));
  if(epoch!==fingerprint())return;
  const e=d.e,address=w.address;
  const contract=(c:Row)=>'<li><div><strong>'+e(c.location_name)+'</strong><span>'+e(c.starts_on)+' ～ '+e(c.ends_on)+'</span></div><div><strong>'+e(({annual:'年約',monthly:'月約',two_year:'兩年約',custom:'自訂期間',unknown:'待補'} as Row)[c.term_kind]||'合約類型待補')+'</strong><span>'+e(({once:'一次繳清',monthly:'每月繳付',quarterly:'每季繳付',half_yearly:'每半年繳付',yearly:'每年繳付',custom:'依個別約定'} as Row)[c.payment_cycle]||'付款週期待補')+' · '+e(d.serviceState(c).label)+'</span></div></li>';
  d.modal('<h2>'+e(w.name)+'</h2><div class="detail-badges">'+d.badge(w.scope_kind==='operator'?'業者工作區':'進駐企業工作區')+d.badge(w.status==='active'?'工作區有效':'工作區暫停',w.status==='active'?'green':'amber')+'</div><p class="pw-note">工作區對應已建立，原平台功能仍在整合，尚未開通。</p>'+(address?'<section class="pw-detail"><h3>借址服務</h3><p>'+e(address.business.name)+(address.business.registration_no?' · 統編 '+e(address.business.registration_no):'')+'</p>'+(address.contracts.length?'<ul class="pw-list pw-contracts">'+address.contracts.map(contract).join('')+'</ul>':'<p>尚未建立借址合約，服務起迄與合約類型待補。</p>')+(d.me().role!=='business_admin'?'<button data-pw-address="'+e(address.business.id)+'">開啟借址維運台 →</button>':'')+'</section>':'')+'<section class="pw-detail"><h3>完整平台模組</h3><ul class="pw-modules">'+w.modules.map((m:Row)=>'<li><strong>'+e(m.name)+'</strong>'+d.badge('整合中，未開通','amber')+'</li>').join('')+'</ul><p>費率：待議定 · 分潤：待議定</p></section>'+(d.me().role==='operator_owner'?'<form id="pw-status-form" data-id="'+e(w.id)+'" data-version="'+e(w.version)+'"><h3>工作區狀態</h3><label>工作區狀態<select name="status"><option value="active" '+(w.status==='active'?'selected':'')+'>有效</option><option value="suspended" '+(w.status==='suspended'?'selected':'')+'>暫停</option></select></label><label>變更依據<input name="reference" required maxlength="500"></label><p>僅調整此工作區的存取狀態；借址合約仍需在維運台管理。</p><button class="primary" type="submit">保存工作區狀態</button><p class="form-error" role="alert"></p></form>':''));
 }
 document.addEventListener('click',event=>{
  const el=(event.target as HTMLElement).closest<HTMLElement>('[data-pw-detail],[data-pw-page],[data-pw-address]');if(!el)return;
  if(el.dataset.pwDetail)void detail(el.dataset.pwDetail).catch(err=>d.toast(err.message));
  if(el.dataset.pwPage){if(el.dataset.pwPage==='previous'&&index)index--;else if(el.dataset.pwPage==='next'&&snapshot.next_cursor){cursors[++index]=snapshot.next_cursor;}else return;void d.refresh().catch(err=>d.toast(err.message));}
  if(el.dataset.pwAddress){document.querySelector<HTMLDialogElement>('#modal')?.close();void d.openAddress(el.dataset.pwAddress).catch(err=>d.toast(err.message));}
 });
 document.addEventListener('submit',event=>{
  const form=event.target as HTMLFormElement;if(!['pw-search-form','pw-status-form'].includes(form.id))return;
  event.preventDefault();event.stopImmediatePropagation();
  const data=new FormData(form);
  if(form.id==='pw-search-form'){query=String(data.get('q')||'').trim();index=0;cursors=[null];void d.refresh().catch(err=>d.toast(err.message));return;}
  const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;
  void (async()=>{try{await d.api('/platform-workspaces/'+encodeURIComponent(form.dataset.id!),'PATCH',{status:data.get('status'),version:Number(form.dataset.version),reference:data.get('reference')});document.querySelector<HTMLDialogElement>('#modal')?.close();await d.refresh();d.toast('工作區狀態已保存');}catch(err){form.querySelector('.form-error')!.textContent=(err as Error).message;}finally{button.disabled=false;}})();
 });
 return {path,render};
}
