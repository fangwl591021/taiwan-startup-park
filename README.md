# 台灣創業園 · Taiwan Startup Park

借址登記業者的 LINE OA 風格工作台。第一期提供借址成交到租戶閉環、地址合約與人工帳務、續約、信件與維運，以及操作人員歷程。

**最新分期決策：第一期只到借址。官網與 LINE OA 等數位服務保留後續程式，平台費與分潤條件均留空、待議定，不計算、不結算。** 詳見 [PHASE_ONE_SCOPE.md](docs/PHASE_ONE_SCOPE.md)。本功能分支的變更與教學錄影尚未發布至正式網址；已發布版本以 DEPLOYMENT_STATUS.md 為準。

**正式工作台已部署，使用 Cloudflare Access 個人身分登入。LINE、金流及 AI 尚未串接／啟用。**
最新發布結果及驗收證據以 [DEPLOYMENT_STATUS.md](docs/DEPLOYMENT_STATUS.md) 為準。

[正式工作台](https://taiwan-startup-park.fangwl591021.workers.dev/) · [獨立測試帳號模擬](https://taiwan-startup-park-demo.fangwl591021.workers.dev/) · [實際錄影教學](https://taiwan-startup-park.fangwl591021.workers.dev/tutorial.html)

測試區及中文字幕教學由 release workflow 建置、驗證及發布；使用獨立 D1、獨立 Access application 和虛構資料。僅原本指定管理員可以進入，再選擇管理員／業務／維運／財務／B 業者模擬身分。正式資料庫不提供角色切換或示範登入。詳見 [SIMULATION_GUIDE.md](docs/SIMULATION_GUIDE.md)。
完整產品需求及後續迭代保留於 [PLATFORM_BLUEPRINT.md](docs/PLATFORM_BLUEPRINT.md)。

## 本機啟動

需 Node.js 22.23.3+（使用內建 node:sqlite）及 npm：

```sh
npm ci
npm run dev
```

開啟 http://127.0.0.1:8787 ，選擇虛構業者與個別操作人員。僅監聽 loopback。
資料持久保存於本機 .local/demo.sqlite；刪除此檔才會重設示範資料。
測試使用記憶體資料庫，不修改你的本地示範資料。預設本機也採借址第一期；既有後續數位回歸僅在明確本機 DIGITAL_PREVIEW=on 時執行，遠端環境無法用此旗標開放數位收費。

前端為 TypeScript + 原生 DOM/CSS；後端為 Workers 相容 Fetch handler。
本地 HTTP adapter 使用 SQLite，D1 migration 位於 migrations/。
未將 Node SQLite 包進 Worker；D1 binding 使用同一套 prepared statement API。
本機 session 使用隨機 token、伺服器雜湊保存、HttpOnly cookie 與停權檢查。
第二輪新增 Cloudflare Access 驗證與 LINE 接收／Outbox adapter，尚未配置正式連線；詳見 [LINE_INTEGRATION.md](docs/LINE_INTEGRATION.md)。

## 驗收流程

1. 以青禾總管理員登入，查看總覽與成交追蹤。
2. 建立企業／聯絡人與案件，搜尋、篩選、設定跟進、轉交負責人。
3. 推進至導入、收費，使用「成交轉租戶」。同企業加購請選擇既有企業。
4. 到租戶維運台管理地址合約、人工應收／收退款、續約、信件與維運。官網、商城、LINE OA／CRM 在第一期只保留後續規劃；總管理員可在據點與方案查看空白待議定的分潤欄位。
5. 在工作聊天室選擇案件，用本地 adapter 模擬回覆。可模擬失敗、由原操作者重試。
6. 切換 S1、S2、S3 驗證指派與歷史回覆者分離；總管理員可停權人員。
7. 用第二家晴川業者帳號驗證資料隔離。維運只看指定租戶，財務不能讀聊天室。
8. 總管理員專區只有尚未啟用空狀態，業務直接呼叫 API 也會拒絕。

畫面時間為 Asia/Taipei，伺服器資料以 UTC 保存。範例均為虛構，不得輸入正式客戶資料。

## 清楚區分狀態

| 項目 | 本輪狀態 |
| --- | --- |
| 身分驗證 | Access adapter 已實作；未設定 issuer/AUD/帳號綁定時 fail closed |
| LINE OA | Webhook / push adapter 已實作；正式 channel 未串接，本機不對外發訊 |
| 金流 | 尚未串接；只可保存人工收款核對，不發生交易 |
| AI / 風控 | 尚未啟用；不產生假分數或告警 |
| 官網 / 商城 / LINE / CRM 租用 | 後續程式與歷程保留；第一期不新增需求、訂閱或數位收費，不開通 |
| 數位平台費與分潤 | 欄位 NULL／待議定，沒有計算、撥款或結算 |
| 平台管理員 / 企業管理員 | 保留角色，工作台尚未開放；不默認跨業者存取 |

成交與付款各自記錄；成交不代表已付款，申請不代表已開通。
聊天室來源欄位預留 customer / human / ai_auto / ai_approved，本機只產生 human 模擬回覆；配置完成的正式 LINE 文字外送保留 human 與真實 actor。
公開 LINE API 不保證能取得原生 OA 後台的實際回覆人員，私人通訊亦不在此資料範圍。
工作通訊紀錄的目的告知、保存期限與刪除政策仍須在正式導入時落實。

## 環境與部署界線

| 欄位 | 本輪值 | 用途 |
| --- | --- | --- |
| APP_ENV | production（Worker 預設） | 只有 local 才能開示範 session |
| DEMO_MODE | off（Worker 預設） | 須 on 且 loopback 才能示範登入 |
| DB | D1 binding | wrangler 的 database_id 為無效 placeholder |
| ASSETS | 靜態資產 binding | dist/public |
| DEMO_DB | 可選本機 SQLite 路徑 | 只供 scripts/dev.mjs；預設 .local/demo.sqlite |
| PORT | 8787 | 僅供本機 loopback server |

.dev.vars.example 僅含安全假值；不要加入正式 token 或資料。
wrangler.jsonc 刻意未配置有效 D1，workers_dev=false。
**禁止把本地 demo 當作正式登入。** 即使 production 誤設 DEMO_MODE=on 仍會拒絕。
dev.mjs 不可公開代理或對外部署。正式環境使用 Access 驗證、Secure cookie 與固定 APP_ORIGIN；仍需完成 Access policy／邊界限流與實際部署接線。

本輪未讀取或修改正式 Cloudflare 帳號、Worker、資料庫、R2、排程、通知或金流。
Worker URL 僅作目標識別，不代表已驗證部署權限。
worker:check 只執行 wrangler deploy --dry-run，不發佈。
正式資源盤點與 staging 建立依第 10 節另行執行。

## 測試

```sh
npm run typecheck
npm test
npm run worker:check
npx playwright install --with-deps chromium
npm run test:e2e
```

GitHub Actions 執行相同流程並保存桌面／手機截圖及測試報告。
已完成的驗收與畫面證據：[FOUNDATION_ACCEPTANCE.md](docs/FOUNDATION_ACCEPTANCE.md)。
套件鎖已提交；CI 一律 npm ci。
測試涵蓋兩業者與角色隔離、偽造身分、版本衝突、成交冪等、沿用企業／聯絡人、
回覆歸屬、失敗重試、停權、production 關閉 demo、申請／開通分離及手機溢出。
測試驗證 D1 相容 SQLite adapter；未對正式 Cloudflare D1 或 LINE 系統做整合驗證。

## 檔案與設計

- src/worker.ts：所有權限在後端執行；operator_id 與 actor_id 來自 session。
- migrations/0001_foundation.sql：企業、聯絡人、案件、對話、訊息、申請與操作事件，複合外鍵防止跨業者關聯。
- src/web/app.ts、public/app.css：繁中響應式工作台，所有外部文字以 HTML escaping 輸出。
- scripts/database.mjs：本地 SQLite D1 adapter 與兩家純虛構 fixtures，不打包至 Worker。
- tests/core.test.mjs：API 核心及隔離測試。
- tests/ui/：桌面／手機流程測試與截圖。
- docs/FOUNDATION_SCOPE.md：本輪取捨與後續整合需求。

工作事件只提供讀取 API；歷史訊息不因案件轉交或人員停權而改寫。
沒有一般使用者的聊天匯出／刪除或檔案下載 API；LINE 收回事件處理與 inbox/outbox 基礎延續第二輪，尚未啟用正式排程。後續新增功能須同樣套用資料權限與保存政策。

第二輪已通過 30 項後端及 4 項瀏覽器測試，詳見 [LINE_ACCEPTANCE.md](docs/LINE_ACCEPTANCE.md)。正式接線尚未驗證，未部署 Worker。


## 第三輪租戶維運

本分支新增地址合約、應收與人工收退款、信件包裹、維運需求、數位訂閱與後端權益檢查。參見 [租戶維運範圍](docs/TENANT_OPERATIONS.md)。原始藍圖保持完整；金流、物流、模組開通及 AI 仍未串接，沒有正式部署。

第三輪驗收結果與桌面／手機截圖：[TENANT_ACCEPTANCE.md](docs/TENANT_ACCEPTANCE.md)。
