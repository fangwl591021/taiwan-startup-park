# 平台 LINE 帳號設定

本輪依使用者指定 Smart-Menu-Studio 的 LINE 帳號設定模式，將平台 LINE Login 與 Messaging API 合併在同一頁。
參考版本：`fangwl591021/Smart-Menu-Studio@f69fd70a2ff91056bbac158a41e046ee35f10077`，`frontend/src/App.jsx` 的 Workspace LINE 表單與 `backend/src/index.ts` 的系統 line-account API。

## 介面

入口：系統總後台 → LINE 帳號設定。
網址：`/?workspace=platform&section=line-account`；舊的 `section=line-login` 仍指向同一頁。

桌面兩欄、手機單欄；文字採深色。名稱與 @帳號、Login Channel ID、Messaging API Channel ID、Login Secret、Messaging Access Token、Messaging Secret 一次保存。每組憑證各自顯示已設定／尚未設定，不回顯；留白沿用原值。Callback 與預留 Webhook 網址唯讀，可複製。Provider ID 收在選填區；通知草稿與額度保留獨立頁面。

## 保存與隔離

- `/api/platform/line-account` 僅系統總管理員或明確授權的平台建立者可讀寫。一般業者與客戶無權存取。
- Login 密鑰沿用既有 `platform_line_login`，不重新解讀、不遺失。Messaging 憑證以另一個 AES-GCM AAD 命名空間保存；與各業者的 OA 連線、客戶和聊天分開。
- `0011_platform_line_account.sql` 保留平台原有 OA 名稱和 Messaging 規劃編號，不從 Login 複製。既有通知草稿、額度及所有後續藍圖保留。
- 同一交易檢查三個版本，舊頁面不能覆寫新設定；保存一次產生一筆含人員與時間的操作歷程。歷程只記更新欄位名稱和依據，不記密鑰值。
- 空白保留同一頻道的憑證；變更 Channel ID 清除該頻道舊憑證，另一組不受影響。部分替換 Messaging 密鑰／Token 保留同頻道另一項。
- 正式環境金鑰未就緒或測試環境禁止保存真實憑證。送出後清除瀏覽器密鑰欄，即使保存失敗。

## 真實啟用狀態

本輪完成設定保存，尚未實作平台 OAuth 登入與平台 OA 訊息接收。Callback 回應 503；預留平台 Webhook 回應 404，絕不假裝接受並遺失事件。頁面明示兩者未啟用，保存憑證不代表驗證或連線成功。

各業者既有 Messaging API 接收流程維持原狀。`LINE_SEND_ENABLED=off`；不發送客戶訊息。金流、AI、數位租用與分潤仍未啟用。`docs/PLATFORM_BLUEPRINT.md` 完整保留。

## 驗收

後端測試涵蓋兩組加密及 AAD 隔離、不回顯、不進歷程、空白保留、部分更新、换頻道清除、舊版衝突原子性、舊 Login 資料保留、權限與 CSRF、禁止啟用欄位、測試環境真實憑證限制。
瀏覽器測試涵蓋桌面／手機欄位與排版、三個 password 欄、密鑰失敗清除、同頁保存與重載、網址複製、未啟用標示與水平溢位。
