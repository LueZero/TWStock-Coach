import argparse
from ..common.paths import data_path, stock_code
from ..views.console import show, show_json
from ..models.institutional import InstitutionalFetcher, InstitutionalAnalyzer, summarize_market_institutional
from ..models.repository import load_institutional_df, save_table


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣股票法人籌碼資料")
    parser.add_argument("--code", type=stock_code, help="股票代碼")
    parser.add_argument("--action", choices=["fetch", "analyze", "market"], default="fetch",
                        help="fetch=抓取資料, analyze=分析")
    parser.add_argument("--days", type=int, default=180, help="歷史天數")
    parser.add_argument("--save", action="store_true", help="儲存至 data/ 目錄")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    args = parser.parse_args(argv)

    if args.action in {"fetch", "analyze"} and not args.code:
        parser.error("--code 為 fetch 與 analyze action 的必要參數")

    if args.action == "market":
        fetcher = InstitutionalFetcher()
        show(f"開始抓取 TWSE 大盤三大法人資料（{args.days} 天）...")
        df = fetcher.fetch_market_history(args.days)
        if df.empty:
            show_json({"error": "無法取得 TWSE 大盤法人資料"}, ensure_ascii=False)
            return
        if args.save:
            save_table(df, args.data_dir, "market_institutional.csv")
        show_json(summarize_market_institutional(df), ensure_ascii=False, indent=2, default=str)
        return

    if args.action == "fetch":
        fetcher = InstitutionalFetcher()
        show(f"開始抓取 {args.code} 的籌碼資料（{args.days} 天）...")

        df = fetcher.fetch_history(args.code, args.days)

        if df.empty:
            result = {"error": f"無法取得 {args.code} 的籌碼資料"}
            show_json(result, ensure_ascii=False, indent=2)
            return

        show(f"取得 {len(df)} 筆籌碼資料 ({df['date'].min().date()} ~ {df['date'].max().date()})")

        # 集保分散表（週頻）
        tdcc = fetcher.fetch_tdcc_concentration(args.code)
        if tdcc:
            show(f"集保大戶持股比例: {tdcc['concentration_pct']}%")

        if args.save:
            path = save_table(df, args.data_dir, f"{args.code}_institutional.csv")
            show(f"\n已儲存至 {path}")

        # 輸出最近 5 筆
        show("\n最近 5 日法人籌碼:")
        show(df.tail(5).to_string(index=False))

        result = {
            "code": args.code,
            "records": len(df),
            "date_range": f"{df['date'].min().date()} ~ {df['date'].max().date()}",
            "latest": df.iloc[-1].to_dict() if not df.empty else {},
            "tdcc": tdcc,
        }
        # Convert date to string for JSON
        if "date" in result["latest"]:
            result["latest"]["date"] = str(result["latest"]["date"])
        show_json(result, ensure_ascii=False, indent=2, default=str)

    elif args.action == "analyze":
        # 載入現有資料
        df = load_institutional_df(args.code, args.data_dir)
        if df is None:
            # 嘗試自動抓取
            show(f"未找到 {args.code} 籌碼資料，自動抓取中...")
            fetcher = InstitutionalFetcher()
            df = fetcher.fetch_history(args.code, args.days)
            if df.empty:
                result = {"error": f"無法取得 {args.code} 的籌碼資料"}
                show_json(result, ensure_ascii=False, indent=2)
                return
            # 存檔
            path = save_table(df, args.data_dir, f"{args.code}_institutional.csv")

        analyzer = InstitutionalAnalyzer(df)
        result = analyzer.analyze()
        show_json(result, ensure_ascii=False, indent=2, default=str)
