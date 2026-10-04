# Cloudflare 正式部署

目標 Worker：taiwan-startup-park  
目標網址：https://taiwan-startup-park.fangwl591021.workers.dev  
來源：release/cloudflare（接續已驗收 feature/tenant-operations）  
專案 D1 名稱：taiwan-startup-park-prod

使用者已於對話授權部署。GitHub Actions Cloudflare release 在 release/cloudflare push 時執行建置、測試與設定檢查；全部具備後才進行遠端遷移及部署。PR 或其它分支不執行發布。手動 workflow_dispatch 按鈕須此 workflow 已存在預設分支才會顯示；目前可使用既有 run 的 Re-run all jobs。每次發布使用該次提交，不自行合併既有草稿 PR。

## 私有設定

Repository Settings → Secrets and variables → Actions：

| 名称 | 儲存位置 | 用途 |
| --- | --- | --- |
| CLOUDFLARE_API_TOKEN | Secret | 只授權目標 Cloudflare 帳號，Workers Scripts 編輯、D1 編輯、Access 應用程式／政策與組織讀取；不得貼在聊天或提交程式 |
| CLOUDFLARE_ACCOUNT_ID | Secret 或 Variable | 所屬帳號 ID；流程另核對 workers.dev 子網域 |
| D1_DATABASE_ID | Secret 或 Variable | 本專案 taiwan-startup-park-prod 的實際 UUID，不接受佔位值 |
| ACCESS_ISSUER | Secret 或 Variable | https://團隊.cloudflareaccess.com |
| ACCESS_AUD | Secret 或 Variable | 保護完整目標工作台網域的 Access application AUD |

先列出缺少的名稱，不輸出值；缺項時 build 仍可成功，但 deploy 會停止，不得報告已上線。只檢查上述明確設定，不嘗試發現其它 secret 名稱或讀出其內容。

## 首次初始化

需要先有本專案專用 D1、正式 schema、有效管理員及 auth_identities issuer/subject 綁定，以及 Access application 與 allow policy。流程會檢查這些條件，不會把本地 fixture 或共享示範管理員塞進正式資料庫。

尚未提供 Cloudflare 授權前，無法建立或核對這些實際資源。取得授權後，首次 D1 建立、套用 migrations 和本人主體綁定另依目標帳號進行；不能從 GitHub 使用者名稱或截圖 email 推定 Access subject。現有 release job 不會自行建立管理員或放寬登入。

## 發布程序

1. npm ci、typecheck、npm test（包含 build）、dependency audit、Worker dry-run、桌面／手機流程。
2. 留存 dist、migrations、測試報告與截圖 artifact。
3. 產生未追蹤 wrangler.production.json。固定 APP_ENV=production、DEMO_MODE=off、LINE_SEND_ENABLED=off、workers_dev=true、preview_urls=false。
4. 核對 account 的 workers.dev 子網域、DB 名稱／ID、Access 組織、完整工作台 domain/AUD、allow policy、既有 DB 綁定與有效管理員。
5. 保存既有 Worker deployment metadata 作為回復依據；不輸出 Worker secrets。
6. 對經核對的 DB 執行 migrations apply --remote，再發布 Worker 與靜態資產。
7. 檢查未登入 /api/me 被拒絕或導向 Access。本人登入與操作仍需要真實端到端驗證，不能用此公開檢查取代。

遠端失敗時停止，不自動刪除 DB、不自動還原資料、不啟用 LINE 外送／金流／AI／排程。若部署成功但 smoke 失敗，狀態視為發布後驗證失敗，需檢查已保存版本再回復 Worker；DB migration 不因 Worker 回復而自動倒退。

原始 wrangler.jsonc 保留本地驗收佔位設定；正式產生檔不包含 API token、不加入 git。原產品藍圖完整保留。

## 參考

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/d1/wrangler-commands/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
