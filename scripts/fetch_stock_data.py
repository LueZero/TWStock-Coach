"""台灣股票資料抓取模組 - TWSE/TPEX API"""
import argparse
if __package__:
    from .project_paths import data_path, stock_code
else:
    from project_paths import data_path, stock_code
import json
import os
import time
from datetime import datetime, timedelta

import pandas as pd
import requests


class TWStockFetcher:
    """TWSE/TPEX 股票資料抓取器"""

    TWSE_REALTIME = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
    TWSE_HISTORY = "https://www.twse.com.tw/exchangeReport/STOCK_DAY"
    TPEX_REALTIME = "https://mis.tpex.org.tw/stock/api/getStockInfo.jsp"
    TPEX_HISTORY = "https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php"

    def __init__(self, rate_limit=3.0):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        self.rate_limit = rate_limit
        self.last_request = 0

    def _throttle(self):
        elapsed = time.time() - self.last_request
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self.last_request = time.time()

    def get_realtime(self, code: str) -> dict:
        """取得即時報價"""
        self._throttle()
        # 嘗試 TWSE
        params = {"ex_ch": f"tse_{code}.tw", "json": "1", "delay": "0"}
        resp = self.session.get(self.TWSE_REALTIME, params=params, timeout=10)
        data = resp.json()

        if data.get("msgArray") and len(data["msgArray"]) > 0:
            return self._parse_realtime(data["msgArray"][0])

        # Fallback: TPEX
        params = {"ex_ch": f"otc_{code}.tw", "json": "1", "delay": "0"}
        resp = self.session.get(self.TPEX_REALTIME, params=params, timeout=10)
        data = resp.json()

        if data.get("msgArray") and len(data["msgArray"]) > 0:
            return self._parse_realtime(data["msgArray"][0])

        return {"error": f"找不到股票代碼 {code}"}

    def _parse_realtime(self, raw: dict) -> dict:
        """解析即時報價資料"""
        def safe_float(v):
            try:
                return float(v) if v and v != "-" else None
            except (ValueError, TypeError):
                return None

        return {
            "code": raw.get("c", ""),
            "name": raw.get("n", ""),
            "time": raw.get("t", ""),
            "open": safe_float(raw.get("o")),
            "high": safe_float(raw.get("h")),
            "low": safe_float(raw.get("l")),
            "close": safe_float(raw.get("z")),
            "volume": safe_float(raw.get("v")),
            "yesterday_close": safe_float(raw.get("y")),
        }

    def get_history(self, code: str, days: int = 180) -> pd.DataFrame:
        """取得歷史日K資料"""
        all_data = []
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        current = start_date.replace(day=1)
        while current <= end_date:
            self._throttle()
            date_str = f"{current.year}{current.month:02d}01"

            params = {"response": "json", "date": date_str, "stockNo": code}
            try:
                resp = self.session.get(self.TWSE_HISTORY, params=params, timeout=10)
                data = resp.json()

                if data.get("stat") == "OK" and data.get("data"):
                    for row in data["data"]:
                        try:
                            # 民國年轉西元
                            date_parts = row[0].split("/")
                            year = int(date_parts[0]) + 1911
                            date = f"{year}-{date_parts[1]}-{date_parts[2]}"

                            all_data.append({
                                "date": date,
                                "volume": int(row[1].replace(",", "")),
                                "open": float(row[3].replace(",", "")),
                                "high": float(row[4].replace(",", "")),
                                "low": float(row[5].replace(",", "")),
                                "close": float(row[6].replace(",", "")),
                            })
                        except (ValueError, IndexError):
                            continue
            except Exception:
                pass

            # 下一個月
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1)
            else:
                current = current.replace(month=current.month + 1)

        if not all_data:
            return pd.DataFrame()

        df = pd.DataFrame(all_data)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)

        # 只保留指定天數
        cutoff = datetime.now() - timedelta(days=days)
        df = df[df["date"] >= pd.Timestamp(cutoff)].reset_index(drop=True)

        return df


def main():
    parser = argparse.ArgumentParser(description="台灣股票資料抓取")
    parser.add_argument("--code", type=stock_code, required=True, help="股票代碼")
    parser.add_argument("--action", choices=["realtime", "history"], default="realtime")
    parser.add_argument("--days", type=int, default=180, help="歷史天數")
    parser.add_argument("--save", action="store_true", help="儲存至 data/ 目錄")
    parser.add_argument("--data-dir", type=data_path, default="data", help="專案 data/ 內的目錄（相對於專案根目錄）")
    args = parser.parse_args()

    fetcher = TWStockFetcher()

    if args.action == "realtime":
        result = fetcher.get_realtime(args.code)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif args.action == "history":
        df = fetcher.get_history(args.code, args.days)
        if df.empty:
            print(f"無法取得 {args.code} 的歷史資料")
            return

        print(f"取得 {len(df)} 筆歷史資料 ({df['date'].min().date()} ~ {df['date'].max().date()})")
        print(df.tail(10).to_string(index=False))

        if args.save:
            os.makedirs(args.data_dir, exist_ok=True)
            path = data_path(args.data_dir, f"{args.code}_history.csv")
            df.to_csv(path, index=False)
            print(f"\n已儲存至 {path}")


if __name__ == "__main__":
    main()
