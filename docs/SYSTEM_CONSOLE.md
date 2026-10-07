# 系統總後台與業者工作台

系統總管理員是平台商，業者管理員只管理自己的借址業者。原本 role 名稱「總管理員」改為「業者管理員」；platform_admin 顯示「系統總管理員」。原始 PLATFORM_BLUEPRINT.md 不改寫。

## 本輪可操作範圍

- 系統總覽：各業者及 OA 接收設定的數量。
- 業者總覽：名稱、操作人員及 OA 數量，搜尋、每頁 50 筆。業者新增、開通、停用及 SaaS 方案核准仍待後續實作，不以本頁假裝已具備。
- 業者 OA 串接總覽：各業者 OA 名稱、接收開關、Token 查驗時間、最後已驗簽接收時間及加密紀錄存在狀態。加密紀錄存在不代表憑證目前有效；曾接收不代表目前持續健康。無聊天室、客戶身分、訊息或密鑰。
- 平台自有 OA／通知規劃：可保存名稱、規劃 Provider／Channel ID、目的、加入及服務通知草稿、每月規劃上限。只保存草稿，不查驗 LINE、不輸入密鑰、不產生 Webhook、不發送。規劃上限不是官方 LINE 額度；額度 API、外送用量、失敗紀錄及開通開關留待實際串接。
- 平台費與分潤：以業者與四種數位服務顯示既有預留值，保持 NULL／待議定，不收費、不結算。
- 系統設定歷程：保存規劃時記錄實際人員、時間及更新依據，獨立於業者服務歷程。

## 登入及權限

同一正式網址。已授權的平台建立者可從業者側欄「系統總後台 →」切換；系統側欄可返回業者工作台。亦可用 `/?workspace=platform`，但網址與前端旗標不能取得後端權限。

0009_platform_console.sql 新增平台授權、規劃及歷程表。既有的固定初始化帳號 tsp-primary-owner／tsp-primary-operator 必須有效、仍為 operator_owner 且已綁定 Access，才取得部署授權。此授權為本次平台建立者要求修正系統端的指定初始化，不擴及所有 operator_owner；角色保持原樣，系統權限另存 platform_admin_grants。

每次 platform API 查驗系統角色或有效獨立授權；停權／撤銷立即阻擋，不依賴瀏覽器儲存。沒有公開 API 可自行新增系統權限或把員工提升至系統角色。純 platform_admin 不能使用各業者 CRM、聊天室或 OA 憑證設定 API。雙身分建立者在業者 API 仍只限自己的 operator。

系統草稿採版本比對與原 CSRF，白名單拒絕密鑰、推播開關、角色及分潤寫入。變更與獨立歷程為同一交易；衝突不產生假歷程。

獨立測試區可選「系統總管理員（虛構）」；沿用指定管理員的 Access 訪客驗證及獨立 D1。正式不接受測試角色登入。初次 seed 排除 migration 已建的 platform_settings singleton，避免重複建立。既有測試資料不重設。

## 驗收

93 項後端驗收包含原成交、租戶、合約、收件綁定、權限及 OA 接收流程；新增四項涵蓋系統角色／明確授權、撤銷、秘密與內容隔離、草稿 CAS／歷程／CSRF／禁用外送、50 筆分頁及固定建立者遷移。

新增桌面／手機系統後台與平台 OA 草稿驗收，及雙工作台切換。純系統角色 UI 使用真實本機 SQLite 虛構資料；雙身分切換的 UI 使用局部權限模擬，後端另驗證真正的 grant 檢查。

發布後核對指定正式帳號 grant、測試角色、獨立 D1、平台設定、分潤 NULL、LINE_SEND_ENABLED=off。系統 API 維持 Access 保護；不擴張 webhook bypass。教學沿用，不重錄。

## 發布證據（2026-10-07 15:20，Asia/Taipei）

- [93 後端、25 桌面／手機及完整發布通過](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37586454743)，source d2e05cc244a537f8400d11eeb33ce61d2aca901f；npm audit 0 vulnerabilities，教學錄影 skipped。
- [桌面／手機畫面與建置](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37586454743/artifacts/11466727105)，圖片 docs/screenshots/*-system-dashboard.png、*-system-oa-planning.png。
- [遠端核對](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37586454743/artifacts/11467280650)：兩區 system_admin_ready:true、平台 OA planning、分潤 NULL、LINE 外送 off；系統 overview/settings API 未登入皆 Access 302。
- 第一輪雙後台 UI 測試把未登入錯誤誤標為已授權，導致登入表单不存在；已修正 mock 保留未登入回應，沒有刪除或降低切換驗收。首輪發布被建置 gate 擋下，未部署失敗版本。
- 尚未代替本人登入正式瀏覽器，平台 OA 實際串接、用量查詢及發送均未實作／未啟用。
