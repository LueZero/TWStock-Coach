# 參與貢獻

歡迎提出問題、修正與功能建議。提交前請先說明可重現的情境與預期結果，並遵循現有前後端分工。

## 開發環境

在根目錄執行 `npm ci`、`npm run setup`、`docker compose up -d --build`，再執行 `npm run dev`。前端位於5173，API位於8000；詳細設定見 [README](README.md) 與 [架構設計](docs/DESIGN.md#部署與維護)。

## 提交檢查

```sh
npm test
npm run format:check
npm run build
npm run verify
docker compose exec -T api npm run verify:db
npm run verify:browser
```

API驗證需要Compose運行；瀏覽器驗證另需前端開發服務及本機Chrome。純API回歸測試不依賴外部行情來源或資料庫連線。修改前端後，請確認桌面與手機畫面、日期區間、資料缺漏及股票切換。

## Pull Request

請說明變更目的、使用者可見行為、驗證方式，以及資料契約或部署流程是否改變。分析公式須附口徑與缺值處理依據；來源資料不得以推估值填補後冒充正式數值。

請保留股票字串代號、原始／還原價分離、成交量股單位、具時區時間及修訂紀錄。正式訊號只使用完成K線；過往資料可得性不得被現在擷取的資料回填。

請勿提交`.env`、金鑰、私人帳戶資料、資料庫備份、node_modules或dist。第三方程式與資料須保留相應授權及來源聲明。提交貢獻即同意依本專案MIT授權提供該貢獻。
