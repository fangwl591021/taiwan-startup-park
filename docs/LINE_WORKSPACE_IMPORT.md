# Smart-Menu-Studio LINE OA 機制導入

日期：2026-10-07（Asia/Taipei）。本文件補充 `PLATFORM_BLUEPRINT.md`，不取代原規格或刪除後續需求。

參考來源：fangwl591021/Smart-Menu-Studio，main / `f69fd70a2ff91056bbac158a41e046ee35f10077`。
導入方式：沿用其工作區、身分、CRM、模組權益、模板分層的設計，改寫為本專案的 operator／business／案件權限。沒有搬入餐飲、旅遊、點數等無關資料或正式憑證。

## 功能對照與實際狀態

| 參考專案機制 | 台灣創業園入口與資料 | 本次可操作範圍 | 尚未啟用／後續 |
| --- | --- | --- | --- |
| `workspace_line_accounts`：Login／Messaging 分開 | 平台 LINE 帳號設定；業者 LINE OA 工作台、Messaging 帳號設定 | 獨立 Channel／Secret、加密保存、不回顯、留白沿用；Webhook 驗簽、去重、收回 | LINE Login OAuth／LIFF、正式外送仍未啟用 |
| `crm_people`、identity links、profiles、tags、timeline、pipeline | 會員 CRM；`crm_people`、`crm_line_links`、既有 contacts／opportunities／businesses | 手動及 OA 來客建檔、標籤、搜尋分頁、指派、版本控制、服務歷程；CRM 直接建案，成交沿用為租戶 | 多企業 membership、名片 OCR、CSV 匯入、分群行銷仍保留 |
| `workspace_module_entitlements`：導航＋後端權益 | 業者模組管理（唯讀）；系統模組管理（啟停） | CRM、LINE 工作台、模板、管理員核查由後端校驗；相依檢查與版本歷程；借址核心不可停用 | 付費官網／商城／租戶 OA 不開通；價格及分潤為 NULL |
| 圖文選單專案及模板中心 | 平台共用模板、業者私有模板、內建借址參考 | 回覆草稿建立、編輯及套用；六格標題／文字動作配置、預覽及另存 | 圖片素材、R2、LINE rich menu 發布、alias／切換與成效同步未實作，不顯示已發布 |
| `workspace_keyword_routes`／LINE Hub | LINE OA 工作台的關鍵字分類與最近來客 | 可設定完全相同／包含文字，提出借址、續租、郵件、帳務或服務分類建議 | 不自動回覆；不開放任意外部 Webhook 轉送；群組助手仍保留 |
| LINE intelligence、AI 使用／建議 | 聊天室 AI 監控（僅業者管理員） | 來客及待分派數、逾期跟進、實際回覆者；私有規則掃描最近 200 則平台出站紀錄、待核查、人工結案與私有歷程 | 參考專案的 LINE intelligence 是選單成效分析，不能冒充截單模型；本次無 AI 模型、無自動告警推播、無自動處分 |
| SaaS 模組／經銷結算 | 平台費與分潤；既有 digital_revenue_terms | 保留業者、模組、平台費、分潤、結算及生效欄位 | 第一階段只收借址服務；數位租用須與平台商議定標準，保持 NULL／unagreed |

## 使用流程

1. 系統總管理員設定平台自己的 LINE 帳號、管理業者模組及共用模板。此身分不預設讀取業者 CRM 或聊天室。
2. 業者管理員在自己的 LINE OA 工作台設定 Messaging API、Webhook，另行保存該 OA 對應的 Login Channel／Secret。Messaging 設定保存與最後驗簽時間分開顯示。
3. 已驗簽的一對一 LINE 來客自動取得本業者 CRM 身分。未綁定案件的來客先由管理員接洽／指派；一般業務只讀授權會員及企業。
4. 會員補資料、標籤及需求後按「建立成交案件」。單一未綁定 LINE 身分會同時綁定新案件聊天室，歷史已接收訊息加入工作對話；多個身分需管理員明確分派，不任意選取。
5. 接觸 → 導入 → 收費 → 成交。成交沿用同企業、聯絡人與 CRM；重送不重複建案，第二筆成交不重複建租戶。付款核對及功能啟用各自獨立。
6. 租戶維運補登據點、借址合約起迄、年約／月約、付款週期、郵件代收、應收與續約。收件通知沿用既有已核對的 LINE 聯絡人；推播尚未開啟。
7. 回覆模板只填入人工草稿；操作人員仍須確認並按送出。測試區僅本地模擬，正式外送開關維持 off。
8. 業者管理員設定自己的私有核查用語，再人工掃描工作紀錄；命中列為待核查，依上下文處理。一般人員不顯示核查資料；公司工作通訊記錄用途仍依原規格告知。

## 隔離與資料保留

- 不以電話、Email、姓名或不同 Provider 的 LINE UID 自動合併會員。原有 contacts 以 additive migration 建立 CRM 關聯，不覆寫原企業、合約、聊天或操作者。
- operator_id、角色及 actor_id 取自經驗證 session。業務只存取分派案件／會員；維運只存取指派租戶；平台僅管理模組、共用資源及狀態。
- 模組停用限制其新增 API，但保留歷史資料；借址核心與 Webhook 持久化不受可選模組停用影響。
- Login Secret 與 Messaging Secret 使用不同 AES-GCM context，不能互換。主鑰缺失且已存在任何加密 Login／Messaging 設定時拒絕重建。
- 私有規則與核查歷程使用獨立資料表，不記入一般 activity_events。事件只保存來源訊息 id；來源收回後，核查 API 不再顯示正文，不保留衍生內容副本。
- 私有用語、金鑰、真實訊息與告警案例不得提交公開 Git。測試案例與截圖只使用虛構資料。
- 所有列表有上限／分頁；CRM 使用 keyset 分頁及 operator/status/time 索引。千筆測試為本地 SQLite 驗證，不宣稱等同正式網路延遲。

## 官方依據與保留路線

- [LINE user ID 與 Provider 範圍](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)
- [Provider／跨頻道設計](https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/)
- [圖文選單正式發布需建立配置、圖片上傳與設定](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/)
- 原規格第 7、11 節仍為後續路線：AI 建站／名片及 DM、商城金流、自有租戶 OA、訂閱權益、會員匯入、模型核查及告警、經銷結算與網域。未接通的部分不以開關或示範成功冒充正式功能。

## 驗收

`tests/line-workspace.test.mjs` 涵蓋跨業者及角色隔離、CRM 與案件／租戶沿用、LINE 歷史來訊綁定、CAS、重送、模組相依及 NULL 分潤、私有／共用模板、Login 加密、私有核查去重與收回、千筆會員分頁。

`tests/ui/line-workspace.spec.mjs` 在桌面與手機走完會員 → 成交租戶、回覆模板 → 人工草稿、六格選單預覽、關鍵字分類、實際回覆人員 → 私有核查 → 誤報結案，並確認平台不讀業者 CRM、一般業務無核查入口。

本次不製作或重新錄製教學影片。發布證據另記於 `DEPLOYMENT_STATUS.md`。

2026-10-07 19:06（Asia/Taipei）已發布來源 `13ed99c931f2e20aa75943b87ede3fb3c364043f` 至正式及獨立測試站；109 項後端與 31 項桌面／手機測試全部通過。新 migration 已套用，實際模組及 Access 邊界核對完成。

[功能 PR #17](https://github.com/fangwl591021/taiwan-startup-park/pull/17) 已隨發布合併；[發布證據](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37611482434)。[截圖與完整測試報告](https://github.com/fangwl591021/taiwan-startup-park/actions/runs/37611846625/artifacts/11477339138) 包含 desktop/mobile-line-workspace-crm、hub、modules、templates、monitor，共十張虛構資料截圖。後續截圖拍攝選項修正不改動已發布的應用程式。
