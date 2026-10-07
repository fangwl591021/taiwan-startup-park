# 平台 LINE Webhook 接收修正

原因：`0011` 產生平台專用 Webhook 網址，原先 Worker 只有各業者 `line_connections` 接收端。平台網址因沒有對應業者 channel 而回應 404，LINE Verify 無法通過。

## 實際接收

- 保留平台既有 Webhook URL 與已存憑證，`platform-*` 網址由平台專用接收端處理。
- 僅使用「LINE 訊息頻道密鑰（Messaging API Channel Secret）」驗證原始 HTTP body 的 HMAC-SHA256。Login Secret、Access Token、網址本身都不代替簽章。
- `events:[]` 的有效簽章 Verify 回應 HTTP 200。第一次有效簽章將 LINE bot destination 綁定至平台帳號；後續拒絕其他 destination。這是驗簽接收確認，不表示已驗證手填 Channel ID／Token，或已完成 Login 登入。
- 有效事件在 D1 交易持久保存後才回應 200；重送以 Channel + webhookEventId 去重。訊息收回會清除文字，保留 tombstone 防止延遲訊息復原。無效簽章 401、未知 URL 404、缺少 Messaging Channel ID／Secret 503、保存失敗 500，均不假裝接受事件。
- 交易檢查配置版本、密文與 destination；讀取憑證後遇到設定變更，拒絕接收並要求重試。
- `0012_platform_line_webhook.sql` 只增加平台 destination／最後驗簽時間、平台 events 與收回表；不把平台事件寫入業者來客、聊天室、租戶或任何外送佇列。

## 介面與權限

系統總後台 → LINE 帳號設定顯示「待設定／待 LINE 驗證／已驗簽接收」與最後驗簽時間。
系統總後台 → 平台 OA 來訊顯示目前配置平台 Channel 最近 50 筆已保存事件，不回傳完整 LINE user ID。所有外部文字經 HTML escape 顯示。

`/api/platform/line-events` 仍需既有企業登入與明確平台管理權限。一般業者、業務、服務、財務與客戶不能查看。各業者既有 OA 接收與工作聊天室流程維持原狀。測試站禁止真實 LINE Webhook。

## 啟用與驗收

1. 保存平台 Messaging API Channel ID 及 Messaging API Channel Secret；與 Login 的兩項資料分開。
2. 在相同 Messaging API Channel 貼上原有平台 Webhook URL，按 Verify。
3. Verify 成功後開啟 Use webhook，傳一則文字至平台 OA。
4. 回到平台後台重新整理，確認已驗簽時間與平台 OA 來訊。

LINE 官方規則：
https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/
https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/

測試涵蓋空事件 200、錯誤／Login 密鑰／body 變動拒絕、首次 destination 綁定、另一 bot 拒絕、密鑰讀取失敗、重送去重、訊息收回與延遲、權限隔離、配置競爭、保存失敗不確認、XSS 文字及桌面／手機畫面。

`LINE_SEND_ENABLED=off`，不回覆、推播或呼叫外送 API。平台 LINE Login、金流與 AI 仍未啟用；原始 PLATFORM_BLUEPRINT 與數位租用／分潤待議定需求完整保留。本輪不錄製教學影片。

## 發布證據

2026-10-07 17:57:34（Asia/Taipei）正式與獨立測試站已驗證更新。Source `c7a106936a8e5cd9d6be86c819bd82198ba70f8b`；正式 active `c740117a-3bfe-489b-a1a2-787d7cf00c50`，測試 active `ef56babe-f84f-40c3-aae1-b7a1d5aa26f3`。0012 遷移在兩個專用 D1 成功套用，Access 與資料隔離維持，推播關閉／分潤 NULL。

100 項後端、27 項桌面／手機、建置及 Worker dry-run 通過；[發布流程](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37603887754)，[截圖及驗收報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37603887754/artifacts/11473827821)，[草稿 PR #16](https://github.com/fangwl591021/taiwan-startup-park/pull/16)。截圖使用虛構 UI 測試資料；正式後台是否完成 LINE Verify，以真實最後驗簽時間為準。

17:58:19 對使用者提供的原平台網址發送不含有效簽章的公開測試：由原來 404 改為預期的 401，確認已到達驗簽接收端且已可解密 Messaging Secret。有效簽章的空事件 200 在隔離測試中驗證；尚未代替使用者在 LINE Console 按 Verify。未發送任何客戶訊息，未變更網址或已保存密鑰。
