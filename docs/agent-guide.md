# Agent 互動設計

## Hermes Agent 設定

### 啟動流程
1. `run.ps1` / `run.sh` 沿用既有 `HERMES_HOME`，否則使用系統使用者預設目錄
2. Hermes 讀取 系統 Hermes 的 `config.yaml`（provider / model / terminal）
3. Hermes **自動載入** `AGENTS.md` 作為工作區上下文
4. 進入對話模式

### 模型選擇（系統 Hermes 的 `config.yaml`）
```yaml
provider: copilot      # 或 openrouter, anthropic
model: gpt-4.1         # 或其他支援的模型
terminal: local        # local（Linux/macOS）/ git-bash（Windows）
```

Windows 使用 PowerShell 啟動，但 hermes 透過 Git Bash 執行腳本。

## AGENTS.md 結構

| 區塊 | 用途 |
|------|------|
| 角色定義 | 告訴 agent 它是台股分析助手 |
| 可用工具 | 列出所有 `scripts/` 腳本與 CLI 範例 |
| 股票代碼對照 | 中文名 → 代碼速查 |
| 工作流程 | 標準對話 → 工具呼叫順序 |
| 動態決策邏輯 | **重點**：腳本失敗時如何自動補救（不要直接丟錯給使用者） |
| 預測流程 | 整合 Phase 1-4 的最佳實踐 |
| 白話解讀指南 | **重點**：所有術語的白話翻譯表 + 回答範本 |

## 白話翻譯設計（核心特色）

### 為什麼需要？
使用者是金融小白，不懂 Sharpe、MDD、KD 是什麼。直接丟 JSON 給他看沒意義。

### 翻譯表（節錄）
| 術語 | 白話 |
|------|------|
| 預測報酬 +6% | 模型猜 5 天後會漲 6% |
| 上漲機率 83% | 模型有 83% 把握會漲 |
| ATR 動態止損 | 跌到 X 元就無條件賣，防止小虧變大虧 |
| Sharpe 1.86 | 報酬與風險的比值不錯（>1 算好） |
| MDD -5% | 歷史上最慘賠 5% 就回血了 |

完整表格見 [AGENTS.md](../AGENTS.md) 的「白話解讀指南」段落。

### 訊號補充範本
當 agent 看到 `🟢 BUY` 訊號，**必須**補一段白話：

> 📌 模型預測 5 天會漲 6%，把握度 83%。建議買進，**止損價設 2162 元**（跌到就賣）。⚠️ 把握度若 < 65%，請只用小部位試水溫。

## 動態決策邏輯（重要）

腳本回傳 JSON 帶 `error` 或 `train_samples` 欄位時，agent **不能直接丟錯給使用者**，而是要自動補救：

| 狀況 | 自動處理 |
|------|---------|
| `error` 含「資料不足」 | 自動 `fetch_stock_data --days 365 → 730 → 1095` 重抓 |
| `train_samples < 50` | 告知信心低，建議參考技術分析 |
| `predicted_return > 10%` | 提醒這是極端值，可能雜訊 |
| KD/MACD NaN | 自動補抓資料重算 |
| API 超時 | 等 2 秒重試一次 |

補救過程用一句話說明，不要長篇大論：
> 「資料不足，自動抓取 730 天重試...」

## 風險提醒（每次都要附）

報告結尾必加：
```
⚠️ 以上分析僅供參考，不構成投資建議。
   模型勝率約 60%，仍有 40% 看錯機率。
```

## 自訂 / 擴充

### 加新股票代碼別名
編輯 `AGENTS.md` 的「股票代碼對照」表格。

### 加新指標解讀
編輯 `AGENTS.md` 的「白話解讀指南」名詞表。

### 換 LLM provider
編輯 系統 Hermes 的 `config.yaml` 的 `provider` + `model` 欄位，並更新 系統 Hermes 的 `.env`。

### 加新工具
1. 在 `scripts/` 新增 Python 腳本（接受 `--code` 參數）
2. 在 `AGENTS.md` 的「可用工具」加上 CLI 範例
3. 重啟 hermes
