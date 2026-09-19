from typing import Optional
import requests


class ETFFetcher:
    """上市 ETF 基本資料抓取器（TWSE OpenAPI）"""

    TWSE_FUND_BASIC = "https://openapi.twse.com.tw/v1/opendata/t187ap47_L"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

    def fetch_fund_info(self, code: str) -> Optional[dict]:
        try:
            resp = self.session.get(self.TWSE_FUND_BASIC, timeout=20)
            resp.raise_for_status()
            for row in resp.json():
                if row.get("基金代號") == code:
                    return {
                        "code": code,
                        "short_name": row.get("基金簡稱"),
                        "fund_type": row.get("基金類型"),
                        "tracking_index": row.get("標的指數/追蹤指數名稱"),
                        "includes_foreign_holdings": row.get("是否包含國外成分股"),
                        "listed_date": row.get("上市日期"),
                        "manager": row.get("基金經理人"),
                        "custodian": row.get("保管機構"),
                    }
            return None
        except (requests.RequestException, ValueError):
            return None
