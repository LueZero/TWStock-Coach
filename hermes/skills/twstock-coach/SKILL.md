---
name: twstock-coach
description: 台股小教練 — 即時報價、技術分析、ML 預測與白話解讀（搭配本 repo 的 scripts/）
version: 1.0.0
author: TWStock-Coach
platforms: [windows, linux, macos]
metadata:
  hermes:
    tags: [stock, taiwan, twse, ml, technical-analysis]
    category: domain
---

# 台股小教練 (TWStock-Coach)

當使用者詢問台股股票分析、即時報價、技術指標、ML 預測，或想看綜合報告時載入此 skill。

## When to Use

- 使用者提到台股代碼（4 位數字，如 2330、0050）或公司名稱（台積電、鴻海...）
- 使用者要求「分析」「預測」「報告」「該不該買」「止損價」「技術指標」
- 使用者說「我想買 <股票代碼或名稱>」或「這檔能買嗎」時，套用技術分析；未提供可辨識代碼或名稱才追問。
- 使用者要求白話解讀模型結果

## Procedure

### 0. 環境前置
所有腳本位於 repo 的 `scripts/` 目錄，使用專案 Python 環境執行。預設 cwd 已是 repo 根目錄。

### 產出位置（必須遵守）

所有專案產物須寫入本專案 `data/`，包含下載、報告、圖片、模型、回測、日誌與暫存檔。CSV 放 `data/`，模型放 `data/models/`，報告／圖片放 `data/reports/`，回測放 `data/backtests/`，暫存／驗證檔放 `data/tmp/`，快取與日誌放 `data/cache/`、`data/logs/`。先定位 repo 根目錄並建立必要子目錄；stdout 重新導向也須使用這些路徑。不得放到 Hermes 使用者目錄或系統暫存目錄。

`--data-dir` 僅接受專案 `data/` 內的位置；相對路徑以 repo 根目錄解析。自訂資料目錄時，調參與報告使用相同的 `--data-dir`，參數位於其 `models/` 子目錄。Hermes 本身的設定與對話仍由系統使用者目錄管理。

### 1. 識別股票代碼
若使用者只給公司名，先查對照表轉成代碼：

| 公司 | 代碼 | | 公司 | 代碼 |
|------|------|-|------|------|
| 台積電 | 2330 | | 鴻海 | 2317 |
| 聯發科 | 2454 | | 台達電 | 2308 |
| 中華電 | 2412 | | 國泰金 | 2882 |
| 富邦金 | 2881 | | 台塑 | 1301 |
| 廣達 | 2382 | | 日月光 | 3711 |

### 2. 即時報價
```bash
python scripts/fetch_stock_data.py --code <code> --action realtime
```

### 3. 歷史資料（ML 用至少 365 天，首次建議 1095 天）
```bash
python scripts/fetch_stock_data.py --code <code> --action history --days 1095 --save
```

### 4. 技術分析
```bash
python scripts/technical_analysis.py --code <code> --indicators all
```

### 公開新聞輿情
當使用者詢問「新聞風向」「輿情」或「最近市場怎麼看」時，執行：

```bash
python scripts/sentiment_analysis.py --code <code> --name <公司名稱> --days 7
```

回覆需列出文章數、來源與標題，並說明這是標題關鍵詞統計，不納入技術分數或 ML 預測，不能代表市場共識或交易指令。

### 基本面 / ETF 價值分析
當使用者問「貴不貴」「便宜嗎」「殖利率多少」「營收成長如何」時：

```bash
# 上市個股：本益比/殖利率/淨值比/月營收 MoM-YoY/獲利能力
python scripts/fundamental_analysis.py --code <code>

# ETF：追蹤指數/是否含國外成分股/保管機構
python scripts/etf_analysis.py --code <ETF代碼>
```

基本面僅供價值面參考，不納入技術分數或 ML 特徵。查無資料時，先判斷該代碼是否為 ETF、權證或上櫃股票、再回覆使用者，不要直接說系統壞了。ETF 注意：TWSE 免費 API **不提供** NAV 折溢價與內扣費用率，不能假裝有這項資訊。

### 當沖（當日沖銷）風控參考
當使用者問「當沖」「今天可以沖嗎」「當日沖銷」時：

```bash
python scripts/day_trading_analysis.py --code <code>
# 或在綜合報告中一起加入
python scripts/report_generator.py --code <code> --day-trade
```

提供今日振幅、現價在今日高低區間的位置、距離漲跌停、委買賣價差、五檔委買量佔比，以及當日是否暫停現股當沖先賣後買。務必先確認現在是否為盤中（開盤時間查詢才有意義），並提醒這只是即時快照、不是逐筆委託簿、不能預測盤中未來走勢，且不建議新手輕易嘗試當沖。

### 買進意圖與價格區間候選
使用者說「我想買 <股票代碼或名稱>」時，依序執行即時報價、歷史日 K（不足時先補抓）、技術分析與公開新聞輿情；輿情只用來說明近期事件與風向，不計入技術分數或 ML 預測。依訊號、風險與止損給機率性解讀，不直接回答必買或必賣。

使用者要求「找 25~35 元附近的股票」或「依價格篩選」時，執行：

```bash
python scripts/stock_screener.py --min-price 25 --max-price 35 --min-volume 1000000
```

掃描器先依 TWSE 上市普通股最近可用收盤價及成交量篩選，再對流動性最高候選抓取歷史日 K，以同一套技術規則排序。結果是候選，不保證上漲或固定上漲金額；目前不含上櫃、ETF、權證。

### 5. ML 預測
```bash
python scripts/prediction_model.py --code <code> --days_ahead 5 --model xgboost
```

### 6. 綜合報告（會整合技術、輿情、籌碼、ML 與 ATR 止損）
```bash
python scripts/report_generator.py --code <code> --days-ahead 5
```

### 7. 回測驗證（可選）
```bash
python scripts/backtest.py --code <code> --stop-loss-atr 2.0 --position-size 0.1
```

### 8. Optuna 超參數調校（首次分析新股票）
```bash
python scripts/tune.py --code <code> --n_trials 30 --save
```

### 大盤三大法人
當使用者詢問「大盤法人買超/賣超」時，不需要股票代碼：

```bash
python scripts/institutional_data.py --action market --days 20 --save
```

資料為 TWSE 上市全市場加總，不含櫃買市場，也不是券商分點主力進出。

## 動態決策邏輯（重要）

腳本回 JSON 含 `error` 或 `train_samples` 時，**自己判斷下一步**，不要把錯誤丟給使用者：

- `error` 含「資料不足」 → 加大 `--days` 重抓（365 → 730 → 1095）
- `train_samples` < 50 → 提醒預測信心較低
- `predicted_return` 絕對值 > 10% → 提醒可能是雜訊
- 抓取失敗 → 等 2 秒重試一次

## 回報報告格式範本

執行完 `report_generator.py` 後，按此結構整理：

```
📊 [公司名] ([代碼]) 分析摘要

💰 目前股價：XX 元（漲跌幅 +X%）

🤖 ML 模型怎麼說：
   未來 5 天預測：+X% (信心 Y%)
   訊號：🟢 BUY / ⚪ HOLD / 🔴 SELL
   👉 白話：[一句話總結]

📈 技術指標怎麼看：
   多空研判：[多頭排列/空頭排列/盤整]
   關鍵訊號：[列 2-3 個重要的，用白話]

🛡️ 風控建議：
   建議止損價：XX 元（跌到就賣）
   建議部位：[小試/中度/觀望]

⚠️ 提醒：以上僅供參考，模型勝率約 60%，請搭配自身判斷。
```

## 白話翻譯速查表

| 術語 | 白話 | 怎麼看 |
|------|------|--------|
| 預測報酬 | 模型猜未來 N 天會漲跌多少% | +3% 以上算強、-3% 以下算弱 |
| 上漲機率 | 模型有幾成把握會漲 | >65% 高把握、55-65% 普通、<55% 不確定 |
| BUY/HOLD/SELL | 建議買進/觀望/出場 | BUY 需漲幅與機率雙達標 |
| MA | N 天平均價 | 股價在 MA 上=多頭、下=空頭 |
| KD | 短期超買超賣 | K>80 超買、K<20 超賣 |
| RSI | 強弱指標 | >70 過熱、<30 過冷 |
| MACD | 趨勢動能 | DIF 由負轉正=買進 |
| ATR | 平均日波動（元） | 算合理止損距離 |
| 止損價 | 跌到就要賣 | 防止小虧變大虧 |
| 勝率 | 100 筆有幾筆賺錢 | >55% 不錯、>60% 很棒 |
| Sharpe | 報酬/風險比 | >1 不錯、>2 很好 |
| MDD | 史上最慘賠多少% | 越接近 0 越穩 |
| Buy & Hold | 一路抱不動的對照組 | 策略要贏過它才有價值 |
| 本益比 (P/E) | 股價是每股獲利的幾倍 | 太低可能便宜或有隱憂、太高可能貴或高成長預期 |
| 殖利率 | 配息占股價比例 | 越高代表領股息報酬率越好 |
| 月營收 MoM/YoY | 這月比上月/去年同月多或少賺幾% | 連續正成長代表營運轉強 |
| ETF 折溢價 | 市價比淨值貴或便宜多少 | 系統無法取得，勿假裝有此資訊 |
| 今日振幅 | 今天最高與最低價差佔昨收比例 | 太小當沖不易賺超過手續費 |
| 五檔委買委賣 | 排隊等成交的買單/賣單價量 | 委買量占比高=當下買盤較強，僅反映查詢瞬間 |

## Pitfalls

- 預設 `--days 180` 不夠 ML 用，跑預測前先用 `--days 365` 或更多
- 跨資產基準為可選功能；只有使用者指定 `--market-code` 時才載入。應選擇與個股分析目的相符的市場或產業基準，不能假設 0050 對所有個股都更準。
- 回測複利數字會騙人，看實戰數字請用 `--position-size 0.1` 的 `strategy_realistic` 欄位
- 訊號出 BUY 但機率 < 65% → 只建議小部位試水溫
- `day_trading_analysis.py` 只在盤中（09:00-13:30）查詢才有意義，盤後查詢到的五檔與振幅是收盤當下的殘影，須提醒使用者；且輸出不含逐筆委託簿，數秒內市況就可能不同
- 代碼開頭是 0 的標的（0050、00881 等 ETF）存進 CSV 的 `stock_code` 欄若被 pandas 當數字讀入會變成 881，導致 `validate_history_code` 誤判「代碼不符」而中斷報告。`fetch_stock_data.py`、`technical_analysis.py`、`prediction_model.py`、`report_generator.py` 讀歷史 CSV 時都必須帶 `dtype={"stock_code": str}`（已修）；若之後新增讀 CSV 的腳本，記得比照辦理
- `institutional_data.py --code <code>` 對單一個股抓法人籌碼常在 60~120 秒內逾時（TWSE 個股籌碼端點慢），碰到逾時就跳過該步驟繼續產報告，不要重試卡住整個流程；`--action market`（大盤加總）通常正常
- `fetch_stock_data.py` 對 TWSE 即時報價偶發 SSL handshake timeout，等 1-2 秒重試一次即可，不要連續重試多次卡住
- `fundamental_analysis.py`/`etf_analysis.py` 抓的是 TWSE 全市場彙總表（本益比、月營收、營益分析、基金基本資料），單次呼叫可能要幾秒到十幾秒；ETF 代碼查不到本益比資料是正常的（ETF 本來就不適用 P/E），不要當成錯誤
- 使用者若要求「保證上漲」「保證漲 N 元」這類說法，先澄清釐清真實需求（例如改成「技術面訊號較強的候選」），不要直接執行也不要用模型數字包裝成保證

## Verification

- 報告產出含 `signal`、`predicted_return`、`probability_up`、`stop_loss_atr` 欄位即成功
- 缺欄位通常代表資料不足，回到 Procedure 第 3 步加大 `--days` 重抓

## 規則

- 所有回覆繁體中文
- 每次分析結尾加：「⚠️ 以上分析僅供參考，不構成投資建議。」
- 資料來源 TWSE/TPEX 公開 API
