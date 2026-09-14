"""台灣股票綜合報告產生器"""
import argparse
import json
import os
import sys
from datetime import datetime

# 加入 scripts 目錄
sys.path.insert(0, os.path.dirname(__file__))

from fetch_stock_data import TWStockFetcher
from technical_analysis import TechnicalAnalyzer, validate_history_code
from prediction_model import StockPredictor, load_market_df
from institutional_data import InstitutionalAnalyzer, load_institutional_df
from sentiment_analysis import NewsSentimentAnalyzer


def generate_report(code: str, days_ahead: int = 5, data_dir: str = "data", market_code: str | None = None) -> str:
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
            if df.attrs.get("failed_months"):
                report_parts.append(
                    f"  ⚠️ 部分月份抓取失敗：{', '.join(df.attrs['failed_months'])}；技術指標可能不完整。"
                )
        else:
            report_parts.append("  ⚠️ 無法取得歷史資料")
        report_parts.append("")

    if has_history:
        import pandas as pd
        df = pd.read_csv(csv_path, parse_dates=["date"], dtype={"stock_code": str})
        try:
            validate_history_code(df, code)
        except ValueError as error:
            report_parts.append(f"## 技術指標\n  ⚠️ 資料驗證失敗: {error}")
            return "\n".join(report_parts)

        report_parts.append("## 技術指標")
        analyzer = TechnicalAnalyzer(df)
        result = analyzer.generate_signals()

        indicators = result["indicators"]
        report_parts.append(f"- 收盤價: {indicators['price']}")
        if indicators.get("data_as_of"):
            report_parts.append(f"- 技術資料截至: {indicators['data_as_of']} 收盤")

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

        cci = indicators.get("cci", {})
        if cci:
            report_parts.append(f"- CCI(20): {cci['CCI']}")

        # Bollinger
        boll = indicators.get("bollinger", {})
        if boll:
            report_parts.append(f"- 布林通道: 上={boll['upper']} 中={boll['middle']} 下={boll['lower']}")

        keltner = indicators.get("keltner", {})
        if keltner:
            report_parts.append(f"- 肯特納通道: 上={keltner['upper']} 中={keltner['middle']} 下={keltner['lower']}")

        atr = indicators.get("atr", {})
        if atr:
            report_parts.append(f"- ATR(14): {atr['ATR']}（日均波動 {atr['ATR_pct']}%）")

        regime = indicators.get("market_regime", {})
        if regime and regime.get("adx") is not None:
            label = "趨勢市" if regime["regime"] == "trending" else "盤整市"
            report_parts.append(f"- 市場狀態: {label}（ADX={regime['adx']}）")

        bias = indicators.get("bias", {})
        if bias:
            report_parts.append(f"- MA{bias['period']} 乖離: {bias['bias_pct']}%（Z={bias['zscore']}）")

        trailing_stop = indicators.get("trailing_stop", {})
        if trailing_stop:
            report_parts.append(
                f"- 持有移動停損: {trailing_stop['price']}（{trailing_stop['basis']}）"
            )

        adx = indicators.get("adx", {})
        if adx and adx.get("ADX") is not None:
            report_parts.append(
                f"- ADX/DMI: ADX={adx['ADX']} | +DI={adx['plus_DI']} | -DI={adx['minus_DI']}"
            )

        obv = indicators.get("obv", {})
        if obv:
            direction = "累積" if obv["OBV_change"] > 0 else ("流出" if obv["OBV_change"] < 0 else "持平")
            report_parts.append(f"- OBV: 近 {obv['period']} 日量能{direction}")

        vr = indicators.get("vr", {})
        if vr and vr["VR"] is not None:
            report_parts.append(f"- VR({vr['period']}): {vr['VR']}")

        support_resistance = indicators.get("support_resistance", {})
        if support_resistance:
            report_parts.append(
                f"- 近 20 日支撐/壓力: {support_resistance['support']} / {support_resistance['resistance']}"
            )

        fibonacci = indicators.get("fibonacci", {})
        if fibonacci:
            report_parts.append(
                f"- Fibonacci(60日): 38.2%={fibonacci['38.2%']} | 50%={fibonacci['50.0%']} | 61.8%={fibonacci['61.8%']}"
            )

        patterns = result.get("patterns", {})
        detected_patterns = patterns.get("candlesticks", []) + patterns.get("chart_patterns", [])
        if detected_patterns:
            report_parts.append("- 型態候選: " + "、".join(pattern["name"] for pattern in detected_patterns))

        # Signals
        report_parts.append(f"\n### 訊號判讀")
        for name, desc, direction in result["signals"]:
            icon = "🟢" if direction == "bullish" else ("🔴" if direction == "bearish" else "⚪")
            report_parts.append(f"  {icon} {name}: {desc}")
        report_parts.append(f"\n**綜合研判: {result['overall']}**")
        report_parts.append("")

        # 2.5 籌碼面分析
        institutional_df = load_institutional_df(code, data_dir)
        if institutional_df is not None and not institutional_df.empty:
            report_parts.append("## 籌碼面分析")
            inst_analyzer = InstitutionalAnalyzer(institutional_df)
            inst_result = inst_analyzer.analyze()

            if "error" not in inst_result:
                summary = inst_result["summary"]
                report_parts.append(f"**綜合籌碼評分: {inst_result['score']}/100 — {summary['overall']}**")
                report_parts.append(f"  {summary['description']}")
                report_parts.append("")

                # 法人動向
                foreign = inst_result["foreign"]
                trust = inst_result["trust"]
                report_parts.append("### 法人動向")
                report_parts.append(f"- 外資: 今日 {foreign['net_today']:+,} 股 | 5日累計 {foreign['net_5d']:+,} | 10日累計 {foreign['net_10d']:+,}")
                if foreign["consecutive_buy_days"] > 0:
                    report_parts.append(f"  → 連續買超 {foreign['consecutive_buy_days']} 天")
                elif foreign["consecutive_sell_days"] > 0:
                    report_parts.append(f"  → 連續賣超 {foreign['consecutive_sell_days']} 天")
                report_parts.append(f"- 投信: 今日 {trust['net_today']:+,} 股 | 5日累計 {trust['net_5d']:+,} | 10日累計 {trust['net_10d']:+,}")
                if trust["consecutive_buy_days"] > 0:
                    report_parts.append(f"  → 連續買超 {trust['consecutive_buy_days']} 天")
                elif trust["consecutive_sell_days"] > 0:
                    report_parts.append(f"  → 連續賣超 {trust['consecutive_sell_days']} 天")

                dealer = inst_result["dealer"]
                report_parts.append(f"- 自營商: 今日 {dealer['net_today']:+,} 股 | 5日累計 {dealer['net_5d']:+,}")
                report_parts.append("")

                # 融資融券
                margin = inst_result.get("margin", {})
                if margin:
                    report_parts.append("### 融資融券")
                    report_parts.append(f"- 融資餘額: {margin.get('margin_balance', 0):,} 張")
                    report_parts.append(f"- 融券餘額: {margin.get('short_balance', 0):,} 張")
                    report_parts.append(f"- 券資比: {margin.get('margin_short_ratio', 0):.2f}%")
                    if margin.get("margin_change_5d_pct", 0) != 0:
                        report_parts.append(f"- 融資 5 日變化: {margin['margin_change_5d_pct']:+.2f}%")
                    report_parts.append("")

                # 籌碼訊號
                if inst_result["signals"]:
                    report_parts.append("### 籌碼訊號")
                    for icon, desc in inst_result["signals"]:
                        report_parts.append(f"  {icon} {desc}")
                    report_parts.append("")
            else:
                report_parts.append(f"  ⚠️ {inst_result['error']}")
                report_parts.append("")

        # 2.6 公開新聞輿情（僅輔助資訊，不納入技術與 ML 訊號）
        report_parts.append("## 公開新聞輿情")
        try:
            sentiment = NewsSentimentAnalyzer().analyze(code, realtime.get("name"), limit=3)
            report_parts.append(f"- 近 {sentiment['window_days']} 日 {sentiment['article_count']} 則：{sentiment['label']}（正面 {sentiment['positive_count']}、負面 {sentiment['negative_count']}）")
            for article in sentiment["articles"]:
                report_parts.append(f"  - [{article['source']}] {article['title']}")
            report_parts.append("- 此為標題關鍵詞統計，不納入技術分數或 ML 預測。")
        except Exception as error:
            report_parts.append(f"- 輿情資料暫時無法取得：{error}")
        report_parts.append("")

        # 3. ML 預測（含 ensemble + 大盤特徵 + 最佳參數 + 籌碼特徵）
        report_parts.append(f"## ML 預測（未來 {days_ahead} 天）")
        market_df = load_market_df(data_dir, market_code)

        params = None
        params_path = os.path.join("models", f"{code}_best_params.json")
        if os.path.exists(params_path):
            with open(params_path, encoding="utf-8") as f:
                params = json.load(f)
            report_parts.append(f"  使用調參數檔: `{params_path}`")

        if market_df is not None:
            report_parts.append(f"  已納入跨資產基準（{market_code}）")

        if institutional_df is not None:
            report_parts.append(f"  已納入法人籌碼特徵（{len(institutional_df)} 筆）")

        predictor = StockPredictor(ensemble=True, params=params)
        pred = predictor.predict(df, days_ahead, market_df=market_df, institutional_df=institutional_df)

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
    parser.add_argument("--market-code", help="可選的大盤或產業基準代碼，例如 0050")
    args = parser.parse_args()

    report = generate_report(args.code, args.days_ahead, args.data_dir, args.market_code)
    print(report)


if __name__ == "__main__":
    main()
