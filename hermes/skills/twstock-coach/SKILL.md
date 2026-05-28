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
- 使用者要求白話解讀模型結果

## Procedure

### 0. 環境前置
所有腳本位於 repo 的 `scripts/` 目錄，使用專案 Python 環境執行。預設 cwd 已是 repo 根目錄。

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

### 5. ML 預測
```bash
python scripts/prediction_model.py --code <code> --days_ahead 5 --model xgboost
```

### 6. 綜合報告（會整合上述全部 + ATR 止損）
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

## Pitfalls

- 預設 `--days 180` 不夠 ML 用，跑預測前先用 `--days 365` 或更多
- 0050 大盤代理檔不存在會降低預測精度，建議一併抓 `data/0050_history.csv`
- 回測複利數字會騙人，看實戰數字請用 `--position-size 0.1` 的 `strategy_realistic` 欄位
- 訊號出 BUY 但機率 < 65% → 只建議小部位試水溫

## Verification

- 報告產出含 `signal`、`predicted_return`、`probability_up`、`stop_loss_atr` 欄位即成功
- 缺欄位通常代表資料不足，回到 Procedure 第 3 步加大 `--days` 重抓

## 規則

- 所有回覆繁體中文
- 每次分析結尾加：「⚠️ 以上分析僅供參考，不構成投資建議。」
- 資料來源 TWSE/TPEX 公開 API
