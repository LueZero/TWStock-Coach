"""股票候選掃描器的資料解析測試。"""
import unittest

from scripts.stock_screener import TaiwanStockScreener


class StockScreenerTests(unittest.TestCase):
    def test_parse_twse_quotes_keeps_only_four_digit_stocks(self):
        payload = {"tables": [{"fields": ["證券代號", "證券名稱", "成交股數", "收盤價"], "data": [["2330", "台積電", "1,234,000", "1,000.00"], ["0050", "ETF", "999,999", "200.00"], ["2330A", "權證", "999", "1.00"]]}]}
        self.assertEqual(TaiwanStockScreener.parse_twse_quotes(payload), [{"code": "2330", "name": "台積電", "screen_close": 1000.0, "volume": 1234000}])


if __name__ == "__main__":
    unittest.main()