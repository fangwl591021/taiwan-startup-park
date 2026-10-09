import { Hono, type Context } from '../../../.migration-build/smart-menu/backend/node_modules/hono/dist/index.js';
import { verifyLiffAccessToken } from './liff-token.mjs';
import { canChangeRichMenu, menuUploadLiffConfig, runMenuJob } from './rich-menu-chat.mjs';
import { discardMenuUploadBody, readMenuUploadImage } from './rich-menu-chat-image.mjs';
import { menuUploadGeometry, menuUploadJobLayoutMatches, menuUploadSessionAreas, parseMenuUploadLayout } from './rich-menu-upload-layout.mjs';

type Env = { Bindings: { smart_menu_db: D1Database; smart_menu_assets: R2Bucket } };
type Status = 400 | 401 | 403 | 404 | 408 | 409 | 410 | 413 | 503;
type Session = { run_id: string; phase: string; snapshot_json: string; expires_at: number };
type Job = { id: string; phase: string; error_code: string | null; notification_status: string; progress_json?: string | null };
class UploadError extends Error {
  code: string; status: Status; details: Record<string, number>;
  constructor(code: string, status: Status = 400, details: Record<string, number> = {}) { super(code); this.code = code; this.status = status; this.details = details; }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function fail(code: string, status: Status = 400): never { throw new UploadError(code, status); }
const jobResponse = (job: Job) => ({ success: true, jobId: job.id, phase: job.phase, errorCode: job.error_code, notificationStatus: job.notification_status });

function query(c: Context<Env>, runRequired = true) {
  const params = new URL(c.req.url).searchParams;
  if ([...params.keys()].some(key => !['lineAccountId', 'menuRun', 'portalSlug'].includes(key) || params.getAll(key).length !== 1)) fail('MENU_UPLOAD_INPUT_INVALID');
  const lineAccountId = params.get('lineAccountId'), menuRun = params.get('menuRun'), portalSlug = params.get('portalSlug');
  if (!lineAccountId || !/^[A-Za-z0-9_-]{1,120}$/.test(lineAccountId) || (runRequired || menuRun !== null) && !uuid(menuRun)) fail('MENU_UPLOAD_INPUT_INVALID');
  return { lineAccountId, menuRun: menuRun || '', portalSlug };
}
export function createRichMenuUploadRoutes(fetcher: typeof fetch = fetch) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  app.onError((error, c) => error instanceof UploadError
    ? c.json({ success: false, error: error.code, ...error.details }, error.status)
    : c.json({ success: false, error: 'MENU_UPLOAD_UNAVAILABLE' }, 503));
  async function configuration(c: Context<Env>, runRequired = true) {
    const input = query(c, runRequired);
    let config;
    try { config = await menuUploadLiffConfig(c.env.smart_menu_db, input.lineAccountId); }
    catch { fail('MENU_UPLOAD_CONFIG_UNAVAILABLE', 409); }
    if (input.portalSlug !== null && input.portalSlug !== config.portalSlug) fail('MENU_UPLOAD_SCOPE_MISMATCH', 403);
    return { input, config };
  }
  async function authority(c: Context<Env>) {
    const { input, config } = await configuration(c), account = config.account, db = c.env.smart_menu_db;
    const token = /^Bearer ([^\s]{1,4096})$/i.exec(c.req.header('Authorization') || '')?.[1];
    if (!token) fail('MENU_UPLOAD_AUTH_REQUIRED', 401);
    let uid: string;
    try { const verified = await verifyLiffAccessToken(token, config.lineLoginChannelId, (url, init) => fetcher(url, { ...init, signal: AbortSignal.timeout(8000) })); uid = verified.lineUserId; }
    catch { fail('MENU_UPLOAD_AUTH_INVALID', 401); }
    if (!/^U[a-f0-9]{32}$/.test(uid!)) fail('MENU_UPLOAD_AUTH_INVALID', 401);
    if (!await canChangeRichMenu(db, account, uid!)) fail('MENU_UPLOAD_FORBIDDEN', 403);
    const session = await db.prepare('SELECT run_id,phase,snapshot_json,expires_at FROM rich_menu_chat_sessions WHERE workspace_id=? AND line_account_id=? AND line_user_id=?')
      .bind(account.workspace_id, account.id, uid!).first<Session>();
    if (!session || session.run_id !== input.menuRun) fail('MENU_UPLOAD_SESSION_STALE', 409);
    if (session.expires_at <= Date.now()) fail('MENU_UPLOAD_SESSION_EXPIRED', 410);
    if (!session.snapshot_json || ['choose', 'cancelled', 'acknowledged'].includes(session.phase)) fail('MENU_UPLOAD_SESSION_STALE', 409);
    const snapshot = JSON.parse(session.snapshot_json);
    if (snapshot.project?.workspace_id !== account.workspace_id || !snapshot.project?.id) fail('MENU_UPLOAD_SESSION_STALE', 409);
    return { account, uid: uid!, session, snapshot, run: input.menuRun };
  }
  app.get('/bootstrap', async c => {
    const { config } = await configuration(c, false);
    return c.json({ success: true, config: { liffId: config.liffId, status: config.status, endpointPath: config.endpointPath }, ...(config.portalSlug ? { portalSlug: config.portalSlug } : {}) });
  });
  app.get('/session', async c => {
    const { session, snapshot } = await authority(c);
    if (session.phase === 'failed') fail('MENU_UPLOAD_SESSION_STALE', 409);
    return c.json({ success: true, projectName: String(snapshot.project.name), originalWidth: snapshot.config.size.width, originalHeight: snapshot.config.size.height,
      areaCount: snapshot.areas.length, expiresAt: session.expires_at, status: session.phase, areaEditVersion: 1, areas: menuUploadSessionAreas(snapshot) });
  });
  app.get('/jobs/:jobId', async c => {
    const { account, uid, session, run } = await authority(c), jobId = c.req.param('jobId');
    if (!uuid(jobId)) fail('MENU_UPLOAD_INPUT_INVALID');
    const eventPrefix = 'liff:' + run + ':' + uid + ':';
    const job = await c.env.smart_menu_db.prepare(`SELECT id,phase,error_code,notification_status FROM rich_menu_chat_jobs
      WHERE id=? AND workspace_id=? AND line_account_id=? AND line_user_id=? AND snapshot_json=? AND substr(event_id,1,?)=? LIMIT 1`)
      .bind(jobId, account.workspace_id, account.id, uid, session.snapshot_json, eventPrefix.length, eventPrefix).first<Job>();
    if (!job) fail('MENU_UPLOAD_JOB_NOT_FOUND', 404);
    return c.json(jobResponse(job!));
  });
  app.post('/image', async c => {
    const { account, uid, session, snapshot, run } = await authority(c), db = c.env.smart_menu_db;
    const requestId = c.req.header('X-Menu-Upload-Request');
    if (!uuid(requestId)) fail('MENU_UPLOAD_INPUT_INVALID');
    let layout;
    try { layout = parseMenuUploadLayout(c.req.header('X-Menu-Upload-Layout'), snapshot); }
    catch (error) { if ((error as Error).message === 'MENU_UPLOAD_LAYOUT_INVALID') fail('MENU_UPLOAD_LAYOUT_INVALID'); throw error; }
    const eventId = 'liff:' + run + ':' + uid + ':' + requestId;
    const prior = () => db.prepare('SELECT id,phase,error_code,notification_status,progress_json FROM rich_menu_chat_jobs WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND event_id=? AND snapshot_json=? LIMIT 1')
      .bind(account.workspace_id, account.id, uid, eventId, session.snapshot_json).first<Job>();
    const replay = await prior();
    if (replay) {
      if (!menuUploadJobLayoutMatches(replay.progress_json, layout)) fail('MENU_UPLOAD_LAYOUT_CONFLICT', 409);
      try { await discardMenuUploadBody(c.req.raw); }
      catch (error) {
        const value = error as { message?: string; status?: Status; details?: Record<string, number> };
        if (['IMAGE_TOO_LARGE', 'IMAGE_UPLOAD_TIMEOUT'].includes(value.message || '')) throw new UploadError(value.message!, value.status || 409, value.details);
        fail('MENU_UPLOAD_SESSION_BUSY', 409);
      }
      return c.json(jobResponse(replay), 202);
    }
    if (session.phase !== 'upload') fail('MENU_UPLOAD_SESSION_BUSY', 409);
    let image;
    try {
      image = await readMenuUploadImage(c.req.raw);
      if (!image.width || !image.height) throw new UploadError('IMAGE_INVALID');
      menuUploadGeometry(snapshot, image, layout);
    } catch (error) {
      const value = error as { message?: string; status?: Status; details?: Record<string, number> };
      const code = ['IMAGE_INVALID', 'IMAGE_TOO_LARGE', 'IMAGE_UPLOAD_TIMEOUT', 'IMAGE_FORMAT_UNSUPPORTED', 'IMAGE_FORMAT_MISMATCH', 'IMAGE_RATIO_MISMATCH', 'AREA_INVALID', 'MENU_UPLOAD_LAYOUT_DIMENSIONS_MISMATCH'].includes(value.message || '') ? value.message! : 'IMAGE_LAYOUT_INVALID';
      throw new UploadError(code, value.status || 400, { ...value.details, ...(image ? { actualSize: image.bytes.length, actualWidth: image.width, actualHeight: image.height } : {}) });
    }
    if (!await canChangeRichMenu(db, account, uid)) fail('MENU_UPLOAD_FORBIDDEN', 403);
    const jobId = crypto.randomUUID();
    const changed = await db.batch([
      db.prepare(`UPDATE rich_menu_chat_sessions SET phase='busy',updated_at=CURRENT_TIMESTAMP
        WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase='upload' AND snapshot_json=? AND expires_at>?`)
        .bind(account.workspace_id, account.id, uid, run, session.snapshot_json, Date.now()),
      db.prepare(`INSERT INTO rich_menu_chat_jobs(id,workspace_id,line_account_id,project_id,line_user_id,event_id,phase,snapshot_json,old_asset_id,old_menu_id,progress_json,notification_status)
        SELECT ?,workspace_id,line_account_id,?,line_user_id,?,'checking',snapshot_json,?,?,?,'suppressed' FROM rich_menu_chat_sessions
        WHERE workspace_id=? AND line_account_id=? AND line_user_id=? AND run_id=? AND phase='busy' AND snapshot_json=? AND changes()=1`)
        .bind(jobId, snapshot.project.id, eventId, snapshot.project.asset_id, snapshot.oldMenuId, layout ? JSON.stringify({ menuUploadLayout: layout }) : null, account.workspace_id, account.id, uid, run, session.snapshot_json),
    ]);
    if (changed[0].meta.changes !== 1 || changed[1].meta.changes !== 1) {
      const concurrent = await prior();
      if (concurrent) {
        if (!menuUploadJobLayoutMatches(concurrent.progress_json, layout)) fail('MENU_UPLOAD_LAYOUT_CONFLICT', 409);
        return c.json(jobResponse(concurrent), 202);
      }
      fail('MENU_UPLOAD_SESSION_BUSY', 409);
    }
    c.executionCtx.waitUntil(runMenuJob({ env: c.env, account, uid, event: null, notify: null, session, snapshot, jobId, fetcher, directImage: image, uploadLayout: layout }).catch(() => { console.error('MENU_UPLOAD_JOB_FAILED'); }));
    return c.json({ success: true, jobId, phase: 'checking' }, 202);
  });
  return app;
}
