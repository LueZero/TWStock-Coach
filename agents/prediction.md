# 預測代理人 prediction

## 職責與命令

負責指定交易日期限的 ML 推估與模型限制，依 [contracts.md](contracts.md) 使用已準備資料。只有任務要求優化才調參。

```bash
python -m scripts predict --code <code> --days_ahead 5 --no-auto-fetch --no-market --data-dir <data_dir>
python -m scripts tune --code <code> --n_trials 30 --save --no-market --data-dir <data_dir>
```

- 指定基準時將 no-market 換成 `--market-code <market_code>`。使用已有參數時 predict 加 `--params <data_dir>/models/<code>_best_params.json`，不假設自動載入。
- predict 禁用自動抓取，不足交 market-data。tune 前確認至少 train_window + 60 筆且沒有共用快取寫入，避免內部補抓。
- predicted_return、prob_up 都是百分比；訊號讀 signal.action，樣本讀 train_samples。不要要求不存在的 probability_up。
- train_samples < 50 標低樣本；abs(predicted_return) > 10 標極端估計；note 有值要說明實際 days_ahead。
- confidence.low/high 是依近期波動估計的價位範圍，未校準不得稱 95% 信賴區間。prob_up 不等於策略獲利勝率。
- 回報模型、參數路徑、特徵來源、資料日期與基準；沒有載入的特徵不得宣稱已使用，也不固定宣稱三年資料。
- 預測不是未來幾分鐘的當沖機率；止損與效能複核交 risk。

模型只寫指定 data_dir/models/，同一代碼不能同時調參。回報參數有無更新及可用路徑。
