import argparse
import os
from ..common.paths import data_path, stock_code
from ..views.console import show
from ..models.repository import load_history
from ..technical.controller import TechnicalAnalysisController
from ..technical.views import TechnicalAnalysisView


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣股票技術分析")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--indicators", default="all", help="指標類型")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    args = parser.parse_args(argv)

    # 讀取歷史資料
    csv_path = data_path(args.data_dir, f"{args.code}_history.csv")
    if not os.path.exists(csv_path):
        show(f"找不到歷史資料: {csv_path}")
        show(f"請先執行: python -m scripts fetch --code {args.code} --action history --save")
        return

    try:
        df = load_history(args.code, args.data_dir)
    except ValueError as error:
        show(f"資料驗證失敗: {error}")
        return
    result = TechnicalAnalysisController(df).analyze()
    if args.indicators == "markdown":
        show(TechnicalAnalysisView.markdown(result))
    else:
        show(TechnicalAnalysisView.json(result))
