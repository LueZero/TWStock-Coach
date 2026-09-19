import re
from datetime import datetime, timedelta
import requests


class ListedQuotesFetcher:
    """先以官方收盤行情篩選，再以既有技術規則排序候選股。"""

    TWSE_DAILY_CLOSE = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

    @staticmethod
    def _number(value):
        try:
            return float(str(value).replace(",", ""))
        except (TypeError, ValueError):
            return None

    @classmethod
    def parse_twse_quotes(cls, payload):
        """解析 MI_INDEX 的上市普通股收盤資料，排除 ETF、權證等非四位數標的。"""
        for table in payload.get("tables", []):
            fields = table.get("fields", [])
            if not {"證券代號", "證券名稱", "成交股數", "收盤價"}.issubset(fields):
                continue
            indexes = {field.strip(): index for index, field in enumerate(fields)}
            quotes = []
            for row in table.get("data", []):
                code = str(row[indexes["證券代號"]]).strip()
                close = cls._number(row[indexes["收盤價"]])
                volume = cls._number(row[indexes["成交股數"]])
                if re.fullmatch(r"[1-9]\d{3}", code) and close is not None and volume is not None:
                    quotes.append({
                        "code": code,
                        "name": str(row[indexes["證券名稱"]]).strip(),
                        "screen_close": close,
                        "volume": int(volume),
                    })
            return quotes
        raise ValueError("TWSE 回傳中找不到上市收盤行情資料表")

    def listed_quotes(self, date=None):
        dates = [date] if date else [
            (datetime.now() - timedelta(days=offset)).strftime("%Y%m%d")
            for offset in range(7)
        ]
        last_status = "TWSE 查詢失敗"
        for target_date in dates:
            response = self.session.get(
                self.TWSE_DAILY_CLOSE,
                params={"date": target_date, "type": "ALLBUT0999", "response": "json"},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("stat") == "OK":
                quotes = self.parse_twse_quotes(payload)
                for quote in quotes:
                    quote["quote_date"] = target_date
                return quotes
            last_status = payload.get("stat", last_status)
        raise ValueError(f"最近 7 日找不到可用上市收盤行情：{last_status}")
