import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { taipeiDay, addDays } from "../api/lib.js";

const { values } = parseArgs({
  options: {
    stocks: {
      type: "string",
      default: "TWSE:2409,TPEX:6147,TWSE:00927,TWSE:00878",
    },
    start: { type: "string", default: addDays(taipeiDay(), -60) },
    end: { type: "string", default: taipeiDay() },
    output: { type: "string", default: ".tmp/data-audit-latest.json" },
  },
});
const base = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const range = new URLSearchParams({ start: values.start, end: values.end });
const newsStart =
  values.start < addDays(values.end, -30)
    ? addDays(values.end, -30)
    : values.start;
const newsRange = new URLSearchParams({ start: newsStart, end: values.end });
async function request(path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(`HTTP ${r.status}: ${data.detail || "來源查詢失敗"}`);
  return data;
}
async function section(pair, section, query = range) {
  const begin = performance.now();
  let result;
  do {
    result = await request(
      `/api/stock-data/${pair}?section=${section}&${query}`,
    );
    if (result.state !== "updating") return result;
    await new Promise((r) => setTimeout(r, 500));
  } while (performance.now() - begin < 60000);
  return result;
}
const report = {
  checked_at: new Date().toISOString(),
  range: { start: values.start, end: values.end },
  health: await request("/health"),
  stocks: [],
  note: "只反映本次平台來源查詢；空資料不表示所有公開API都沒有。分鐘K查詢用來核對權限，不假造分鐘資料。",
};
const market = await request("/api/market/status");
const minuteDay =
  values.end < market.daily_source_end ? values.end : market.daily_source_end;
for (const item of values.stocks.split(",")) {
  if (!/^(TWSE|TPEX):[A-Za-z0-9]{2,16}$/.test(item))
    throw Error("股票格式需為 TWSE:2409 或 TPEX:6147");
  const [market, symbol] = item.split(":"),
    pair = `${market}/${symbol}`;
  const entry = { market, symbol, sections: {}, errors: [] };
  async function check(name, load) {
    try {
      await load();
    } catch (error) {
      entry.sections[name] = { status: "check_failed", message: error.message };
      entry.errors.push({ section: name, message: error.message });
    }
  }
  await check("overview", async () => {
    const quote = await request(`/api/quote/${pair}`);
    entry.sections.overview = {
      status:
        quote.state === "unavailable"
          ? "source_error"
          : quote.last_price != null
            ? "available"
            : "source_empty",
      quote_state: quote.state,
      source: quote.source,
      source_time: quote.source_time,
      received_at: quote.received_at,
      bids: quote.bids?.length || 0,
      asks: quote.asks?.length || 0,
    };
  });
  await check("technical", async () => {
    const chart = await section(
      pair,
      "chart",
      new URLSearchParams({ ...report.range, resolution: "1d" }),
    );
    entry.sections.technical = {
      status: chart.state,
      bars: chart.data.data.length,
      latest_day: chart.data.data.at(-1)?.trade_date,
      message: chart.update.message,
    };
  });
  await check("minute_k", async () => {
    const minute = await section(
      pair,
      "chart",
      new URLSearchParams({
        start: minuteDay,
        end: minuteDay,
        resolution: "5m",
      }),
    );
    entry.sections.minute_k = {
      status:
        minute.data.source_error_code === "SOURCE_PERMISSION"
          ? "permission_denied"
          : minute.state,
      message: minute.update.message,
      bars: minute.data.data.length,
    };
  });
  await check("basic", async () => {
    const basic = await section(pair, "basic");
    entry.sections.basic = {
      status: basic.state,
      coverage: basic.data.coverage.filter(
        (r) => r.dataset === "CompanyProfile",
      ),
    };
  });
  await check("financial", async () => {
    const financial = await section(pair, "financial");
    entry.sections.financial = {
      status: financial.state,
      instrument_type: financial.data.instrument_type,
      coverage: financial.data.coverage,
      availability: financial.data.availability,
    };
  });
  await check("chips", async () => {
    const equity = await section(pair, "equity");
    entry.sections.chips = {
      status: equity.state,
      coverage: equity.data.coverage,
      distribution_rows: equity.data.details.distribution.length,
      house_difference: {
        status: "not_connected",
        reason:
          "目前集中度來源不提供完整家數差，不能用前15大分點或不完整分點推算。",
      },
    };
  });
  await check("peers", async () => {
    const peers = await request(
      `/api/peers/${pair}?reference=${values.end}&view_mode=latest&alignment=common`,
    );
    entry.sections.peers = {
      status:
        peers.instrument_type === "etf"
          ? peers.rows.some((r) => r.snapshot)
            ? "available"
            : "no_data"
          : peers.rows.find((r) => r.selected)?.metrics?.per?.status ===
              "not_applicable"
            ? "not_applicable"
            : peers.rows.some((r) => r.available > 0)
              ? "partial"
              : "source_pending",
      companies: peers.rows.length,
      companies_with_metrics: peers.rows.filter(
        (r) => r.available > 0 || r.snapshot,
      ).length,
      needs_loading: peers.rows.filter((r) => r.load_required).length,
      note: "只核對已取得比較資料；其他公司按需載入，不等於API沒有資料。",
    };
  });
  if (/^00\d{2,}[A-Z]?$/i.test(symbol)) {
    await check("fund_quarterly", async () => {
      const r = await request(
        `/api/fund-data/${pair}?section=quarterly&${range}`,
      );
      entry.sections.fund_quarterly = {
        status: r.status,
        rows: r.rows.length,
        date: r.date,
        basis: r.basis,
        note: r.note,
      };
    });
    await check("fund_nav", async () => {
      const r = await request(`/api/fund-data/${pair}?section=nav&${range}`);
      entry.sections.fund_nav = {
        status: r.status,
        snapshot: r.snapshot,
        history_rows: r.history.length,
        coverage: r.coverage,
      };
    });
    await check("fund_portfolio", async () => {
      const r = await request(
        `/api/fund-data/${pair}?section=portfolio&${range}`,
      );
      entry.sections.fund_portfolio = {
        status: r.status,
        stock_rows: r.rows.length,
        date: r.date,
        effective_date: r.effective_date,
        note: r.note,
      };
    });
  }
  await check("news", async () => {
    const news = await request(`/api/media/${pair}?${newsRange}&source=recent`);
    entry.sections.news = {
      status: news.sources.some((r) => r.available)
        ? "available"
        : "source_error",
      count: news.news.length,
      discussion_count: news.discussions.length,
      sources: news.sources.map(({ id, available, count, stale }) => ({
        id,
        available,
        count,
        stale,
      })),
      scope: "recent_feeds_filtered_to_range",
      range: { start: newsStart, end: values.end },
      note: "近期RSS不是完整歷史新聞；零筆不等於沒有公司新聞。",
    };
  });
  await check("news_index_sample", async () => {
    const index = await request(
      `/api/media/${pair}?date=${values.end}&source=index`,
    );
    entry.sections.news_index_sample = {
      day: values.end,
      sources: index.sources,
      count: index.news.length,
      scope: "single_day_sample_not_full_range",
    };
  });
  await check("strategy", async () => {
    const replay = await request("/api/strategy/backtest", {
      market,
      symbol,
      ...report.range,
      resolution: "1d",
      price_basis: "raw",
    });
    entry.sections.strategy = {
      status: replay.status,
      bars: replay.bars,
      note: "策略由來源K線計算；無交易或資料不足不代表API權限不足。",
    };
  });
  report.stocks.push(entry);
  console.log(
    JSON.stringify({
      stock: item,
      status: entry.errors.length ? "incomplete" : "checked",
      financial_values:
        entry.sections.financial?.availability?.metrics_available,
      financial_gaps: entry.sections.financial?.availability?.metrics_missing,
      minute: entry.sections.minute_k?.status,
      errors: entry.errors,
    }),
  );
}
const root = process.cwd(),
  target = resolve(values.output);
if (!target.startsWith(root + sep)) throw Error("輸出須位於專案內");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(report, null, 2), "utf8");
console.log(`Audit saved: ${values.output}`);
if (report.stocks.some((r) => r.errors.length)) process.exitCode = 1;
