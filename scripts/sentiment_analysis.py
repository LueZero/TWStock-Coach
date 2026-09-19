"""以公開新聞標題產生可追溯的輿情輔助摘要。"""
import argparse
import json
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import requests


class NewsSentimentAnalyzer:
    """透明詞典式新聞情緒分析；不產生交易指令。"""

    GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
    POSITIVE_WORDS = ("上調", "看好", "成長", "創高", "擴產", "突破", "上修", "買超", "利多", "優於預期", "獲利", "訂單")
    NEGATIVE_WORDS = ("下調", "看壞", "衰退", "跌停", "下修", "賣超", "利空", "虧損", "裁員", "調查", "制裁", "風險", "減產")
    IRRELEVANT_WORDS = ("排行榜", "成交量TOP", "盤中零股", "台股盤勢")

    def __init__(self, session=None):
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

    @staticmethod
    def _published_at(value):
        try:
            return parsedate_to_datetime(value).astimezone(timezone.utc)
        except (TypeError, ValueError):
            return None

    @classmethod
    def _score_title(cls, title):
        positive = [word for word in cls.POSITIVE_WORDS if word in title]
        negative = [word for word in cls.NEGATIVE_WORDS if word in title]
        return len(positive) - len(negative), positive + negative

    def parse_feed(self, content, code, name=None, days=7, now=None):
        root = ET.fromstring(content)
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
        identifiers = [str(code)] + ([name] if name else [])
        seen, articles = set(), []
        for item in root.findall("./channel/item"):
            title = (item.findtext("title") or "").strip()
            if not title or title in seen or not any(identifier in title for identifier in identifiers):
                continue
            seen.add(title)
            if any(word in title for word in self.IRRELEVANT_WORDS):
                continue
            published_at = self._published_at(item.findtext("pubDate"))
            if published_at and published_at < cutoff:
                continue
            score, keywords = self._score_title(title)
            articles.append({"title": title, "source": item.findtext("source") or "未知來源", "published_at": published_at.isoformat() if published_at else None, "link": item.findtext("link"), "score": score, "keywords": keywords})
        return articles

    def analyze(self, code, name=None, days=7, limit=10):
        query = " ".join(value for value in (str(code), name) if value)
        response = self.session.get(self.GOOGLE_NEWS_RSS, params={"q": query, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}, timeout=20)
        response.raise_for_status()
        articles = self.parse_feed(response.content, code, name, days)
        score = sum(article["score"] for article in articles)
        return {"code": str(code), "name": name, "query": query, "window_days": days, "article_count": len(articles), "positive_count": sum(article["score"] > 0 for article in articles), "negative_count": sum(article["score"] < 0 for article in articles), "score": score, "label": "偏正面" if score >= 2 else ("偏負面" if score <= -2 else "中性或訊號不足"), "articles": articles[:limit], "methodology": "以近期公開新聞標題的透明關鍵詞統計，僅作輿情輔助，不納入技術分數或 ML 預測。", "limitations": "標題詞典無法理解反諷、事件影響程度或文章全文；少量文章時不應解讀為市場共識。"}


def main():
    parser = argparse.ArgumentParser(description="台股公開新聞輿情摘要")
    parser.add_argument("--code", required=True, help="股票代碼")
    parser.add_argument("--name", help="公司名稱，可提高新聞比對精度")
    parser.add_argument("--days", type=int, default=7, help="新聞回溯天數")
    parser.add_argument("--limit", type=int, default=10, help="最多列出文章數")
    args = parser.parse_args()
    if args.days < 1 or args.limit < 1:
        parser.error("days 與 limit 必須至少為 1")
    print(json.dumps(NewsSentimentAnalyzer().analyze(**vars(args)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()