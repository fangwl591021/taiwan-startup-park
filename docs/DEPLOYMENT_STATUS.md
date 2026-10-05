# 正式部署狀態

2026-10-05 11:35 UTC：完整工作台已發布至指定 Worker。

## 已完成
- 首位管理員已由本人通過 Access 驗證並初始化；發布前以正式 D1 核對有效 operator_owner 與 issuer／subject 綁定。
- 本專案 D1：taiwan-startup-park-prod；0001、0002、0003 schema 已套用，本次發布確認無待套用 migration。
- Access 僅保護本專案完整網址，首位登入信箱由 INITIAL_OWNER_EMAIL GitHub Secret 提供，未寫入公開原始碼；無 bypass 政策。
- 完整 Worker 與 3 個靜態資產已成功發布；初始化頁程式已由正式工作台取代。
- APP_ENV=production、DEMO_MODE=off、LINE_SEND_ENABLED=off；未匯入示範客戶資料，未啟用排程。
- 未登入 /api/me 回應 302 至 Access 登入，未開放客戶資料。
- 第一輪與租戶維運功能已保留：LINE OA 風格儀表板、後端權限、成交追蹤、成交轉租戶、工作聊天室及操作人員歷程，另含合約、人工帳務、功能租用、收件與維運工單。
- 原始 PLATFORM_BLUEPRINT.md 完整保留，未串接項目仍有明確狀態。

## 發布識別
- 網址：https://taiwan-startup-park.fangwl591021.workers.dev/
- 發布來源 commit：e6fe3d806d814fd41ba18a530c559475282485fc
- Cloudflare Worker version：2bf6d5ec-066e-4f6e-899b-251cdbb195da
- [完整工作台建置及發布成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37303798554)
- [部署前資源核對及回復 metadata](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37303798554/artifacts/11343291364)
- [桌面／手機驗收截圖與建置成果](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37303798554/artifacts/11342851592)

## 驗證與界線
58 項後端／權限／核心流程／部署測試及 6 項瀏覽器驗收全部通過。workerd 執行環境的 RS256 驗證與實際 Access 公開金鑰取得／匯入皆通過。公開金鑰請求使用 manual redirect 並拒絕 3xx，修正 Workers 不支援 redirect:error 的問題。

截圖在建置 artifact 的 docs/screenshots 目錄，含 desktop-dashboard.png、mobile-dashboard.png、成交／租戶／聊天室與維運頁面；使用本地虛構測試資料，非正式客戶資料。本人已完成初始化，但正式工作台發布後的瀏覽器登入確認仍待本人重新開啟頁面；不將未登入檢查或測試 fixture 視為正式使用者登入驗收。

LINE 真實收送尚未串接且發送關閉；金流未串接，帳務為人工記錄；AI 與風控規則未啟用。官網、商城等未接通的服務不得因申請或人工帳務而標示為已啟用。其餘後續需求以 PLATFORM_BLUEPRINT.md 為準。

## 影響與回復
僅使用 taiwan-startup-park 與本專案專用 D1／Access；未修改其它 Worker 或其它資料庫。回復時核對 artifact 中前一版本的部署記錄及 Worker ID；不自動刪除資料庫或取消 Access 保護。非秘密資源對應保存在 config/production-resources.json，真正憑證只由 GitHub Secrets 提供。
