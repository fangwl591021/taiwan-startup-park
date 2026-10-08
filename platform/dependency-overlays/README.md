# 來源依賴修正

原始 Smart-Menu-Studio snapshot 保持不變，這裡提供經驗證的 package／lock overlay，在隔離建置副本套用。

來源版本：f69fd70a2ff91056bbac158a41e046ee35f10077
驗證：CI 37679159576，1222 後端與 592 前端測試、module typecheck、完整 Worker dry-run 及前端 build 通過；兩端 npm audit 均為 0。

處理方式：
- 使用相容範圍的 npm audit fix，未執行 force 或變更原直接依賴版本範圍。
- 明確 override sharp 0.35.5，修正 GHSA-wq5f-xc86-pv6w：https://github.com/advisories/GHSA-wq5f-xc86-pv6w。
- package 與 lock 已固定並由 config/platform-dependency-overlay.json 校驗 SHA。正式 CI 只執行 npm ci，不每次動態 audit fix。
- 不包含部署憑證、資源設定或業者資料；是否正式開通仍由後續整合決定。

來源套件功能及圖片處理整合仍需實際平台驗收；依賴零 findings 不代表全部功能與權限已完成。
