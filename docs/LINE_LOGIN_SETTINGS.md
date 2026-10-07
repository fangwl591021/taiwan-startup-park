# LINE Login 與 Messaging API 分開

> 2026-10-07 更新：設定介面已合併為「LINE 帳號設定」，與 Messaging API 同頁填寫；兩種憑證仍分開保存。詳見 [LINE_ACCOUNT_SETTINGS.md](LINE_ACCOUNT_SETTINGS.md)。本文保留先前實作與登入後續需求。

前一輪系統後台只有平台 OA／Messaging API 規劃，使用者指出要填的是 Login API。新增「LINE Login 登入設定」獨立頁面與資料表，不把已保存的 OA Provider／Channel 當成 Login Channel。

## 欄位

LINE Login Channel ID（client_id）、Channel secret（client_secret）、選填 Provider ID、預定 Callback URL（redirect_uri）、openid profile 權限及更新依據。Channel 應在 LINE Developers Console 建立 LINE Login、App type 為 Web app。Provider ID 僅供管理核對，不是 OAuth token request 的必要欄位。Email 權限不預設申請。

Callback URL 由伺服器服務網址產生，不接受使用者自訂第三方 redirect。正式預定值為 https://taiwan-startup-park.fangwl591021.workers.dev/api/auth/line/callback。這是預留路徑，登入流程尚未啟用；目前僅回應 503，不交換 code、不建立登入 session、不改動 Access 或人員權限。實際對外回呼仍受既有 Access；啟用時須另行設計明確回呼邊界，不能當成可用 OAuth 回呼。

本輪只有正確欄位、設定保存與秘密保護，沒有 OAuth 上線，也不能由 ID／密鑰格式確認 Channel 類型或有效性。LINE Login 不是 Messaging API 的 channel access token，也不使用訊息 Webhook。

## 保存與權限

0010_platform_line_login.sql 新增獨立 singleton 表，初始空白；不複製 OA 值。Login secret 以既有 Worker 加密主鑰 AES-GCM 保存，AAD 使用獨立 platform Login namespace 與 Login Channel ID。API 不回顯 secret 或密文；歷程只記錄操作者、更新依據及是否換密鑰／Channel。

僅系統總管理員／明確授權平台建立者可存取，沿用 session、Access 與 CSRF。更新採版本比對；相同 Channel 下密鑰留空沿用，更換或清空 Channel ID 清除舊密鑰，避免配錯。不接受 OA token、webhook、登入啟用開關、權限或 callback URL 欄位。前端送出成功／失敗都清空密鑰輸入。

測試區只保存虛構 Channel 規劃，拒絕真實密鑰。任何 OA 或 Login 密文存在時，部署都不自動重建主鑰。現有企業登入、OA 接收、推播 off、金流／AI 未啟用及分潤 NULL 保留。

後續 OAuth 必須另做 state、nonce、PKCE、伺服器 code 交換與 ID token 驗證、預先授權帳號連結、重放防護及 session 更新。不能用未驗證的 LINE user ID 或 email 直接升級管理員。

## 驗收

後端驗證 Login 與 OA 資料分離、加密／AAD／不回顯、版本及歷程、同 Channel 沿用／換 Channel 清密鑰、角色／CSRF／欄位白名單、sandbox 與缺鑰拒絕、預留 callback 不產生 session 或權限、零外送。

桌面／手機驗證 Login 欄位、唯讀 callback／scope、沒有 OA token／Webhook 欄位，錯誤後密鑰清空，草稿保存，明確未啟用、無假登入按鈕及不溢出。UI 只使用虛構資料，secret 輸入可用旗標是局部模擬；後端另驗證真正的加密。

官方參考：
- https://developers.line.biz/en/docs/line-login/integrate-line-login/
- https://developers.line.biz/en/reference/line-login/
- https://developers.line.biz/en/docs/line-login/security-checklist/

## 發布驗收（2026-10-07 15:48，Asia/Taipei）

- [95 後端、27 桌面／手機及發布全通過](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37589370643)，source f9e532524e8266eddbf8883cf3aab44ca6fb4747；npm audit 0 vulnerabilities。
- [建置與桌面／手機畫面](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37589370643/artifacts/11468260803)，docs/screenshots/*-line-login-settings.png。
- [遠端核對](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37589370643/artifacts/11468206103)：獨立 Login 設定結構存在，設定 API 未登入 Access 302，主鑰 key_created:false、根政策保留、兩區 DB 分離、LINE 外送 off、分潤 NULL。
- 尚未輸入正式 Login Channel 或密鑰、未代替本人登入正式瀏覽器、OAuth 登入流程及回呼未啟用。教學沿用、不重錄。
