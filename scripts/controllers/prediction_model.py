import argparse
import os
from ..common.paths import data_path, stock_code
from ..views.console import show, show_json
from ..models.prediction import StockPredictor
from ..models.repository import load_params_file, load_market_df, load_institutional_df, load_history
from .history import load_or_fetch


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣股票 ML 預測")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--days_ahead", type=int, default=5, help="預測天數")
    parser.add_argument("--model", default="xgboost", help="模型類型")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    parser.add_argument("--auto-fetch", action="store_true", default=True, help="資料不足時自動抓取（預設開啟）")
    parser.add_argument("--no-auto-fetch", dest="auto_fetch", action="store_false", help="關閉自動抓取")
    parser.add_argument("--market-code", type=stock_code, default="0050", help="大盤代理代碼（預設 0050）")
    parser.add_argument("--no-market", action="store_true", help="不使用跨資產特徵")
    parser.add_argument("--params", type=data_path, help="載入優化參數 JSON")
    args = parser.parse_args(argv)

    csv_path = data_path(args.data_dir, f"{args.code}_history.csv")

    if args.auto_fetch:
        df = load_or_fetch(args.code, args.data_dir)
    else:
        if not os.path.exists(csv_path):
            show(f"找不到歷史資料: {csv_path}")
            show(f"請先執行: python -m scripts fetch --code {args.code} --action history --save")
            return
        df = load_history(args.code, args.data_dir)

    if df is None or df.empty:
        show_json({"error": "無法取得任何歷史資料"}, ensure_ascii=False, indent=2)
        return

    market_df = None if args.no_market else load_market_df(args.data_dir, args.market_code)

    # 載入籌碼資料（若存在）
    institutional_df = load_institutional_df(args.code, args.data_dir)

    params = load_params_file(args.params)

    predictor = StockPredictor(params=params)
    result = predictor.predict(df, args.days_ahead, market_df=market_df, institutional_df=institutional_df)
    if market_df is not None:
        result["market_features"] = f"已納入大盤代理 {args.market_code}"
    if institutional_df is not None:
        result["institutional_features"] = f"已納入籌碼特徵（{len(institutional_df)} 筆）"

    show_json(result, ensure_ascii=False, indent=2)
