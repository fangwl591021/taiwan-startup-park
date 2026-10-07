# 業者 LINE OA 串接設定

前一輪只有整合狀態及收件通知聯絡人綁定，沒有管理員配置表單。本次新增業者自己的 LINE OA 設定，不啟用租戶付費數位 OA、商城、金流或 AI；平台費／分潤保持 NULL。

## 入口與操作
總管理員側欄「LINE OA 串接」；整合中心、管理員專區也提供入口。
1. 業者先於 LINE Official Account Manager 啟用 Messaging API，確認正確 Provider。
2. LINE Developers Console 取得 Provider ID、Channel ID、Channel secret、長期 Channel access token。
3. 新增 OA：名稱、上述欄位與授權依據。伺服器只呼叫 verify token 及 get bot info，核對 Channel ID，取得 OA destination；不發訊息。此版本只支援長期／短期 token verify API，其他 token 類型請勿使用。
4. 保存後產生每組 OA 的 Webhook 網址。貼至 LINE Developers → Messaging API → Webhook URL → Verify → Use webhook。
5. 客戶加入 OA 並傳文字，回設定頁重新整理查看「已驗簽接收」，再到整合中心分派案件或租戶維運台綁定收件聯絡人。
Token 查驗與 Webhook 驗收分開；Token 有效不能顯示已成功接收。UI 不包含測試推播或廣播按鈕。
Provider ID 由管理員核對輸入，token verify 僅核驗 Channel ID；不假稱 LINE API 已驗證 Provider 管理權。
更新時密鑰欄位留空沿用、送出後清除輸入；不回顯既有秘密。OA/Channel/Provider 識別固定，改接另一個 OA 需新增；停用保留所有來客與歷程。

## 秘密與權限
0008_line_settings.sql 新增 name/version/verified_at/last_webhook_at 等設定及加密憑證表。
憑證以 AES-256-GCM 保存到專案 D1，隨機 12-byte nonce，AAD 綁定版本／operator／connection。加密主鑰獨立保存為正式 Worker secret LINE_CREDENTIALS_KEY；不寫入 repo、D1 或 frontend。
已有加密紀錄時缺鑰不能自動重建；現有主鑰不旋轉。後續 key rotation 需另外設計並先驗證重加密及備援。
密文解密錯誤不回退舊 LINE_CHANNELS_JSON，驗簽 fail closed。舊私有 JSON 設定仍相容，管理員更新後遷移至加密紀錄。
設定 GET/POST/PATCH/check/status 限同業者 operator_owner；認證與 CSRF 沿用原後端。欄位白名單與 CAS 防止偽造及覆寫。設定歷程僅管理員可讀；audit 不存密鑰／token／Bot userId。
獨立 sandbox 拒絕真實憑證與 Webhook；本機缺加密鑰亦不能保存。截圖/UI 測試使用局部 fake 設定，不要求正式憑證。

## Webhook 邊界
只為 taiwan-startup-park.fangwl591021.workers.dev/api/line/webhook/* 新增精確路徑 Access 應用程式 bypass，讓第三方 LINE 可接收 HTTP POST。
工作台根網域及 /api/me、/api/line/settings、/api/line/inbox 仍受原 Access allow 政策保護；不更改整站政策。
Worker 本身在此端點核對 channel enabled、raw-body HMAC、destination、事件欄位；未設定 Channel、錯簽章或 destination 均拒絕。只有通過驗簽的請求才更新 last_webhook_at；包含 LINE Verify 的空 events。
UI「接收開啟」只表示接收設定可用，未收到已驗簽請求前始終顯示 Webhook 尚待確認。
本輪 LINE_SEND_ENABLED 仍 off，沒有推播或外送佇列建立；郵件通知仍 preparation-only。原始藍圖與後續需求完整保留，教學影片不重錄。

## 驗收
新增後端測試：加密秘密、Channel token 驗證、原簽章 receiver 接收並成為郵件候選、角色／operator 隔離、白名單、版本衝突／歷程、秘密輪換後重驗簽、錯鑰／AAD fail closed、精確 Access 路徑與 root 保護。
桌面／手機 UI：新入口、新增、密碼欄位、Webhook URL、狀態區分、更新空欄沿用、停用、sandbox readonly、sales 隱藏入口、無橫向溢出。
UI 模擬不能作為正式 OA 已串接證明；後端使用 SQLite、模擬官方 read-only 回應與實際 HMAC。發布後另外驗證根工作台 302、Webhook 未設定探針拒絕且不跳登入。需業者自行填入正式 LINE 憑證並在 LINE 後台完成 Verify/Use webhook 才能宣稱已串接。

官方參考：
- https://developers.line.biz/en/reference/messaging-api/#verify-channel-access-token
- https://developers.line.biz/en/reference/messaging-api/#get-bot-info
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/#bypass-a-public-endpoint
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/

## 發布驗收（2026-10-07 14:54，Asia/Taipei）

- 已發布正式與獨立測試區；[完整 CI / 發布](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37583798236) source `e1370867fd46cc66a851927dc65b0017ddea4857`。
- 89 項後端、22 項桌面／手機 UI、TypeScript、建置及 Worker dry run 通過；npm audit 為 0 vulnerabilities。新增 sharp 0.35.5 override 修補新公告的依賴問題，未略過 audit gate。
- [桌面／手機畫面與驗收](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37583798236/artifacts/11465462248)；圖片位於 docs/screenshots/，LINE 設定 UI 使用虛構資料。
- [遠端核對](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37583798236/artifacts/11465952685)：未設定 webhook 探針 HTTP 404 且無登入跳轉；/api/me、/api/line/settings、/api/line/inbox 皆 Access 302。
- 初次新路徑發布的邊界檢查未通過；後續未放寬根政策即通過。部署驗證現加入上限 10 次、間隔 10 秒的傳播等待及 HTTP 狀態診斷，不降低通過標準。
- 主鑰已存在，重複部署 `key_created:false`，沒有旋轉；兩區資料庫分離、LINE 外送 off、分潤 NULL、結算 disabled。教學沿用，錄影 skipped。
- 尚未輸入真實 LINE 憑證、未替管理員登入正式瀏覽器、未發送客戶訊息。後台入口已就緒，實際 OA 仍需業者設定及 LINE Verify。
