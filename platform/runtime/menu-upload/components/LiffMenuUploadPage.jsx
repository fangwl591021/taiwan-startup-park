import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadLiffSdk } from '../liff-referral.js';
import MenuUploadAreaEditor from './MenuUploadAreaEditor.jsx';
import {
  createMenuUploadAreas, MENU_UPLOAD_LAYOUT_HEADER, serializeMenuUploadLayout, validateMenuUploadLayout,
  closeMenuUpload, consumeMenuUploadContinuation, initializeMenuUpload, menuUploadError, menuUploadErrorMessage,
  menuUploadJson, menuUploadScopeQuery, pinMenuUploadLocation, validateMenuUploadFile, validateMenuUploadJob, validateMenuUploadSession,
} from '../menu-upload.js';

const API_BASE = '';
const pendingPhases = ['loading', 'redirecting', 'validating', 'uploading', 'checking', 'acknowledged', 'publishing'];
const textByPhase = {
  loading: '正在確認 LINE 身分與選單權限…', redirecting: '正在完成 LINE 登入，請稍候…',
  validating: '正在讀取原圖尺寸，圖片不會被縮放或壓縮…', uploading: '正在上傳原始檔案，請勿重複點擊…',
  checking: '正在檢查圖片並準備部署，請勿重複上傳…', publishing: '正在部署圖片與確認後的按鈕範圍，按鈕名稱與功能會保留…',
  acknowledged: '已接收上傳，正在處理選單，請勿重複上傳…',
  succeeded: '圖片已更新並部署，確認後的按鈕範圍已同步，名稱與功能保留。既有使用者選單將自動更新。',
  failed: '這次部署未完成。請查看下方錯誤說明，並由管理員確認後台紀錄；請勿重複上傳。',
  busy: '這個選單已有上傳／部署正在處理，請勿再次上傳。請稍後重新開啟此上傳頁確認結果。',
  uncertain: '部署狀態需要確認，請勿再次上傳。請重新開啟此上傳頁或由管理員查看後台紀錄確認。',
  unconfirmed: '未能確認這次部署的結果，請勿重複上傳。請重新開啟此上傳頁或由管理員查看後台紀錄確認。',
};

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export default function LiffMenuUploadPage({ entry, location = window.location }) {
  const invalid = entry?.invalid, lineAccountId = entry?.lineAccountId, menuRun = entry?.menuRun, portalSlug = entry?.portalSlug;
  const continuationId = entry?.continuation?.liffId, continuationExpires = entry?.continuation?.expires;
  // A recreated but equivalent App route object must not reset a running POST.
  const scopeEntry = useMemo(() => ({ invalid, lineAccountId, menuRun, portalSlug,
    ...(continuationId ? { continuation: { liffId: continuationId, expires: continuationExpires } } : {}) }),
  [invalid, lineAccountId, menuRun, portalSlug, continuationId, continuationExpires]);
  const [phase, setPhase] = useState('loading'), [session, setSession] = useState(null);
  const [selection, setSelection] = useState(null), [error, setError] = useState(null), [leaveHint, setLeaveHint] = useState('');
  const lifetime = useRef(null), selected = useRef(null), previewUrl = useRef(''), selectVersion = useRef(0);
  const clearSelection = () => {
    selected.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    if (lifetime.current) lifetime.current.previewUrl = '';
    setSelection(null);
  };

  useEffect(() => {
    const controller = new AbortController();
    const context = { controller, token: '', liff: null, session: null, locked: false, previewUrl: '' };
    lifetime.current = context;
    const alive = () => lifetime.current === context && !controller.signal.aborted;
    const invalidate = () => { if (lifetime.current === context) lifetime.current = null; selectVersion.current++; };
    selectVersion.current++;
    clearSelection(); setSession(null); setError(null); setLeaveHint(''); setPhase('loading');
    void (async () => {
      try {
        const auth = await initializeMenuUpload({ entry: scopeEntry, location, apiBase: API_BASE,
          signal: controller.signal, loadSdk: loadLiffSdk, alive });
        if (!alive() || auth.status === 'stale') return;
        context.liff = auth.liff;
        if (auth.status === 'redirecting') { setPhase('redirecting'); return; }
        context.token = auth.token;
        const body = await menuUploadJson(API_BASE, '/api/line/webhook/menu-upload/session?' + menuUploadScopeQuery(scopeEntry),
          { token: context.token, signal: controller.signal });
        if (!alive()) return;
        const state = validateMenuUploadSession(body);
        if (state.expiresAt <= Date.now()) throw menuUploadError('MENU_UPLOAD_SESSION_EXPIRED');
        if (pinMenuUploadLocation(scopeEntry, location, window.history)) consumeMenuUploadContinuation(scopeEntry);
        context.session = state; context.locked = state.status !== 'upload';
        setSession(state); setPhase(state.status === 'upload' ? 'ready' : state.status === 'done' ? 'succeeded' : state.status);
      } catch (failure) { if (alive()) { context.locked = true; setError(failure); setPhase('error'); } }
    })();
    return () => {
      invalidate();
      controller.abort();
      if (context.previewUrl) URL.revokeObjectURL(context.previewUrl);
      context.previewUrl = '';
      previewUrl.current = '';
    };
  }, [scopeEntry, location]);

  const selectFile = async event => {
    const context = lifetime.current;
    if (!context || context.locked || !context.session || context.controller.signal.aborted) return;
    const version = ++selectVersion.current;
    const file = event.target.files?.[0];
    clearSelection(); setError(null);
    if (!file) { setPhase('ready'); return; }
    setPhase('validating');
    const alive = () => lifetime.current === context && version === selectVersion.current && !context.controller.signal.aborted;
    try {
      if (context.session.expiresAt <= Date.now()) throw menuUploadError('MENU_UPLOAD_SESSION_EXPIRED');
      const metadata = await validateMenuUploadFile(file, context.session);
      if (!alive()) return;
      const areas = createMenuUploadAreas(context.session, metadata);
      let layoutError = null;
      if (areas) { try { validateMenuUploadLayout(areas, metadata); } catch (failure) { layoutError = failure; } }
      const requestId = crypto.randomUUID();
      previewUrl.current = URL.createObjectURL(file);
      context.previewUrl = previewUrl.current;
      const next = { file, metadata, requestId, previewUrl: previewUrl.current, areas,
        initialAreas: areas ? areas.map(area => ({ ...area })) : null, layoutError };
      selected.current = next; setSelection(next); setPhase('ready');
    } catch (failure) { if (alive()) { setError(failure); setPhase('ready'); } }
  };

  const changeAreas = (file, requestId, areas) => {
    const context = lifetime.current, chosen = selected.current;
    if (!context || context.locked || context.controller.signal.aborted || !chosen || chosen.file !== file
      || chosen.requestId !== requestId || !chosen.initialAreas) return false;
    // The editor may change geometry only. Keep stable server IDs, labels,
    // count and order even if a delayed or malformed callback is invoked.
    if (!Array.isArray(areas) || areas.length !== chosen.initialAreas.length || areas.some((area, index) =>
      !area || area.id !== chosen.initialAreas[index].id || area.label !== chosen.initialAreas[index].label)) return false;
    let layoutError = null;
    try { validateMenuUploadLayout(areas, chosen.metadata); } catch (failure) { layoutError = failure; }
    const next = { ...chosen, areas: areas.map(area => ({ ...area })), layoutError };
    selected.current = next; setSelection(next);
    return true;
  };

  const deploy = async () => {
    const context = lifetime.current, chosen = selected.current;
    if (!context || context.locked || !chosen || context.controller.signal.aborted) return;
    let layout = null;
    try { if (chosen.areas) layout = serializeMenuUploadLayout(chosen.areas, chosen.metadata); }
    catch (failure) {
      const next = { ...chosen, layoutError: failure }; selected.current = next; setSelection(next);
      return;
    }
    // Lock synchronously so two taps before React's next render still create
    // exactly one POST. Network uncertainty never causes an automatic re-upload.
    context.locked = true; setError(null); setPhase('uploading');
    const alive = () => lifetime.current === context && !context.controller.signal.aborted;
    try {
      if (context.session.expiresAt <= Date.now()) throw menuUploadError('MENU_UPLOAD_SESSION_EXPIRED');
      const body = await menuUploadJson(API_BASE, '/api/line/webhook/menu-upload/image?' + menuUploadScopeQuery(entry), {
        token: context.token, signal: context.controller.signal, method: 'POST',
        headers: { 'Content-Type': chosen.file.type, 'X-Menu-Upload-Request': chosen.requestId,
          ...(layout ? { [MENU_UPLOAD_LAYOUT_HEADER]: layout } : {}) }, body: chosen.file,
      });
      if (!alive()) return;
      const initial = validateMenuUploadJob(body);
      const jobId = initial.jobId;
      setPhase(initial.phase);
      if (['succeeded', 'failed', 'uncertain'].includes(initial.phase)) {
        if (initial.phase === 'failed') setError(menuUploadError(initial.errorCode || 'MENU_UPLOAD_REQUEST_FAILED'));
        return;
      }
      // Read-only, bounded backoff. No retries of the deployment POST.
      const deadline = Date.now() + 120_000;
      for (let count = 0; count < 30 && Date.now() < deadline; count++) {
        await pause(Math.min(1000 * 2 ** Math.min(count, 3), 5000), context.controller.signal);
        if (!alive()) return;
        const status = await menuUploadJson(API_BASE, '/api/line/webhook/menu-upload/jobs/' + encodeURIComponent(jobId) + '?' + menuUploadScopeQuery(entry),
          { token: context.token, signal: context.controller.signal });
        if (!alive()) return;
        const job = validateMenuUploadJob(status, jobId);
        setPhase(job.phase);
        if (['succeeded', 'failed', 'uncertain'].includes(job.phase)) {
          if (job.phase === 'failed') setError(menuUploadError(job.errorCode || 'MENU_UPLOAD_REQUEST_FAILED'));
          return;
        }
      }
      if (alive()) setPhase('unconfirmed');
    } catch (failure) {
      if (alive()) {
        setError(failure);
        if (failure?.code === 'IMAGE_UPLOAD_TIMEOUT') { context.locked = false; clearSelection(); setPhase('ready'); }
        else setPhase('unconfirmed');
      }
    }
  };

  const leave = () => {
    const context = lifetime.current;
    if (closeMenuUpload(context?.liff || window.liff)) {
      consumeMenuUploadContinuation(scopeEntry);
      lifetime.current = null; selectVersion.current++; context?.controller.abort();
      return;
    }
    setLeaveHint('請關閉這個分頁，或切回 LINE 原官方帳號聊天室。已送出的部署不會因關閉而取消。');
  };
  const pending = pendingPhases.includes(phase);
  const canSelect = Boolean(session && ['ready', 'validating'].includes(phase) && !lifetime.current?.locked);
  const canDeploy = Boolean(selection && !selection.layoutError && phase === 'ready' && !lifetime.current?.locked && session?.expiresAt > Date.now());
  const size = selection ? `${selection.metadata.size.toLocaleString()} bytes（${(selection.metadata.size / 1000).toFixed(1)} KB）` : '';

  return <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:py-10">
    <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" aria-label="聊天室修改選單上傳" aria-busy={pending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">修改選單・上傳原圖</h1>
        <button type="button" onClick={leave} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">關閉／返回聊天室</button>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">原始檔直接上傳到本系統，不經 LINE 聊天圖片壓縮、不縮放、不使用 AI。</p>
      {leaveHint && <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm" role="status">{leaveHint}</p>}
      {session && <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <h2 className="break-words text-lg font-bold">{session.projectName}</h2>
        <p className="mt-2 text-sm">保留全部 {session.areaCount} 個按鈕的名稱與功能，不重新偵測。{session.areaEditVersion === 1 ? '上傳前可微調按鈕範圍。' : '按鈕相對位置維持不變。'}</p>
        <p className="mt-2 text-sm text-slate-600">目前版型：{session.originalWidth} × {session.originalHeight}。新圖需同比例；大版可用 2500 × 1686，小版可用 2500 × 843。</p>
      </div>}
      {session && <div className="mt-5">
        <label htmlFor="menu-upload-file" className="mb-2 block font-bold">選擇 JPG／PNG 原圖</label>
        <input id="menu-upload-file" type="file" accept="image/jpeg,image/png" disabled={!canSelect} onChange={selectFile}
          className="block w-full rounded-lg border border-slate-300 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-medium file:text-blue-800 disabled:opacity-50" />
        <p className="mt-2 text-sm text-slate-600">檔案小於 1 MB（1,000,000 bytes）。不支援 ZIP 或 HEIC。</p>
      </div>}
      {selection && <>
        {selection.areas ? <MenuUploadAreaEditor key={selection.requestId} imageUrl={selection.previewUrl} dimensions={selection.metadata}
          areas={selection.areas} initialAreas={selection.initialAreas} disabled={phase !== 'ready' || Boolean(lifetime.current?.locked)}
          onChange={areas => changeAreas(selection.file, selection.requestId, areas)} />
          : <div className="mt-5 overflow-hidden rounded-xl border border-slate-200"><img src={selection.previewUrl} alt="待上傳的原圖預覽" className="block h-auto w-full" /></div>}
        <p className="mt-3 break-words rounded-lg bg-slate-50 p-3 text-sm">{selection.file.name} · 實際尺寸 {selection.metadata.width} × {selection.metadata.height} · {size}</p>
      </>}
      {textByPhase[phase] && <div className={`mt-5 rounded-lg p-4 text-sm ${phase === 'succeeded' ? 'bg-green-50 text-green-900' : ['uncertain', 'unconfirmed'].includes(phase) ? 'bg-amber-50 text-amber-900' : 'bg-slate-100'}`} role="status">
        {pending && <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent align-middle" aria-hidden="true" />}
        {textByPhase[phase]}
      </div>}
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">{menuUploadErrorMessage(error)}</p>}
      {session && <button type="button" disabled={!canDeploy} onClick={deploy}
        className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto">{['uploading', 'checking', 'acknowledged', 'publishing'].includes(phase) ? '處理中，請勿重複點擊' : '上傳並部署'}</button>}
      <p className="mt-5 text-xs leading-5 text-slate-500">部署結果顯示在本頁，不發送 LINE 推播。處理中或結果尚未確認時，請勿重複上傳；關閉此頁不會取消已送出的部署，請重新開啟本頁查看狀態。</p>
      <button type="button" onClick={leave} className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-medium sm:w-auto">返回聊天室</button>
    </section>
  </main>;
}
