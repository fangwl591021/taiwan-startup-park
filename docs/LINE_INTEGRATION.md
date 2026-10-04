# 第二輪：登入、LINE 接收與可靠外送

基準為 Foundation commit 109376156c7a54496da90c0fb12beebce068d8e9。
完整平台規格仍以 PLATFORM_BLUEPRINT.md 為準。本輪不部署，不建立正式排程。

## 已實作的程式能力（不代表正式環境已連線）
- Cloudflare Access：固定 issuer / audience、RS256 / JWKS 簽章、到期、主體綁定；只接受已建立的 staff 帳號。
- 伺服器保存雜湊 session；正式 cookie 為 Secure / HttpOnly / SameSite=Strict。
- 每個正式請求再次驗證 Access 主體，停權或移除綁定立即阻止存取；不信任 email / role / actor 等前端聲明。
- LINE Webhook：原始 bytes 的 HMAC-SHA256 驗簽、destination 核對、channel 決定 operator，先持久化再背景處理。
- webhookEventId 與 provider message ID 去重；channel/provider 區分使用者；事件依 LINE 時間排序。
- 只支援一對一文字。群組與多媒體保留 unsupported metadata，不假裝已取得其內容。
- 未綁定來客先進總管理員待分派匣；綁到既有案件後，只有案件授權人員能閱讀回覆。
- 收回訊息清除 messages / line_events 可見正文；先到的收回事件保留 tombstone，防止晚到或重送恢復內容。
- Outbox：與訊息原子保存、固定接收者與重試 UUID、租約鎖與逾時回收、重試上限與 23 小時安全窗口。
- 每次外送前重查 channel、人員 active、案件授權和 recipient binding。轉交／停權可阻擋尚未外送的訊息。
- LINE 2xx 或帶 accepted-request-id 的 409 才標 accepted；不顯示送達或已讀。
- Timeout、429、5xx 保留 unknown / retry 與退避；其它非成功為 failed。
- 超過窗口／次數保留 needs_review，不重新產生 retry key 或自動另發相同內容。
- UI 整合中心只顯示設定是否具備，不回傳 channel secret / token / 原始 LINE UID。

## 私有設定契約
預設 APP_ENV=production、DEMO_MODE=off、LINE_SEND_ENABLED=off，所有未設定路徑 fail closed。

| 設定 | 用途 |
| --- | --- |
| APP_ORIGIN | 經核准的 HTTPS 工作台 origin，無結尾斜線 |
| ACCESS_ISSUER | https://你的-team.cloudflareaccess.com |
| ACCESS_AUD | 指定 Access application 的 AUD |
| LINE_CHANNELS_JSON | Secret binding；connection ID 對應 channelSecret/channelAccessToken |
| LINE_SEND_ENABLED | 只有 staging/production 且值 on 才可能呼叫 LINE |
| DB | 本專案獨立 D1；不可沿用別的專案資料庫 |

正式設定尚未提供，沒有要求使用者把 token、secret 或 JWT 貼進 PR／公開倉庫。
資料庫 line_connections 的 operator/provider/channel/destination 必須由授權管理員私下配置；
auth_identities 的 issuer/subject/user_id 必須依驗證過的員工身分配置，不開放自助指定角色。
不存在公開自動註冊、任意 email 登入或從 LINE 訊息內容決定業者的機制。

## 部署前需核准的接線步驟（本輪未執行）
1. 建立本專案 staging D1、Access application 與 hostname；套用兩版 migrations，建立真實員工與 issuer/subject 綁定。
2. 設定 APP_ORIGIN、ACCESS_ISSUER、ACCESS_AUD；整個工作台受 Access 保護。
3. Webhook 路徑 /api/line/webhook/<connection-id> 必須能接受 LINE 伺服器請求；僅此精確路徑可排除 Access，仍強制 LINE 簽章。
4. 配置 line_connections 與私有 LINE_CHANNELS_JSON，啟用 channel 接收。destination 為該 bot 的 user ID。
5. 在 LINE Console 設 Webhook URL 並驗證，開啟 redelivery；確認以工作台回覆為準，避免原生 OA 人工回覆造成歸屬缺口。
6. 先驗證接收、待分派、權限和收回，再人工批准 LINE_SEND_ENABLED=on 與 push 方案／用量。
7. 驗證真實 LINE 行為與 Access 身分；針對 outbox failure/unknown 配置告警與排程恢復。
8. 完成保存期限、刪除政策、D1 runtime/備份遷移與正式 rollout，才討論正式部署。

## 可靠性與運作界線
工作聊天室提供「更新訊息」手動刷新；本輪沒有 WebSocket／SSE 即時推播。
Webhook 使用 waitUntil 處理已持久化事件；外送亦由 waitUntil 嘗試 drain。
提供總管理員「處理待收／待送訊息」回復入口，以及 Worker scheduled handler，
但 wrangler 沒有 cron trigger，**尚未啟用自動定期恢復**。waitUntil 中斷不會丟失 D1 工作；
沒有定期 drain 時，需管理員手動恢復，不能宣稱已有正式外送 SLA。
本輪不使用外部 Queue；D1 是持久工作來源。後續可加 Queue 加速，必須保留 DB 冪等與租約保障。
停止啟用不撤回已被 LINE 接受或已在網路中的請求。拒絕、unknown 或超窗狀態不得視為未送達並自動另發。
LINE webhook 不會自動替未知來客建立企業。應先建立／選擇案件，再核對綁定；
本輪一個 LINE channel 使用者綁一個工作對話，跨案件重綁／多企業共用窗口尚待 membership 設計。

## 本機與測試
npm ci、npm test、npm run worker:check、npm run test:e2e。
本機 demo 仍使用虛構資料與模擬發送，不因填入 token 而對外送信。
integration.test.mjs 用測試 RSA/HMAC 金鑰及 mock HTTP 驗證 adapter；
不連接真實 Access、LINE 或正式客戶。
tests/core.test.mjs 的首輪權限與流程測試完整保留。

## 仍未完成
正式帳號/channel 接線與端到端外部驗證、自動恢復排程、媒體接收、群組對話、
企業自己的 OA、訂閱權益、金流、AI、風控規則與告警、建站商城發布、分潤結算。
第二輪僅提供可測試且可接線的能力；不得把程式完成當作正式串接驗收。

## 官方參考
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- https://developers.line.biz/en/docs/messaging-api/retrying-api-request/
