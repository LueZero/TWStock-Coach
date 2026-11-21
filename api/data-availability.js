const waiting = new Set(["queued", "loading"]);
const failures = [
  "invalid_token",
  "permission_denied",
  "quota_exceeded",
  "source_blocked",
  "source_error",
  "not_configured",
  "not_connected",
  "not_applicable",
  "outside_range",
  "no_data",
];
export const isEtf = (symbol) => /^00\d{2,}[A-Z]?$/i.test(symbol);
export const ETF_COMPANY_DATASETS = new Set([
  "TaiwanStockMonthRevenue",
  "TaiwanStockFinancialStatements",
  "TaiwanStockBalanceSheet",
  "TaiwanStockCashFlowsStatement",
  "TaiwanStockPER",
]);

function gapReason(metric, coverage) {
  const dependencies = (metric.datasets || [])
    .map((key) => coverage.find((c) => c.dataset === key))
    .filter(Boolean);
  const failed = failures.find((status) =>
    dependencies.some((c) => c.status === status),
  );
  if (failed) {
    const source = dependencies.find((c) => c.status === failed);
    return {
      status: failed === "no_data" ? "source_empty" : failed,
      reason:
        source.message ||
        (failed === "no_data"
          ? "來源請求成功，但本次股票與日期範圍回傳空資料；不能推論所有 API 都沒有。"
          : "請查看相關來源的實際回應狀態。"),
    };
  }
  if (dependencies.some((c) => waiting.has(c.status)))
    return {
      status: "loading",
      reason: "相關來源仍在查詢，尚不能判定指標缺漏。",
    };
  return {
    status: "calculation_unavailable",
    reason:
      metric.missing_reason === "non_positive_profit"
        ? "分母淨利非正，計算條件未成立；不是權限不足。"
        : `來源資料已取得，但此指標可能仍缺科目、足夠期間或有效分母。${metric.note || ""}`,
  };
}

export function annotateFinancialAvailability(data, symbol) {
  const fund = isEtf(symbol);
  const coverage = data.coverage || [];
  const gaps = (data.metrics || [])
    .filter((m) => m.value == null)
    .map((m) => ({
      key: m.key,
      label: m.label,
      datasets: m.datasets || [],
      ...gapReason(m, coverage),
    }));
  const catalog = data.catalog
    ? {
        ...data.catalog,
        groups: data.catalog.groups.map((group) => ({
          ...group,
          pages: group.pages.map((page) => {
            if (fund && page.kind !== "dividends" && page.kind !== "documents")
              return {
                ...page,
                status: "not_applicable",
                availability_reason:
                  "這是公司財報／估值口徑，不適用 ETF。基金淨值、折溢價與投資組合評價需另接資料，不能用公司指標代替。",
              };
            if (page.requires)
              return {
                ...page,
                availability_reason: `平台尚缺完整計算條件，不代表 API 拒絕權限。${page.requires}`,
              };
            const missing = gaps.filter((m) => page.keys.includes(m.key));
            const dependencies = new Set([
              ...(page.report ? [page.report] : []),
              ...missing.flatMap((m) => m.datasets),
            ]);
            const sourceRows = coverage.filter((c) =>
              dependencies.has(c.dataset),
            );
            let reason = missing.length
              ? `${missing.length} 項指標暫缺；${missing.every((m) => m.status === "calculation_unavailable") ? "來源已取得，仍需核對科目、比較期間與有效分母；不是已確認權限不足。" : missing[0].reason}`
              : null;
            if (!reason && page.status === "no_data")
              reason = sourceRows.some((c) => waiting.has(c.status))
                ? "來源仍在查詢中。"
                : sourceRows.some((c) => c.status === "no_data")
                  ? "本次來源回傳空資料，不是已確認權限不足。"
                  : "此細項尚缺可用來源或必要科目，請核對來源狀態。";
            return { ...page, availability_reason: reason };
          }),
        })),
      }
    : data.catalog;
  if (fund && catalog) {
    const group = catalog.groups.find((g) => g.id === "valuation");
    group?.pages.unshift(
      {
        id: "etf-nav",
        label: "ETF 淨值與折溢價",
        kind: "fund_nav",
        keys: [],
        status: "reference",
      },
      {
        id: "etf-portfolio",
        label: "ETF 投資組合",
        kind: "fund_portfolio",
        keys: [],
        status: "reference",
      },
      {
        id: "etf-quarterly",
        label: "ETF 季度揭露",
        kind: "fund_quarterly",
        keys: [],
        status: "reference",
      },
    );
  }
  return {
    ...data,
    metrics: gaps.length
      ? (data.metrics || []).map((m) =>
          m.value == null
            ? { ...m, availability: gaps.find((g) => g.key === m.key) }
            : m,
        )
      : data.metrics,
    instrument_type: fund ? "etf" : "stock",
    catalog,
    availability: {
      metrics_available: (data.metrics || []).filter((m) => m.value != null)
        .length,
      metrics_missing: gaps.length,
      metric_gaps: gaps,
      page_gaps:
        catalog?.groups.flatMap((g) =>
          g.pages
            .filter((p) => !["available", "reference"].includes(p.status))
            .map((p) => ({
              category: g.label,
              id: p.id,
              label: p.label,
              status: p.status,
              reason: p.availability_reason || p.note || null,
            })),
        ) || [],
      note: "這是本次平台來源與計算的覆蓋狀態，不宣稱所有公開 API 都已搜尋完畢。",
    },
  };
}

export function sourceObservation(dataset, source, rows) {
  const dates = rows
    .map((r) => r.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ""))
    .sort();
  return {
    rows: rows.length,
    data_start: dates[0] || null,
    data_end: dates.at(-1) || null,
    scope:
      dataset === "CompanyProfile"
        ? "current_profile"
        : dataset === "OfficialBookValue"
          ? "latest_quarter"
          : source === "tdcc_history"
            ? "historical_weeks"
            : source === "tdcc"
              ? "latest_week"
              : dataset === "DirectorHoldingsReport"
                ? "latest_position"
                : dataset === "InsiderTransfersReport"
                  ? "latest_official_snapshot"
                  : "requested_range",
  };
}
