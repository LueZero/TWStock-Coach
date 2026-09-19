"""Coordinate cache loading and progressively longer history requests."""
import pandas as pd

from ..models.market_data import TWStockFetcher
from ..models.repository import load_history, save_history
from ..views.console import show


def load_or_fetch(code, data_dir="data", min_rows=200, progress=show):
    df = load_history(code, data_dir)
    if df is not None and len(df) >= min_rows:
        return df
    fetcher = TWStockFetcher()
    for days in (365, 730, 1095):
        progress(f"資料不足（{len(df) if df is not None else 0} 筆），自動抓取近 {days} 天...")
        try:
            fetched = fetcher.get_history(code, days)
            if fetched is not None and not fetched.empty:
                save_history(fetched, code, data_dir)
                df = fetched
                progress(f"已抓取 {len(df)} 筆並儲存")
                if len(df) >= min_rows:
                    return df
        except Exception as error:
            progress(f"抓取 {days} 天失敗: {error}")
    return df if df is not None else pd.DataFrame()
