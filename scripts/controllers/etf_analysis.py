import argparse
from ..views.console import show_json
from ..models.etf import ETFFetcher


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


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台灣上市 ETF 基本資料查詢")
    parser.add_argument("--code", required=True, help="ETF 代碼，如 0050")
    args = parser.parse_args(argv)
    show_json(analyze(args.code), ensure_ascii=False, indent=2)
