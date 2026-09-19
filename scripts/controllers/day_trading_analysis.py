import argparse
from ..views.console import show_json
from ..models.day_trading import DayTradingFetcher, DayTradingAnalyzer


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣股票當沖（當日沖銷）風控參考分析")
    parser.add_argument("--code", required=True, help="股票代碼")
    args = parser.parse_args(argv)

    fetcher = DayTradingFetcher()
    snapshot = fetcher.fetch_snapshot(args.code)
    if snapshot is None:
        show_json({"error": f"找不到股票代碼 {args.code} 的即時報價"}, ensure_ascii=False)
        return

    eligibility = fetcher.fetch_daytrade_eligibility(args.code)
    result = DayTradingAnalyzer(snapshot, eligibility).analyze()
    result["snapshot"] = snapshot
    show_json(result, ensure_ascii=False, indent=2, default=str)
