import React,{useEffect,useRef,useState} from 'react';
const errors={MENU_OPERATOR_FORBIDDEN:'只有租戶管理員或系統管理員可以授權。',MENU_OPERATOR_INPUT_INVALID:'請填寫正確 LINE UID（U 開頭、32 個小寫十六進位字元）。',MENU_OPERATOR_STALE:'設定已被變更，請重新載入後再試。',MENU_OPERATOR_ACCOUNT_REQUIRED:'請先連結此租戶的 LINE 官方帳號。'};
const phases={checking:'檢查中',publishing:'部署中',succeeded:'部署完成',failed:'未發布',uncertain:'結果待核對',acknowledged:'已人工核對'};
export default function RichMenuChatOperators({request,endpoint}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uid,setUid]=useState(''),[label,setLabel]=useState(''),[retry,setRetry]=useState(0),[review,setReview]=useState(null);
  const active=useRef(null),latest=useRef(null);latest.current={request,endpoint};
  const current=context=>context&&active.current===context&&latest.current.request===context.request&&latest.current.endpoint===context.endpoint;
  useEffect(()=>{const context={request,endpoint,saving:false};active.current=context;setData(null);setError('');setUid('');setLabel('');setBusy(false);setReview(null);
    const load=async()=>{try{const response=await request(endpoint,{cache:'no-store'}),body=await response.json();if(!response.ok||!body.success)throw new Error(body.error);if(current(context))setData(body);}catch(e){if(current(context))setError(errors[e.message]||'管理員與發布紀錄暫時無法讀取。');}};
    load();const timer=setInterval(()=>{if(!context.saving)load();},5000);
    return()=>{clearInterval(timer);if(active.current===context)active.current=null;};
  },[request,endpoint,retry]);
  const context=active.current;
  const mutate=async(path,method,body)=>{if(!current(context)||context.saving)return;context.saving=true;setBusy(true);setError('');try{
    const response=await context.request(context.endpoint+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok||!result.success)throw new Error(result.error);if(current(context))setRetry(v=>v+1);
  }catch(e){if(current(context))setError(errors[e.message]||'設定未儲存，請重試。');}finally{if(current(context)){context.saving=false;setBusy(false);}}};
  return <div className="border-t pt-4 space-y-3">
    <h4 className="font-semibold">聊天室選單管理員</h4>
    <p className="text-sm text-gray-600">預設不授權一般會員。加入管理員 UID 後，他才能在此官方帳號的一對一聊天室輸入「修改選單」→ 選既有選單 → 上傳原圖 → 部署。群組不啟動此流程。</p>
    <p className="text-sm text-gray-600">可先私訊官方帳號「修改選單」，未授權提示會顯示本人 UID。授權僅適用此工作區。</p>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={()=>setRetry(v=>v+1)}>重新載入管理員與紀錄</button>
    {!data&&!error&&<p role="status">讀取中…</p>}
    {data&&current(context)&&<>
      {!data.configured?<p>請先連結 LINE 官方帳號。</p>:<>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();mutate('','PUT',{uid:uid.trim(),label:label.trim(),enabled:true,revision:0});}}>
          <label className="flex-1 min-w-60">LINE UID<input className="border rounded block w-full p-2" aria-label="選單管理員 LINE UID" value={uid} onChange={event=>setUid(event.target.value)} placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" maxLength={33} disabled={busy}/></label>
          <label>辨識名稱（選填）<input className="border rounded block p-2" aria-label="選單管理員辨識名稱" value={label} onChange={event=>setLabel(event.target.value)} maxLength={80} disabled={busy}/></label>
          <button type="submit" className="bg-blue-700 text-white rounded px-4 py-2 disabled:opacity-50" disabled={busy||!/^U[a-f0-9]{32}$/.test(uid.trim())}>{busy?'儲存中…':'新增授權'}</button>
        </form>
        {!(data.operators||[]).length&&<p className="text-sm">尚未授權任何聊天室選單管理員。</p>}
        <ul className="space-y-2">{(data.operators||[]).map(row=><li key={row.uid} className="flex flex-wrap items-center gap-3 border rounded p-3">
          <span className="flex-1 min-w-0"><span>{row.label||'選單管理員'}</span><code className="block text-xs break-all">{row.uid}</code></span>
          <span>{row.enabled?'已授權':'已停用'}</span><button type="button" className={`rounded px-3 py-2 text-white ${row.enabled?'bg-red-700':'bg-green-700'}`} disabled={busy} onClick={()=>mutate('','PUT',{uid:row.uid,label:row.label,enabled:!row.enabled,revision:row.revision})}>{row.enabled?'停用授權':'重新授權'}</button>
        </li>)}</ul>
      </>}
      <h4 className="font-semibold pt-2">最近聊天室發布紀錄</h4>
      {!(data.jobs||[]).length&&<p className="text-sm text-gray-600">尚無發布紀錄。原圖片、原按鈕與點數資料不會因開通而變更。</p>}
      <ul className="space-y-2">{(data.jobs||[]).map(job=><li key={job.id} className="border rounded p-3 space-y-2"><div className="flex flex-wrap items-center gap-3"><span className="flex-1">{job.projectName||'選單'} · {phases[job.phase]||job.phase}</span><time className="text-xs text-gray-500">{job.createdAt}</time></div>
        {job.errorCode&&<p className="text-sm text-red-700">核對代碼：{job.errorCode}</p>}{job.notificationStatus==='failed'&&<p className="text-sm text-red-700">LINE 完成通知未送達；不會重複發布。</p>}
        {job.phase==='uncertain'&&(review===job.id?<div className="space-y-2"><p className="text-sm text-red-700">請先在圖文選單後台與 LINE 核對圖片、按鈕及首頁。此操作只解除流程，不重發、不回復、不變更現有選單。</p><button type="button" className="border rounded px-3 py-2 mr-2" disabled={busy} onClick={()=>mutate('/jobs/'+encodeURIComponent(job.id)+'/acknowledge','POST',{reviewed:true})}>已完成核對，解除流程</button><button type="button" disabled={busy} onClick={()=>setReview(null)}>取消</button></div>:<button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={()=>setReview(job.id)}>人工核對／解除流程</button>)}
      </li>)}</ul>
    </>}
  </div>;
}
