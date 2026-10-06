# 目前版本：合約服務起迄與付款約定

2026-10-06 10:46（Asia/Taipei）正式與獨立測試區已更新。

- 租戶清單依實際合約顯示起迄與服務狀態，未建合約不再一律顯示服務中。詳情先呈現據點、地址、日期、合約類型、付款週期、郵件內容與到期／續約提示，聯絡及承辦紀錄置後；保留條列、深色大字及收合。
- 合約類型與付款週期獨立，支持年約按月付款等約定。舊條件為 NULL／待補；管理員可依版本及變更依據補登，保留實際操作者。續約可沿用，終止紀錄只讀。
- 0006_contract_service_terms.sql 在正式與測試專用 D1 成功套用；只新增 nullable 欄位與索引，未刪除、重設或導入正式資料。
- 一次性代辦與借址年約明確區分；獨立代辦／押金台帳尚未提供。付款週期本輪是約定紀錄，現有應收仍是本期總額台帳，可分次人工記錄實收，不自動拆月帳單、扣款或續約。
- 數位服務逐項呈現期間與收費規劃。第一期不開放數位收費或開通，分潤與平台費全 NULL／待議定。原始藍圖及後續需求保留；[研究與驗收界線](TENANT_SERVICE_CLARITY.md)。
- [建置、79 後端及 18 桌面／手機驗收、發布全部成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37405598113)。
- [桌面／手機截圖及完整報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37405598113/artifacts/11387071367)：desktop/mobile-tenant-service-summary.png、desktop/mobile-tenant-contract-terms.png。
- Source：fcb9d7b02b830cf0e796bf8730320c9595df9d6b。
- 正式 Worker active：111b9d82-fe7e-44be-8c9b-9feaf3b0cc2d；測試 Worker active：fb82f36a-d691-427e-a56e-624183edc2c8。
- 2026-10-06T02:46:42.673Z 發布後已確認實際 DB 綁定與環境隔離、LINE 外送 off、分潤全 NULL、兩區未登入 API Access 302；[部署證據](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37405598113/artifacts/11387616244)。未代替使用者登入正式瀏覽器；畫面驗收使用本機虛構資料。
- 教學影片沿用原版，錄影步驟 skipped。

---

## 先前發布紀錄

# 目前版本：按需載入、快取與列表分頁

2026-10-06 08:55（Asia/Taipei）正式與獨立測試區已更新。

- 切頁保留側欄與外框；資料按頁載入，15 秒內合併與重用 GET，寫入及身分切換清除。租戶、案件、對話清單每頁 50 筆，完整總數及搜尋由後端提供。
- 0005_workspace_paging_indexes.sql 已成功套用於兩個專用 D1；只新增索引，不清除資料。租戶維運與據點讀取批次化，移除逐訂閱額外資格請求；原有角色／業者權限保留。
- [建置、75 後端及 16 桌面／手機驗收、發布全部成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37396358578)
- 1,001 家虛構租戶的分頁完整性與索引驗收通過；模擬 GET 延遲下，TTL 內的重訪與維運分頁額外讀取為 0。這些是本機／自動化證據，不是正式使用者延遲保證；[詳細測試與界線](PERFORMANCE_ACCEPTANCE.md)。
- [截圖與報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37396358578/artifacts/11383383146)
- Source：d6f4074854e09067a2ad2134d0e4173077f06d47
- 正式 Worker：e87a75f6-8ca6-4605-ac9a-cca84eb24b80
- 測試 Worker active：74c21861-ca48-4e01-8ddd-ebd6a63cee90
- [發布後核對](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37396358578/artifacts/11382854641)：2026-10-06T00:55:37.475Z 確認 DB 分離、分潤值全 NULL、LINE 外送 off、兩區未登入 API Access 302。未代替本人完成正式已登入瀏覽器效能量測。
- 教學影片沿用原版，錄影步驟 skipped；借址第一期、原始藍圖及未串接狀態完整保留。

---

## 先前發布紀錄

# 目前版本：緊湊租戶條列與深色文字

2026-10-06 08:36（Asia/Taipei）已更新正式與獨立測試區。

- 租戶企業由大型卡片改為條列：企業、服務狀態、服務承辦、功能申請數及查看入口；整列可點選。桌面列高約 78px，手機分行呈現，保留大字、搜尋、側欄及區塊收合。
- 全站原本偏淡的輔助文字調深；表單 placeholder、停用欄位、歷程與狀態標籤同樣調深，維持綠色按鈕與白字。
- [建置、72 項後端及 14 項桌面／手機驗收、發布全部成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37394706074)
- [桌面／手機截圖及驗收報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37394706074/artifacts/11383210927)：新增 desktop-tenant-compact-dark.png、mobile-tenant-compact-dark.png；驗收列高、輔助文字對比至少 7:1（對白色背景）、搜尋的空結果與正確篩選、點選租戶及維運入口、無橫向溢出。
- Source commit：c3461e8361576e09fc2b1d432a45ac43de93472d
- 正式 Worker version：63a9e8a2-b259-49b0-9fb9-22ecf45dc0ba
- 測試 Worker active version：b48b7513-a411-486a-92d2-058875862102
- [遠端核對與部署 metadata](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37394706074/artifacts/11383275860)：2026-10-06T00:36:20.917Z 確認實際 D1 binding 分離、分潤欄位全部 NULL、LINE 外送關閉，兩區未登入 /api/me 均 Access HTTP 302。
- 本輪僅前端與 UI 驗收變更，不改動後端權限、資料庫 schema 或借址第一期範圍；原始藍圖完整保留。LINE、金流、AI 尚未串接。
- 教學影片保留原版，錄影步驟 skipped；沒有重製影片。
- UI 與截圖使用本機虛構資料，未代替本人完成正式網址已登入的瀏覽器驗收。

---

## 先前發布紀錄

# 目前版本：大字與可收合工作台

2026-10-06 08:26（Asia/Taipei）已更新正式與獨立測試區。

- 桌面頁首可收合／展開側欄；收合為圖示後仍有完整無障礙名稱及提示，手機維持抽屜導航。
- 工作台主要區塊及彈出視窗段落提供展開／收合；租戶的企業數位服務租用預設收起，先呈現承辦與維運入口。
- 主要文字與表單為 16–18px，輔助文字至少 14px；手機欄數、換行、表單與關閉按鈕調整。瀏覽器只記住版面偏好，不保存客戶資料或權限。
- 依使用者指示暫不製作教學影片。先前錄影流程的發布已取消，本次沿用已上線 run 37391789253 的影片與字幕；新的發布 run 明確跳過錄影。一般 push 不再自動重錄。
- 借址第一期範圍、後端權限與既有資料保持不變；LINE、金流與 AI 尚未串接，數位功能不收費、不開通，分潤欄位全為 NULL／待議定。

## 本次發布證據

- Source commit：89e4cedf093a1c5e8f86e112cb3c9588eb194f13
- 正式 Worker：607a37e5-7d55-4973-99c1-414b18be0f41（100%）
- 獨立測試 Worker：12d29316-54f0-4724-97fe-e372982842c7（100%）
- [建置、驗收及部署全部成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37393823430)
- [桌面／手機截圖與驗收報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37393823430/artifacts/11382320856)
- [實際環境、資料隔離、分潤欄位與部署 metadata](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37393823430/artifacts/11382415838)
- 72 項後端及 14 項桌面／手機測試通過。新增檢查涵蓋側欄收合增加內容寬度、重新載入保存偏好、區塊收合與恢復、租戶維運入口可操作、字體大小與無橫向溢出。
- 新截圖：desktop-dashboard-folded.png、mobile-dashboard-folded.png、desktop-sidebar-folded.png、desktop-tenant-large-text.png、mobile-tenant-large-text.png。
- 第一次版面驗收的教學連結測試使用舊圖示文字名稱，更新為語意名稱後通過；未移除權限檢查或降低驗收。
- 2026-10-06T00:26:33.661Z 發布後核對：兩區實際 D1 binding 分離、每業者四組數位條件完整且全部空白、LINE 外送關閉、未登入 /api/me 均 Access HTTP 302。
- UI 驗收使用本機虛構資料；未代替本人完成正式網站已登入的瀏覽器驗收。原始 PLATFORM_BLUEPRINT.md 完整保留。
- 詳細操作及影片延期決策：[READABLE_LAYOUT.md](READABLE_LAYOUT.md)。

---

## 先前發布紀錄

# 第一期借址版本發布紀錄

2026-10-06 08:07（Asia/Taipei）：正式工作台、獨立測試區及新版借址教學影片已發布完成。

## 可使用入口

- [正式工作台](https://taiwan-startup-park.fangwl591021.workers.dev/)
- [獨立測試帳號模擬](https://taiwan-startup-park-demo.fangwl591021.workers.dev/)
- [新版實際操作教學影片](https://taiwan-startup-park.fangwl591021.workers.dev/tutorial.html)

## 本次生效範圍

第一期只到借址：成交追蹤、成交轉租戶、地址合約、人工應收／收退款、續約、信件包裹、維運、工作聊天室基礎與操作人員歷程保持可操作。既有資料與數位歷程保留。

官網、商城、LINE OA 與 CRM 的後續程式保留；正式與測試區均不開放數位需求、訂閱、數位收費或功能開通。合作平台商、平台費、雙方分潤、結算基準與週期、生效日及議定依據欄位全部留空（NULL）、待議定，沒有分潤計算、撥款或結算。LINE、金流及 AI 尚未串接／啟用。

## 版本與驗收證據

- 發布來源 commit：96bc332a9101de140ef9d59003db70cd4e03114a
- 正式 Worker version：2a5114af-2dd3-43ba-9d39-7fdc84ba81c9（100%）
- 測試 Worker active version：04799136-d75e-4358-b138-1f26d19515af（100%，包含原有私有入口 secret 設定）
- [建置、測試、錄影及正式發布全部成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37391789253)
- [桌面／手機截圖與建置證據](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37391789253/artifacts/11381846232)
- [新版影片、中文字幕與逐步教學](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37391789253/artifacts/11381816187)
- [遠端核對報告與部署 metadata](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37391789253/artifacts/11381483295)
- Typecheck、建置、72 項後端／權限／核心流程測試、12 項桌面／手機驗收、Worker dry run 及 Access runtime 驗證通過。
- 實際 UI 錄影：146.1 秒、25 個步驟、1280 × 900、H.264、1,418,023 bytes，中文字幕、無旁白；播放器驗證通過。新版已替換線上教學。
- docs/screenshots 含 desktop-phase1-revenue-terms.png、mobile-phase1-revenue-terms.png、desktop-phase1-address-billing.png、mobile-phase1-address-billing.png。

## 遠端發布後核對

2026-10-06 00:07:00 UTC 的 phase-one-release-report.json 確認：

- 正式 D1 為 taiwan-startup-park-prod，測試 D1 為 taiwan-startup-park-demo；核對遠端 Worker 真實 binding，兩區獨立。
- 兩個專用 D1 均成功套用 0004_digital_revenue_placeholders.sql；未刪除原有租戶、合約、收款或操作歷程，未重設測試資料。
- 每家業者四種模組的預留資料完整，商業欄位全部為 NULL、狀態 unagreed。
- 正式 production／DEMO_MODE=off，測試 sandbox／DEMO_MODE=on；兩者 LINE_SEND_ENABLED=off。
- 兩區未登入 /api/me 均 HTTP 302 至 Cloudflare Access；原有管理員綁定及 Access 保護保留，無公開示範登入。
- 原始 PLATFORM_BLUEPRINT.md 完整保留。
- 自動化 UI 與影片使用本機虛構資料；未代替本人完成正式網址已登入的瀏覽器驗收。遠端資料庫、實際發布版本、環境旗標與未登入邊界已核對。

## 回復與後續

部署 metadata 保留前一正式版本 e71f3748-5c73-401f-b865-bc56b3535af6 及測試版本，供人工核對回復。0004 為新增資料表與 trigger，不以 Worker 回復自動刪除資料；舊版本仍含本期關閉前的數位流程，回復時須重新核對第一期限制，不可直接視為可對外收費。

後續數位串接須先議定合作條件，再另行實作設定、核准、當期標準快照及結算對帳。詳見 [第一期範圍](PHASE_ONE_SCOPE.md) 與 [測試操作指引](SIMULATION_GUIDE.md)。

---

## 歷史發布紀錄（以下為過往版本，不代表目前功能範圍）

# 正式工作台、測試帳號模擬與教學影片

2026-10-05 12:42 UTC：本輪更新已發布成功。

## 目前可使用
- [正式工作台](https://taiwan-startup-park.fangwl591021.workers.dev/)
- [獨立測試帳號模擬](https://taiwan-startup-park-demo.fangwl591021.workers.dev/)
- [操作教學影片](https://taiwan-startup-park.fangwl591021.workers.dev/tutorial.html)
- 教學為實際 UI 錄影，145.55 秒（約 2 分 26 秒）、25 個步驟，1280 × 900、H.264、1,475,809 bytes；中文字幕直接顯示，另附 WebVTT，無旁白。播放及下載控制、桌面／手機排版皆驗收通過。

## 本輪發布識別與證據
- 程式提交：6f87bf7f55305b28f5b1f0d92a4374ed6f676251
- 正式 Worker version：e71f3748-5c73-401f-b865-bc56b3535af6
- 測試 Worker：taiwan-startup-park-demo
- 測試 D1：taiwan-startup-park-demo，UUID a81974f2-ffff-4973-a128-22597eed6919；不使用正式 D1。
- [完整建置／驗收／發布成功（attempt 2）](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37310577997)
- [影片、字幕、封面與逐步文字](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37310577997/artifacts/11345526746)
- [桌面／手機截圖、建置與 UI 報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37310577997/artifacts/11345886356)
- [部署前版本與測試區資源 metadata](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37310577997/artifacts/11346450378)
- 67 項後端測試、10 項桌面／手機測試、教學流程快速預演、完整錄影及媒體播放驗證通過。影片兩個代表畫面已人工檢視，含表單字幕與 B 業者隔離範例。
- 首次新測試區發布後登入重新導向檢查未通過；相同提交僅重跑失敗發布工作後，測試 /api/demo/users 與正式 /api/me 均 HTTP 302 至 Access。未改動或放寬驗證／通行規則。
- 尚未代替本人完成已登入的正式網址瀏覽器驗收；自動化 UI／錄影使用獨立記憶體虛構資料，遠端已核對實際 D1 binding、Access 規則與未登入邊界。

## 測試帳號與資料界線
- 原本指定管理員通過獨立 Access application 驗證後，選擇管理員、業務 S1／S2／S3、維運、財務及 B 業者管理員／業務。沒有公開密碼。
- 各角色使用既有後端角色／業者資料範圍；模擬 session 綁定授權訪客的 Access issuer／subject。正式環境不接受模擬 session 或角色選擇登入。
- 測試區虛構資料獨立保存，不自動重設、不匯入正式客戶。新增人員仍為待身分綁定。請勿在測試區填真實客戶資料。
- 正式 Worker 保持 production／DEMO_MODE=off；LINE_SEND_ENABLED=off。測試 Worker sandbox／DEMO_MODE=on，但無真實 LINE credentials、webhook／外送或排程。
- LINE、金流、AI 尚未串接／啟用；訂閱、人工收款、需求申請不代表外部功能已開通。
- 原始 docs/PLATFORM_BLUEPRINT.md 完整保留。詳見 [測試操作指引](SIMULATION_GUIDE.md)。

---

## 上一輪正式部署紀錄

2026-10-05 11:51 UTC：完整工作台已發布至指定 Worker。

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
- 發布來源 commit：a0f2c4a54b24ac0abf4d3d5055e9089329cedc39
- Cloudflare Worker version：a83ba0da-901a-443f-a79d-aacfdb239eaf
- [完整工作台建置及發布成功](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37305465164)
- [部署前資源核對及回復 metadata](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37305465164/artifacts/11343209871)
- [桌面／手機驗收截圖與建置成果](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37305465164/artifacts/11343566122)

## 驗證與界線
63 項後端／權限／核心流程／部署測試及 8 項瀏覽器驗收全部通過。workerd 執行環境的 RS256 驗證與實際 Access 公開金鑰取得／匯入皆通過。公開金鑰請求使用 manual redirect 並拒絕 3xx，修正 Workers 不支援 redirect:error 的問題。

截圖在建置 artifact 的 docs/screenshots 目錄，含 desktop-dashboard.png、mobile-dashboard.png、成交／租戶／聊天室與維運頁面；使用本地虛構測試資料，非正式客戶資料。本人已完成初始化，但正式工作台發布後的瀏覽器登入確認仍待本人重新開啟頁面；不將未登入檢查或測試 fixture 視為正式使用者登入驗收。

LINE 真實收送尚未串接且發送關閉；金流未串接，帳務為人工記錄；AI 與風控規則未啟用。官網、商城等未接通的服務不得因申請或人工帳務而標示為已啟用。其餘後續需求以 PLATFORM_BLUEPRINT.md 為準。

## 影響與回復
僅使用 taiwan-startup-park 與本專案專用 D1／Access；未修改其它 Worker 或其它資料庫。回復時核對 artifact 中前一版本的部署記錄及 Worker ID；不自動刪除資料庫或取消 Access 保護。非秘密資源對應保存在 config/production-resources.json，真正憑證只由 GitHub Secrets 提供。

## 新增入口修正

已發布新增既有租戶、新增操作人員資料及獨立據點／方案設定，並補上空資料頁的可點擊建立入口。空租戶工作台、實際建檔、手機入口及承辦人權限已通過測試。直接建檔租戶不製造案件成交、收款或權益；明確指派業務承辦時，僅該員或管理員可查看。人員資料預設停用且待 Access 綁定；不能直接啟用、指派案件或新增 owner/platform 角色。新增操作指引見 CREATION_GUIDE.md。

新增驗收截圖：desktop-empty-tenants.png、desktop-add-staff.png、mobile-add-tenant.png、mobile-catalog.png，保存於上述 build artifact 的 docs/screenshots。

