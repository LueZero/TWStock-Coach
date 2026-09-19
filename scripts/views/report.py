"""Report View: render collected data without network, files, or trading rules."""
from ..technical.views import TechnicalAnalysisView

DISCLAIMER = "⚠️ 以上分析僅供參考，不構成投資建議。投資有風險，請審慎評估。"


def render_realtime(code, realtime):
    report_parts = ["## 即時報價"]
    if "error" not in realtime:
        report_parts.append(f"- 股票: {realtime.get('name', code)} ({code})")
        report_parts.append(f"- 開盤: {realtime.get('open', 'N/A')}")
        report_parts.append(f"- 最高: {realtime.get('high', 'N/A')}")
        report_parts.append(f"- 最低: {realtime.get('low', 'N/A')}")
        report_parts.append(f"- 現價: {realtime.get('close', 'N/A')}")
        report_parts.append(f"- 成交量: {realtime.get('volume', 'N/A')}")
        report_parts.append(f"- 昨收: {realtime.get('yesterday_close', 'N/A')}")
    else:
        report_parts.append(f"  ⚠️ {realtime['error']}")
    report_parts.append("")
    return "\n".join(report_parts)


def render_institutional(inst_result):
    report_parts = ["## 籌碼面分析"]
    if "error" not in inst_result:
        summary = inst_result["summary"]
        report_parts.append(f"**綜合籌碼評分: {inst_result['score']}/100 — {summary['overall']}**")
        report_parts.append(f"  {summary['description']}")
        report_parts.append("")

        # 法人動向
        foreign = inst_result["foreign"]
        trust = inst_result["trust"]
        report_parts.append("### 法人動向")
        report_parts.append(f"- 外資: 今日 {foreign['net_today']:+,} 股 | 5日累計 {foreign['net_5d']:+,} | 10日累計 {foreign['net_10d']:+,}")
        if foreign["consecutive_buy_days"] > 0:
            report_parts.append(f"  → 連續買超 {foreign['consecutive_buy_days']} 天")
        elif foreign["consecutive_sell_days"] > 0:
            report_parts.append(f"  → 連續賣超 {foreign['consecutive_sell_days']} 天")
        report_parts.append(f"- 投信: 今日 {trust['net_today']:+,} 股 | 5日累計 {trust['net_5d']:+,} | 10日累計 {trust['net_10d']:+,}")
        if trust["consecutive_buy_days"] > 0:
            report_parts.append(f"  → 連續買超 {trust['consecutive_buy_days']} 天")
        elif trust["consecutive_sell_days"] > 0:
            report_parts.append(f"  → 連續賣超 {trust['consecutive_sell_days']} 天")

        dealer = inst_result["dealer"]
        report_parts.append(f"- 自營商: 今日 {dealer['net_today']:+,} 股 | 5日累計 {dealer['net_5d']:+,}")
        report_parts.append("")

        # 融資融券
        margin = inst_result.get("margin", {})
        if margin:
            report_parts.append("### 融資融券")
            report_parts.append(f"- 融資餘額: {margin.get('margin_balance', 0):,} 張")
            report_parts.append(f"- 融券餘額: {margin.get('short_balance', 0):,} 張")
            report_parts.append(f"- 券資比: {margin.get('margin_short_ratio', 0):.2f}%")
            if margin.get("margin_change_5d_pct", 0) != 0:
                report_parts.append(f"- 融資 5 日變化: {margin['margin_change_5d_pct']:+.2f}%")
            report_parts.append("")

        # 籌碼訊號
        if inst_result["signals"]:
            report_parts.append("### 籌碼訊號")
            for icon, desc in inst_result["signals"]:
                report_parts.append(f"  {icon} {desc}")
            report_parts.append("")
    else:
        report_parts.append(f"  ⚠️ {inst_result['error']}")
        report_parts.append("")
    return "\n".join(report_parts)


def render_etf(etf_result):
    report_parts = []
    report_parts.append("## ETF 基本資料")
    info = etf_result["info"]
    report_parts.append(f"- 名稱: {info.get('short_name')}（{info.get('fund_type')}）")
    report_parts.append(f"- 追蹤指數: {info.get('tracking_index')}")
    report_parts.append(f"- 含國外成分股: {info.get('includes_foreign_holdings')}")
    report_parts.append(f"- 上市日期: {info.get('listed_date')} | 保管機構: {info.get('custodian')}")
    for note in etf_result["notes"]:
        report_parts.append(f"  ⚠️ {note}")
    report_parts.append("")
    return "\n".join(report_parts)


def render_fundamental(fund_result):
    report_parts = ["## 基本面分析"]
    valuation = fund_result.get("valuation")
    monthly_revenue = fund_result.get("monthly_revenue")
    profitability = fund_result.get("profitability")
    if "error" not in fund_result:
        if valuation:
            report_parts.append(
                f"- 本益比: {valuation.get('pe_ratio')} | 殖利率: {valuation.get('dividend_yield')}% "
                f"| 股價淨值比: {valuation.get('pb_ratio')}（{valuation.get('date')}）"
            )
        if monthly_revenue:
            mom = monthly_revenue.get("mom_pct")
            yoy = monthly_revenue.get("yoy_pct")
            report_parts.append(
                f"- 月營收（{monthly_revenue.get('year_month')}）: {monthly_revenue.get('revenue')} 千元 "
                f"| MoM {mom:.2f}% | YoY {yoy:.2f}%" if mom is not None and yoy is not None else
                f"- 月營收（{monthly_revenue.get('year_month')}）: {monthly_revenue.get('revenue')} 千元"
            )
        if profitability:
            report_parts.append(
                f"- 最新一季毛利率: {profitability.get('gross_margin_pct')}% "
                f"| 營業利益率: {profitability.get('operating_margin_pct')}% "
                f"| 稅後淨利率: {profitability.get('net_margin_pct')}%"
            )
        if fund_result.get("signals"):
            report_parts.append("### 基本面訊號")
            for icon, desc in fund_result["signals"]:
                report_parts.append(f"  {icon} {desc}")
        report_parts.append("- 基本面資料為 TWSE 公開資訊，僅供價值面參考，不納入技術分數或 ML 預測。")
    else:
        report_parts.append(f"  ⚠️ {fund_result['error']}")
    return "\n".join(report_parts)


def render_daytrade(result):
    parts = ["## 當沖風控參考（即時快照，非逐筆委託簿）"]
    if "error" in result:
        parts.append(f"  ⚠️ {result['error']}")
    else:
        parts.extend([
            f"- 今日振幅: {result.get('amplitude_pct', 'N/A')}% | 現價區間位置: {result.get('range_position', 'N/A')}（0=今日最低、1=今日最高）",
            f"- 距離漲停: {result.get('distance_to_limit_up_pct', 'N/A')}% | 距離跌停: {result.get('distance_to_limit_down_pct', 'N/A')}%",
        ])
        for key, label in [("bid_ask_spread_pct", "委買賣價差"), ("five_level_bid_ratio_pct", "五檔委買量佔比")]:
            if key in result:
                parts.append(f"- {label}: {result[key]}%")
        if result.get("daytrade_suspended"):
            parts.append("- ⚠️ 今日暫停現股當沖先賣後買")
        if result.get("signals"):
            parts.append("### 當沖訊號")
            parts.extend(f"  {icon} {description}" for icon, description in result["signals"])
        parts.append(f"- {result.get('disclaimer', '')}")
    return "\n".join(parts)


def render_sentiment(sentiment):
    parts = ["## 公開新聞輿情"]
    if "error" in sentiment:
        parts.append(f"- {sentiment['error']}")
    else:
        parts.append(f"- 近 {sentiment['window_days']} 日 {sentiment['article_count']} 則：{sentiment['label']}（正面 {sentiment['positive_count']}、負面 {sentiment['negative_count']}）")
        parts.extend(f"  - [{article['source']}] {article['title']}" for article in sentiment["articles"])
        parts.append("- 此為標題關鍵詞統計，不納入技術分數或 ML 預測。")
    return "\n".join(parts)


def render_prediction(report):
    pred = report.prediction
    parts = [f"## ML 預測（未來 {report.days_ahead} 天）"]
    if report.params_path:
        parts.append(f"  使用調參數檔: `{report.params_path}`")
    if report.market_code:
        parts.append(f"  已納入跨資產基準（{report.market_code}）")
    if report.institutional_rows is not None:
        parts.append(f"  已納入法人籌碼特徵（{report.institutional_rows} 筆）")
    if "error" in pred:
        parts.append(f"  ⚠️ {pred['error']}")
    else:
        parts.extend([
            f"- 模型: {pred['model']}", f"- 現價: {pred['current_price']}",
            f"- 預測價: {pred['predicted_price']}", f"- 預測報酬: {pred['predicted_return']}%",
            f"- 上漲機率: {pred.get('prob_up', 'N/A')}%", f"- 方向: {pred['direction']}",
            f"- 信心區間: {pred['confidence']['low']} ~ {pred['confidence']['high']}",
        ])
        signal = pred.get("signal", {})
        if signal:
            icon = {"BUY": "🟢", "SELL": "🔴", "HOLD": "⚪"}.get(signal["action"], "⚪")
            parts.extend([f"\n### 交易訊號: {icon} **{signal['action']}**", f"  - 理由: {signal['reason']}"])
        if report.risk:
            risk = report.risk
            parts.extend([
                f"  - 建議止損價（ATR×2 = {risk['stop_pct']:.2f}%）: **{risk['stop_price']}**",
                f"  - ATR(14): {risk['atr']:.2f}（日均波動 {risk['atr_pct']:.2f}%）",
            ])
    return "\n".join(parts)


def render_report(report):
    parts = [f"# 📊 股票分析報告 - {report.code}", f"生成時間: {report.generated_at}",
             render_realtime(report.code, report.realtime)]
    if report.daytrade is not None:
        parts.append(render_daytrade(report.daytrade))
    if report.history:
        history = report.history
        lines = ["## 歷史資料"]
        if history.get("rows"):
            lines.append(f"  已取得 {history['rows']} 筆資料")
        if history.get("failed_months"):
            lines.append(f"  ⚠️ 部分月份抓取失敗：{', '.join(history['failed_months'])}；技術指標可能不完整。")
        if history.get("error"):
            lines.append(f"  ⚠️ {history['error']}")
        parts.append("\n".join(lines))
    if report.technical_error:
        parts.append(f"## 技術指標\n  ⚠️ {report.technical_error}")
    if report.technical is not None:
        parts.append(TechnicalAnalysisView.report_section(report.technical))
    for result, renderer in [(report.institutional, render_institutional), (report.etf, render_etf),
                             (report.fundamental, render_fundamental), (report.sentiment, render_sentiment)]:
        if result is not None:
            parts.append(renderer(result))
    if report.prediction is not None:
        parts.append(render_prediction(report))
    parts.extend(["---", DISCLAIMER])
    return "\n\n".join(parts)
