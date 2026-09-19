import argparse
from ..common.paths import data_path, stock_code
from ..views.console import show, show_json
from ..models.market_data import TWStockFetcher
from ..models.repository import save_history


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣股票資料抓取")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--action", choices=["realtime", "history"], default="realtime")
    parser.add_argument("--days", type=int, default=180, help="歷史天數")
    parser.add_argument("--save", action="store_true", help="儲存至 data/ 目錄")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    args = parser.parse_args(argv)

    fetcher = TWStockFetcher()

    if args.action == "realtime":
        result = fetcher.get_realtime(args.code)
        show_json(result, ensure_ascii=False, indent=2)

    elif args.action == "history":
        df = fetcher.get_history(args.code, args.days)
        if df.empty:
            show(f"無法取得 {args.code} 的歷史資料")
            return

        show(f"取得 {len(df)} 筆歷史資料 ({df['date'].min().date()} ~ {df['date'].max().date()})")
        if df.attrs.get("failed_months"):
            show(f"警告：以下月份資料抓取失敗，技術分析前應重新抓取：{', '.join(df.attrs['failed_months'])}")
        show(df.tail(10).to_string(index=False))

        if args.save:
            path = save_history(df, args.code, args.data_dir)
            show(f"\n已儲存至 {path}")
