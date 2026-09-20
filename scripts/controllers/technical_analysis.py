import argparse
import os
import json
from pathlib import Path
from uuid import uuid4
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
    parser.add_argument("--chart", action="store_true", help="產出日線趨勢 PNG 與 Markdown 報告到 data/reports/")
    parser.add_argument("--chart-bars", type=int, default=120, help="圖表顯示最近幾筆日線（20–1000；預設 120）")
    args = parser.parse_args(argv)
    if not 20 <= args.chart_bars <= 1000:
        parser.error("--chart-bars 須介於 20 至 1000")

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
    controller = TechnicalAnalysisController(df)
    result = controller.analyze()
    artifacts = None
    if args.chart:
        from ..technical.chart_view import TrendChartView
        chart = controller.trend_chart(args.code, result, args.chart_bars)
        stem = f"{args.code}_technical_{chart.dates[-1]}_{uuid4().hex[:10]}"
        chart_path = TrendChartView.png(chart, data_path("data/reports", stem + ".png"))
        report_path = Path(data_path("data/reports", stem + ".md"))
        markdown = TrendChartView.markdown(chart, result, Path(chart_path).name)
        report_path.write_text(markdown, encoding="utf-8")
        artifacts = {"chart_png": chart_path, "report_markdown": str(report_path),
                     "data_as_of": chart.dates[-1], "chart_bars": len(chart.dates)}
    if args.indicators == "markdown":
        show(TechnicalAnalysisView.markdown(result))
        if artifacts:
            show(f"\n趨勢圖：{artifacts['chart_png']}\n完整 Markdown：{artifacts['report_markdown']}")
    else:
        payload = result.to_dict()
        if artifacts:
            payload["artifacts"] = artifacts
        show(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
