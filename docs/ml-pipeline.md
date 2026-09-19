# ML Pipeline 設計

## 模型架構

採用 **XGBoost + LightGBM 雙模型集成 (ensemble)**，同時做：
- **回歸頭**：預測未來 N 天累積報酬率（float）
- **分類頭**：預測未來 N 天漲跌方向（0/1）

兩家模型各訓一組，預測時取平均；分類機率用於訊號判斷的「上漲機率」門檻。

## 特徵工程 (`FeatureEngineer`)

### 基礎價量特徵
- `returns_1/5/10/20` — 多時間尺度報酬
- `volatility_10/20` — 滾動標準差
- `volume_ratio_5/20` — 量能變化
- `high_low_pct` — 日內振幅
- `close_open_pct` — 開收漲跌

### 技術指標（內建計算，不依賴 talib）
- `ma_5/10/20/60` + `price_to_ma_*` — 均線與乖離
- `rsi_14`
- `kd_k`, `kd_d`
- `macd`, `macd_signal`, `macd_hist`
- `bb_upper/middle/lower`, `bb_position` — 布林通道位置

### 跨資產特徵（Phase 3 新增）
從 `data/0050_history.csv` 載入後加入：
- `mkt_returns`, `mkt_ret_5/20` — 大盤多尺度報酬
- `mkt_vol_20` — 大盤波動
- `mkt_above_ma20` — 大盤多空旗
- `rel_strength_1/5/20` — 個股相對大盤強弱
- `mkt_corr_20` — 20 日滾動相關係數

### 自適應視窗
當資料 < 200 筆時，自動縮短特徵視窗（如 `ma_60` → `ma_30`），避免特徵全 NaN。

## 訓練流程 (`StockPredictor`)

```python
predictor = StockPredictor(
    ensemble=True,       # True = XGB+LGB, False = 僅 XGB
    params=best_params,  # Optuna 調出的最佳參數（可選）
)
predictor.train(df, market_df=market_df, days_ahead=5)
result = predictor.predict(df, market_df=market_df)
# result = {
#   "predicted_return": 0.0604,
#   "prob_up": 0.835,
#   "signal": {"action": "BUY", "reason": "...", "threshold": 0.02},
#   "train_samples": 650,
#   ...
# }
```

## Optuna 超參數搜尋 (`tune.py`)

### 搜尋空間（XGB + LGB 合併）
- `n_estimators`: 100-500
- `max_depth`: 3-10
- `learning_rate`: 0.01-0.3
- `subsample`, `colsample_bytree`: 0.6-1.0
- LGB 額外：`num_leaves`, `min_child_samples`

### Objective Score（Phase 3 修正）
```
score = direction_hit - 2.0 * mae
```
- 移除 Sharpe 權重（小樣本易過擬合 sharpe）
- 重視方向命中率 > 報酬大小

### 輸出
存到 `data/models/<code>_best_params.json`，由 `prediction_model` 與 `report_generator` 自動載入。

## 訊號規則 (`_signal`)

```
BUY:  predicted_return > +threshold  AND  prob_up > 0.55
SELL: predicted_return < -threshold  AND  prob_up < 0.45
HOLD: 其他
```

預設 `threshold = 0.02`（即 2%），可由 `params["signal_threshold"]` 覆寫。

## 已知限制

- **小樣本過擬合**：< 200 筆訓練資料時，建議先抓 3 年（`--days 1095`）
- **盤整期較弱**：模型在明顯趨勢時較準，盤整期勝率掉到 50% 附近
- **不預測黑天鵝**：突發新聞、政策、戰爭一律無能為力
- **5 日尺度為主**：訓練目標是 5 天累積報酬，更長期請另訓
