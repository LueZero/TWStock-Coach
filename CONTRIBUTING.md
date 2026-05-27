# 貢獻指南 Contributing Guide

感謝你想為 **台股小教練 TWStock-Coach** 出一份力！🎉

本文件說明如何回報 issue、提交 PR、以及專案的開發規範。

---

## 📋 目錄

- [行為準則](#行為準則)
- [回報 Issue](#回報-issue)
- [提交 Pull Request](#提交-pull-request)
- [開發環境設置](#開發環境設置)
- [程式碼規範](#程式碼規範)
- [Commit 規範](#commit-規範)
- [優先協助項目](#優先協助項目)

---

## 行為準則

請保持友善、尊重不同觀點。本專案採用 [Contributor Covenant](https://www.contributor-covenant.org/) 行為準則。

---

## 回報 Issue

### 提 Issue 前請先確認
1. 搜尋 [現有 Issues](https://github.com/LueZero/TWStock-Coach/issues) 看是否已被回報
2. 確認你用的是最新版（`git pull` 後再試）
3. 如果是 ML 預測「不準」相關 → 請先讀 [docs/ml-pipeline.md](docs/ml-pipeline.md) 的「已知限制」段落

### Issue 模板

#### 🐛 Bug 回報
```markdown
**環境**
- OS: Windows 11 / Ubuntu 22.04 / macOS 14
- Python 版本: 3.11.x
- Hermes Agent 版本: 0.14.x

**重現步驟**
1. 執行 `python scripts/xxx.py --code 2330`
2. ...

**預期行為**


**實際結果（含完整錯誤訊息）**
```

#### 💡 功能建議
```markdown
**想解決的問題**
（為什麼需要這個功能？）

**建議做法**


**替代方案**
```

---

## 提交 Pull Request

### 流程

1. **Fork** 本專案到你的 GitHub
2. **Clone** 你的 fork：
   ```bash
   git clone https://github.com/<your-name>/TWStock-Coach.git
   cd TWStock-Coach
   ```
3. **建分支**（從 `master`）：
   ```bash
   git checkout -b feat/add-ichimoku-indicator
   # 或 fix/, docs/, refactor/, test/
   ```
4. **開發 + 測試**（見下方規範）
5. **Commit**（見 commit 規範）
6. **Push** 到你的 fork：
   ```bash
   git push origin feat/add-ichimoku-indicator
   ```
7. 在 GitHub 開 PR 到 `LueZero/TWStock-Coach:master`

### PR 描述模板
```markdown
## 變更內容
（一句話總結）

## 解決的問題 / 關聯 issue
Closes #123

## 變更類型
- [ ] Bug fix
- [ ] 新功能
- [ ] 文件更新
- [ ] 重構（不改變行為）
- [ ] 效能優化

## 測試方式
- [ ] 已在 2330 / 2317 / 2454 / 2308 上實測
- [ ] 回測 Sharpe 沒退步
- [ ] 新指標有單元測試

## 截圖 / 輸出範例（如有）
```

---

## 開發環境設置

### 安裝
```powershell
# Windows
git clone https://github.com/LueZero/TWStock-Coach.git
cd TWStock-Coach
.\setup.ps1
```

```bash
# Linux/macOS
git clone https://github.com/LueZero/TWStock-Coach.git
cd TWStock-Coach
./setup.sh
```

### 開發前先抓資料
```bash
# 抓 4 檔測試股票的 3 年歷史
for code in 0050 2330 2317 2454 2308; do
  python scripts/fetch_stock_data.py --code $code --days 1095 --save
done
```

### 驗證環境
```bash
python scripts/report_generator.py --code 2330 --days-ahead 5
# 應該看到完整報告輸出
```

---

## 程式碼規範

### Python 風格
- 遵循 [PEP 8](https://peps.python.org/pep-0008/)
- 行寬 100 字元
- 使用 `ruff` 或 `black` 格式化（可選）
- 函式 / 類別命名用 `snake_case` / `PascalCase`

### 腳本設計原則（**重要**）
1. **無 hardcode 股票代碼**：所有腳本必須接受 `--code` 參數
2. **失敗自動補救**：抓不到資料 → 自動加大天數重試，不要直接拋錯
3. **JSON 輸出**：腳本主要結果用 JSON 印到 stdout，方便 agent 解析
4. **時序嚴格**：訓練 / 回測切分必須是時間順序，不可隨機 split
5. **可選增強**：新增 Optuna 參數、跨資產特徵等都要設成可選，沒有也能跑

### 新增腳本檢查清單
- [ ] 接受 `--code <股票代碼>` 參數
- [ ] 輸出 JSON 格式
- [ ] 錯誤訊息有 `error` 欄位
- [ ] 在 `AGENTS.md` 的「可用工具」加上 CLI 範例
- [ ] 在 `docs/architecture.md` 模組職責表加一列

### ML / 回測新功能
- [ ] 在 2330 / 2317 / 2454 / 2308 上實測，Sharpe 不能比 baseline 差太多
- [ ] 更新 [docs/ml-pipeline.md](docs/ml-pipeline.md) 或 [docs/backtest.md](docs/backtest.md)
- [ ] 若改變預設行為，需在 README 「驗證效果」表更新數據

---

## Commit 規範

採用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>: <subject>

<body (optional)>
```

### Type 對照
| Type | 用途 | 範例 |
|------|------|------|
| `feat` | 新功能 | `feat: 加入一目均衡表指標` |
| `fix` | 修 bug | `fix: 修正 KD 指標在資料不足時 NaN` |
| `docs` | 改文件 | `docs: 補充 backtest.md ATR 公式說明` |
| `refactor` | 重構 | `refactor: 抽出特徵工程到 FeatureEngineer` |
| `test` | 加測試 | `test: 加 prediction_model 單元測試` |
| `perf` | 效能優化 | `perf: backtest 預測快取加速 3x` |
| `chore` | 雜項 | `chore: 升級 xgboost 到 2.1.0` |

### Subject 規則
- 用繁體中文 or 英文都可
- 50 字內
- 動詞開頭、現在式
- 不加句點

### 範例
```
feat: 加入 USD/TWD 匯率作為跨資產特徵

- prediction_model._add_market_features 新增匯率欄位
- 在 2330/2317/2454 實測，Sharpe 平均 +0.12
- 更新 docs/ml-pipeline.md 特徵清單
```

---

## 優先協助項目

特別歡迎以下 PR：

### 🎯 高優先
- [ ] **新的技術指標**：一目均衡表、籌碼面（三大法人）、融資融券
- [ ] **更多跨資產特徵**：USD/TWD、美債殖利率、SOX 半導體指數、0052
- [ ] **多檔批次掃描**：一次跑 50 檔，列出當日 BUY 訊號排行
- [ ] **視覺化 dashboard**：streamlit / gradio 介面

### 📚 文件類
- [ ] 英文版 README / docs
- [ ] 影片教學 / GIF demo
- [ ] FAQ 整理
- [ ] 更多白話術語翻譯（補進 AGENTS.md）

### 🧪 測試類
- [ ] 單元測試覆蓋 `scripts/`
- [ ] CI workflow（GitHub Actions）
- [ ] 多檔回測自動化腳本

### 🐛 已知 Issue
查看 [Issues 標籤 good first issue](https://github.com/LueZero/TWStock-Coach/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)。

---

## 不接受的 PR 類型

- ❌ 純粹「炫技」的重構，沒有實際效益
- ❌ 引入大型相依（除非有充分理由，例如 PyTorch）
- ❌ 個股 hardcode（任何只對 2330 有效的特化邏輯）
- ❌ 違反「無未來資料洩漏」原則的「優化」
- ❌ 移除免責聲明或風險提醒

---

## 問題討論

- 💬 [GitHub Discussions](https://github.com/LueZero/TWStock-Coach/discussions)（功能討論）
- 🐛 [Issues](https://github.com/LueZero/TWStock-Coach/issues)（bug / 功能建議）

---

## 致謝

每一位貢獻者都會列在 README 的致謝區與 Release Notes。再次感謝你的投入！🙏
