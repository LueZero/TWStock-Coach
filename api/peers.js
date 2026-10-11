import { rows } from "./db.js";
import { summarize, DATASETS } from "./fundamentals.js";
import { now, num, median, daysBetween, fail } from "./lib.js";
export const FIELDS = [
  ["per", "本益比", "倍", "TaiwanStockPER", 14],
  ["pbr", "股價淨值比", "倍", "TaiwanStockPER", 14],
  ["dividend_yield", "來源殖利率", "%", "TaiwanStockPER", 14],
  ["revenue_yoy", "月營收年增", "%", "TaiwanStockMonthRevenue", 100],
  ["eps", "單季EPS", "元／股", "TaiwanStockFinancialStatements", 200],
  ["gross_margin", "毛利率", "%", "TaiwanStockFinancialStatements", 200],
  [
    "operating_margin",
    "營業利益率",
    "%",
    "TaiwanStockFinancialStatements",
    200,
  ],
  ["debt_ratio", "負債比率", "%", "TaiwanStockBalanceSheet", 200],
];
const GROUPS = [
  {
    name: "大型顯示面板製造",
    members: ["TWSE:2409", "TWSE:3481"],
    sources: [
      "https://www.auo.com/zh-TW/about_auo/index",
      "https://www.innolux.com/Uploads/22/2023%E5%85%AC%E5%8F%B8%E5%B9%B4%E5%A0%B1_5239e8.pdf",
    ],
  },
  {
    name: "IC封裝載板",
    members: ["TWSE:3189", "TWSE:3037", "TWSE:8046"],
    sources: [
      "https://www.kinsus.com.tw/",
      "https://www.unimicron.com/",
      "https://www.nanyapcb.com.tw/",
    ],
  },
];
const key = (i) => i.market + ":" + i.symbol,
  period = (d, r) =>
    d === "TaiwanStockMonthRevenue" && r.revenue_year && r.revenue_month
      ? `${r.revenue_year}-${String(r.revenue_month).padStart(2, "0")}`
      : r.date;
export async function report(
  market,
  symbol,
  reference,
  viewMode = "latest",
  alignment = "common",
  requested = null,
  cutoffStamp = null,
) {
  const all = await rows("SELECT * FROM instruments ORDER BY symbol"),
    target = all.find((i) => key(i) === market + ":" + symbol);
  if (!target) fail("股票目錄尚無此代號，請先搜尋股票");
  const receipt =
      cutoffStamp ||
      (viewMode === "historical"
        ? new Date(
            Math.min(Date.parse(reference + "T23:59:59.999+08:00"), Date.now()),
          ).toISOString()
        : now()),
    snaps = await rows(
      "SELECT * FROM fundamental_snapshots WHERE dataset=ANY($1) AND received_at<=$2 ORDER BY id DESC",
      [Object.keys(DATASETS), receipt],
    ),
    available = new Set(snaps.map(key)),
    group = GROUPS.find((g) => g.members.includes(key(target))),
    business = (i) => group?.members.includes(key(i)) ?? false,
    candidates = all
      .filter(
        (i) =>
          i.industry &&
          i.industry === target.industry &&
          i.symbol !== symbol &&
          !i.symbol.startsWith("00"),
      )
      .sort(
        (a, b) =>
          Number(!business(a)) - Number(!business(b)) ||
          Number(!available.has(key(a))) - Number(!available.has(key(b))) ||
          a.symbol.localeCompare(b.symbol),
      ),
    by = Object.fromEntries(all.map((i) => [key(i), i]));
  if (requested?.some((k) => !by[k])) fail("比較名單含目錄不存在的股票");
  const choices = [
      ...new Map(
        [
          target,
          ...(requested?.length ? requested.map((k) => by[k]) : candidates),
        ].map((i) => [key(i), i]),
      ).values(),
    ].sort(
      (a, b) =>
        Number(key(a) !== key(target)) - Number(key(b) !== key(target)) ||
        Number(!business(a)) - Number(!business(b)),
    ),
    raw = {},
    sources = {};
  for (const s of snaps) {
    const k = key(s);
    raw[k] ??= {};
    sources[k] ??= {};
    if (s.dataset in raw[k]) continue;
    raw[k][s.dataset] = s.data.filter((r) => r.date <= reference);
    sources[k][s.dataset] = {
      source: s.source,
      revision: s.revision,
      received_at: s.received_at,
    };
  }
  const common = {};
  for (const d of new Set(FIELDS.map((f) => f[3])))
    common[d] =
      (raw[key(target)]?.[d] ?? [])
        .map((r) => period(d, r))
        .sort()
        .at(-1) ?? null;
  const results = choices.map((i) => {
    const k = key(i);
    let visible = raw[k] ?? {};
    if (alignment === "common")
      visible = Object.fromEntries(
        Object.entries(visible).map(([d, rs]) => [
          d,
          d in common
            ? rs.filter((r) => period(d, r) <= (common[d] ?? ""))
            : rs,
        ]),
      );
    const metrics = Object.fromEntries(
        summarize(visible, reference, false).metrics.map((m) => [m.key, m]),
      ),
      cells = {};
    for (const [field, , , d, maxAge] of FIELDS) {
      const m = metrics[field] ?? {},
        p = m.period ?? null,
        mismatch = alignment === "common" && p !== common[d],
        v = mismatch ? null : num(m.value),
        age = p ? daysBetween(reference, p.length === 7 ? p + "-01" : p) : null,
        status =
          v == null
            ? "missing"
            : age == null || age < 0 || age > maxAge
              ? "stale"
              : "available";
      cells[field] = {
        value: v,
        period: p,
        status,
        reason: !sources[k]?.[d]
          ? "尚未擷取來源"
          : mismatch
            ? "未提供本檔比較期間資料"
            : v == null
              ? "來源未提供此數值"
              : status === "stale"
                ? "超過資料有效期間"
                : "",
        source: sources[k]?.[d] ?? null,
      };
    }
    return {
      market: i.market,
      symbol: i.symbol,
      name: i.name,
      industry: i.industry,
      selected: k === key(target),
      same_industry: !!target.industry && i.industry === target.industry,
      business_peer: business(i),
      load_required: FIELDS.some((f) => !sources[k]?.[f[3]]),
      metrics: cells,
      available: Object.values(cells).filter((c) => c.status === "available")
        .length,
    };
  });
  const medians = {};
  for (const [field] of FIELDS) {
    const cell = results.find((r) => r.selected).metrics[field],
      vals = results
        .filter(
          (r) =>
            cell.status === "available" &&
            !r.selected &&
            r.same_industry &&
            r.metrics[field].status === "available" &&
            r.metrics[field].period === cell.period,
        )
        .map((r) => r.metrics[field].value);
    medians[field] = {
      value: vals.length >= 2 ? median(vals) : null,
      count: vals.length,
    };
  }
  return {
    market,
    symbol,
    industry: target.industry,
    reference_day: reference,
    selection_basis: {
      label: group?.name ?? "交易所產業分類候選",
      detail: group
        ? "完整帶出同產業候選；依官方公司產品資料核對的業務相近公司優先排列，其餘屬產業大分類。可篩選業務相近組，這不是交易所細產業分類。"
        : "完整帶出股票目錄的同產業公司，屬於大分類，不代表直接競爭者；可自行調整名單。",
      sources: group?.sources ?? [],
    },
    view_mode: viewMode,
    alignment,
    as_of: receipt,
    rows: results,
    medians,
    fields: FIELDS.map(([key, label, unit, d]) => ({
      key,
      label,
      unit,
      common_period: common[d],
    })),
    candidates: candidates.map(({ market, symbol, name, industry }) => ({
      market,
      symbol,
      name,
      industry,
    })),
    note: "分類只代表同產業候選，不保證相同業務或會計口徑。中位數只含至少2家有有效資料的同產業比較公司，不含本檔；缺值、過期、跨產業不加入。各自最新模式期間可能不同。單季EPS不可當作規模或報酬排名；估值低不代表值得買。金融業等需使用適合產業的指標。",
  };
}
