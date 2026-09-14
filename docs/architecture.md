# 專案結構 Architecture

```
twstock-coach/
├── .hermes/                  # Hermes Agent 設定 (HERMES_HOME)
│   ├── config.yaml           # 模型 / provider / terminal 設定
│   ├── .env.example          # API Token 範本（複製為 .env 後填入）
│   └── skills/               # 自訂 skills（如有）
│
├── scripts/                  # 核心分析腳本（全部用 --code 參數，無 hardcode）
│   ├── fetch_stock_data.py   # 抓 TWSE/TPEX 即時報價 + 歷史 K 線
│   ├── technical_analysis.py # 趨勢、動能、波動、量價與支撐壓力指標
│   ├── fundamental_analysis.py # 上市個股本益比/殖利率/淨值比/月營收/獲利能力
│   ├── etf_analysis.py       # ETF 基本資料（追蹤指數/保管機構，不含 NAV 折溢價）
│   ├── day_trading_analysis.py # 當沖風控參考：即時五檔、今日振幅、漲跌停距離
│   ├── institutional_data.py # 個股與 TWSE 大盤三大法人、融資融券、借券、集保
│   ├── prediction_model.py   # XGB+LGB ensemble + 跨資產特徵
│   ├── backtest.py           # Walk-forward 回測 + ATR 止損 + 真實複利
│   ├── tune.py               # Optuna 超參數搜尋
│   └── report_generator.py   # 一鍵綜合報告（自動串接以上所有模組）
│
├── data/                     # 股票歷史資料快取（gitignore）
│   ├── 0050_history.csv      # 大盤代理（跨資產特徵來源）
│   ├── 2330_history.csv
│   └── ...
│
├── models/                   # Optuna 最佳參數（gitignore）
│   └── <code>_best_params.json
│
├── docs/                     # 設計文件（本資料夾）
│   ├── architecture.md       # 專案結構（本檔）
│   ├── ml-pipeline.md        # ML 模型設計
│   ├── backtest.md           # 回測方法
│   ├── agent-guide.md        # Agent 互動設計
│   └── technical-analysis.md # 技術面指標與訊號規則
│
├── AGENTS.md                 # Hermes 啟動時自動載入的工作區上下文
├── README.md                 # 專案首頁
├── requirements.txt          # Python 依賴
├── setup.ps1 / setup.sh      # 一鍵安裝腳本
└── run.ps1 / run.sh          # 啟動 hermes agent
```

## 模組職責

| 模組 | 輸入 | 輸出 | 上游 | 下游 |
|------|------|------|------|------|
| `fetch_stock_data` | 股票代碼、天數 | CSV 歷史檔 / JSON 即時報價 | TWSE/TPEX API | 其他所有腳本 |
| `technical_analysis` | CSV 歷史檔 | JSON 指標值 + 訊號 | fetch | report |
| `fundamental_analysis` | 個股代碼 | JSON 本益比/殖利率/淨值比/月營收/獲利能力 | TWSE OpenAPI | report |
| `etf_analysis` | ETF 代碼 | JSON 追蹤指數/保管機構等基本資料 | TWSE OpenAPI | report |
| `day_trading_analysis` | 股票代碼 | JSON 即時快照 + 風控訊號（振幅/區間位置/漲跌停距離/五檔） | TWSE 即時 + OpenAPI | report（選項） |
| `institutional_data` | 個股代碼或大盤日期區間 | 個股/大盤法人籌碼 JSON + CSV | TWSE/TPEX/TDCC | report + ML |
| `prediction_model` | CSV + 大盤 CSV + 參數 | JSON 預測 + 訊號 | fetch + tune | report + backtest |
| `backtest` | CSV + 參數 + 止損設定 | JSON 績效（含 realistic 區塊） | fetch + tune | （CLI 直接看） |
| `tune` | CSV + 大盤 CSV | `models/<code>_best_params.json` | fetch | prediction + backtest |
| `report_generator` | 股票代碼 | 統一格式報告 | 上面全部 | hermes agent |

## 資料流

```
TWSE/TPEX API
     │
     ▼
fetch_stock_data ────► data/<code>_history.csv
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
    technical_analysis   prediction_model   backtest
              │               │
              └───────┬───────┘
                      ▼
              report_generator ───► hermes agent ───► 使用者（白話翻譯）
```

## 設計原則

1. **無 hardcode**：所有腳本只接受 `--code` 參數，可推廣到任何台股代碼
2. **時序嚴格**：walk-forward 切分，訓練集永遠在預測集之前，無未來資料洩漏
3. **失敗自動補救**：抓不到資料 → 自動加大天數重試（見 AGENTS.md「動態決策邏輯」）
4. **白話優先**：agent 層負責把所有數字翻譯成人話，腳本只負責算
5. **可選增強**：Optuna 參數、跨資產特徵都是可選，沒有也能跑
