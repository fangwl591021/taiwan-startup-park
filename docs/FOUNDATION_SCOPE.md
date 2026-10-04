# Foundation 實作範圍

基準：docs/platform-blueprint / a2fb24c4079be9475b7b530838cae551c7b5e459。
完整規格 docs/PLATFORM_BLUEPRINT.md 原封保留；本文件不覆蓋其後續需求。

## 本輪閉環
企業與聯絡人 → 案件與工作對話 → 接觸／導入／收費 → 成交 → 同一企業成為租戶 → 數位功能需求。
付款紀錄、案件階段及功能申請互相獨立。金額為整數新台幣示範應收，尚非完整帳務模型。

角色與業者邊界由伺服器 session 確立。sales 依目前案件指派讀取；
service 依租戶服務承辦權限讀取；finance 可看企業案件和人工核對收款，不讀聊天室。
platform_admin 與 business_admin 保留角色但預設無本輪工作台權限。
管理員專區 API 獨立驗證 operator_owner；一般 CRM API 不回傳風險資料。

本地訊息識別碼去重；相同識別碼換文字或操作者回傳衝突。
重試原訊息不新增另一筆。實際發送狀態只能是 received_demo、failed、simulated。
案件更新及成交使用 version compare-and-swap；D1 batch 保持案件/租戶/事件原子性。
目前未做分散式外送重試，未提供 LINE Webhook；第二輪必須加入 outbox 及 provider 事件去重。

## 首輪資料模型取捨
以 opportunities.owner_id 保存當前指派，activity_events 保存歷次轉交；
以 conversations.first_agent_id 保存首次完成本地回覆者，messages.actor_id 保存逐則人員。
企業先單一聯絡人建立，但 contacts 表及讀取支援多筆。
尚無跨企業共用聯絡人介面。memberships、business_contacts、獨立 leads/assignments 留待迭代，
不可把 LINE UID 當跨 provider/channel 的唯一個人身分。
服務承辦由管理員指派。地址合約、訂閱權益、商城商品款都尚未建立，不用本輪欄位冒充。

## 後續整合與原規格對照
- 正式登入、IdP、Secure session、CSRF、登入限流、受信任網域及復原流程。
- LINE channel/provider 身分、raw body 簽章驗證、webhookEventId 去重、Queue、outbox、重試與狀態未知處理、收回事件與保存政策。
- 授權平台支援存取及企業管理員 memberships，不增加全域聊天讀取權。
- 報價版本、應收期限、payments、借址合約、信件包裹、維運工單。
- plans/subscriptions/entitlements：方案、額度、期限、續租、暫停恢復；地址退租不直接刪除數位資料。
- 依授權私有設定實作 risk_events/reviews，區分規則與 AI 推論，人工核查與管理員通知。不得自動處分，私有規則不提交公開倉庫。
- 名片、DM、社群網址建站：R2 私有素材、OCR、來源追溯、內容確認、版本、自訂網域及發布。
- 各企業獨立商城：第一版每單單一企業、付款回呼驗證與冪等；地址款、數位租用款、商品款分開對帳。
- referrals/settlements：經銷或推薦歸屬、退款淨額結算；比例、價格、額度均未定案。
- AI 不信任訊息/OCR/文件中的系統指令，不自行發訊或改金流，模型故障須呈現狀態。
- 上線前完成資源盤點、D1 真實 runtime 整合驗證、備份遷移、內容保存刪除、可觀測性與稽核保存政策。

## 驗證證據
CI workflow：Foundation acceptance。
成功後的 desktop/mobile 截圖在 docs/screenshots，Playwright HTML 報告在 workflow artifact。
以 workflow 實際結果為準；產生程式或本文件不代表測試已通過。
