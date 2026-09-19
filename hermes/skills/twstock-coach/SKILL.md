---
name: twstock-coach
description: 台股小教練 — 即時報價、技術分析、ML 預測與白話解讀（搭配本 repo 的 scripts/）
version: 2.0.0
author: TWStock-Coach
platforms: [windows, linux, macos]
metadata:
  hermes:
    tags: [stock, taiwan, twse, ml, technical-analysis]
    category: domain
---

# 台股小教練：角色路由入口

股票報價、技術、基本面、預測、回測、當沖或報告需求時載入。技能只負責導向專案規範，角色責任不在這裡重複維護。

1. 定位使用者指定的 TWStock-Coach 專案根目錄，確認包含 `AGENTS.md`、`agents/`、`scripts/__main__.py`；不是技能安裝目錄或 Hermes home。無法定位才詢問。
2. 讀取該根目錄 `AGENTS.md`。若本次是受委派子任務，只讀指定 `agents/<role>.md` 與 `agents/contracts.md`，不再扮演主代理。
3. 主代理讀 `agents/coordinator.md`，依路由選必要角色並將定義與證據傳給 `delegate_task`。當沖必選 `agents/day-trading.md`，不能以日線／ML 替代。
4. 角色定義使用專案絕對路徑讀取；不要假設在 skill 複製到系統後，相對路徑仍指向專案。這些角色檔不會自動註冊為 profile。
5. 委派工具不可用或單次模式時，依契約循序執行，明示沒有獨立子代理複核。程式報告 `python -m scripts report` 不代表多代理已執行。
6. 在專案根目錄使用專案 Python 與統一 CLI；產物限於專案 `data/`。各角色的實際命令、資料限制及補救規則以角色文件為單一維護來源。
7. 結果按 `docs/analysis-language.md` 白話呈現，附實際資料時間、缺項及分析免責聲明。

## 角色索引（相對於專案根目錄）

| 路徑 | 用途 |
|---|---|
| `agents/coordinator.md` | 分派與最終回覆 |
| `agents/market-data.md` | 行情、籌碼、快取與補抓 |
| `agents/technical.md` | 日線技術與價格候選 |
| `agents/fundamental.md` | 財務、ETF、新聞 |
| `agents/prediction.md` | ML 推估與調參 |
| `agents/risk.md` | 回測與風險複核 |
| `agents/day-trading.md` | 當沖快照與流動性 |
| `agents/contracts.md` | 共用交接契約 |
