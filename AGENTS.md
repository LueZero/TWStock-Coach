# TWStock-Coach 工作區規則

## 角色入口

股票任務採一個主代理人與專業子代理人。角色 Markdown 是專案規範，不是自動註冊的 Hermes profile。

- 主代理先讀 [agents/coordinator.md](agents/coordinator.md)，負責需求、分派、協調與最終回覆。
- 子代理只讀本次指定角色與 [agents/contracts.md](agents/contracts.md)，不得套用主代理分派職責或再委派。
- 純程式碼維護不必啟動股票分析團隊；依 [MVC 架構](docs/architecture.md) 處理。

| 角色 | 定義 | 職責 |
|---|---|---|
| 主代理 | [coordinator](agents/coordinator.md) | 需求、分派、整合 |
| 資料 | [market-data](agents/market-data.md) | 代碼、行情、籌碼、補抓與品質 |
| 技術 | [technical](agents/technical.md) | 日線、型態、候選掃描 |
| 基本面 | [fundamental](agents/fundamental.md) | 財務、ETF 與新聞 |
| 預測 | [prediction](agents/prediction.md) | ML 推估與調參 |
| 風控 | [risk](agents/risk.md) | 風險複核與回測 |
| 當沖 | [day-trading](agents/day-trading.md) | 盤中快照、新鮮度、價差與五檔 |

## 共通規則

- 使用繁體中文，數字附來源、日期／時間與單位。行情優先 TWSE/TPEX，其他來源明列，新聞 RSS 不能說成交易所資料。
- 在專案根目錄以專案 Python 執行 `python -m scripts <功能>`。Windows 可用 `.venv/Scripts/python.exe`，Linux/macOS 用 `.venv/bin/python`；子代理也須收到實際絕對路徑。
- 參數查 `python -m scripts --help`／`python -m scripts <功能> --help`，禁止使用已移除的根層轉接腳本。
- 任務產物一律在 `data/`：行情／籌碼 CSV 根層；模型 `data/models/`；報告／圖片 `data/reports/`；回測 `data/backtests/`；暫存／交接 `data/tmp/`；快取 `data/cache/`；日誌 `data/logs/`。重導向、下載、測試產物、備份也適用。
- 相對資料路徑以專案根目錄解析；程式用 `scripts/common/paths.py` 檢查，不得透過 `..` 或符號連結越界。
- 原始碼、角色／技能定義與維護文件留在版控目錄；Hermes 自身設定、登入、記憶及對話留在系統目錄，不重建專案 `.hermes/`。
- 缺資料先依角色規範有限次補救；仍不足回報 partial／blocked，不捏造數值、來源、成功或其他角色的結論。
- 技術訊號、模型機率、回測勝率都不是獲利保證。沒有本次可核實回測，不引用固定「約 60% 勝率」。BUY/HOLD/SELL 是模型輸出，不代替個人決策。
- 股票分析最終回覆附：「⚠️ 以上分析僅供參考，不構成投資建議。」純程式碼維護不套金融報告格式。

## 按需參考

- [交接契約](agents/contracts.md)：任務欄位、結果格式、寫入責任與失敗處理。
- [白話解讀](docs/analysis-language.md)：術語與最終呈現。
- [Hermes 分工操作](docs/agent-guide.md)：啟動、委派範例及驗證。
