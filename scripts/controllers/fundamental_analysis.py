import argparse
from ..views.console import show_json
from ..models.fundamental import FundamentalFetcher, FundamentalAnalyzer


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣上市股票基本面分析（本益比/殖利率/淨值比/月營收/獲利能力）")
    parser.add_argument("--code", required=True, help="股票代碼")
    args = parser.parse_args(argv)

    fetcher = FundamentalFetcher()
    valuation = fetcher.fetch_valuation(args.code)
    monthly_revenue = fetcher.fetch_monthly_revenue(args.code)
    profitability = fetcher.fetch_profitability(args.code)

    analyzer = FundamentalAnalyzer(valuation, monthly_revenue, profitability)
    result = analyzer.analyze()
    show_json(result, ensure_ascii=False, indent=2, default=str)
