---
name: twstock-fundamental
description: 分析公司財務、估值、籌碼或ETF淨值與組合時使用，按商品選證據，避免混期、缺值補零與最新組合冒充歷史。
---

# 財務、籌碼與基金研究

先確認公司或 ETF。公司獲利查 get_stock_data financial 的指標目錄、頁面狀態與 coverage，再以 get_financial_history 選必要 metric。source_status=updating 不是無營收；可重查一次，仍未完成就分析已取得部分並列缺項，不連續輪詢耗盡額度。

依問題連結獲利品質、成長、現金與負債，不列完所有指標。季報與月營收各標期間；成長率比較同季，虧損基期不用一般百分比。缺票據、費用拆項或連續季不反推。來源 EPS 未確認股數基準不加總 TTM；銀行、保險不套一般製造業門檻。

估值先看來源 PER/PBR 與適用性，需要歷史位置才用 get_valuation_bands。來源倍數換算參考帶不是標準 EPS/BVPS 河流圖、合理價或必到目標；負獲利與缺淨值不能硬算便宜。

籌碼先用 get_chip_detail 取子頁目錄，再選 dataset。外資淨買賣為區間流量，外資持股為存量；集保週頻、董監月頻，申報轉讓不是成交。集中度不能辨認交易者。permission_denied、source_error、queued、no_data 與區間外分開，不用權限不足概括所有缺值。

ETF 用 get_fund_data nav、portfolio、quarterly；公司被基金持有用 holders。核對估值日、盤中指示淨值與已公布淨值，折溢價非成交保證。日組合與季報分開，只有名稱／權重不猜代號／股數；兩家投信不是全市場。沒有歷史組合不宣稱過去持股。配息率不是含息總報酬，公司 EPS 不適用 ETF。

白話指出支持、反對及缺項影響的結論。財報期末不是公告日；point_in_time=false 不得推論現在查到的資料在歷史當時已知。

需要損益表、股利或多指標整頁內容時，先查catalog後用get_financial_history的page指定id；單項用metric，兩者擇一。兩種查詢都有有限wait_ms，仍updating時不當成不存在。財務歷史與籌碼明細預設最近頁，頁內依日期升序；要從最早開始用order=asc。籌碼dataset可用目錄id、回傳中文名稱或對應來源資料集名，核對dataset_status，不用整體partial判定該子頁也缺資料。
