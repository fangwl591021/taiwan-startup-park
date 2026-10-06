# 測試帳號模擬與錄影教學

正式工作台： https://taiwan-startup-park.fangwl591021.workers.dev/
獨立測試區： https://taiwan-startup-park-demo.fangwl591021.workers.dev/
教學：正式／測試區側欄的「操作教學影片」，或 /tutorial.html。

正式與測試區已於 2026-10-06 依 [PHASE_ONE_SCOPE.md](PHASE_ONE_SCOPE.md) 發布借址第一期，教學影片同步更新；發布版本與驗收證據見 [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md)。新版本不提供數位需求、訂閱或數位收費，預留分潤欄位全部為空白待議定；既有虛構數位紀錄保留唯讀。

## 使用方式

1. 使用原本指定管理員的 Access 登入驗證進入測試區。
2. 選擇管理員、業務 S1／S2／S3、維運、財務、B 業者管理員或業務。
3. 按「進入示範工作台」。側欄、資料範圍、寫入權限由既有後端權限系統決定。
4. 使用頂端「切換測試帳號」登出目前模擬角色，再選其他帳號。
5. 測試資料持續保存，無自動重設；請勿填入真實企業或客戶資料。新增操作人員仍預設待綁定。

## 安全隔離

- Worker / D1 分別命名 taiwan-startup-park-demo；不使用、複製或匯入正式 D1。
- Access 使用獨立 application/AUD，限定指定管理員信箱；每次 API 都驗證 RS256 JWT、issuer、aud、exp、subject 與私有 gate secret 中的管理員信箱。
- 模擬 session 綁定實際訪客的 Access issuer/subject，同時選擇虛構 staff actor。未驗證訪客、另一個 Access subject、本機 session、正式 session 不互通。
- 正式環境仍 DEMO_MODE=off；任何 production 環境都拒絕 demo sessions 和 demo login。
- hosted sandbox 有固定域名、非正式 DB ID、APP_ENV、DEMO_MODE、LINE 外送及憑證限制；部署核對遠端 Worker 真實 DB binding。
- 不接收真實 LINE webhook，不配置 LINE credentials、AI、金流或排程。聊天室為純模擬；借址收退款只有人工記帳；本期不操作數位訂閱或數位款項。
- 模擬回覆／稽核顯示被選擇的虛構人員，與真實操作人員的正式歷程分開。管理員 Access 身分僅用於保護測試入口，不用來繞過所選角色權限。

## 教學影片

scripts/record-tutorial.mjs 啟動獨立記憶體測試服務，用 Playwright 錄製實際 UI 互動；FFmpeg 轉成 H.264 MP4。中文字幕直接顯示在錄影畫面，另附 WebVTT。無旁白。
涵蓋測試選擇、建案、導入、收費、成交轉租戶、地址續約與人工帳務、待議定分潤欄位、聊天室失敗／重試及歷程、角色／業者隔離、據點方案與待綁定人員。
CI 將 MP4、字幕、封面與媒體驗證報告存成 tutorial-video artifact，並隨 Worker 靜態資產提供可播放及下載的教學頁面。
影片約數分鐘，大小限制 24 MiB，播放前驗證 duration、H.264 codec、720p+ 與可解碼畫面。

## 保留後續規格

docs/PLATFORM_BLUEPRINT.md 不變。本輪未實作租戶自助登入、正式人員綁定邀請、AI 建站、商城、金流扣款、訂閱自動開通、真實 LINE OA 接收／外送配置或 AI 風險判讀。
