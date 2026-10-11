# 部署與維護

## Docker Compose

`npm run setup` 建立本機 .env；Compose 自動提供資料庫連線，不需將密碼印出。Docker使用package-lock.json與固定Node.js映像digest，只安裝後端正式依賴，不建置或提供前端。Compose只有postgres、api、scheduler三個服務：

```powershell
docker compose up -d --build --remove-orphans
docker compose ps
npm run verify
docker compose exec -T api npm run verify:db
docker compose exec -T api npm run verify:worker
```

postgres-data卷保留原名。API啟動先執行SQL遷移，使用advisory lock及交易，重啟不重建資料；scheduler等API健康後開始。僅API綁127.0.0.1:8000，資料庫不公開埠。正式對外由主機反向代理提供HTTPS及登入／存取控制。

停止使用的初始化及工具服務已移除，手動操作改為 `docker compose run --rm api node api/cli.js ...`。更新不要執行down -v。Node映像以非root使用者執行，.env不打包。

## 不使用Docker的主機

主機需Node.js 22.16以上（建議24）、PostgreSQL及對外HTTPS。僅提供靜態或PHP空間、無背景程序、無PostgreSQL的虛擬主機無法直接承載此架構。可改用提供Node程序與外部PostgreSQL的方案或支援Compose的VPS。

1. 後端上傳api、package.json、package-lock.json及必要scripts；前端另行部署，不需上傳web至API主機。不要上傳本機node_modules或.env金鑰到公開目錄。
2. 在API部署環境執行 `npm ci --omit=dev --workspaces=false`，只安裝後端正式依賴。
3. 由主機密鑰設定DATABASE_URL，例如postgresql://帳號:URL編碼密碼@資料庫主機:5432/stock；使用主機規定的TLS設定。另設INGEST_API_KEY、來源設定、PORT與HOST。
4. 啟動 `node api/index.js`，另以程序管理器啟動 `node api/cli.js schedule`。程序需可自動重啟及接收SIGTERM。
5. 若主機只准一個Node程序，可設定RUN_WORKER=true；API會同時消費佇列與定時更新。多個API仍由資料庫鎖限制一個消費者，但標準Compose採分離方式。
6. 主機需保留工作及PostgreSQL資料，不能只依賴程序記憶體。

`process.loadEnvFile`會讀取本機.env；作業平台直接注入的環境變數優先。PORT預設8000、HOST預設0.0.0.0。不用Docker時務必設定DATABASE_URL，預設本機連線只用於開發。

## 資料備份

由備份程序使用PostgreSQL的pg_dump自訂格式輸出，保留所有資料表、序列及修訂。Windows範例讓容器直接寫二進位檔，避免PowerShell文字管線破壞備份：

```powershell
docker compose exec -T postgres pg_dump -U stock -d stock -Fc -f /tmp/stock.backup
docker compose cp postgres:/tmp/stock.backup ./stock.backup
```

備份檔包含完整分析資料，保存於專用非公開目錄；不要提交版本控制。還原先在隔離資料庫演練，確認行情筆數、快照修訂、時間戳、API與圖表；正式替換資料庫須停寫並另安排維護。平台此處未自動執行正式還原或刪除資料卷。

## 日誌與工作

```powershell
docker compose logs --tail 100 api scheduler
docker compose exec -T api node -e "fetch('http://localhost:8000/api/jobs').then(r=>r.json()).then(console.log)"
```

工作心跳每30秒，正常重啟後可恢復中斷Node工作，執行3次後中斷則失敗。已完成工作不因重啟重跑；定時更新可建立新修訂。訊號SIGTERM會停止接新工作、結束正在處理的來源請求並關閉連線池，Compose預留60秒。來源需權限或網路失敗會記錄到工作，不輸出授權Token。

`/health` 只驗證API與資料庫連線，不代表資料來源或scheduler健康。`docker compose ps` 的scheduler「Up」只代表程序存活；另檢查 `/api/jobs` 的status、heartbeat_at、attempts、priority及日誌。queued 沒有執行心跳是正常的，不能因等待很久而判定失敗。正在執行工作的心跳長時間停止時，先檢查程序／資料庫，不手動把仍由消費者持有的工作改成失敗。

`verify:worker` 唯讀核對目前schema有1個排程鎖持有者、running心跳不超過120秒，列出待處理數量與等待時間；沒有running工作時只核對鎖。這是維護檢查，不是獨立的worker健康端點，也不代表外部來源必定可用。

`verify:db` 建立專用隨機 `stock_audit_*` schema，測試完成後只刪除此schema，不清空既有資料表；執行者需有CREATE／DROP SCHEMA權限。容器測試使用既有Compose資料庫連線，本機若自行執行需提供有效DATABASE_URL，Compose的PostgreSQL預設未公開本機埠。中斷測試可能留下測試schema，應核對名稱與內容後再由管理者清理。

依賴更新流程：修改套件、更新package-lock、npm audit、npm test、隔離資料庫測試、瀏覽器驗證，再重建映像。映像digest需要定期更新，不能把固定版本視為永久維護完成。

## 前端開發與預覽

Compose後端運行時，於根目錄執行 `npm run dev`，開啟http://127.0.0.1:5173；亦可在web目錄執行相同指令。Vite代理API至8000，開發時不必重建容器才看見前端變更。若API不在預設位址，透過環境變數API_PROXY_TARGET指定完整HTTP(S)網址。

`npm run build` 建置至web/dist，`npm run preview` 在4173預覽；preview不是正式服務程序。API的8000根路徑只提供JSON服務資訊，看盤頁在5173或4173。前端更新不需重建API容器。

API_PROXY_TARGET由啟動Vite的程序環境讀取，修改後需重啟；根目錄.env不會自動提供這項Vite設定。PowerShell範例：

```powershell
$env:API_PROXY_TARGET = "http://127.0.0.1:8000"
npm run dev
```

## 獨立部署前端

建置環境執行 `npm ci` 與 `npm run build`，將完整web/dist部署到靜態網站服務。正式前端不需Node背景程序，但網站服務需把 `/api/`、`/docs`、`/health` 與 `/openapi.json` 代理至API；前端使用同源相對網址，單純上傳到不支援代理的靜態空間仍無法連接後端。

Nginx範例位於 [web/deploy/nginx.conf](../web/deploy/nginx.conf)，請調整server_name、root與proxy_pass上游位址，並由主機提供HTTPS。上游請保留完整路徑與查詢參數。範例假設Nginx與API同主機；不同主機需自行配置可達的可信網路。

替換前端dist時應以完整版本切換，避免HTML指向缺少的雜湊資源。API不再託管web、images或工作台HTML；`/docs`仍保留API文件介面。正式發布前需在實際主機驗證代理、HTTPS、登入／存取控制及備份；本機Vite preview僅用於建置檢查。
