"""歷史資料抓取的完整性揭露測試。"""
import unittest

from scripts.models.market_data import TWStockFetcher


class FailingResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"stat": "很抱歉，沒有符合條件的資料!"}


class FailingSession:
    headers = {}

    def get(self, *args, **kwargs):
        return FailingResponse()


class HistoryFetchTests(unittest.TestCase):
    def test_failed_months_are_exposed_on_empty_history(self):
        fetcher = TWStockFetcher(rate_limit=0)
        fetcher.session = FailingSession()
        history = fetcher.get_history("2330", days=1)
        self.assertTrue(history.empty)
        self.assertTrue(history.attrs["failed_months"])


if __name__ == "__main__":
    unittest.main()