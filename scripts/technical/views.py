"""技術分析 View：僅負責把結果轉為輸出格式。"""
import json


class TechnicalAnalysisView:
    @staticmethod
    def json(result):
        return json.dumps(result.to_dict(), ensure_ascii=False, indent=2, default=str)

    @staticmethod
    def markdown(result):
        lines = ["## 技術分析", f"- 收盤價: {result.indicators['price']}", f"- 綜合研判: **{result.overall}**", "", "### 訊號判讀"]
        icons = {"bullish": "🟢", "bearish": "🔴", "neutral": "⚪"}
        lines.extend(f"- {icons[signal.direction]} {signal.category}: {signal.description}" for signal in result.signals)
        detected = result.patterns.get("candlesticks", []) + result.patterns.get("chart_patterns", [])
        if detected:
            lines.extend(["", "### 型態候選"])
            lines.extend(f"- {pattern['name']}（{pattern['confidence']} 信心）" for pattern in detected)
        lines.extend(["", f"> {result.patterns.get('notice', '')}"])
        return "\n".join(lines)

    @staticmethod
    def report_section(analysis):
        """Detailed report presentation of the same AnalysisResult."""
        result = analysis.to_dict()
        result["signals"] = [(s.category, s.description, s.direction) for s in analysis.signals]
        report_parts = ["## 技術指標"]
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
        return "\n".join(report_parts)
