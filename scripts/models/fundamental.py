from typing import Optional
import requests


class FundamentalFetcher:
    """上市個股估值、月營收與獲利能力抓取器（TWSE OpenAPI）"""

    TWSE_VALUATION = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"
    TWSE_MONTHLY_REVENUE = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"
    TWSE_PROFITABILITY = "https://openapi.twse.com.tw/v1/opendata/t187ap17_L"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

    @staticmethod
    def _to_float(value) -> Optional[float]:
        try:
            return float(value) if value not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def fetch_valuation(self, code: str) -> Optional[dict]:
        """本益比、殖利率、股價淨值比（上市個股最新交易日）"""
        try:
            resp = self.session.get(self.TWSE_VALUATION, timeout=15)
            resp.raise_for_status()
            for row in resp.json():
                if row.get("Code") == code:
                    return {
                        "date": row.get("Date"),
                        "pe_ratio": self._to_float(row.get("PEratio")),
                        "dividend_yield": self._to_float(row.get("DividendYield")),
                        "pb_ratio": self._to_float(row.get("PBratio")),
                    }
            return None
        except (requests.RequestException, ValueError):
            return None

    def fetch_monthly_revenue(self, code: str) -> Optional[dict]:
        """最新月營收與 MoM/YoY 增減幅（上市公司彙總表）"""
        try:
            resp = self.session.get(self.TWSE_MONTHLY_REVENUE, timeout=20)
            resp.raise_for_status()
            for row in resp.json():
                if row.get("公司代號") == code:
                    return {
                        "year_month": row.get("資料年月"),
                        "revenue": self._to_float(row.get("營業收入-當月營收")),
                        "mom_pct": self._to_float(row.get("營業收入-上月比較增減(%)")),
                        "yoy_pct": self._to_float(row.get("營業收入-去年同月增減(%)")),
                        "cumulative_yoy_pct": self._to_float(row.get("累計營業收入-前期比較增減(%)")),
                        "note": row.get("備註") or None,
                    }
            return None
        except (requests.RequestException, ValueError):
            return None

    def fetch_profitability(self, code: str) -> Optional[dict]:
        """最新一季毛利率/營業利益率/稅前淨利率/稅後淨利率（上市公司營益分析彙總表）"""
        try:
            resp = self.session.get(self.TWSE_PROFITABILITY, timeout=20)
            resp.raise_for_status()
            for row in resp.json():
                if row.get("公司代號") == code:
                    return {
                        "year": row.get("年度"),
                        "quarter": row.get("季別"),
                        "gross_margin_pct": self._to_float(row.get("毛利率(%)(營業毛利)/(營業收入)")),
                        "operating_margin_pct": self._to_float(row.get("營業利益率(%)(營業利益)/(營業收入)")),
                        "pretax_margin_pct": self._to_float(row.get("稅前純益率(%)(稅前純益)/(營業收入)")),
                        "net_margin_pct": self._to_float(row.get("稅後純益率(%)(稅後純益)/(營業收入)")),
                    }
            return None
        except (requests.RequestException, ValueError):
            return None


class FundamentalAnalyzer:
    """把估值、營收與獲利指標整理成白話訊號，不涉及技術分數或 ML 預測"""

    def __init__(self, valuation: Optional[dict], monthly_revenue: Optional[dict],
                 profitability: Optional[dict]):
        self.valuation = valuation
        self.monthly_revenue = monthly_revenue
        self.profitability = profitability

    def analyze(self) -> dict:
        if not any([self.valuation, self.monthly_revenue, self.profitability]):
            return {
                "error": "查無基本面資料（可能是 ETF、權證、上櫃股票，或當日資料尚未更新）",
            }

        signals = []

        if self.valuation:
            pe = self.valuation.get("pe_ratio")
            pb = self.valuation.get("pb_ratio")
            dy = self.valuation.get("dividend_yield")
            if pe is not None:
                if pe < 12:
                    signals.append(("🟢", f"本益比 {pe}（偏低，<12），須搭配獲利趨勢判斷是便宜還是有隱憂"))
                elif pe > 30:
                    signals.append(("🔴", f"本益比 {pe}（偏高，>30），股價可能已反映高成長預期"))
            if dy is not None and dy >= 4:
                signals.append(("🟢", f"殖利率 {dy}%（偏高），存股型投資人可留意"))
            if pb is not None and pb < 1:
                signals.append(("🟢", f"股價淨值比 {pb}（<1），理論上股價低於帳面淨值"))

        if self.monthly_revenue:
            yoy = self.monthly_revenue.get("yoy_pct")
            if yoy is not None:
                if yoy >= 20:
                    signals.append(("🟢", f"最新月營收年增 {yoy:.2f}%，成長動能強"))
                elif yoy <= -20:
                    signals.append(("🔴", f"最新月營收年減 {abs(yoy):.2f}%，營運轉弱需留意"))

        if self.profitability:
            om = self.profitability.get("operating_margin_pct")
            if om is not None and om < 0:
                signals.append(("🔴", "最新一季營業利益率為負，本業處於虧損"))

        return {
            "valuation": self.valuation,
            "monthly_revenue": self.monthly_revenue,
            "profitability": self.profitability,
            "signals": signals,
        }
