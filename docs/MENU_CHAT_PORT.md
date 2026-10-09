# 聊天室修改選單移植

從 SaaS 的指定功能檔案移植「修改選單 → 選擇已發布選單 → 上傳原圖 → 發布」流程。來源檔案與 SHA-256 記錄於 `config/menu-chat-source.json`；原有 369 個固定匯入檔案不變，也不複製來源憑證、資料庫或工作區。

## 操作

1. 在數位工作區「LINE OA 設定」保存該工作區的 Messaging API Secret、Token；使用 LIFF 時也填入 LINE Login Channel ID。
2. 「聊天室修改選單」驗證 Token 並啟用，將顯示的獨立 Webhook URL 填入該 OA 的 LINE Developers 設定。此接收器只處理修改選單流程，接收器不轉送至另一個回覆者。
3. 新增授權 LINE UID。預設名單為空；一般會員、群組與聊天室不取得權限。
4. 在圖文選單專案發布初始選單。私訊 OA「修改選單」，選擇選單，傳送 JPG／PNG 原圖。
5. 使用 LIFF 上傳頁時：在同一 Provider 下的 LINE Login Channel 建立 LIFF、勾選 profile，Endpoint URL 使用管理介面顯示的網址，保存 LIFF ID。可調整按鈕座標；名稱、功能與 ID 保留。完成、失敗或待核對狀態直接顯示於上傳頁與工作區紀錄，不發終端 push。

## 邊界與復原

- 管理 API 仍由主工作台 HttpOnly 身分、角色、同來源寫入檢查及 CORE_MENU 權益授權。借址承辦身分不等於企業數位管理員。
- 簽章 Webhook 驗證原始位元組、OA destination、目前工作區狀態與權益。LIFF API 驗證 access token 的 Login Channel、profile UID、授權名單、該 UID 的有效 run 和工作區。
- 公開入口只提供上傳 UI／靜態程式和以上受 LINE 身分驗證的 API，使用現有 `/api/line/webhook/*` 專用 Access 路徑。工作台與 CRM 保持原本 Access／應用程式身分保護。
- 憑證留在自己的加密命名空間。更換憑證會停用接收，必須重新啟用。展示環境不連接／發布至 LINE。
- 只開通該工作區圖文選單 publish。其他 LINE 外送、金流、AI、分潤與結算的既有執行限制不變。
- 新增數位資料庫 migration `0060_menu_chat.sql`。不重建資料庫、不重跑已套用的 `0059`、不種入任何管理員或選單。
- 事件去重、帳號 lease、run nonce、發布快照及同步 revision 阻止重複／過期覆寫。曖昧結果保留紀錄並要求人工核對，不自動重發。
- 正式環境每分鐘處理最多四個已啟用且仍有根工作區權限的帳號，讀取 LINE batch 狀態及保存完成收據。HTTP 202 不視為完成。中斷發布只標記待核對；不自動重新發布，也不 push。

## 驗證

移植核心、實際 Worker 的簽章與 LIFF 隔離測試、手機授權與原始圖片位元組上傳驗收皆納入 CI。測試使用虛構圖片、UID、Token；沒有對真實 OA 發布驗收圖片。真人 LINE／LIFF 驗收須在該工作區完成帳號與 LIFF 設定後執行。
