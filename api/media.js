import { XMLParser, XMLValidator } from "fast-xml-parser";
import { rows } from "./db.js";
import { saved } from "./market-board.js";
import { FinMind } from "./providers.js";
import { taipeiDay, validDate, addDays, daysBetween, fail } from "./lib.js";

export function mediaRange(query = {}, today = taipeiDay()) {
  if (query.date && (query.start || query.end || query.cursor))
    fail("單日與區間參數不可同時使用");
  if (!!query.start !== !!query.end) fail("請同時提供起始日與截止日");
  const end = validDate(query.end || query.date || today);
  const start = validDate(query.start || query.date || addDays(end, -6));
  if (start > end) fail("起始日不可晚於截止日");
  if (end > today) fail("不支援未來日期");
  if (daysBetween(end, start) >= 31) fail("新聞區間最多 31 個日曆日");
  const cursor = validDate(query.cursor || start);
  if (cursor < start || cursor > end) fail("新聞查詢游標超出區間");
  return { start, end, cursor };
}

export function filterMediaRange(items, start, end) {
  return items.filter((item) => {
    const day =
      item.timezone_known === false
        ? item.published_at.slice(0, 10)
        : Number.isFinite(Date.parse(item.published_at))
          ? taipeiDay(item.published_at)
          : "";
    return day >= start && day <= end;
  });
}

// Small pages keep requests bounded while the client progressively loads the range.
export async function stockMediaRange(
  market,
  symbol,
  query,
  loadDay = stockMedia,
) {
  const { start, end, cursor } = mediaRange(query);
  const pageEnd = cursor;
  const page = await loadDay(market, symbol, cursor);
  return {
    ...page,
    start,
    end,
    page_start: cursor,
    page_end: pageEnd,
    next_cursor: pageEnd < end ? addDays(pageEnd, 1) : null,
    failed_dates:
      page.warning || !page.sources.find((s) => s.id === "finmind")?.available
        ? [cursor]
        : [],
    notes: [
      "公司索引依區間逐日查詢，包含週末與假日；每次最多 31 個日曆日。",
      "Yahoo、PTT 與 Google RSS 僅有近期文章，依選取區間篩選，不代表完整歷史。",
      ...(page.notes || []).slice(1),
    ],
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});
const array = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) =>
  String(typeof v === "object" ? v?.["#text"] || "" : v || "")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, entity) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[
          entity
        ],
    )
    .trim();
export function safeLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function parseFeed(xml, source) {
  if (
    Buffer.byteLength(xml) > 2000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error("RSS 格式不支援");
  const doc = parser.parse(xml),
    atom = !!doc.feed;
  return array(atom ? doc.feed.entry : doc.rss?.channel?.item).flatMap((r) => {
    const url = safeLink(
      atom
        ? array(r.link).find(
            (l) => !l["@_rel"] || l["@_rel"] === "alternate",
          )?.["@_href"]
        : text(r.link),
    );
    const title = text(r.title),
      date = new Date(text(atom ? r.published || r.updated : r.pubDate));
    if (!url || !title || !Number.isFinite(date.getTime())) return [];
    return [
      {
        title: title.slice(0, 500),
        url,
        published_at: date.toISOString(),
        source: text(r.source) || source,
        searchable: text(r.content || r.description),
      },
    ];
  });
}
export function related(items, name, symbol) {
  const names = [name, name.replace(/[-－](KY|DR).*$/i, "")].filter(
    (v) => v.length >= 2,
  );
  const code = new RegExp(`(^|[^0-9A-Za-z])${symbol}([^0-9A-Za-z]|$)`);
  return items.flatMap((r) => {
    const matches = (value) =>
      names.some((n) => value.includes(n)) || code.test(value);
    const direct = matches(r.title);
    return direct || matches(r.searchable || "")
      ? [
          {
            ...r,
            searchable: undefined,
            relation: direct ? "標題相關" : "文內提及",
          },
        ]
      : [];
  });
}
export function mergeMedia(items, limit = 60) {
  const seen = new Set();
  return items
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .filter((r) => {
      const canonical = new URL(r.url);
      for (const key of [...canonical.searchParams.keys()])
        if (/^(utm_|fbclid$|gclid$)/i.test(key))
          canonical.searchParams.delete(key);
      const key = canonical.href;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
async function feed(url, source) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "TWStock-Coach/1.1 (+public-feed-reader)" },
  });
  if (!response.ok) throw Error("公開 RSS 暫時無法連線");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2000000) {
      await reader.cancel();
      throw Error("RSS 過大");
    }
    chunks.push(Buffer.from(value));
  }
  return parseFeed(Buffer.concat(chunks).toString("utf8"), source);
}
export async function stockMedia(market, symbol, requested) {
  const instrument = (
    await rows("SELECT name FROM instruments WHERE market=$1 AND symbol=$2", [
      market,
      symbol,
    ])
  )[0];
  if (!instrument)
    return {
      name: symbol,
      symbol,
      date: requested || taipeiDay(),
      news: [],
      discussions: [],
      sources: [],
      warning: "尚未載入股票基本資料。",
    };
  const latest = (
    await rows(
      "SELECT max(trade_date)::text AS day FROM bars WHERE market=$1 AND symbol=$2 AND timeframe='1d'",
      [market, symbol],
    )
  )[0]?.day;
  const date = validDate(requested || latest || taipeiDay()),
    name = instrument.name;
  const specs = [
    [
      "finmind",
      "公司新聞索引 · FinMind",
      async () =>
        (
          await new FinMind(fetch, { signal: AbortSignal.timeout(30000) }).get(
            "TaiwanStockNews",
            { data_id: symbol, start_date: date },
          )
        ).flatMap((r) => {
          const url = safeLink(r.link);
          // FinMind returns a single publication day; its dates have no documented zone.
          const stamp = String(r.date || "").replace(" ", "T");
          if (
            r.stock_id !== symbol ||
            !url ||
            !/^\d{4}-\d{2}-\d{2}T/.test(stamp)
          )
            return [];
          return [
            {
              title: text(r.title).slice(0, 500),
              url,
              source: text(r.source),
              published_at: stamp,
              timezone_known: false,
              relation: "公司索引",
            },
          ];
        }),
    ],
    [
      "yahoo",
      "Yahoo 股市 · 最新 RSS",
      async () =>
        related(
          await feed(
            "https://tw.stock.yahoo.com/rss?category=news",
            "Yahoo 股市",
          ),
          name,
          symbol,
        ),
    ],
    [
      "ptt",
      "PTT Stock · 最新公開文章",
      async () =>
        related(
          await feed("https://www.ptt.cc/atom/Stock.xml", "PTT Stock"),
          name,
          symbol,
        ),
    ],
  ];
  if (process.env.GOOGLE_NEWS_ENABLED === "true")
    specs.push([
      "google",
      "Google 新聞 · 個人 RSS",
      async () =>
        related(
          await feed(
            `https://news.google.com/rss/search?${new URLSearchParams({ q: `${name} ${symbol}`, hl: "zh-TW", gl: "TW", ceid: "TW:zh-Hant" })}`,
            "Google 新聞",
          ),
          name,
          symbol,
        ),
    ]);
  const results = await Promise.all(
    specs.map(async ([id, label, load]) => {
      try {
        const value = await saved(
          `media:${id}:${market}:${symbol}:${id === "finmind" ? date : "recent"}`,
          600000,
          async () => ({
            date,
            received_at: new Date().toISOString(),
            data: await load(),
          }),
        );
        return { id, label, available: true, ...value };
      } catch {
        return {
          id,
          label,
          available: false,
          data: [],
          warning: "來源暫時無法取得，沒有以其他股票或假資料替代。",
        };
      }
    }),
  );
  for (const source of results)
    source.data = filterMediaRange(source.data, date, date);
  const all = mergeMedia(
    results.flatMap((s) => s.data),
    Infinity,
  );
  const isForum = (r) =>
    /\/(forum|bbs)\//.test(new URL(r.url).pathname) ||
    /(^|\.)dcard\.tw$/.test(new URL(r.url).hostname);
  return {
    market,
    symbol,
    name,
    date,
    received_at: new Date().toISOString(),
    news: all.filter((r) => !isForum(r)),
    discussions: all.filter(isForum),
    sources: results.map(({ data, ...s }) => ({ ...s, count: data.length })),
    searches: [
      {
        label: "Google 新聞",
        url: `https://news.google.com/search?q=${encodeURIComponent(name + " " + symbol)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,
      },
      {
        label: "Yahoo 公司新聞",
        url: `https://tw.stock.yahoo.com/quote/${symbol}.${market === "TPEX" ? "TWO" : "TW"}/news`,
      },
      {
        label: "更多公開討論",
        url: `https://www.google.com/search?q=${encodeURIComponent(name + " " + symbol + " (site:ptt.cc/bbs/Stock OR site:cmoney.tw/forum OR site:dcard.tw)")}`,
      },
    ],
    notes: [
      "公司索引只查所選一個發布日期；Yahoo 與 PTT 是最近公開文章，不代表完整歷史。",
      "依最新時間排序，沒有點閱量排名；文內提及不一定以該公司為主題。",
      "論壇內容為未驗證觀點，不進行情緒評分或投資建議。",
      "FinMind 發布時間未標示時區，保留來源時間，不冒充台北時間。",
      "Google RSS 預設停用；僅於符合個人非商業閱讀用途時設定 GOOGLE_NEWS_ENABLED=true。",
    ],
  };
}
