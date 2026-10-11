# 公司新聞與公開討論

「個股看盤 → 熱門新聞」在中央內容區顯示新聞左欄、輿論右欄；窄螢幕改為上下排列。各欄預設6則，可獨立展開更多；股票切換立即清除舊內容，取消前次請求並檢查股票與請求版本，避免串檔。

## 來源與時間

- FinMind `TaiwanStockNews` 每次上游請求只提供一天；平台依公司代號逐日查詢並合併所選起訖日期，包含週末／假日。來源回傳的 Yahoo、經濟日報、財經媒體等歸新聞，CMoney、PTT、Dcard 論壇網址歸公開討論。論壇連結來自公司索引，不聲稱直接取得論壇全站。
- Yahoo 股市 RSS、PTT Stock Atom 依股票名稱／完整代號篩選最近公開文章。僅文內出現公司時標示「文內提及」，不當成專屬公司主題。
- 預設近七個日曆日，以台北今日為截止日。可輸入起始日期、截止日期，或使用今日／近七日／近一月（30日）快捷鍵；切換股票保留區間。單次最多31日，拒絕反向日期、未來日期與超限區間。
- 新聞與公開討論共同依區間篩選。RSS 依 Asia/Taipei 日期；FinMind 未註明時區的時間依來源日期。Yahoo／PTT RSS 只涵蓋近期文章，不保證歷史完整。
- 查詢逐日載入並顯示進度，結果合併、去重與展開更多；失敗日期明確列出，斷線保留已載入部分並標示未完成。較長區間首次查詢可能需數分鐘，受上游節流與排程影響；重跑優先讀取每日快取。
- FinMind 時間未註明時區，保留來源時間並標示；RSS 明確時區才換算 Asia/Taipei。沒有跨來源精確排序的時區保證。
- 名稱為熱門新聞，但實際依來源時間排序；沒有點閱量、推文量或熱度排名。討論為未驗證觀點，不提供情緒分數、交易指令或主力身份推論。

## Google 與第三方條件

預設提供 Google 新聞搜尋連結。Google News RSS 的來源聲明限個人、非商業的閱讀器用途，所以 `GOOGLE_NEWS_ENABLED=false`；符合該用途時可自行設定為 `true`，重建／更新 API 容器。公開開源程式的 MIT 不授予第三方新聞、論壇或 Google 資料的轉載權。

只顯示標題、來源、發布時間、關聯標籤與原文連結，不儲存或轉載全文。無權限或來源失敗即顯示狀態；沒有符合文章不代表沒有市場討論。外部搜尋連結可查更多來源。

## 實作

- `GET /api/media/:market/:symbol?start=YYYY-MM-DD&end=YYYY-MM-DD&cursor=YYYY-MM-DD`：每頁查詢一個發布日，`cursor` 預設 `start`；回傳 `start`、`end`、`page_start`、`page_end`、`next_cursor`、`failed_dates`。消費端必須逐頁查到 `next_cursor=null` 才算走完區間，且仍須檢查失敗日期與來源狀態。保留 `date=YYYY-MM-DD` 單日相容，不能與區間參數混用。股票名稱從 instrument 目錄取得，來源 URL 固定，不接受使用者提供爬取網址。
- `api/media.js`：RSS／Atom、大小與DTD檢查、HTTPS 連結、公司關聯、去重與新聞／論壇分類。去重移除追蹤參數，保留新聞 SN 等必要識別參數。
- `web/src/controllers/media-controller.js`：日期查詢、股票切換保護、來源狀態、雙欄呈現與展開文章。
- 公司索引按股票與發布日快取；RSS 按股票與來源共用近期快取，避免區間每一天重抓 RSS。同鍵請求合併、10分鐘快取，標準化標題與連結快照寫入 PostgreSQL。首次內容接收時間與最近觀測last_seen_at分開，內容回到舊版本時仍以最近觀測判斷離線回讀；來源失敗明示原接收時間及stale。

## 區間驗證

`npm test` 包含新聞區間邊界、台北跨日、逐日游標與失敗日期、文章去重與超過60筆案例。`node scripts/verify_media_range.cjs` 使用隔離瀏覽器測試資料驗證三日合併、三個快捷鍵、非法區間、取消舊請求及1440／1024／390／320排版，不代表所有外部來源均可取得。

來源：[FinMind 台股資料文件](https://finmind.github.io/tutor/TaiwanMarket/DataList/)、[Yahoo 官方 RSS 清單](https://tw.stock.yahoo.com/rss-index)、[PTT Stock Atom](https://www.ptt.cc/atom/Stock.xml)。
