import argparse
from ..views.console import show_json
from ..models.quotes import ListedQuotesFetcher
from ..models.market_data import TWStockFetcher
from ..technical.controller import TechnicalAnalysisController


class TaiwanStockScreener(ListedQuotesFetcher):
    def screen(self, min_price, max_price, min_volume, candidate_limit, limit, history_days, direction):
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
            if direction == "bullish" and result.overall == "偏空":
                continue
            if direction == "bearish" and result.overall != "偏空":
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
                    for signal in result.signals
                    if direction == "both" or signal.direction == direction
                ],
            })
        score_key = (
            lambda item: (item["bearish_score"] - item["bullish_score"], item["volume"])
            if direction == "bearish"
            else (item["bullish_score"] - item["bearish_score"], item["volume"])
        )
        candidates.sort(key=score_key, reverse=True)
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
        return {"scope": "TWSE 上市普通股", "as_of": quotes[0]["quote_date"] if quotes else None, "filters": {"min_price": min_price, "max_price": max_price, "min_volume": min_volume, "history_days": history_days, "direction": direction}, "screened_count": len(quotes), "candidates": candidates[:limit], "notice": "screen_close 是篩選用的最近交易日收盤價；realtime_close 是即時 API 回傳價。候選依技術訊號排序，不預測或保證今日上漲或下跌金額。"}


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台股上市股票技術面候選掃描")
    parser.add_argument("--min-price", type=float, required=True, help="最低收盤價")
    parser.add_argument("--max-price", type=float, required=True, help="最高收盤價")
    parser.add_argument("--min-volume", type=int, default=1_000_000, help="最低當日成交股數")
    parser.add_argument("--candidate-limit", type=int, default=10, help="先依流動性取前幾檔抓歷史資料")
    parser.add_argument("--limit", type=int, default=5, help="最多輸出候選數")
    parser.add_argument("--history-days", type=int, default=180, help="每檔技術分析的日曆資料天數")
    parser.add_argument("--direction", choices=("bullish", "bearish", "both"), default="bullish", help="篩選偏多、偏空或全部技術面候選")
    args = parser.parse_args(argv)
    if args.min_price > args.max_price or min(args.candidate_limit, args.limit, args.history_days) < 1:
        parser.error("價格區間與數量參數必須為有效正值")
    result = TaiwanStockScreener().screen(**vars(args))
    show_json(result, ensure_ascii=False, indent=2)
