import argparse
from ..views.console import show_json
from ..models.sentiment import NewsSentimentAnalyzer


def main(argv=None, *, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description="台股公開新聞輿情摘要")
    parser.add_argument("--code", required=True, help="股票代碼")
    parser.add_argument("--name", help="公司名稱，可提高新聞比對精度")
    parser.add_argument("--days", type=int, default=7, help="新聞回溯天數")
    parser.add_argument("--limit", type=int, default=10, help="最多列出文章數")
    args = parser.parse_args(argv)
    if args.days < 1 or args.limit < 1:
        parser.error("days 與 limit 必須至少為 1")
    show_json(NewsSentimentAnalyzer().analyze(**vars(args)), ensure_ascii=False, indent=2)
