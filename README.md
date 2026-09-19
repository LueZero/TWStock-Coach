# 台股小教練 TWStock-Coach

> 🎓 用白話教你看懂台股的 AI 助手 — 技術分析 + ML 預測 + 風控教學一站搞定

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

基於 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的台灣股票智能分析助手。
**為金融小白設計**：每個技術指標、每個 ML 預測訊號都會自動翻譯成白話，附上止損建議與風險提醒。

---

## ✨ 主要特色

### 🤖 ML 走勢預測
- **XGBoost + LightGBM 集成模型**，自動加權兩家模型輸出
- **可選跨資產特徵**：使用者可指定市場或產業基準，加入其走勢、相對強弱與波動率
- **Optuna 自動調參**：每檔股票可獨立優化超參數
- **分類 + 回歸雙頭**：同時預測「漲跌方向 + 報酬幅度」
- **Walk-forward 回測**：嚴格時序切分，無未來資料洩漏

### 📊 完整技術分析
- MA / EMA / KD / MACD / RSI / Bollinger / ATR / ADX-DMI / OBV / 量能與支撐壓力
- 多空研判 + 訊號解讀
- 即時報價（TWSE / TPEX 公開 API）
- **價格區間候選掃描**：依收盤價、流動性及既有技術訊號排序 TWSE 上市普通股

### 🛡️ 真實風控
- **ATR 動態止損**：自動依個股波動算合理止損距離（不是固定 5%）
- **真實複利模型**：每筆只用 10% 資金，避免回測「滿倉複利幻覺」
- **訊號門檻過濾**：BUY 需同時滿足「預測報酬 + 上漲機率」雙條件

### 🎓 白話教學模式（特色）
助手會自動把術語翻譯給你聽：

> 🟢 BUY 訊號出現時，助手會說：
> 「模型預測未來 5 天會漲 6%，把握度 83%。建議買進，**止損價設 2162 元**（跌到就無條件賣出）。⚠️ 這是統計推估，勝率約 60%，不要梭哈。」

---

## 🚀 快速開始

### 1. 安裝環境

**Windows (PowerShell)**：
```powershell
git clone https://github.com/LueZero/TWStock-Coach.git
cd TWStock-Coach
.\setup.ps1
```

**Linux / macOS / WSL2**：
```bash
git clone https://github.com/LueZero/TWStock-Coach.git
cd TWStock-Coach
chmod +x setup.sh
./setup.sh
```

### 2. 設定 Hermes 登入與模型

安裝腳本會執行 `hermes setup`；日後也可自行執行以調整登入與模型。
沿用既有 `HERMES_HOME`；未設定時，Windows 使用 `%LOCALAPPDATA%/hermes`，Linux/macOS 使用 `~/.hermes`。
專案不再建立 `.hermes/`，OAuth 登入不必提供 `.env`。
自訂 skills 設定見 [hermes/README.md](hermes/README.md)。

### 3. 啟動助手

```powershell
# Windows
.\run.ps1

# Linux/macOS
./run.sh
```

---

## 💬 使用範例

啟動後直接用自然語言對話：

| 你說 | 助手做什麼 |
|------|-----------|
| 「查台積電即時股價」 | 呼叫 TWSE API，回傳最新報價 |
| 「分析 2330 技術指標」 | 跑趨勢、動能、波動、量價與支撐壓力分析 |
| 「台積電本益比貴不貴」 | 查本益比、殖利率、股價淨值比與月營收 YoY |
| 「0050 追蹤什麼指數」 | 查 ETF 追蹤指數、保管機構等基本資料 |
| 「預測鴻海未來 5 天走勢」 | ML 模型給預測報酬 + 機率 + BUY/HOLD/SELL 訊號 |
| 「產生聯發科完整投資報告」 | 即時報價 + 指標 + ML + ATR 止損價，全部白話翻譯 |
| 「2308 回測一下」 | Walk-forward 回測 + Sharpe / MDD / 勝率 |
| 「調 2454 的參數」 | Optuna 30 trials，存最佳參數到 `data/models/` |

### 進階：直接呼叫腳本

```bash
# 即時報價 + 抓取 3 年歷史
python -m scripts fetch --code 2330 --action history --days 1095 --save

# 技術分析
python -m scripts technical --code 2330 --indicators all

# 基本面分析（本益比/殖利率/淨值比/月營收/獲利能力，上市個股用）
python -m scripts fundamental --code 2330

# ETF 基本資料（追蹤指數/保管機構，不含 NAV 折溢價）
python -m scripts etf --code 0050

# 當沖（當日沖銷）風控參考（需盤中查詢才有意義）
python -m scripts day-trade --code 2330

# 掃描收盤價 25 至 35 元的上市技術面候選
python -m scripts screen --min-price 25 --max-price 35 --min-volume 1000000

# ML 預測（5 日）
python -m scripts predict --code 2330 --days_ahead 5 --model xgboost

# 綜合報告（自動載入 Optuna 最佳參數 + 大盤特徵）
python -m scripts report --code 2330 --days-ahead 5

# Walk-forward 回測（ATR 動態止損 + 真實複利）
python -m scripts backtest --code 2330 --stop-loss-atr 2.0 --position-size 0.1

# Optuna 超參數調校
python -m scripts tune --code 2330 --n_trials 30 --save
```

---

## 📈 驗證效果（4 檔股票實測）

3 年回測（2023-2026），使用 ATR×2 動態止損 + 10% 部位真實複利：

| 股票 | 方向命中率 | Sharpe | MDD | 真實年化報酬 |
|------|-----------|--------|-----|-------------|
| 2330 台積電 | 60.4% | 1.06 | -4.66% | ~6% |
| 2317 鴻海 | 58.7% | 1.46 | -5.10% | ~9% |
| 2454 聯發科 | 61.2% | 1.87 | -4.92% | ~12% |
| 2308 台達電 | 62.1% | 2.86 | -5.23% | ~22% |

> ⚠️ 過去績效不保證未來，模型勝率 56-62%，仍有 38-44% 看錯機率。

---

## 📚 延伸文件

- [docs/architecture.md](docs/architecture.md) — 專案結構與檔案職責
- [docs/ml-pipeline.md](docs/ml-pipeline.md) — ML 模型設計與特徵工程
- [docs/backtest.md](docs/backtest.md) — 回測方法、ATR 止損與複利模型
- [docs/agent-guide.md](docs/agent-guide.md) — Hermes Agent 自訂與互動設計
- [AGENTS.md](AGENTS.md) — Agent 工作區上下文（自動載入給 hermes）

---

## 🛠️ 技術棧

- **Python 3.11+**
- **ML**: XGBoost 2.x, LightGBM 4.x, Optuna 4.x, scikit-learn
- **Data**: pandas, numpy, TWSE/TPEX 公開 API
- **Agent**: [Hermes Agent](https://github.com/NousResearch/hermes-agent)（支援 Copilot / OpenRouter / Anthropic）

---

## 🤝 貢獻

歡迎 PR！請先閱讀 [CONTRIBUTING.md](CONTRIBUTING.md) 了解開發規範。

特別期待：
- 新的技術指標（一目均衡表、籌碼面等）
- 更多跨資產特徵（USD/TWD、美債、半導體 ETF）
- 多檔批次掃描工具
- 視覺化 dashboard

---

## ⚠️ 免責聲明

本專案**僅供教育與研究用途**，不構成任何投資建議。

- 機器學習模型有 35-45% 預測錯誤率
- 過去回測績效不保證未來表現
- 市場黑天鵝（戰爭、政策、突發新聞）無法被模型預測
- 真實交易請設定止損、分散持股、控制部位
- 作者與貢獻者不對任何交易損失負責

---

## 📄 授權

[MIT License](LICENSE) — 自由使用、修改、商用，但須保留版權聲明。

---

## 🙏 致謝

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — 提供穩定的 agent 框架
- TWSE / TPEX — 提供公開股價 API
- XGBoost / LightGBM / Optuna 開源社群

## 專案產出位置

所有任務產物統一存於專案 `data/`：CSV 放根層，模型放 `data/models/`，報告／圖片放 `data/reports/`，回測放 `data/backtests/`，暫存放 `data/tmp/`，快取及日誌放 `data/cache/`、`data/logs/`。腳本路徑不受啟動位置影響，`--data-dir` 僅可指定 `data/` 內的目錄。Hermes 本身的設定與對話仍在系統使用者目錄。

## 統一分析入口

在專案根目錄執行（使用專案 Python 環境）：

```bash
python -m scripts --help
python -m scripts technical --code 2330
python -m scripts report --code 2330
python -m scripts backtest --code 2330
python -m scripts technical --help
```

功能包含 `fetch`、`technical`、`fundamental`、`etf`、`sentiment`、`day-trade`、`screen`、`predict`、`report`、`institutional`、`backtest`、`tune`。原本根層轉接腳本已移除，請改用上述命令。
