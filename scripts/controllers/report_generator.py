"""Collect report data and coordinate analyses; formatting is delegated to Views."""
import argparse
from datetime import datetime
import math

from ..common.paths import data_path, stock_code
from ..models.report import ReportData
from ..models.market_data import TWStockFetcher
from ..models.repository import load_history, save_history, load_market_df, load_institutional_df, load_params
from ..models.prediction import StockPredictor
from ..models.institutional import InstitutionalAnalyzer
from ..models.fundamental import FundamentalFetcher, FundamentalAnalyzer
from ..models.day_trading import DayTradingFetcher, DayTradingAnalyzer
from ..models.sentiment import NewsSentimentAnalyzer
from ..technical.controller import TechnicalAnalysisController
from ..technical.indicators import IndicatorCalculator
from ..views.console import show
from ..views.report import render_report
from . import etf_analysis


def build_report(code: str, days_ahead: int = 5, data_dir: str = "data",
                 market_code: str | None = None, include_daytrade: bool = False) -> ReportData:
    data_dir, code = data_path(data_dir), stock_code(code)
    if market_code is not None:
        market_code = stock_code(market_code)
    report = ReportData(code, days_ahead, datetime.now().strftime("%Y-%m-%d %H:%M"))
    fetcher = TWStockFetcher()
    report.realtime = fetcher.get_realtime(code)

    if include_daytrade:
        try:
            daytrade = DayTradingFetcher()
            snapshot = daytrade.fetch_snapshot(code)
            report.daytrade = (DayTradingAnalyzer(snapshot, daytrade.fetch_daytrade_eligibility(code)).analyze()
                               if snapshot is not None else {"error": f"找不到 {code} 的即時報價，無法做當沖快照"})
        except Exception as error:
            report.daytrade = {"error": f"當沖快照暫時無法取得：{error}"}

    try:
        df = load_history(code, data_dir)
        if df is None:
            df = fetcher.get_history(code, 365)
            report.history = {"downloaded": True, "rows": len(df), "failed_months": df.attrs.get("failed_months", [])}
            if not df.empty:
                save_history(df, code, data_dir)
        if df.empty:
            report.history["error"] = "無法取得歷史資料"
            return report
        report.technical = TechnicalAnalysisController(df).analyze()
    except ValueError as error:
        report.technical_error = f"資料驗證失敗: {error}"
        return report

    institutional_df = load_institutional_df(code, data_dir)
    if institutional_df is not None and not institutional_df.empty:
        report.institutional = InstitutionalAnalyzer(institutional_df).analyze()
    if institutional_df is not None:
        report.institutional_rows = len(institutional_df)

    report.etf = etf_analysis.analyze(code)
    if "error" in report.etf:
        report.etf = None
        try:
            fundamentals = FundamentalFetcher()
            report.fundamental = FundamentalAnalyzer(
                fundamentals.fetch_valuation(code), fundamentals.fetch_monthly_revenue(code),
                fundamentals.fetch_profitability(code),
            ).analyze()
        except Exception as error:
            report.fundamental = {"error": f"基本面資料暫時無法取得：{error}"}
    try:
        report.sentiment = NewsSentimentAnalyzer().analyze(code, report.realtime.get("name"), limit=3)
    except Exception as error:
        report.sentiment = {"error": f"輿情資料暫時無法取得：{error}"}

    market_df = load_market_df(data_dir, market_code)
    if market_df is not None:
        report.market_code = market_code
    params, report.params_path = load_params(code, data_dir)
    report.prediction = StockPredictor(ensemble=True, params=params).predict(
        df, days_ahead, market_df=market_df, institutional_df=institutional_df,
    )
    if report.prediction.get("signal", {}).get("action") == "BUY":
        # Reuse the documented Wilder ATR Model, instead of a second rolling ATR.
        atr = IndicatorCalculator(df).atr_series(14).iloc[-1]
        current = report.prediction["current_price"]
        if current > 0 and math.isfinite(atr):
            stop_pct = max(0.03, min(0.08, atr / current * 2))
            report.risk = {"atr": float(atr), "atr_pct": atr / current * 100,
                           "stop_pct": stop_pct * 100, "stop_price": round(current * (1 - stop_pct), 2)}
    return report


def generate_report(code: str, days_ahead: int = 5, data_dir: str = "data",
                    market_code: str | None = None, include_daytrade: bool = False) -> str:
    return render_report(build_report(code, days_ahead, data_dir, market_code, include_daytrade))


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣股票綜合報告")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--days-ahead", type=int, default=5, help="預測天數")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄")
    parser.add_argument("--market-code", type=stock_code, default=None, help="選用跨資產基準（預設不使用）")
    parser.add_argument("--day-trade", action="store_true", help="加入當沖即時快照")
    args = parser.parse_args(argv)
    show(generate_report(args.code, args.days_ahead, args.data_dir, args.market_code, args.day_trade))
