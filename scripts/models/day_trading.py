import time
from typing import Optional
import requests


class DayTradingFetcher:
    """即時報價（含五檔、漲跌停）與當沖資格旗標抓取器"""

    TWSE_REALTIME = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
    TPEX_REALTIME = "https://mis.tpex.org.tw/stock/api/getStockInfo.jsp"
    TWSE_DAYTRADE_LIST = "https://openapi.twse.com.tw/v1/exchangeReport/TWTB4U"

    def __init__(self, rate_limit: float = 2.0):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        self.rate_limit = rate_limit
        self.last_request = 0.0

    def _throttle(self):
        elapsed = time.time() - self.last_request
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self.last_request = time.time()

    @staticmethod
    def _safe_float(value) -> Optional[float]:
        try:
            return float(value) if value not in (None, "", "-") else None
        except (TypeError, ValueError):
            return None

    @classmethod
    def _parse_ladder(cls, raw: Optional[str], as_int: bool = False):
        """解析 TWSE 即時報價的五檔字串（以底線分隔，可能有空欄位）"""
        if not raw:
            return []
        values = []
        for part in raw.split("_"):
            part = part.strip()
            if not part:
                continue
            try:
                values.append(int(float(part)) if as_int else float(part))
            except ValueError:
                continue
        return values

    def fetch_snapshot(self, code: str) -> Optional[dict]:
        """抓取即時報價快照：開高低收、昨收、漲跌停、五檔委買委賣"""
        self._throttle()
        params = {"ex_ch": f"tse_{code}.tw", "json": "1", "delay": "0"}
        resp = self.session.get(self.TWSE_REALTIME, params=params, timeout=10)
        data = resp.json()
        raw = data.get("msgArray", [None])[0] if data.get("msgArray") else None

        if raw is None:
            self._throttle()
            params = {"ex_ch": f"otc_{code}.tw", "json": "1", "delay": "0"}
            resp = self.session.get(self.TPEX_REALTIME, params=params, timeout=10)
            data = resp.json()
            raw = data.get("msgArray", [None])[0] if data.get("msgArray") else None

        if raw is None:
            return None

        return {
            "code": raw.get("c", code),
            "name": raw.get("n", ""),
            "time": raw.get("t", ""),
            "open": self._safe_float(raw.get("o")),
            "high": self._safe_float(raw.get("h")),
            "low": self._safe_float(raw.get("l")),
            "close": self._safe_float(raw.get("z")),
            "yesterday_close": self._safe_float(raw.get("y")),
            "limit_up": self._safe_float(raw.get("u")),
            "limit_down": self._safe_float(raw.get("w")),
            "ask_prices": self._parse_ladder(raw.get("a")),
            "bid_prices": self._parse_ladder(raw.get("b")),
            "ask_volumes": self._parse_ladder(raw.get("f"), as_int=True),
            "bid_volumes": self._parse_ladder(raw.get("g"), as_int=True),
        }

    def fetch_daytrade_eligibility(self, code: str) -> Optional[dict]:
        """查詢當日是否暫停現股當沖先賣後買（TWSE 上市股票每日當沖標的及統計）"""
        try:
            resp = self.session.get(self.TWSE_DAYTRADE_LIST, timeout=20)
            resp.raise_for_status()
            for row in resp.json():
                if row.get("Code") == code:
                    return {
                        "date": row.get("Date"),
                        "suspended": row.get("Suspension") == "Y",
                    }
            return None
        except (requests.RequestException, ValueError):
            return None


class DayTradingAnalyzer:
    """把即時快照整理成當沖風控參考，不做盤中買賣點預測"""

    def __init__(self, snapshot: dict, eligibility: Optional[dict] = None,
                 atr_pct: Optional[float] = None):
        self.snapshot = snapshot
        self.eligibility = eligibility
        self.atr_pct = atr_pct

    def analyze(self) -> dict:
        s = self.snapshot
        close = s.get("close")
        high = s.get("high")
        low = s.get("low")
        prev_close = s.get("yesterday_close")
        limit_up = s.get("limit_up")
        limit_down = s.get("limit_down")

        result: dict = {"signals": []}

        # 今日振幅（相對昨收）
        if high is not None and low is not None and prev_close:
            amplitude_pct = round((high - low) / prev_close * 100, 2)
            result["amplitude_pct"] = amplitude_pct
            if amplitude_pct < 1.5:
                result["signals"].append(("🔴", f"今日振幅僅 {amplitude_pct}%，波動偏小，當沖獲利可能不夠覆蓋手續費與證交稅"))
            elif amplitude_pct > 5:
                result["signals"].append(("🟡", f"今日振幅達 {amplitude_pct}%，波動大，當沖機會與風險同步放大"))

        # 現價在今日高低區間的相對位置（0=今日最低、1=今日最高）
        if close is not None and high is not None and low is not None and high != low:
            position = round((close - low) / (high - low), 2)
            result["range_position"] = position
            if position >= 0.85:
                result["signals"].append(("🟢", "現價接近今日最高點，屬強勢位置，追高風險同步提高"))
            elif position <= 0.15:
                result["signals"].append(("🔴", "現價接近今日最低點，屬弱勢位置，追空風險同步提高"))

        # 距離漲跌停
        if close is not None and limit_up:
            dist_up_pct = round((limit_up - close) / close * 100, 2)
            result["distance_to_limit_up_pct"] = dist_up_pct
            if dist_up_pct <= 1:
                result["signals"].append(("🟡", "接近漲停，若鎖住漲停將難以賣出，流動性可能瞬間消失"))
        if close is not None and limit_down:
            dist_down_pct = round((close - limit_down) / close * 100, 2)
            result["distance_to_limit_down_pct"] = dist_down_pct
            if dist_down_pct <= 1:
                result["signals"].append(("🟡", "接近跌停，若鎖住跌停將難以買回回補，流動性可能瞬間消失"))

        # 委買委賣價差（流動性 / 當沖來回成本）
        ask_prices, bid_prices = s.get("ask_prices") or [], s.get("bid_prices") or []
        if ask_prices and bid_prices and close:
            spread = round(ask_prices[0] - bid_prices[0], 2)
            spread_pct = round(spread / close * 100, 2)
            result["bid_ask_spread"] = spread
            result["bid_ask_spread_pct"] = spread_pct
            if spread_pct > 0.3:
                result["signals"].append(("🔴", f"委買賣價差 {spread_pct}% 偏大，當沖來回成本較高"))

        # 五檔委買委賣量能比（短線買賣力道，僅反映當下瞬間）
        ask_volumes, bid_volumes = s.get("ask_volumes") or [], s.get("bid_volumes") or []
        total_ask, total_bid = sum(ask_volumes), sum(bid_volumes)
        if total_ask + total_bid > 0:
            bid_ratio_pct = round(total_bid / (total_ask + total_bid) * 100, 1)
            result["five_level_bid_ratio_pct"] = bid_ratio_pct
            if bid_ratio_pct >= 65:
                result["signals"].append(("🟢", f"五檔委買量占比 {bid_ratio_pct}%，當下買盤較強（僅反映查詢瞬間）"))
            elif bid_ratio_pct <= 35:
                result["signals"].append(("🔴", f"五檔委買量占比僅 {bid_ratio_pct}%，當下賣壓較重（僅反映查詢瞬間）"))

        if self.atr_pct is not None:
            result["atr_pct_reference"] = self.atr_pct

        if self.eligibility is not None:
            result["daytrade_suspended"] = self.eligibility.get("suspended")
            if self.eligibility.get("suspended"):
                result["signals"].append(("🔴", "今日暫停現股當沖先賣後買，無法用現股當沖交易"))

        result["disclaimer"] = (
            "本分析僅為查詢當下的即時快照（五檔、今日高低點、漲跌停距離），只反映數秒內的市況，"
            "不是逐筆委託簿回放，也不能預測盤中未來走勢；當沖為信用交易的一種，"
            "當日未平倉會被券商強制處理，虧損無法留到隔日攤平，手續費與證交稅會侵蝕薄利，新手務必謹慎。"
        )
        return result
