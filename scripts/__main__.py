"""Single CLI entry point: python -m scripts <command> [options]."""
import argparse
from importlib import import_module


COMMANDS = {
    "fetch": ("fetch_stock_data", "即時報價與歷史資料"),
    "technical": ("technical_analysis", "技術指標與訊號"),
    "fundamental": ("fundamental_analysis", "基本面與價值分析"),
    "etf": ("etf_analysis", "ETF 基本資料"),
    "sentiment": ("sentiment_analysis", "公開新聞輿情"),
    "day-trade": ("day_trading_analysis", "當沖即時快照"),
    "screen": ("stock_screener", "價格區間候選掃描"),
    "predict": ("prediction_model", "ML 走勢預測"),
    "report": ("report_generator", "綜合分析報告"),
    "institutional": ("institutional_data", "個股與大盤法人籌碼"),
    "backtest": ("backtest", "Walk-forward 回測"),
    "tune": ("tune", "Optuna 超參數調校"),
}


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m scripts",
        description="台股小教練：統一分析入口（請在專案根目錄執行）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="功能：\n" + "\n".join(f"  {name:14} {description}" for name, (_, description) in COMMANDS.items())
        + "\n\n使用 python -m scripts <功能> --help 查看該功能參數。",
    )
    parser.add_argument("command", nargs="?", choices=COMMANDS, help="分析功能")
    parser.add_argument("arguments", nargs=argparse.REMAINDER, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    module_name, _ = COMMANDS[args.command]
    controller = import_module(f"scripts.controllers.{module_name}")
    return controller.main(args.arguments, prog=f"{parser.prog} {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
