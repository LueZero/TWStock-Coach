"""公開新聞輿情摘要的解析與詞典分類測試。"""
import unittest
from datetime import datetime, timezone

from scripts.models.sentiment import NewsSentimentAnalyzer


FEED = b'''<?xml version="1.0"?><rss><channel>
<item><title>2330 &#19978;&#35519;</title><link>https://example.com/positive</link><pubDate>Mon, 14 Sep 2026 02:42:44 GMT</pubDate><source>Example</source></item>
<item><title>2330 &#36067;&#36229;</title><link>https://example.com/negative</link><pubDate>Mon, 14 Sep 2026 03:42:44 GMT</pubDate><source>Example</source></item>
<item><title>2330 &#25490;&#34892;&#27036;</title><link>https://example.com/noise</link><pubDate>Mon, 14 Sep 2026 03:42:44 GMT</pubDate><source>Example</source></item>
</channel></rss>'''


class NewsSentimentTests(unittest.TestCase):
    def test_parse_feed_filters_noise_and_scores_titles(self):
        articles = NewsSentimentAnalyzer().parse_feed(FEED, "2330", now=datetime(2026, 9, 14, tzinfo=timezone.utc))
        self.assertEqual(len(articles), 2)
        self.assertEqual([article["score"] for article in articles], [1, -1])


if __name__ == "__main__":
    unittest.main()