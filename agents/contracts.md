# 代理人交接契約

## 委派輸入

主代理人交付 `task_id`、`role`、`goal`、`project_root`、`python`、`code`（大盤任務可空）、`horizon`（當沖／日線／N 個交易日）、`requested_at`（含 Asia/Taipei）、`data_dir`、上游證據、`output_dir`、允許命令與寫入範圍。

- 傳入角色定義、共通規則與契約的必要內容；不要只說「照剛才分析」。子代理人沒有完整主對話。
- `output_dir` 是 `data/tmp/agents/<task_id>/<role>/` 的絕對路徑，先建立目錄。task_id 只用英數、連字號或底線，不接受路徑片段。
- 每名角色使用同一個指定 `data_dir`。`market_code` 明確為代碼或 null；null 時 predict/backtest/tune 加 `--no-market`，report 不傳 `--market-code`。前三個命令省略選項會預設使用 0050。

## 子代理人回報

回傳以下 JSON；需保存時寫到自己的 `output_dir/result.json`。範例不是實際分析結果。

```json
{
  "task_id": "example",
  "role": "technical",
  "status": "ok",
  "code": "2330",
  "horizon": "daily",
  "as_of": null,
  "summary": "白話結論",
  "evidence": [],
  "findings": [],
  "artifacts": [],
  "limitations": [],
  "requests": []
}
```

- status 為 ok／partial／blocked；ok 代表指定任務有足夠依據，不代表看多或保證正確。
- as_of 填實際資料時間，不知道用 null 並說明；不能以查詢時間代替行情時間。
- evidence 每項列來源 URL 或檔案絕對路徑、實際命令、查詢時間、資料截至時間；數值附原欄位、單位。
- artifacts 只列已存在的檔案。stdout 可能混有進度文字與 JSON，須辨識完整 JSON；同時檢查退出碼、stderr 與 error 欄位。
- requests 列缺資料、要交接的角色與理由，由主代理安排。子代理人不得再委派或自行擴張職責。

## 寫入與執行順序

- market-data 是共用行情／籌碼快取唯一寫入者；其他角色只讀。`institutional --action analyze` 缺檔會補抓，也屬資料角色。
- prediction 可寫指定模型子目錄；同一資料目錄與代碼不可並行調參。predict 加 `--no-auto-fetch`。
- backtest/tune 內部可能補抓；執行前資料角色須確認至少 `train_window + 60` 筆，且該階段無其他共用快取寫入，不足就不啟動。
- screen 會抓候選日 K，但不寫共用快取，technical 可執行。
- 每名子代理只寫自己的交接目錄；正式報告由主代理整理到 `data/reports/`，回測明細由 risk 寫到 `data/backtests/<task_id>/`。
- 非同步委派先收完成通知再做相依工作；dispatch handle 不是分析結果。不重複輪詢交接檔推測完成。
- 子任務失敗／超時只針對缺項重派一次；仍失敗就標缺項，不重啟整批。資料補抓依 market-data 的有限階梯執行。
- 委派工具不可用時，主代理可按角色規範循序處理，但須明示單代理人執行，不虛稱獨立複核。
