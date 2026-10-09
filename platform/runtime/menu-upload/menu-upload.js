import { liffEntryParams } from './liff-entry.js';
import { validateMenuUploadSessionAreas } from './menu-upload-geometry.js';
export { createMenuUploadAreas, validateMenuUploadLayout, serializeMenuUploadLayout, MENU_UPLOAD_LAYOUT_HEADER } from './menu-upload-geometry.js';

const hints = ['menuUpload', 'menuRun'];
const otherIntents = ['ref', 'src', 'returnTo', 'memberLogin', 'memberTab', 'memberTabExpires', 'memberPage', 'memberPageExpires', 'activity', 'activityMode', 'activityToken', 'activityCompact', 'cardShare', 'referralShare'];
const validSlug = value => typeof value === 'string' && value !== 'default' && /^[a-zA-Z0-9\u4e00-\u9fff_-]{1,100}$/.test(value);
const validAccount = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const validRun = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const brandPrefix = '/liff/referral/portal/';
const continuationKey = 'smart-menu-menu-upload-continuation';
const continuationTtl = 10 * 60_000;
export const MENU_UPLOAD_MAX_BYTES = 1_000_000;

export function menuUploadStorage() {
  try { return window.sessionStorage; } catch { return null; }
}
export function clearMenuUploadContinuation(storage = menuUploadStorage()) {
  try { storage?.removeItem(continuationKey); } catch { /* No credentials are persisted. */ }
}
export function consumeMenuUploadContinuation(entry, storage = menuUploadStorage()) {
  const saved = readContinuation(storage).value;
  if (saved?.lineAccountId !== entry?.lineAccountId || saved?.menuRun !== entry?.menuRun || saved?.portalSlug !== entry?.portalSlug) return false;
  clearMenuUploadContinuation(storage);
  return true;
}
function readContinuation(storage) {
  try {
    const raw = storage?.getItem(continuationKey);
    if (!raw) return { value: null };
    if (raw.length > 2048) return { invalid: true };
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'expires,liffId,lineAccountId,menuRun,portalSlug'
      || !validAccount(value.lineAccountId) || !validRun(value.menuRun) || !validSlug(value.portalSlug)
      || !/^\d+-[a-zA-Z0-9]+$/.test(value.liffId) || !Number.isSafeInteger(value.expires)) return { invalid: true };
    return { value };
  } catch { return { invalid: true }; }
}
const validContinuationTime = (value, now) => value.expires > now && value.expires <= now + continuationTtl;
export function rememberMenuUploadContinuation(entry, config, storage = menuUploadStorage(), now = Date.now()) {
  menuUploadScopeQuery(entry);
  const safe = validatedConfig(config, entry, config?.portalSlug || entry.portalSlug);
  if (!safe.endpointPath.startsWith(brandPrefix) || !storage) throw menuUploadError('MENU_UPLOAD_CONTINUATION_FAILED');
  const previous = readContinuation(storage).value;
  const same = previous && previous.menuRun === entry.menuRun && previous.lineAccountId === entry.lineAccountId
    && previous.portalSlug === safe.portalSlug && previous.liffId === safe.liffId;
  const expires = entry.continuation?.expires ?? (same ? previous.expires : now + continuationTtl);
  const value = { lineAccountId: entry.lineAccountId, menuRun: entry.menuRun, portalSlug: safe.portalSlug, liffId: safe.liffId, expires };
  if (!validContinuationTime(value, now)) throw menuUploadError('MENU_UPLOAD_SESSION_EXPIRED');
  try { storage.setItem(continuationKey, JSON.stringify(value)); }
  catch { throw menuUploadError('MENU_UPLOAD_CONTINUATION_FAILED'); }
  return value;
}

export function menuUploadError(code) {
  return Object.assign(new Error('Menu upload request failed'), { code });
}

function hasUploadIntent(search) {
  const params = new URLSearchParams(search || '');
  if (hints.some(key => params.has(key))) return true;
  // Even malformed or duplicated primary state must render our error page,
  // never fall through into member establishment or a pending share flow.
  return params.getAll('liff.state').some(state => {
    const separator = state.indexOf('?');
    return hints.some(key => new URLSearchParams(separator < 0 ? state : state.slice(separator + 1)).has(key));
  });
}

export function menuUploadEntryFromLocation(location, storage = menuUploadStorage(), now = Date.now()) {
  const explicit = hasUploadIntent(location?.search);
  if (!explicit) {
    if (location?.pathname !== '/api/line/webhook/menu-upload/page' && !location?.pathname?.startsWith(brandPrefix)) return null;
    try {
      const params = liffEntryParams(location.search, location.pathname, otherIntents);
      // A deliberate member/referral/share entry never inherits an OAuth
      // continuation from another action. The upload resolver runs first.
      if ([...otherIntents, 'lineAccountId'].some(key => params.has(key))) { clearMenuUploadContinuation(storage); return null; }
      const pending = readContinuation(storage);
      if (!pending.value && !pending.invalid) return null;
      // A corrupt/expired non-authorizing marker still records this feature's
      // intent on a bare OAuth callback. Repeated reloads must not establish a
      // member. Only an explicit different action or a new upload replaces it.
      if (pending.invalid) return { invalid: true };
      const value = pending.value;
      if (location.pathname.startsWith(brandPrefix) && decodeURIComponent(location.pathname.slice(brandPrefix.length)) !== value.portalSlug) return null;
      if (params.has('portalSlug') && params.get('portalSlug') !== value.portalSlug) return { invalid: true };
      if (!validContinuationTime(value, now)) return { invalid: true };
      return { lineAccountId: value.lineAccountId, menuRun: value.menuRun, portalSlug: value.portalSlug,
        continuation: { liffId: value.liffId, expires: value.expires } };
    } catch { return readContinuation(storage).value || readContinuation(storage).invalid ? { invalid: true } : null; }
  }
  try {
    const pathname = location.pathname;
    if (!['/', '/api/line/webhook/menu-upload/page'].includes(pathname) && !pathname.startsWith(brandPrefix)) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
    const params = liffEntryParams(location.search, pathname, [...hints, ...otherIntents]);
    const lineAccountId = params.get('lineAccountId'), menuRun = params.get('menuRun');
    if (params.get('menuUpload') !== '1' || !validAccount(lineAccountId) || !validRun(menuRun)
      || otherIntents.some(key => params.has(key))) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
    let portalSlug = params.get('portalSlug') || '';
    if (pathname.startsWith(brandPrefix)) {
      const routeSlug = decodeURIComponent(pathname.slice(brandPrefix.length));
      if (!validSlug(routeSlug) || (portalSlug && portalSlug !== routeSlug)) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
      portalSlug = routeSlug;
    }
    if (params.has('portalSlug') && !validSlug(portalSlug)) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
    const result = { lineAccountId, menuRun, portalSlug };
    const saved = readContinuation(storage).value;
    if (saved?.menuRun === menuRun && saved.lineAccountId === lineAccountId && saved.portalSlug === portalSlug) {
      if (!validContinuationTime(saved, now)) return { invalid: true };
      result.continuation = { liffId: saved.liffId, expires: saved.expires };
    }
    return result;
  } catch { return { invalid: true }; }
}

export function menuUploadScopeQuery(entry) {
  if (entry?.invalid || !validAccount(entry?.lineAccountId) || !validRun(entry?.menuRun)
    || (entry.portalSlug && !validSlug(entry.portalSlug))) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
  return new URLSearchParams({ lineAccountId: entry.lineAccountId, menuRun: entry.menuRun }).toString();
}

// Call only after SDK initialization AND the server has verified this live
// session. Pin public intent before consuming a bare OAuth continuation so a
// later reload cannot accidentally enter the unrelated member portal.
export function pinMenuUploadLocation(entry, location, history) {
  try {
    menuUploadScopeQuery(entry);
    const origin = new URL(location.origin);
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) return false;
    const brand = entry.portalSlug ? brandPrefix + encodeURIComponent(entry.portalSlug) : '';
    if (!['/', '/api/line/webhook/menu-upload/page', brand].filter(Boolean).includes(location.pathname)) return false;
    const params = new URLSearchParams(location.search);
    const publicKeys = ['menuUpload', 'menuRun', 'lineAccountId', 'portalSlug'];
    const current = menuUploadEntryFromLocation(location, null);
    if (current && !current.invalid && current.menuRun === entry.menuRun && current.lineAccountId === entry.lineAccountId
      && current.portalSlug === (entry.portalSlug || '') && !location.hash && [...params.keys()].every(key => publicKeys.includes(key))) return true;
    const target = new URL(location.pathname, origin.origin);
    target.search = new URLSearchParams({ menuUpload: '1', menuRun: entry.menuRun, lineAccountId: entry.lineAccountId,
      ...(entry.portalSlug ? { portalSlug: entry.portalSlug } : {}) }).toString();
    history.replaceState(null, '', target.href);
    return true;
  } catch { return false; }
}

function validatedConfig(config, entry, portalSlug) {
  const slug = portalSlug || '';
  if (!/^\d+-[a-zA-Z0-9]+$/.test(config?.liffId || '') || !['READY', 'NOT_RUNTIME_VERIFIED'].includes(config?.status)
    || (slug && !validSlug(slug)) || (entry.portalSlug && slug !== entry.portalSlug)) throw menuUploadError('MENU_UPLOAD_CONFIG_INVALID');
  const expected = slug ? brandPrefix + encodeURIComponent(slug) : '';
  // Accept only the known endpoint, including its equivalent Unicode spelling.
  const rawBrand = slug ? brandPrefix + slug : '';
  if (!['/', '/api/line/webhook/menu-upload/page', expected, rawBrand].filter(Boolean).includes(config.endpointPath)) throw menuUploadError('MENU_UPLOAD_CONFIG_INVALID');
  return { ...config, endpointPath: config.endpointPath === rawBrand ? expected : config.endpointPath, portalSlug: slug };
}

export function menuUploadLoginRedirect(origin, config, entry) {
  menuUploadScopeQuery(entry);
  const safe = validatedConfig(config, entry, config?.portalSlug || entry.portalSlug);
  let target;
  try { target = new URL(safe.endpointPath, origin); }
  catch { throw menuUploadError('MENU_UPLOAD_LINK_INVALID'); }
  if (!['https:', 'http:'].includes(target.protocol) || target.origin !== new URL(origin).origin || target.username || target.password) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
  target.search = new URLSearchParams({ menuUpload: '1', menuRun: entry.menuRun, lineAccountId: entry.lineAccountId,
    ...(safe.portalSlug ? { portalSlug: safe.portalSlug } : {}) }).toString();
  target.hash = '';
  // Explicit redirectUri is used only by the legacy non-brand endpoint.
  // Brand endpoints must use liff.login() with a bounded public continuation:
  // encoded Chinese overrides double-encode and Unicode overrides are rejected.
  if (safe.endpointPath.startsWith(brandPrefix)) throw menuUploadError('MENU_UPLOAD_BRAND_LOGIN_OVERRIDE');
  return target.href;
}

const tokenValid = token => typeof token === 'string' && token.length > 0 && token.length <= 4096 && !/\s/.test(token);
export async function menuUploadJson(apiBase, path, { token, signal, fetcher = fetch, timeoutMs, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (token != null) {
    if (!tokenValid(token)) throw menuUploadError('MENU_UPLOAD_LOGIN_REQUIRED');
    headers.set('Authorization', 'Bearer ' + token);
  }
  const duration = timeoutMs ?? (options.method === 'POST' ? 45_000 : 20_000);
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 45_000) throw menuUploadError('MENU_UPLOAD_REQUEST_FAILED');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
  try {
    let response;
    try { response = await fetcher(apiBase + path, { ...options, headers, signal: controller.signal, credentials: 'omit', cache: 'no-store' }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw menuUploadError(timedOut ? 'MENU_UPLOAD_REQUEST_TIMEOUT' : 'MENU_UPLOAD_CONNECTION_FAILED');
    }
    let body;
    try { body = await response.json(); }
    catch { throw menuUploadError(timedOut ? 'MENU_UPLOAD_REQUEST_TIMEOUT' : 'MENU_UPLOAD_RESPONSE_INVALID'); }
    if (signal?.aborted || controller.signal.aborted) throw menuUploadError(timedOut ? 'MENU_UPLOAD_REQUEST_TIMEOUT' : 'MENU_UPLOAD_CONNECTION_FAILED');
    if (!response.ok || body?.success !== true) {
      const code = body?.errorCode || body?.error;
      throw menuUploadError(typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(code) ? code : 'MENU_UPLOAD_REQUEST_FAILED');
    }
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

// This isolated entry never establishes a member, reads a profile or sends LINE
// messages. The server authorizes the live run using this LIFF access token.
export async function initializeMenuUpload({ entry, location, apiBase, signal, fetcher = fetch, loadSdk, alive = () => true, storage = menuUploadStorage(), now = () => Date.now() }) {
  menuUploadScopeQuery(entry);
  const validExpiry = () => !entry.continuation || (validContinuationTime(entry.continuation, now()) && /^\d+-[a-zA-Z0-9]+$/.test(entry.continuation.liffId));
  if (!validExpiry()) throw menuUploadError('MENU_UPLOAD_SESSION_EXPIRED');
  const body = await menuUploadJson(apiBase, '/api/line/webhook/menu-upload/bootstrap?' + new URLSearchParams({ lineAccountId: entry.lineAccountId }), { signal, fetcher });
  if (!alive()) return { status: 'stale' };
  const config = validatedConfig(body.config, entry, body.portalSlug);
  if (entry.continuation && entry.continuation.liffId !== config.liffId) throw menuUploadError('MENU_UPLOAD_CONFIG_INVALID');
  const brandPath = config.portalSlug ? brandPrefix + encodeURIComponent(config.portalSlug) : '';
  const allowed=[config.endpointPath];
  if (!allowed.filter(Boolean).includes(location.pathname)) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
  let liff;
  try { liff = await loadSdk(); } catch { throw menuUploadError('MENU_UPLOAD_SDK_UNAVAILABLE'); }
  if (!alive()) return { status: 'stale' };
  try { await liff.init({ liffId: config.liffId }); } catch { throw menuUploadError('MENU_UPLOAD_LOGIN_FAILED'); }
  if (!alive()) return { status: 'stale' };
  if (liff.id && liff.id !== config.liffId) throw menuUploadError('MENU_UPLOAD_CONFIG_INVALID');
  // Leave SDK-owned parameters untouched. The primary page must let the SDK
  // perform its secondary redirect before requesting a session or an upload.
  if (new URLSearchParams(location.search).has('liff.state')) return { status: 'redirecting', liff };
  const current = menuUploadEntryFromLocation(location, storage, now());
  if (!current || current.invalid || current.lineAccountId !== entry.lineAccountId || current.menuRun !== entry.menuRun
    || (current.portalSlug && current.portalSlug !== config.portalSlug)) throw menuUploadError('MENU_UPLOAD_LINK_INVALID');
  let loggedIn;
  try { loggedIn = liff.isLoggedIn(); } catch { throw menuUploadError('MENU_UPLOAD_LOGIN_FAILED'); }
  if (!loggedIn) {
    try {
      if (config.endpointPath.startsWith(brandPrefix)) {
        rememberMenuUploadContinuation({ ...current, continuation: entry.continuation }, config, storage, now());
        liff.login();
      } else liff.login({ redirectUri: menuUploadLoginRedirect(location.origin, config, current) });
    }
    catch { throw menuUploadError('MENU_UPLOAD_LOGIN_FAILED'); }
    return { status: 'redirecting', liff };
  }
  let token;
  try { token = liff.getAccessToken(); } catch { throw menuUploadError('MENU_UPLOAD_LOGIN_REQUIRED'); }
  if (!tokenValid(token)) throw menuUploadError('MENU_UPLOAD_LOGIN_REQUIRED');
  if (!validExpiry()) throw menuUploadError('MENU_UPLOAD_SESSION_EXPIRED');
  return { status: 'ready', token, liff };
}

export function validateMenuUploadSession(body) {
  if (typeof body?.projectName !== 'string' || !body.projectName.trim() || body.projectName.length > 200
    || ![body.originalWidth, body.originalHeight, body.areaCount, body.expiresAt].every(Number.isSafeInteger)
    || body.originalWidth < 1 || body.originalHeight < 1 || body.areaCount < 1 || body.areaCount > 20
    || body.expiresAt < 1 || !['upload', 'busy', 'done', 'uncertain'].includes(body.status)) throw menuUploadError('MENU_UPLOAD_RESPONSE_INVALID');
  const areas = validateMenuUploadSessionAreas(body);
  return { projectName: body.projectName, originalWidth: body.originalWidth, originalHeight: body.originalHeight,
    areaCount: body.areaCount, expiresAt: body.expiresAt, status: body.status,
    ...(areas ? { areaEditVersion: 1, areas } : {}) };
}

export function validateMenuUploadJob(body, expectedJobId) {
  if (typeof body?.jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(body.jobId) || (expectedJobId && body.jobId !== expectedJobId)
    || !['checking', 'acknowledged', 'publishing', 'succeeded', 'failed', 'uncertain'].includes(body.phase)
    || (body.errorCode != null && (typeof body.errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,79}$/.test(body.errorCode)))) throw menuUploadError('MENU_UPLOAD_RESPONSE_INVALID');
  return { jobId: body.jobId, phase: body.phase, errorCode: body.errorCode || '' };
}

export async function decodeMenuUploadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => { image.onload = null; image.onerror = null; image.src = ''; reject(menuUploadError('IMAGE_INVALID')); }, 10_000);
      image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
      image.onerror = () => { clearTimeout(timer); reject(menuUploadError('IMAGE_INVALID')); };
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function validateMenuUploadFile(file, session, decode = decodeMenuUploadImage) {
  if (!file || !['image/jpeg', 'image/png'].includes(file.type)) throw menuUploadError('IMAGE_FORMAT_INVALID');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size >= MENU_UPLOAD_MAX_BYTES) throw menuUploadError('IMAGE_SIZE_INVALID');
  let dimensions;
  try { dimensions = await decode(file); } catch { throw menuUploadError('IMAGE_INVALID'); }
  const { width, height } = dimensions;
  if (![width, height].every(Number.isSafeInteger) || width < 800 || width > 2500 || height < 250 || width / height < 1.45) throw menuUploadError('IMAGE_DIMENSIONS_INVALID');
  if (Math.abs(width / height - session.originalWidth / session.originalHeight) > Math.max(1 / session.originalHeight, 1 / height)) throw menuUploadError('IMAGE_RATIO_MISMATCH');
  return { width, height, size: file.size };
}

export function closeMenuUpload(liff) {
  try { if (liff?.isInClient?.()) { liff.closeWindow(); return true; } } catch { /* The visible return explanation remains available. */ }
  return false;
}

export function menuUploadErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'MENU_UPLOAD_LAYOUT_OVERLAP') return '按鈕框線重疊過多，可能觸發錯誤功能。請調整框線後再送出。';
  if (code === 'MENU_UPLOAD_LAYOUT_BOUNDS') return '按鈕框線超出圖片範圍，請修正座標或尺寸後再送出。';
  if (code === 'MENU_UPLOAD_LAYOUT_TINY') return '按鈕框線太小，請放大範圍後再送出。';
  if (code === 'MENU_UPLOAD_LAYOUT_DIMENSIONS_MISMATCH') return '按鈕座標與新圖片尺寸不一致，請重新選取原圖並核對框線。';
  if (code === 'MENU_UPLOAD_LAYOUT_CONFLICT') return '這次上傳已使用另一份座標處理，請勿重複部署。請重新開啟此上傳頁或由管理員查看後台紀錄確認結果。';
  if (code === 'MENU_UPLOAD_LAYOUT_INVALID') return '無法確認按鈕座標，請保留原有按鈕並修正有效的整數座標。';
  if (/PERMISSION|FORBIDDEN|UNAUTHORIZED|LOGIN_REQUIRED/.test(code)) return '目前 LINE 身分沒有此選單的修改權限，或登入已失效。請返回聊天室重新開啟上傳按鈕。';
  if (/EXPIRED|SESSION|RUN|MENU_CHANGED/.test(code)) return '這個上傳流程已過期或選單已變更。請返回聊天室重新輸入「修改選單」，不要重複部署。';
  if (/IMAGE_(SIZE|TOO_LARGE)/.test(code)) return '圖片需小於 1 MB（1,000,000 bytes），請選擇原始 JPG／PNG 檔。';
  if (/IMAGE_(FORMAT|MIME)/.test(code)) return '只支援 JPG／PNG 原圖，不支援 ZIP、HEIC 或其他格式。';
  if (code === 'IMAGE_DIMENSIONS_INVALID') return '尺寸不符：寬需為 800–2500 像素、高至少 250 像素。大版可用 2500 × 1686，小版可用 2500 × 843。';
  if (code === 'IMAGE_RATIO_MISMATCH') return '新圖與目前選單版型比例不同。請選擇同比例原圖；原按鈕不會重新偵測。';
  if (code === 'IMAGE_INVALID') return '無法解碼這張圖片。請選擇有效的 JPG／PNG 原圖，原選單未變更。';
  if (code === 'IMAGE_UPLOAD_TIMEOUT') return '原圖上傳逾時，尚未送出部署。請確認網路後，再選擇原圖上傳。';
  if (/UNCERTAIN|INTERRUPTED/.test(code)) return '部署狀態需要確認，請勿再次上傳。請重新開啟此上傳頁或由管理員查看後台紀錄確認。';
  if (/CONFIG|SDK/.test(code)) return '此官方帳號的 LIFF 上傳入口尚未可用，請返回聊天室或聯絡租戶管理員。';
  if (code === 'MENU_UPLOAD_LINK_INVALID') return '上傳連結無效，請從原官方帳號聊天室重新開啟上傳按鈕。';
  return '目前無法完成操作。若已按下部署，請勿重複上傳；請重新開啟此上傳頁或由管理員查看後台紀錄確認。';
}
