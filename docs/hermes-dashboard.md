# 使用 Hermes 內建網頁 Chat

本專案沿用 Hermes 官方 Dashboard 的 Chat，角色仍由 `AGENTS.md` → `agents/coordinator.md` → 指定角色定義。無須另建股票網站或把七個角色註冊為七個 profile。

## 啟動

在專案根目錄執行：

```powershell
.\run.ps1 -Dashboard
# 指定連接埠，不自動開瀏覽器
.\run.ps1 -Dashboard -Port 9119 -NoOpen
```

Linux/macOS：`./run.sh --dashboard --port 9119`。

開啟 <http://127.0.0.1:9119/chat>。結束前景服務可按 Ctrl+C；若已在背景執行，可先查 `hermes dashboard --status`，確認只有本次 Dashboard 後使用 `hermes dashboard --stop`（此命令會停掉所有 Hermes Dashboard，並非單一專案）。

如果 Chat 顯示 `No inference provider configured`，代表網頁可用但尚未設定模型供應商。請在 Dashboard 的 **Keys／Models** 設定，或執行 `hermes model` 完成自己的 API／OAuth 登入，再建立新對話。不要把 API Key 貼入聊天或提交到 Git。

啟動器切換到專案根目錄，設定本次程序的 `HERMES_CWD`、`TERMINAL_CWD` 及 `HERMES_TUI_TOOLSETS=terminal,skills,web,delegation`。保留既有 Hermes home、登入與模型設定，所有分析產物仍在專案 `data/`。Dashboard 使用 TUI gateway，因此工具集不能只靠 `hermes chat -t`。

本機 Windows 登錄表把 `.js` 關聯成 `text/plain`，會導致瀏覽器拒絕執行 Dashboard。啟動器只對本次程序加入 `hermes/dashboard_runtime` 的 Python 啟動修正，將 JS／CSS／WASM MIME 設為標準值，不修改登錄表或 Hermes 原始碼。

若系統／所選 profile 的 `terminal.cwd` 已固定為其他專案，或恢復了另一個專案的舊對話，其設定／對話 cwd 可能優先；請在 Chat 建立新對話並核對工作目錄。不要沿用不明來源的舊 session。預期目錄為 `D:/AI/TWStock-Coach`。

## 在 Chat 提問

例如：「使用本專案既有 0050 日線做技術分析，附趨勢圖，不重抓行情。」或「分析 2330 當沖快照，說明報價時間與風險」。主代理依需求選擇既有角色；當沖使用 day-trading，日線圖不替代盤中資料。

初次可要求確認：

> 請確認目前工作目錄，讀取 AGENTS.md 與 agents/coordinator.md，列出本次可用的角色定義及 Python 路徑。暫不抓行情、不執行股票分析。

系統技能目錄須包含本專案 `hermes/skills`（既有設定在 `%LOCALAPPDATA%/hermes/config.yaml` 的 `skills.external_dirs`）。角色檔是 prompt 規範，並非工具層隔離。只有實際收到 `delegate_task` 子任務結果才能稱為已完成多代理人複核。

## 趨勢圖輸出

```powershell
.venv/Scripts/python.exe -B -m scripts technical --code 0050 --chart
.venv/Scripts/python.exe -B -m scripts technical --code 0050 --chart --chart-bars 180 --indicators markdown
```

這些命令只讀已存日線，不查 API。PNG 包含收盤價、MA5／10／20／60、成交量與資料截至日；均線使用完整資料計算後再顯示最近筆數。預設 120 筆，可設 20–1000。`data/reports/` 保存 PNG 與引用同目錄圖片的 Markdown；每次檔名不同，保留各次結果。

JSON 額外回傳 `artifacts.chart_png`、`artifacts.report_markdown`、`artifacts.data_as_of` 及 `chart_bars`。未加 `--chart` 時維持既有 JSON 格式，也不產圖。Matplotlib 字型快取在 `data/cache/matplotlib/`；沒有可用中文字型的系統使用英文圖例。

**Chat 是終端式畫面，不是一般網頁 Markdown 圖片聊天室。** 不保證回覆中的 PNG 直接內嵌。主代理應附可辨識的圖檔路徑；在 Dashboard **Files** 進入 `D:/AI/TWStock-Coach/data/reports/` 可下載圖片，或用本機圖片檢視器開啟。不要把檔案搬到系統 Hermes 目錄、把憑證放進回覆連結，或架設額外公開圖床。

## 相容性

[官方 Dashboard 文件](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard) 說明 Chat 為 TUI／PTY。文件仍提到 native Windows 不支援，但此機已安裝版本的 `hermes_cli/web_server.py` 已選用 `win_pty_bridge.WinPtyBridge` 與 pywinpty／ConPTY；以實際安裝版本及啟動測試為準。缺套件時應安裝官方 web／pty extras，不直接假定必須改用 WSL。

Dashboard 前端由 Hermes 的 `web` 目錄建置，Chat 由 `ui-tui` 建置；它們屬於系統 Hermes 安裝，不放進本專案。更新 Hermes 後若產生前端不相容，先確認官方版本與建置結果，再啟動 Chat。
