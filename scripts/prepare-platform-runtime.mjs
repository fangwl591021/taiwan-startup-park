import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
const root='.migration-build/smart-menu';
function replaceOnce(source,before,after){if(source.split(before).length!==2)throw new Error('Runtime overlay does not match pinned source: '+before.slice(0,70));return source.replace(before,after);}
let backend=await readFile(root+'/backend/src/index.ts','utf8');
backend=replaceOnce(backend,"async function resolveTenantContext(c: any) {","async function resolveTenantContext(c: any) {\n  if (c.env.TSP_CONTEXT) return c.env.TSP_CONTEXT;");
backend=replaceOnce(backend,"type Bindings = {","type Bindings = {\n  TSP_CONTEXT?: {workspaceId:string;userId:string;userRole:string};");
await writeFile(root+'/backend/src/index.ts',backend);
let entitlements=await readFile(root+'/backend/src/modules/entitlements.ts','utf8');
entitlements=replaceOnce(entitlements,"enabled: status ? status === 'ENABLED' : true,","enabled: status ? status === 'ENABLED' : false,");
entitlements=replaceOnce(entitlements,"{ moduleKey, enabled: true, source: 'LEGACY_COMPATIBILITY' }","{ moduleKey, enabled: false, source: 'LEGACY_COMPATIBILITY' }");
await writeFile(root+'/backend/src/modules/entitlements.ts',entitlements);
let app=await readFile(root+'/frontend/src/App.jsx','utf8');
app=replaceOnce(app,"import SmartGuide from './components/SmartGuide';","import SmartGuide from './components/SmartGuide';\nimport {RuntimeDashboard,RuntimeSites,BorrowedCompanies} from './components/StartupParkWorkspace';");
const start=app.indexOf('const PRODUCTION_WORKER_BASE_URL ='),end=app.indexOf('const LEGACY_RICH_MENU_DIMENSIONS');
if(start<0||end<start)throw new Error('Missing API configuration');
app=app.slice(0,start)+`const workspaceId = new URLSearchParams(location.search).get('workspace') || '';
const PRODUCTION_WORKER_BASE_URL = location.origin;
const API_BASE_URL = '/api/platform-runtime/' + encodeURIComponent(workspaceId);
const apiUrl = (path = '') => { if(!/^\\/api\\//.test(path)||path.includes('..'))throw new Error('無效工作區路徑');return API_BASE_URL + path; };

`+app.slice(end);
app=replaceOnce(app,"const getAuthToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || '';","// Marker only: every API request is verified by the HttpOnly root session.\nconst getAuthToken = () => workspaceId ? 'server-session' : '';");
app=replaceOnce(app,'const apiMemoryCache = new Map();','const apiMemoryCache = new Map();\nlet actorScope=\'\';');
const authStart=app.indexOf('const authFetch = async'),authEnd=app.indexOf('const apiMemoryCache',authStart);
app=app.slice(0,authStart)+`const authFetch = async (path, options = {}) => {
 const headers = new Headers(options.headers || {});headers.delete('Authorization');
 if(!['GET','HEAD'].includes((options.method || 'GET').toUpperCase())){headers.set('X-Requested-With','tsp');apiMemoryCache.clear();}
 const response = await fetch(apiUrl(path), {...options,headers,credentials:'same-origin',cache:'no-store'});
 if(path==='/api/auth/me'&&response.ok){const identity=await response.clone().json();const scope=[identity.user?.id,identity.activeWorkspaceId,identity.activeRole].join(':');if(scope!==actorScope){apiMemoryCache.clear();actorScope=scope;}}\n if([401,403,409].includes(response.status)){apiMemoryCache.clear();if(response.status===401)location.assign('/');}
 if(response.status===403)window.dispatchEvent(new CustomEvent('smart-menu:module-not-enabled'));
 return response;
};

`+app.slice(authEnd);
app=replaceOnce(app,"const cached = apiMemoryCache.get(path);","const cached = apiMemoryCache.get(workspaceId + ':' + actorScope + ':' + path);");
app=replaceOnce(app,"apiMemoryCache.set(path, {","apiMemoryCache.set(workspaceId + ':' + path, {");
app=replaceOnce(app,"key.startsWith(prefix)","key.startsWith(workspaceId + ':' + actorScope + ':' + prefix)");
const dashStart=app.indexOf('const DashboardView ='),dashEnd=app.indexOf('const ProjectsView =',dashStart);
app=app.slice(0,dashStart)+"const DashboardView = ({onNavigate}) => <RuntimeDashboard request={authFetch} onNavigate={onNavigate} />;\n\n"+app.slice(dashEnd);
app=replaceOnce(app,"  const [currentView, setCurrentView] = useState('dashboard');","  const [currentView, setCurrentView] = useState('dashboard');\n  const [navOpen,setNavOpen]=useState(()=>!matchMedia('(max-width: 767px)').matches);");
app=replaceOnce(app,"await authFetch('/api/auth/logout', { method: 'POST' });","await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'tsp'}});");
app=replaceOnce(app,"    setSession(null);\n    setCurrentView('dashboard');","    apiMemoryCache.clear();\n    location.assign('/');");
app=replaceOnce(app,"    loadSession();\n  }, []);","    loadSession();\n    const refresh=()=>loadSession();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);\n  }, []);");
const loginStart=app.indexOf('  if (!session) {',app.indexOf('function AppShell')),loginEnd=app.indexOf('  const activeWorkspace =',loginStart);
app=app.slice(0,loginStart)+`  if (!session) return <main className="p-8 text-blue-950"><h1 className="text-2xl font-bold">數位工作區尚無可用身分</h1><p>請從主工作台選擇已授權的工作區。</p><a href="/">返回台灣創業園</a></main>;

`+app.slice(loginEnd);
app=replaceOnce(app,"{ id: 'projects', label: '圖文選單專案', icon: FolderKanban },","{ id: 'projects', label: '圖文選單專案', icon: FolderKanban },\n  {id:'sites',label:'官網素材與草稿',icon:LayoutTemplate},\n  {id:'line-settings',label:'LINE OA 設定',icon:Smartphone},");
app=replaceOnce(app,"['dashboard', 'projects', 'templates', 'crm', 'campaigns', 'commerce', 'travel', 'ai-usage']","['dashboard', 'sites', 'line-settings', 'projects', 'templates', 'crm', 'campaigns', 'commerce', 'travel', 'ai-usage']");
app=replaceOnce(app,'<aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200">','<aside className={navOpen ? "tsp-runtime-sidebar flex flex-col w-64 bg-white border-r border-gray-200" : "hidden"}>');
app=replaceOnce(app,"{isPlatformAdminMode ? 'Smart Menu 管理後台' : 'Smart Menu Studio'}","{'台灣創業園 · 數位服務'}");
app=replaceOnce(app,"onClick={() => { setModuleNotice(''); setCurrentView(item.id); }}","onClick={() => {setModuleNotice('');setCurrentView(item.id);if(matchMedia('(max-width: 767px)').matches)setNavOpen(false);}}");
app=replaceOnce(app,'<div className="text-sm text-gray-500">\n            {isPlatformAdminMode','<div className="text-sm text-gray-500 flex items-center gap-3"><button aria-label="收合或展開工作區選單" onClick={()=>setNavOpen(x=>!x)} className="border rounded px-3 py-2 text-blue-900"><Menu size={20}/></button>\n            {isPlatformAdminMode');
app=replaceOnce(app,'<div className="text-right">\n            <div','<div className="text-right"><a href="/" className="text-blue-800 underline">借址主工作台</a>\n            <div');
app=replaceOnce(app,"{currentView === 'projects' && !isPlatformAdminMode && tenantViewAccessible && (","{currentView === 'sites' && tenantViewAccessible && <RuntimeSites request={authFetch} />}\n            {currentView === 'projects' && !isPlatformAdminMode && tenantViewAccessible && (");
app=replaceOnce(app,'<MembersView\n                onOpenAccount=', '<div><p>操作人員使用主工作台的已驗證帳號；企業帳號須由業者明確授權。</p><a className="text-blue-800 underline" href="/">管理操作人員與企業授權</a></div>/*<MembersView\n                onOpenAccount=');
app=replaceOnce(app,"setCurrentView('member-linehub');\n                }}\n              />","setCurrentView('member-linehub');\n                }}\n              />*/");
// Keep the original component inventory but remove incompatible standalone password management.
app=replaceOnce(app,"<AccountView session={session} onSessionChanged={loadSession} />",'<div><h2>已驗證帳號</h2><p>{session.user?.display_name}</p><p>登入與停權由台灣創業園主工作台管理。</p><a href="/" className="text-blue-800 underline">返回主工作台</a></div>');
app=replaceOnce(app,'<CrmWorkspace request={authFetch} userRole={activeRole} />','<><BorrowedCompanies request={authFetch}/><CrmWorkspace request={authFetch} userRole={activeRole} /></>');
app=replaceOnce(app,"{currentView === 'sites' && tenantViewAccessible && <RuntimeSites request={authFetch} />}","{currentView === 'line-settings' && tenantViewAccessible && <><p className='mb-4 rounded border border-amber-300 bg-amber-50 p-4'>此工作區 OA 設定會加密保存；接收與外送尚未啟用。業者正式接收設定與平台 OA 請至借址主工作台整合中心管理。</p><LineHubView member={null} projectId={null} aiEnabled={false} onBack={()=>setCurrentView('dashboard')}/></>}{currentView === 'sites' && tenantViewAccessible && <RuntimeSites request={authFetch} />}");
app=replaceOnce(app,'<span className="text-white font-bold text-sm">SM</span>','<span className="text-white font-bold text-sm">園</span>');
await writeFile(root+'/frontend/src/App.jsx',app);
let modules=await readFile(root+'/frontend/src/module-entitlements.js','utf8');modules=replaceOnce(modules,"  projects: 'CORE_MENU',","  projects: 'CORE_MENU',\n  sites: 'CORE_MENU',\n  'line-settings': 'CORE_MENU',");await writeFile(root+'/frontend/src/module-entitlements.js',modules);
await cp('platform/runtime/StartupParkWorkspace.jsx',root+'/frontend/src/components/StartupParkWorkspace.jsx');
await writeFile(root+'/frontend/vite.config.js',"import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({base:'/platform/',plugins:[react()],build:{outDir:'dist'}});\n");
await writeFile(root+'/frontend/src/index.css',(await readFile(root+'/frontend/src/index.css','utf8'))+"\nhtml{font-size:17px}body{color:#15384b}h1,h2,h3,label{color:#14549a!important} button.bg-black,aside .bg-black{background-color:#06a94e!important} .text-gray-400,.text-gray-500{color:#405a70!important} .text-xs{font-size:.88rem} .text-sm{font-size:1rem}nav{overflow-y:auto} @media(max-width:767px){.tsp-runtime-sidebar{position:absolute;z-index:20;left:0;top:64px;bottom:0;box-shadow:0 10px 30px #0003} header{padding-left:12px!important;padding-right:12px!important} main>div{padding:16px!important}}");
await mkdir('reports',{recursive:true});await writeFile('reports/platform-runtime-overlay.json',JSON.stringify({server_cookie_auth:true,source_default_workspace:false,client_bearer_tokens:false,legacy_entitlement_default:false,source_data_resources:false,external_integrations:'not_configured',upstream_snapshot_unchanged:true},null,2)+'\n');
console.log('Applied reviewed runtime adapter to build copy only.');
