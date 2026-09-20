"""Headless PNG rendering of prepared daily trend data."""
import os
from pathlib import Path
from ..common.paths import data_path


class TrendChartView:
    @staticmethod
    def markdown(chart, result, image_name):
        from .views import TechnicalAnalysisView
        return (f"# {chart.code} 技術分析\n\n資料截至：{chart.dates[-1]}（日線，非即時行情）\n\n"
                f"![{chart.code} 日線趨勢]({image_name})\n\n"
                + TechnicalAnalysisView.markdown(result)
                + f"\n\n來源：{chart.source}\n\n⚠️ 以上分析僅供參考，不構成投資建議。\n")

    @staticmethod
    def png(chart, output):
        target = Path(data_path(output))
        if target.suffix.lower() != ".png":
            raise ValueError("趨勢圖輸出必須為 PNG")
        # Set before matplotlib import; font cache also belongs in data/.
        cache = Path(data_path("data/cache/matplotlib"))
        cache.mkdir(parents=True, exist_ok=True)
        os.environ["MPLCONFIGDIR"] = str(cache)
        import matplotlib
        matplotlib.use("Agg")
        from matplotlib import font_manager, rc_context
        from matplotlib.figure import Figure
        from matplotlib.backends.backend_agg import FigureCanvasAgg

        installed = {font.name for font in font_manager.fontManager.ttflist}
        cjk_font = next((name for name in ("Microsoft JhengHei", "Noto Sans CJK TC", "PingFang TC", "Microsoft YaHei")
                         if name in installed), None)
        chinese = bool(cjk_font)
        with rc_context({"font.family": cjk_font or "DejaVu Sans", "axes.unicode_minus": False,
                         "font.size": 10, "axes.spines.top": False, "axes.spines.right": False}):
            figure = Figure(figsize=(12, 7), dpi=160, facecolor="#f8faf7")
            FigureCanvasAgg(figure)
            price, volume = figure.subplots(2, 1, sharex=True, gridspec_kw={"height_ratios": [3, 1], "hspace": .10})
            x = list(range(len(chart.dates)))
            price.plot(x, chart.close, color="#204f45", linewidth=1.8, label="收盤價" if chinese else "Close")
            colors = ["#c58c34", "#5088a5", "#9974aa", "#d56c61"]
            for (name, values), color in zip(chart.moving_averages.items(), colors):
                price.plot(x, values, color=color, linewidth=1, label=name)
            price.set_ylabel("價格（元）" if chinese else "Price (TWD)")
            price.legend(loc="upper left", ncol=5, frameon=False, fontsize=9)
            price.margins(x=.015, y=.16)
            bar_colors = ["#bd6e62" if i == 0 or chart.close[i] >= chart.close[i-1] else "#5d9781" for i in x]
            volume.bar(x, chart.volume, color=bar_colors, width=.7)
            volume.set_ylabel("成交量（股）" if chinese else "Volume (shares)")
            volume.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))
            ticks = sorted({round(i * (len(x)-1) / 5) for i in range(6)})
            volume.set_xticks(ticks, [chart.dates[i] for i in ticks], fontsize=9)
            for axis in (price, volume):
                axis.set_facecolor("#f8faf7")
                axis.grid(axis="y", color="#dce3db", linewidth=.6)
                axis.set_axisbelow(True)
                axis.spines["left"].set_color("#cad4c9")
                axis.spines["bottom"].set_color("#cad4c9")
            heading = f"{chart.code} 日線趨勢 · {chart.overall}" if chinese else f"{chart.code} | Daily price trend"
            figure.suptitle(heading, x=.09, ha="left", fontsize=18, fontweight="bold", color="#203e32")
            caption = (f"{chart.dates[0]} — {chart.dates[-1]}  ·  {len(x)} 筆日線  ·  均線使用完整歷史計算"
                       if chinese else f"{chart.dates[0]} — {chart.dates[-1]} | {len(x)} bars | MA calculated on full history")
            figure.text(.09, .905, caption, fontsize=9, color="#64756a")
            footer = (f"來源：{chart.source}；截至 {chart.dates[-1]}。日線非即時行情。\n以上分析僅供參考，不構成投資建議。"
                      if chinese else f"Source: project historical CSV (verify provenance). As of {chart.dates[-1]}.\nDaily data, not a live quote. For reference only; not investment advice.")
            figure.text(.09, .025, footer, fontsize=8, color="#64756a")
            figure.subplots_adjust(top=.855, bottom=.14, left=.09, right=.97)
            target.parent.mkdir(parents=True, exist_ok=True)
            figure.savefig(target, format="png", facecolor=figure.get_facecolor())
            figure.clear()
        return str(target)
