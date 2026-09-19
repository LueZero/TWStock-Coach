import argparse
from ..common.paths import data_path, stock_code
from ..views.console import show_json
from ..models.backtest import walk_forward_backtest
from ..models.repository import load_params_file, load_market_df
from .history import load_or_fetch


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="Walk-forward 回測")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--days_ahead", type=int, default=5, help="預測天數")
    parser.add_argument("--train_window", type=int, default=120, help="訓練視窗")
    parser.add_argument("--step", type=int, default=5, help="滑動步長")
    parser.add_argument("--cost", type=float, default=0.005, help="單次交易成本")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    parser.add_argument("--params", type=data_path, help="從 JSON 載入優化過的超參數（data/models/<code>_best_params.json）")
    parser.add_argument("--no-ensemble", action="store_true", help="只用 XGBoost（關閉 ensemble）")
    parser.add_argument("--market-code", type=stock_code, default="0050", help="大盤代理代碼（預設 0050）")
    parser.add_argument("--no-market", action="store_true", help="不使用跨資產特徵")
    parser.add_argument("--stop-loss", type=float, default=0.0, help="固定止損幅度（0.05 = 5%%）")
    parser.add_argument("--take-profit", type=float, default=0.0, help="固定止盈幅度（0.08 = 8%%）")
    parser.add_argument("--stop-loss-atr", type=float, default=0.0, help="ATR 動態止損倍數（例 2.0）。設定後覆蓋 --stop-loss")
    parser.add_argument("--position-size", type=float, default=0.1, help="每筆交易資金比例（0.1=10%%）供 realistic 模型使用")
    args = parser.parse_args(argv)

    df = load_or_fetch(args.code, args.data_dir, min_rows=args.train_window + 60)
    if df is None or df.empty:
        show_json({"error": "無法取得歷史資料"}, ensure_ascii=False, indent=2)
        return

    market_df = None if args.no_market else load_market_df(args.data_dir, args.market_code)

    params = load_params_file(args.params)

    result = walk_forward_backtest(
        df, args.days_ahead, args.train_window, args.step, args.cost,
        params=params, ensemble=not args.no_ensemble, market_df=market_df,
        stop_loss=args.stop_loss, take_profit=args.take_profit,
        stop_loss_atr_mult=args.stop_loss_atr, position_size=args.position_size,
    )
    if market_df is not None:
        result["market_features"] = f"已納入大盤代理 {args.market_code}"
    show_json(result, ensure_ascii=False, indent=2)
