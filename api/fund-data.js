import { resource } from "./source-cache.js";
import { fetchJSON, num, taipeiDay, validDate } from "./lib.js";
import {
  cathayFunds,
  cathayPortfolio,
  cathayQuarterly,
} from "./cathay-funds.js";

export const FUND_URLS = {
  profiles: "https://openapi.twse.com.tw/v1/opendata/t187ap47_L",
  snapshot: "https://mis.twse.com.tw/stock/data/all_etf.txt",
  history: "https://www.twse.com.tw/zh/ETFortune/ajaxEtfInfoChart",
  capitalList: "https://www.capitalfund.com.tw/CFWeb/api/etf/list",
  capitalPortfolio: "https://www.capitalfund.com.tw/CFWeb/api/etf/buyback",
};
const envelope = (data) => ({
  ...data,
  storage: "memory",
  database_used: false,
});
async function cached(key, load, ttl = 1800000) {
  const entry = resource(`fund:${key}`, load, ttl);
  await entry.promise;
  if (entry.error) throw Error("公開基金來源暫時無法取得，請稍後重試。");
  return entry.value;
}
const post = (url, body) =>
  fetchJSON(url, {
    timeout: 15000,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const positive = (value) => {
  const n = num(value);
  return n > 0 ? n : null;
};
const isoDay = (value) => {
  const text = String(value || "").replaceAll("/", "-");
  const date = /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text;
  try {
    return validDate(date);
  } catch {
    return null;
  }
};

export function parseFundSnapshots(payload) {
  if (!Array.isArray(payload?.a1)) throw Error("ETF 快照格式不符");
  const rows = payload.a1.flatMap((group) =>
    (group.rtCode == null || group.rtCode === "0000") &&
    Array.isArray(group.msgArray)
      ? group.msgArray
          .map((r) => {
            const date = isoDay(r.i),
              time = /^\d{2}:\d{2}:\d{2}$/.test(r.j) ? r.j : null;
            if (
              !/^[A-Za-z0-9]{2,16}$/.test(r.a) ||
              !date ||
              !time ||
              !Number.isFinite(Date.parse(`${date}T${time}+08:00`))
            )
              return null;
            const price = positive(r.e),
              nav = positive(r.f);
            return {
              symbol: r.a,
              name: r.b,
              date,
              source_time: `${date}T${time}+08:00`,
              price,
              indicative_nav: nav,
              premium_percent: num(r.g),
              calculated_premium_percent:
                price != null && nav != null ? (price / nav - 1) * 100 : null,
              previous_nav: positive(r.h),
              issued_units: num(r.c),
              timezone_category: String(r.k),
              source: "twse_mis_etf",
              source_url: FUND_URLS.snapshot,
              note: "預估淨值不是當日正式結算淨值；前一營業日淨值不冒充今日淨值。",
            };
          })
          .filter(Boolean)
      : [],
  );
  if (!rows.length) throw Error("ETF 快照未含有效資料");
  // Duplicate fund codes are ambiguous; never silently choose one issuer's row.
  const counts = new Map();
  rows.forEach((r) => counts.set(r.symbol, (counts.get(r.symbol) || 0) + 1));
  return rows.filter((r) => counts.get(r.symbol) === 1);
}
export async function fundProfiles() {
  return cached(
    "profiles",
    async () => {
      const rows = await fetchJSON(FUND_URLS.profiles, 15000);
      if (!Array.isArray(rows)) throw Error("基金目錄格式不符");
      return rows;
    },
    86400000,
  );
}
export async function fundSnapshots() {
  return cached(
    "snapshots",
    async () => ({
      rows: parseFundSnapshots(await fetchJSON(FUND_URLS.snapshot, 15000)),
      received_at: new Date().toISOString(),
    }),
    15000,
  );
}
export function parseNavHistory(payload, start, end) {
  if (Array.isArray(payload) && !payload.length) return [];
  if (!Array.isArray(payload?.netPrice) || !Array.isArray(payload?.atmps))
    throw Error("歷史淨值格式不符");
  const nav = new Map(),
    premium = new Map();
  for (const [items, dest, validate] of [
    [payload.netPrice, nav, positive],
    [payload.atmps, premium, num],
  ]) {
    for (const r of items) {
      const d = isoDay(r.date),
        v = validate(r.count);
      if (d && start <= d && d <= end && v != null) dest.set(d, v);
    }
  }
  return [...nav]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      nav: value,
      premium_percent: premium.get(date) ?? null,
      source: "twse_etfortune",
      source_url: FUND_URLS.history,
    }));
}
export async function fundNav(market, symbol, start, end) {
  const results = await Promise.allSettled([
    fundSnapshots(),
    market === "TWSE"
      ? cached(`history:${symbol}:${start}:${end}`, async () =>
          parseNavHistory(
            await fetchJSON(FUND_URLS.history, {
              timeout: 15000,
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                id: symbol,
                startDate: start.replaceAll("-", "/"),
                endDate: end.replaceAll("-", "/"),
                type: "fundPric",
              }).toString(),
            }),
            start,
            end,
          ),
        )
      : Promise.resolve(null),
  ]);
  const snap = results[0].status === "fulfilled" ? results[0].value : null;
  const row = snap?.rows.find((r) => r.symbol === symbol);
  const snapshot = row && start <= row.date && row.date <= end ? row : null;
  const history =
    results[1].status === "fulfilled" ? results[1].value || [] : [];
  return envelope({
    market,
    symbol,
    start,
    end,
    snapshot,
    history,
    status:
      snapshot || history.length
        ? results.some((r) => r.status === "rejected")
          ? "partial"
          : "available"
        : results.some((r) => r.status === "rejected")
          ? "source_error"
          : row
            ? "outside_range"
            : "no_data",
    coverage: [
      {
        label: "預估淨值與折溢價",
        status:
          results[0].status === "rejected"
            ? "source_error"
            : snapshot
              ? "available"
              : row
                ? "outside_range"
                : "no_data",
        source_url: FUND_URLS.snapshot,
        received_at: snap?.received_at || null,
      },
      {
        label: "歷史淨值與折溢價",
        status:
          market !== "TWSE"
            ? "not_connected"
            : results[1].status === "rejected"
              ? "source_error"
              : history.length
                ? "available"
                : "no_data",
        source_url: FUND_URLS.history,
      },
    ],
    note: "即時預估值與盤後歷史淨值分開呈現。資料時間可能不同，不混算；歷史淨值不是含息總報酬。",
  });
}

export function parseCapitalPortfolio(payload, fund) {
  const p = payload?.code === 200 ? payload.data : null;
  if (!p?.pcf || !Array.isArray(p.stocks)) throw Error("投信投資組合格式不符");
  const date = isoDay(p.pcf.date2),
    effective = isoDay(p.pcf.date1);
  if (!date || !effective || date > taipeiDay())
    throw Error("投資組合日期不符");
  const rows = p.stocks.flatMap((r) => {
    const shares = num(r.share),
      weight = num(r.weight);
    if (
      !/^[A-Za-z0-9.\-]{1,24}$/.test(r.stocNo) ||
      !Number.isSafeInteger(shares) ||
      shares < 0 ||
      weight == null ||
      weight < 0 ||
      weight > 100
    )
      return [];
    return [
      {
        symbol: r.stocNo,
        name: r.stocName,
        holding_shares: shares,
        weight_percent: weight,
        date,
        effective_date: effective,
        fund_code: fund.stockNo,
        fund_name: fund.shortName,
        basis: "issuer_pcf",
        source: "capital_public_pcf",
        source_url: `https://www.capitalfund.com.tw/etf/product/portfolio/${fund.fundNo}`,
      },
    ];
  });
  if (p.stocks.length && rows.length !== p.stocks.length)
    throw Error("投資組合有無法核對的持股，未當成完整清單");
  return {
    date,
    effective_date: effective,
    fund_code: fund.stockNo,
    fund_name: fund.shortName,
    rows,
    stock_weight_percent: rows.reduce((s, r) => s + r.weight_percent, 0),
    other_assets_present: [p.bonds, p.futures, p.assets, p.rps].some(
      (a) => Array.isArray(a) && a.length,
    ),
    note: "投信公開 PCF 組合，持股數量以股顯示；估值日與申購買回適用日不同。這不是基金交易流量、也不代表全市場基金持股。",
  };
}
async function capitalFunds() {
  return cached(
    "capital:list",
    async () => {
      const result = await post(FUND_URLS.capitalList, null);
      if (result.code !== 200 || !Array.isArray(result.data?.funds))
        throw Error("投信基金目錄格式不符");
      return result.data.funds.filter(
        (f) =>
          /^[0-9]+$/.test(f.fundNo) && /^[A-Za-z0-9]{2,16}$/.test(f.stockNo),
      );
    },
    86400000,
  );
}
async function capitalPortfolio(fund) {
  return cached(
    `capital:portfolio:${fund.stockNo}`,
    async () => ({
      ...parseCapitalPortfolio(
        await post(FUND_URLS.capitalPortfolio, { fundId: fund.fundNo }),
        fund,
      ),
      received_at: new Date().toISOString(),
    }),
    3600000,
  );
}
export async function fundPortfolio(market, symbol, end) {
  const catalogs = await Promise.allSettled([capitalFunds(), cathayFunds()]);
  const list = catalogs.flatMap((r, i) =>
      r.status === "fulfilled"
        ? r.value.map((f) => ({ ...f, issuer: i === 0 ? "capital" : "cathay" }))
        : [],
    ),
    fund = list.find((f) => f.stockNo === symbol);
  if (!fund && catalogs.some((r) => r.status === "rejected"))
    throw Error("部分投信目錄未取得，尚不能判定此基金不在涵蓋範圍");
  if (!fund)
    return envelope({
      status: "not_connected",
      rows: [],
      note: "目前已接入群益及國泰投信公開組合；此基金發行人的組合接口尚未接入。",
    });
  const data = await (fund.issuer === "cathay"
    ? cathayPortfolio(fund)
    : capitalPortfolio(fund));
  if (data.date > end)
    return envelope({
      market,
      symbol,
      status: "outside_range",
      rows: [],
      requested_end: end,
      latest_source_date: data.date,
      received_at: data.received_at,
      note: "來源目前只提供最新 PCF，其估值日晚於查詢截止；未將未來組合回填成歷史持股。",
    });
  return envelope({
    status: "available",
    ...data,
    requested_end: end,
    availability_basis: "current_source_observation",
    market,
    symbol,
  });
}
export async function fundHolders(market, symbol, end) {
  const [catalogs, profiles] = await Promise.all([
    Promise.allSettled([capitalFunds(), cathayFunds()]),
    fundProfiles(),
  ]);
  const list = catalogs.flatMap((r, i) =>
    r.status === "fulfilled"
      ? r.value.map((f) => ({ ...f, issuer: i === 0 ? "capital" : "cathay" }))
      : [],
  );
  const failedIssuers = catalogs.flatMap((r, i) =>
    r.status === "rejected" ? [i === 0 ? "群益" : "國泰"] : [],
  );
  // Only domestic equity funds: overseas tickers can collide with Taiwan stock codes.
  const domestic = new Set(
    profiles
      .filter((p) => /國內成分證券/.test(p["基金類型"]))
      .map((p) => p["基金代號"]),
  );
  const funds = list.filter((f) => domestic.has(f.stockNo));
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, funds.length) }, async () => {
      while (next < funds.length) {
        const fund = funds[next++];
        try {
          results.push({
            fund,
            data: await (fund.issuer === "cathay"
              ? cathayPortfolio(fund)
              : capitalPortfolio(fund)),
          });
        } catch {
          results.push({ fund, error: true });
        }
      }
    }),
  );
  const eligible = results.filter((r) => r.data && r.data.date <= end);
  const outside = results.filter((r) => r.data && r.data.date > end);
  const failed = results.filter((r) => r.error);
  const rows = eligible.flatMap(
    (r) => r.data?.rows.filter((p) => p.symbol === symbol) || [],
  );
  return envelope({
    market,
    symbol,
    status: !funds.length
      ? failedIssuers.length
        ? "source_error"
        : "not_connected"
      : !eligible.length
        ? failed.length || failedIssuers.length
          ? "source_error"
          : "outside_range"
        : failed.length || outside.length || failedIssuers.length
          ? "partial"
          : "available",
    rows,
    requested_end: end,
    availability_basis: "current_source_observation",
    coverage: {
      issuer: "群益、國泰",
      failed_issuers: failedIssuers,
      funds_requested: funds.length,
      funds_loaded: results.filter((r) => r.data).length,
      funds_eligible: eligible.length,
      outside_range_funds: outside.map((r) => ({
        symbol: r.fund.stockNo,
        date: r.data.date,
      })),
      failed_funds: failed.map((r) => r.fund.stockNo),
      all_market: false,
      basis: "issuer_public_portfolios",
    },
    note: "僅反查已接入且核對為國內成分的群益及國泰 ETF 公開組合；零筆只代表已查清單未列本股。逐筆保留估值日與資料口徑，不是法人已成交或全市場基金持有量。季度揭露不混入日組合。",
  });
}
export async function fundQuarterly(market, symbol, end) {
  return envelope({
    market,
    symbol,
    requested_end: end,
    availability_basis: "current_source_observation",
    ...(await cathayQuarterly(symbol, end)),
  });
}

export async function fundPeers(market, symbol, reference, requested = null) {
  const [profiles, snap] = await Promise.all([fundProfiles(), fundSnapshots()]);
  const target = profiles.find((p) => p["基金代號"] === symbol);
  const index = target?.["標的指數/追蹤指數名稱"],
    type = target?.["基金類型"];
  const sameIndex = profiles.filter(
    (p) =>
      index && p["標的指數/追蹤指數名稱"] === index && p["基金代號"] !== symbol,
  );
  const candidates = target
    ? profiles.filter((p) => p["基金類型"] === type)
    : [];
  const selected = new Set([
    symbol,
    ...(requested || []).map((s) => s.split(":")[1]),
  ]);
  const choices = requested?.length
    ? profiles.filter((p) => selected.has(p["基金代號"]))
    : candidates;
  const commonDate = snap.rows
    .filter(
      (r) =>
        r.date <= reference &&
        (r.symbol === symbol ||
          choices.some((p) => p["基金代號"] === r.symbol)),
    )
    .map((r) => r.date)
    .sort()
    .at(-1);
  const rows = choices
    .map((p) => {
      const code = p["基金代號"],
        quote = snap.rows.find((r) => r.symbol === code);
      return {
        market: "TWSE",
        symbol: code,
        name: p["基金簡稱"],
        industry: p["基金類型"],
        selected: code === symbol,
        business_peer: !!index && p["標的指數/追蹤指數名稱"] === index,
        same_industry: p["基金類型"] === type,
        tracking_index: p["標的指數/追蹤指數名稱"],
        load_required: false,
        snapshot:
          quote && commonDate && quote.date === commonDate ? quote : null,
        status:
          quote && commonDate && quote.date === commonDate
            ? "available"
            : "outside_range",
      };
    })
    .sort(
      (a, b) =>
        Number(b.selected) - Number(a.selected) ||
        Number(b.business_peer) - Number(a.business_peer) ||
        a.symbol.localeCompare(b.symbol),
    );
  if (!rows.some((r) => r.selected))
    rows.unshift({
      market,
      symbol,
      name: symbol,
      selected: true,
      load_required: false,
      snapshot:
        snap.rows.find((r) => r.symbol === symbol && r.date === commonDate) ||
        null,
      status: target ? "no_data" : "not_connected",
    });
  return envelope({
    instrument_type: "etf",
    classification_status: target ? "available" : "not_connected",
    market,
    symbol,
    reference_day: reference,
    data_date: commonDate || null,
    rows,
    candidates: candidates.map((p) => ({
      market: "TWSE",
      symbol: p["基金代號"],
      name: p["基金簡稱"],
    })),
    industry: type || "基金分類未接入",
    selection_basis: {
      label: sameIndex.length
        ? "相同追蹤指數優先，其餘同基金類型"
        : "官方基金類型候選",
      detail:
        "相同基金類型可能包含不同產業與投資策略，不代表相同風險或直接替代品。",
      sources: [FUND_URLS.profiles],
    },
    note: "只比較相同來源日的市價、預估淨值與折溢價；不使用公司 EPS／本益比。海外資產受時區影響，折溢價不能單獨當作便宜排名；目前未提供含息總報酬比較。",
    received_at: snap.received_at,
  });
}
