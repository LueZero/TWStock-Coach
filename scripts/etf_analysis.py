"""台灣 ETF 基本資料模組 - 追蹤指數、成立資訊、保管機構

資料來源：TWSE OpenAPI 基金基本資料彙總表（t187ap47_L）。

重要限制：TWSE 免費公開 API 不提供 ETF 每日淨值(NAV)、市價對淨值折溢價、
成分股權重明細與內扣費用率。這些是 ETF 定價是否合理的關鍵資訊，若需要
請自行查詢發行商官網或證交所 ETF 專區，本模組只能提供基金基本資料。
"""
import argparse
import json
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


def analyze(code: str) -> dict:
    """回傳 ETF 基本資料 + 資料侷限說明，不含折溢價或成分股權重"""
    fetcher = ETFFetcher()
    info = fetcher.fetch_fund_info(code)
    if info is None:
        return {"error": f"查無 {code} 的 ETF 基本資料（可能不是上市 ETF，或代碼輸入錯誤）"}

    return {
        "info": info,
        "notes": [
            "TWSE 免費公開 API 不提供 ETF 即時淨值(NAV)、折溢價與內扣費用率，"
            "如需折溢價判斷請自行查詢發行商官網或證交所 ETF 專區。",
            "本資料僅為基金基本資料（追蹤指數、保管機構等），不是每日成分股權重明細。",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="台灣上市 ETF 基本資料查詢")
    parser.add_argument("--code", required=True, help="ETF 代碼，如 0050")
    args = parser.parse_args()
    print(json.dumps(analyze(args.code), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
