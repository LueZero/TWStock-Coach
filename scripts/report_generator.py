"""台灣股票綜合報告產生器"""
import argparse
import json
import os
import sys
from datetime import datetime

# 加入 scripts 目錄
sys.path.insert(0, os.path.dirname(__file__))

from fetch_stock_data import TWStockFetcher
from technical_analysis import TechnicalAnalyzer
from prediction_model import StockPredictor, load_market_df


def generate_report(code: str, days_ahead: int = 5, data_dir: str = "data") -> str:
    """產生完整投資報告"""
    report_parts = []
    report_parts.append(f"# 📊 股票分析報告 - {code}")
    report_parts.append(f"生成時間: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    fetcher = TWStockFetcher()

    # 1. 即時報價
    report_parts.append("## 即時報價")
    realtime = fetcher.get_realtime(code)
    if "error" not in realtime:
        report_parts.append(f"- 股票: {realtime.get('name', code)} ({code})")
        report_parts.append(f"- 開盤: {realtime.get('open', 'N/A')}")
        report_parts.append(f"- 最高: {realtime.get('high', 'N/A')}")
        report_parts.append(f"- 最低: {realtime.get('low', 'N/A')}")
        report_parts.append(f"- 現價: {realtime.get('close', 'N/A')}")
        report_parts.append(f"- 成交量: {realtime.get('volume', 'N/A')}")
        report_parts.append(f"- 昨收: {realtime.get('yesterday_close', 'N/A')}")
    else:
        report_parts.append(f"  ⚠️ {realtime['error']}")
    report_parts.append("")

    # 2. 技術分析
    csv_path = os.path.join(data_dir, f"{code}_history.csv")
    has_history = os.path.exists(csv_path)

    if not has_history:
        report_parts.append("## 歷史資料")
        report_parts.append("正在下載歷史資料...")
        import pandas as pd
        df = fetcher.get_history(code, 365)
        if not df.empty:
            os.makedirs(data_dir, exist_ok=True)
            df.to_csv(csv_path, index=False)
            has_history = True
            report_parts.append(f"  已取得 {len(df)} 筆資料")
        else:
            report_parts.append("  ⚠️ 無法取得歷史資料")
        report_parts.append("")

    if has_history:
        import pandas as pd
        df = pd.read_csv(csv_path, parse_dates=["date"])

        report_parts.append("## 技術指標")
        analyzer = TechnicalAnalyzer(df)
        result = analyzer.generate_signals()

        indicators = result["indicators"]
        report_parts.append(f"- 收盤價: {indicators['price']}")

        # MA
        ma = indicators.get("ma", {})
        if ma:
            ma_str = " | ".join([f"{k}: {v}" for k, v in ma.items()])
            report_parts.append(f"- 移動平均: {ma_str}")

        # KD
        kd = indicators.get("kd", {})
        if kd:
            report_parts.append(f"- KD: K={kd['K']}, D={kd['D']}")

        # MACD
        macd = indicators.get("macd", {})
        if macd:
            report_parts.append(f"- MACD: DIF={macd['DIF']}, SIGNAL={macd['SIGNAL']}, OSC={macd['OSC']}")

        # RSI
        rsi = indicators.get("rsi", {})
        if rsi:
            report_parts.append(f"- RSI(14): {rsi['RSI']}")

        # Bollinger
        boll = indicators.get("bollinger", {})
        if boll:
            report_parts.append(f"- 布林通道: 上={boll['upper']} 中={boll['middle']} 下={boll['lower']}")

        # Signals
        report_parts.append(f"\n### 訊號判讀")
        for name, desc, direction in result["signals"]:
            icon = "🟢" if direction == "bullish" else ("🔴" if direction == "bearish" else "⚪")
            report_parts.append(f"  {icon} {name}: {desc}")
        report_parts.append(f"\n**綜合研判: {result['overall']}**")
        report_parts.append("")

        # 3. ML 預測（含 ensemble + 大盤特徵 + 最佳參數）
        report_parts.append(f"## ML 預測（未來 {days_ahead} 天）")

        params = None
        params_path = os.path.join("models", f"{code}_best_params.json")
        if os.path.exists(params_path):
            with open(params_path, encoding="utf-8") as f:
                params = json.load(f)
            report_parts.append(f"  使用調參數檔: `{params_path}`")

        market_df = load_market_df(data_dir, "0050")
        if market_df is not None:
            report_parts.append("  已納入大盤跨資產特徵（0050）")

        predictor = StockPredictor(ensemble=True, params=params)
        pred = predictor.predict(df, days_ahead, market_df=market_df)

        if "error" not in pred:
            report_parts.append(f"- 模型: {pred['model']}")
            report_parts.append(f"- 現價: {pred['current_price']}")
            report_parts.append(f"- 預測價: {pred['predicted_price']}")
            report_parts.append(f"- 預測報酬: {pred['predicted_return']}%")
            report_parts.append(f"- 上漲機率: {pred.get('prob_up', 'N/A')}%")
            report_parts.append(f"- 方向: {pred['direction']}")
            report_parts.append(f"- 信心區間: {pred['confidence']['low']} ~ {pred['confidence']['high']}")

            # 交易訊號
            signal = pred.get("signal", {})
            if signal:
                icon = {"BUY": "🟢", "SELL": "🔴", "HOLD": "⚪"}.get(signal["action"], "⚪")
                report_parts.append(f"\n### 交易訊號: {icon} **{signal['action']}**")
                report_parts.append(f"  - 理由: {signal['reason']}")

                # 動態止損建議（ATR 2x，Phase 6 實驗最佳組合）
                if signal["action"] == "BUY":
                    current = pred["current_price"]
                    # 計算 ATR(14) %
                    h = df["high"]
                    l = df["low"]
                    c_prev = df["close"].shift(1)
                    tr = pd.concat([h - l, (h - c_prev).abs(), (l - c_prev).abs()], axis=1).max(axis=1)
                    atr14 = float(tr.rolling(14).mean().iloc[-1])
                    atr_pct = atr14 / current
                    dynamic_stop_pct = atr_pct * 2.0
                    # 動態止損限制在 3%~8% 範圍，避免極端值
                    dynamic_stop_pct = max(0.03, min(0.08, dynamic_stop_pct))
                    stop_price = round(current * (1 - dynamic_stop_pct), 2)
                    report_parts.append(
                        f"  - 建議止損價（ATR×2 = {dynamic_stop_pct*100:.2f}%）: **{stop_price}**"
                    )
                    report_parts.append(f"  - ATR(14): {atr14:.2f}（日均波動 {atr_pct*100:.2f}%）")
        else:
            report_parts.append(f"  ⚠️ {pred['error']}")
        report_parts.append("")

    # 免責聲明
    report_parts.append("---")
    report_parts.append("⚠️ 以上分析僅供參考，不構成投資建議。投資有風險，請審慎評估。")

    return "\n".join(report_parts)


def main():
    parser = argparse.ArgumentParser(description="台灣股票綜合報告")
    parser.add_argument("--code", required=True, help="股票代碼")
    parser.add_argument("--days-ahead", type=int, default=5, help="預測天數")
    parser.add_argument("--data-dir", default="data", help="資料目錄")
    args = parser.parse_args()

    report = generate_report(args.code, args.days_ahead, args.data_dir)
    print(report)


if __name__ == "__main__":
    main()
