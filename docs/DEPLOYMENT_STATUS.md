# 正式資源準備狀態

2026-10-05（Asia/Taipei）。

## 已執行
- GitHub Secrets 中的 Cloudflare token／account ID 已透過目標 API 驗證；未讀出或記錄憑證值。
- 確認 workers.dev 子網域屬於指定帳號，既有 taiwan-startup-park Worker 原先沒有資料庫繫結。
- 建立專用 D1：taiwan-startup-park-prod。
- 對該新資料庫套用 0001、0002、0003；migrations list 顯示無待套用項目。
- 建立只保護 taiwan-startup-park.fangwl591021.workers.dev 的 Access 應用程式；目前沒有 allow policy，等待指定第一位管理員。
- 未注入 demo fixture、未指定任何人的角色、未部署應用程式 Worker。
- 非秘密的 D1 UUID、Access issuer/AUD/app ID 保存在 config/production-resources.json，部署時會自動載入。真正 token／account ID 仍只由 GitHub Secrets 提供。

## 證據
- [唯讀盤點](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37297717229)
- [資源建立與正式 D1 migrations](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37297942929)

## 尚待完成
確認第一位總管理員的登入 Email、建立限定該身分的登入政策，經本人登入取得驗證後的 Access subject，綁定正式管理員，最後部署應用程式並驗證。

不能把 Cloudflare 帳號顯示名稱、GitHub 帳號或任意未驗證 email 直接當作 Access subject。Access 應用程式與資料庫建立成功，不等於使用者已可登入或平台已部署完成。

## 影響與回復
目前只新增本專案 D1 及 Access 應用程式並套用 schema；未修改其它 Worker 或其它資料庫。原目標網址開始由 Access 保護，因尚無 allow policy 而不開放登入。若撤銷此次初始化，應先核對資源 ID 後只移除此專案的 Access 應用程式；資料庫不要自動刪除。

## 首位管理員身分設定

管理員登入信箱由 `INITIAL_OWNER_EMAIL` GitHub Secret 提供，不寫入公開原始碼。首次部署僅提供初始化頁，24 小時有效，僅接受經 Access RS256 簽章、issuer、AUD、subject、期限驗證且信箱與預先設定相符的身分。空資料庫的 operator、operator_owner、Access 綁定與歷程在同一交易建立；既有資料拒絕覆寫，不接受客戶端指定角色或業者。初始化頁不包含客戶 API。

本人完成初始化後重新執行 release workflow，原本的正式部署門檻仍會驗證有效管理員，才發布完整工作台。LINE 發送、金流、AI 仍未啟用。正式部署與登入驗收需以 Actions 成功紀錄及本人登入結果確認。
