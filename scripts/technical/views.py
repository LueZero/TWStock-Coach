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