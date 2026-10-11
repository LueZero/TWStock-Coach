# 基本、財務與籌碼分析契約

更新：2026-10-11。實作在 api/fundamentals.js、financial-metrics.js、equity.js、peers.js；前端在 web/src/views 與 web/src/controllers。綜合健診與建議視窗、入口、分數程式及停用API已移除。策略回放保留個股分頁；預測只有 GET /api/research/:market/:symbol，尚無前台預測頁。

## 閱讀與配色

基本、財務、籌碼各有單頁頁籤，避免堆疊在看盤下方。指標可開啟趨勢彈窗，依已取得歷史選區間、看精確數值與來源。財務五大分類與38細項、圖表、同期間表格詳見 [財務分類](FINANCIAL_NAVIGATION.md) 與 [內容核對](FINANCIAL_PARITY_AUDIT.md)。

紅代表正向／改善，綠代表負向／下降，黃代表需留意，灰藍代表需背景或缺資料。財務利潤率比去年同季下降標綠；費用、負債、投資或持股規模不單憑高低判好壞。缺值不是零，公司沒有資料不等於公司不好。配色是指標觀察，不是公司評等或買賣指令。

## 基本資料與財務

公司資料來自 TWSE／TPEx 官方公開接口；未取得時只呈現股票目錄名稱與產業。股利每個事件分列，不把最新季配當全年。基本分析不重複顯示估值觀察；本益比、淨值比、殖利率及相關歷史位於財務價值評估。

營收依來源營收年月，與前月／去年同月比較；財報依相同季，累計現金流需同年且起始現金基準可驗證才差分。成長率基期為零或負不計百分比；TTM需連續4季，TTM年增需連續8季。ROA利息加回、應收票據合計、16季盈再率等均驗證必要科目，不能以缺值補零。

歷史重建選 received_at 不晚於 as_of 的最新修訂，再排除晚於財務截止的財報日期。來源無可靠公告時間，因此歷史可得性明示為 platform_first_observation；歷史公式重算不代表當年公告已知。

## 籌碼

| 區塊      | 內容                                     | 解讀                                   |
| --------- | ---------------------------------------- | -------------------------------------- |
| 三大法人  | 區間取得交易日淨流量、每日明細與趨勢     | 外資／投信／自營商分開，未取得日不補零 |
| 主力代理  | 前15大淨買分點減淨賣分點                 | 不認定是同一主力或猜身分               |
| 券商分點  | 最新已取得分點日，各價格彙總、排序與明細 | 零價格不推估成本；歷史是持續累積的觀測 |
| 籌碼分布  | 逾400張、5張以下、外資存量及分級明細     | 合計與差異數排除，不當成主力身分       |
| ETF／基金 | 指定主動ETF及授權基金揭露                | 非全市場；權重不跨基金相加             |

數量選單股／張同時更新卡片、明細與彈窗。1張＝1000股，37股＝0.037張，百分比、權重及人數不換算。集保免費資料只有最新週且必須完整17級，按實際資料日期保存並累積；不能填到過去要求的日期。

外資合計使用 FinMind 的 `Foreign_Investor` 與 `Foreign_Dealer_Self`，後者是外資自營商，不能寫成 `Foreign_Dealer`。上市自2017-12-18、上櫃自2018-01-15起需兩個組成；此前 `Foreign_Investor` 已是外資合計，不再重複加總。分類依[FinMind官方文件](https://finmind.github.io/tutor/TaiwanMarket/Chip/)處理。自營商若來源提供合計則使用合計，否則需自行及避險兩個組成。任何必要值缺漏，當日合計留空；來源明確提供0才按0計算。逾400張需四個已辨識級距、5張以下需兩個級距，部分分級不冒充完整占比。

## 來源與權限

FinMind財務6資料集抓近5年；法人與外資為來源公開資料；歷史持股分級需 Backer／Sponsor；分點集中及券商分點需對應會員權限，券商分點走專用一日接口。無 Token時可使用集保最新快照。主動ETF需 Sponsor及 ETF_WATCHLIST最多10檔，以ETF代號查詢再篩個股、TWD、股票資產。

法人目標與其他基金不以模型捏造，只接受具授權揭露。target摘要為截止180天內每機構最新報告的中位數及範圍；歷史接收時間同樣受限。基金依基金代號取最近已知揭露，並保留歷史。

工作回報 available／no_data／requires_token／not_configured／not_connected／source_error。不把來源未連接顯示成無持股。背景工作、重試及持久化詳見 [架構](DESIGN.md)。

## 授權揭露匯入

POST /api/equity/import 使用 X-API-Key。請求需要 market、symbol、dataset、source、rows；dataset只能是 AnalystTargetReport 或 FundHoldingsReport。每筆需相符stock_id、非未來date及HTTPS source_url。

目標價另需 institution、currency=TWD及正target_price。基金需 fund_code、fund_name、非負整數holding_shares及可選0～100的weight_percent。來源與資料不可混股票；整批先驗證再保存。重跑同資料不新增快照修訂。

金鑰只由管理端傳入，不能存前端。來源引用：[FinMind基本面](https://finmind.github.io/tutor/TaiwanMarket/Fundamental/)、[FinMind籌碼](https://finmind.github.io/tutor/TaiwanMarket/Chip/)、[集保公開股權分散表](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock)。

## 研究回放與預測

策略API保留固定規則與每根來源修訂，僅用完成K線，預設以次根開盤假設成交；同根停損與目標雙觸價優先停損。財報確認必須當時已接收，不將今天財報放進歷史信號。研究回放未模擬委託排隊、漲跌停無法成交、完整股利或流動性。

ridge-5d-v1 使用完成還原日線，至少165筆，最多500筆滾動訓練；每次只用結果已完成的5日標籤。殘差10～90%分位不是已校準信賴區間，並列歷史均值與零報酬基準。尚無模型發布治理、實盤驗證或自動下單。
