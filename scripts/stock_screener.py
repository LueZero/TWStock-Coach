"""上市股票價格區間與技術面候選掃描器。"""
import argparse
import json
import re
from datetime import datetime, timedelta

import pandas as pd
import requests

try:
    from .fetch_stock_data import TWStockFetcher
    from .technical.controller import TechnicalAnalysisController
except ImportError:
    from fetch_stock_data import TWStockFetcher
    from technical.controller import TechnicalAnalysisController


class TaiwanStockScreener:
    """先以官方收盤行情篩選，再以既有技術規則排序候選股。"""

    TWSE_DAILY_CLOSE = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

    @staticmethod
    def _number(value):
        try:
            return float(str(value).replace(",", ""))
        except (TypeError, ValueError):
            return None

    @classmethod
    def parse_twse_quotes(cls, payload):
        """解析 MI_INDEX 的上市普通股收盤資料，排除 ETF、權證等非四位數標的。"""
        for table in payload.get("tables", []):
            fields = table.get("fields", [])
            if not {"證券代號", "證券名稱", "成交股數", "收盤價"}.issubset(fields):
                continue
            indexes = {field.strip(): index for index, field in enumerate(fields)}
            quotes = []
            for row in table.get("data", []):
                code = str(row[indexes["證券代號"]]).strip()
                close = cls._number(row[indexes["收盤價"]])
                volume = cls._number(row[indexes["成交股數"]])
                if re.fullmatch(r"[1-9]\d{3}", code) and close is not None and volume is not None:
                    quotes.append({
                        "code": code,
                        "name": str(row[indexes["證券名稱"]]).strip(),
                        "screen_close": close,
                        "volume": int(volume),
                    })
            return quotes
        raise ValueError("TWSE 回傳中找不到上市收盤行情資料表")

    def listed_quotes(self, date=None):
        dates = [date] if date else [
            (datetime.now() - timedelta(days=offset)).strftime("%Y%m%d")
            for offset in range(7)
        ]
        last_status = "TWSE 查詢失敗"
        for target_date in dates:
            response = self.session.get(
                self.TWSE_DAILY_CLOSE,
                params={"date": target_date, "type": "ALLBUT0999", "response": "json"},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("stat") == "OK":
                quotes = self.parse_twse_quotes(payload)
                for quote in quotes:
                    quote["quote_date"] = target_date
                return quotes
            last_status = payload.get("stat", last_status)
        raise ValueError(f"最近 7 日找不到可用上市收盤行情：{last_status}")

    def screen(self, min_price, max_price, min_volume, candidate_limit, limit, history_days):
        quotes = [
            quote for quote in self.listed_quotes()
            if min_price <= quote["screen_close"] <= max_price and quote["volume"] >= min_volume
        ]
        quotes.sort(key=lambda quote: quote["volume"], reverse=True)
        fetcher = TWStockFetcher()
        candidates = []
        for quote in quotes[:candidate_limit]:
            history = fetcher.get_history(quote["code"], history_days)
            if len(history) < 60:
                continue
            result = TechnicalAnalysisController(history).analyze()
            summary = result.summary
            if result.overall == "偏空":
                continue
            candidates.append({
                **quote,
                "overall": result.overall,
                "bullish_score": summary["bullish_score"],
                "bearish_score": summary["bearish_score"],
                "market_regime": summary["market_regime"],
                "technical_close": result.indicators["price"],
                "trailing_stop": summary["trailing_stop"].get("price"),
                "signals": [
                    {"category": signal.category, "description": signal.description}
                    for signal in result.signals if signal.direction == "bullish"
                ],
            })
        candidates.sort(key=lambda item: (item["bullish_score"] - item["bearish_score"], item["volume"]), reverse=True)
        for candidate in candidates[:limit]:
            realtime = fetcher.get_realtime(candidate["code"])
            candidate["realtime_close"] = realtime.get("close") if "error" not in realtime else None
            candidate["realtime_time"] = realtime.get("time") if "error" not in realtime else None
            candidate["realtime_error"] = realtime.get("error")
            if candidate["realtime_close"] is not None:
                candidate["realtime_status"] = "available"
                candidate["realtime_change_from_screen_pct"] = round(
                    (candidate["realtime_close"] / candidate["screen_close"] - 1) * 100, 2
                )
            elif candidate["realtime_error"]:
                candidate["realtime_status"] = "unavailable"
            else:
                candidate["realtime_status"] = "no_latest_trade"
                candidate["realtime_note"] = "即時 API 未提供最新成交價，請以 screen_close 作為最近收盤價。"
        return {"scope": "TWSE 上市普通股", "as_of": quotes[0]["quote_date"] if quotes else None, "filters": {"min_price": min_price, "max_price": max_price, "min_volume": min_volume, "history_days": history_days}, "screened_count": len(quotes), "candidates": candidates[:limit], "notice": "screen_close 是篩選用的最近交易日收盤價；realtime_close 是即時 API 回傳價。候選依技術訊號排序，不預測或保證今日上漲金額。"}


def main():
    parser = argparse.ArgumentParser(description="台股上市股票技術面候選掃描")
    parser.add_argument("--min-price", type=float, required=True, help="最低收盤價")
    parser.add_argument("--max-price", type=float, required=True, help="最高收盤價")
    parser.add_argument("--min-volume", type=int, default=1_000_000, help="最低當日成交股數")
    parser.add_argument("--candidate-limit", type=int, default=10, help="先依流動性取前幾檔抓歷史資料")
    parser.add_argument("--limit", type=int, default=5, help="最多輸出候選數")
    parser.add_argument("--history-days", type=int, default=180, help="每檔技術分析的日曆資料天數")
    args = parser.parse_args()
    if args.min_price > args.max_price or min(args.candidate_limit, args.limit, args.history_days) < 1:
        parser.error("價格區間與數量參數必須為有效正值")
    result = TaiwanStockScreener().screen(**vars(args))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()