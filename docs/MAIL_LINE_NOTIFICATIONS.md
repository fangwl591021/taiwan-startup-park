# 借址郵件代收與 LINE 通知準備

## 服務歸屬
借址合約的「郵件代收」欄位記錄 included／excluded／by_agreement／NULL（待確認），與實際信件包裹登記、通知聯絡人綁定分開。
本次增加業者自有 LINE OA 的租戶主要收件通知聯絡人；不是租戶付費租用自己的 LINE OA、官網、商城或 CRM。原有第一期借址範圍及數位合作費／分潤 NULL 待議定保持不變。

## 管理員操作
1. 客戶加入業者 OA 並傳訊息；業者先完成自己的 LINE 接收串接。
2. 租戶維運台 → 信件包裹 → 綁定通知聯絡人，從同業者已驗簽接收的來客選擇帳號。
3. 管理員核對實際客戶、填通知聯絡人姓名及確認依據。這是行政核對，不是 LINE Login 身分認證或客戶本人完成的帳號連結。
4. 登記信件、公文或包裹後，按「預覽 LINE 收件通知」核對企業、摘要及台北時間。
5. 更換／解除綁定需留下原因，保留實際操作者及版本歷程。

LINE 搜尋用 ID 和 Messaging API 的 provider 範圍 userId 不同；不接受手動填入 userId。來客需符合 U + 32 個小寫十六進位字元，並存在該 operator／channel／user 的已驗簽 follow 或 message 事件。不把聊天文字中的 ID 當作身分依據。介面只回傳遮罩識別碼及不超過 120 字的最近訊息，候選最多 50 位，管理員可搜尋。同一位來客可代表多家企業，每家租戶先設定一位主要通知聯絡人；後续可擴充多人／角色授權。

## 本次未啟用實際推播
所有通知狀態固定為 not_enabled／preparation_only，預覽 sent:false。
沒有呼叫 LINE HTTP、沒有建立外送佇列、沒有假造「已通知」「送達」「已讀」，不改變收件狀態。即使一般聊天室 LINE_SEND_ENABLED=on，郵件預覽仍不发送。
預覽亦保留已交付／退回件的歷史內容並明確提示。後续正式推播需另外實作：通道憑證與啟用確認、收件通知專用佇列、冪等及重試、recipient/channel/tenant 再核對、封鎖／退訂處理、營運配額及人工回報。LINE API 接受訊息不等於對方收到或已讀。

## 權限與資料
新增 0007_mail_line_recipients.sql。無自動回填或通知。
operator 與 business/contact/actor 使用組合外鍵；每家 tenant 唯一設定，解除不刪除歷程。
原 tenant 存取範圍先執行；只有 operator_owner 可選擇候選、綁定、更換／解除。具權限的業務／維運可看遮罩聯絡人與預覽；未指派人員及跨業者無法存取。財務／平台管理／企業管理不可讀取此通知端點。
寫入需有效 JSON、白名單欄位、非空姓名／依據及精確版本；失敗或 stale 不新增假操作紀錄。不向前端、audit detail 暴露完整 LINE userId、channel secret 或 token。
既有 LINE 接收／聊天室傳送及 AI 模組不作啟用變更。保留完整 PLATFORM_BLUEPRINT.md 後续規劃。

## 驗收
新增 5 項使用真實 SQLite 與 HMAC webhook 的後端測試，涵蓋已觀察來源、operator/assignment/role 隔離、版本與 audit、跨租戶收件隔離、零 HTTP／零 outbox 及同聯絡人多企業。
新增桌面／手機各 1 項 UI 測試：綁定、更換前提、解除、預覽轉義、無發送按鈕與無橫向溢出。
UI 候選與綁定資料使用局部 route mock，避免在未串接示範環境假造真實 LINE 通道；後端測試使用已驗簽 webhook 與實際資料庫。UI 截圖是驗收示範，不是已接通正式 LINE 的證明。教學影片維持現有版本，不重新製作。

官方參考：
- https://developers.line.biz/en/docs/messaging-api/getting-user-ids/
- https://developers.line.biz/en/docs/messaging-api/sending-messages/
