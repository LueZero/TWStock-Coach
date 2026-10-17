import { createHash } from "node:crypto";
import { calculate } from "../api/indicators.js";
import { calculateTrade } from "./trade-math.js";

export const sections = [
  "overview",
  "basic",
  "technical",
  "financial",
  "chips",
  "market",
  "peers",
  "news",
  "scenarios",
];
export const toolDefinitions = [
  {
    name: "calculate_trade_profit",
    description:
      "依本次股票實際K線或均線價格與使用者明示股數計算每股價差及毛損益。買賣價格限本次價格或依商品合法跳檔取最近、向上、向下的調整價；均線參考價可能不能直接下單。股數必須由使用者問題提供，一張等於1000股。未提供費用不計算淨利；結果不是預測或保證。報告提及價差或損益金額前必須呼叫此工具並引用證據ID。",
    inputSchema: {
      type: "object",
      properties: {
        buy_price: { type: "number", minimum: 0.01, maximum: 1000000 },
        sell_price: { type: "number", minimum: 0.01, maximum: 1000000 },
        shares: { type: "integer", minimum: 1, maximum: 100000000 },
      },
      required: ["buy_price", "sell_price", "shares"],
      additionalProperties: false,
    },
  },
  {
    name: "get_stock_data",
    description:
      "查詢本次選取股票的實際平台資料。先 overview；再依需要查日K/指標、財務、籌碼、大盤、同業、新聞或技術價位參考。每次分析固定同一截止時間，含來源與缺漏；非即時資料會明示。technical可分頁：offset=0最新一頁，遞增往回查，回傳頁內按時間升序。",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", enum: sections },
        start: {
          type: "string",
          maxLength: 10,
          description:
            "自動模式可自選查詢起日，YYYY-MM-DD；不超過截止日前一年。截止固定，手動期間不可更改。",
        },
        offset: { type: "integer", minimum: 0, maximum: 1000 },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
      required: ["section"],
      additionalProperties: false,
    },
  },
  {
    name: "get_financial_history",
    description:
      "查詢完整財務API的一項指標及其歷年序列；不傳metric先列出可用指標。offset=0最早一頁，往後分頁。歷史截止與來源時間沿用本次研究範圍。",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", maxLength: 80 },
        start: { type: "string", maxLength: 10 },
        offset: { type: "integer", minimum: 0, maximum: 2000 },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_chip_detail",
    description:
      "查詢籌碼API子頁完整內容；先不傳dataset取得子頁清單，再選dataset查詢。含法人、主力代理、分點、集中度、融資融券、董監及基金等實際可用子頁；未串接不代填。數量以股，比例不換算。",
    inputSchema: {
      type: "object",
      properties: {
        dataset: { type: "string", maxLength: 80 },
        start: { type: "string", maxLength: 10 },
        offset: { type: "integer", minimum: 0, maximum: 2000 },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
      additionalProperties: false,
    },
  },
];

export function createStockTools(
  context,
  { fetcher = fetch, onCall = async () => {}, signal, complete = false } = {},
) {
  const base = new URL(context.api_url);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error("股票API網址設定不符");
  const scope = context.scope;
  if (
    !scope ||
    !["latest", "historical"].includes(scope.mode) ||
    !["TWSE", "TPEX"].includes(scope.market) ||
    !/^[A-Za-z0-9._-]{1,16}$/.test(scope.symbol) ||
    !Number.isFinite(Date.parse(scope.as_of))
  )
    throw Error("研究範圍不符");
  let snapshotPromise = context.snapshot
    ? Promise.resolve(context.snapshot)
    : null;
  const cache = new Map();
  const rangeTools = new Map();
  async function request(path, body) {
    const response = await fetcher(new URL(path, base), {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([
        AbortSignal.timeout(45000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    });
    if (!response.ok)
      throw Error(`平台資料查詢失敗（HTTP ${response.status}）`);
    const data = await response.json();
    if (JSON.stringify(data).length > 4000000) throw Error("平台回應過大");
    return data;
  }
  // Latest mode is captured at run start too. Send a historical cutoff to the API
  // so all sections use that exact timestamp, never the time of a later call.
  const snapshot = () =>
    (snapshotPromise ||= request("/api/research/report-input", {
      ...scope,
      mode: "historical",
      message: "提供研究資料",
      context: scope.context,
    }));
  const query = new URLSearchParams({
    as_of: scope.as_of,
    start: scope.start,
    end: scope.end,
  });
  const detail = (kind) => {
    if (!cache.has(kind))
      cache.set(
        kind,
        request(`/api/${kind}/${scope.market}/${scope.symbol}?${query}`),
      );
    return cache.get(kind);
  };
  function page(rows, offset, limit, reverse = false) {
    if (complete)
      return {
        rows: [...rows],
        total: rows.length,
        offset: 0,
        limit: rows.length,
        has_more: false,
      };
    const start = reverse ? Math.max(0, rows.length - offset - limit) : offset;
    const end = reverse ? Math.max(0, rows.length - offset) : offset + limit;
    return {
      rows: rows.slice(start, end),
      total: rows.length,
      offset,
      limit,
      has_more: reverse ? start > 0 : end < rows.length,
    };
  }
  function bounded(value, offset, limit) {
    if (Array.isArray(value)) return page(value, offset, limit);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          bounded(v, offset, limit),
        ]),
      );
    return value;
  }
  function modelData(value) {
    if (Array.isArray(value)) return value.map(modelData);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "revisions")
          .map(([key, v]) => [key, modelData(v)]),
      );
    return value;
  }
  async function call(name, args = {}) {
    const definition = toolDefinitions.find((t) => t.name === name);
    if (
      !definition ||
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) => !Object.hasOwn(definition.inputSchema.properties, k),
      )
    )
      throw Error("工具參數不符");
    for (const required of definition.inputSchema.required || [])
      if (!Object.hasOwn(args, required)) throw Error("缺少工具參數");
    for (const [key, value] of Object.entries(args)) {
      const spec = definition.inputSchema.properties[key];
      if (
        ["integer", "number"].includes(spec.type)
          ? (spec.type === "integer"
              ? !Number.isInteger(value)
              : !Number.isFinite(value)) ||
            value < spec.minimum ||
            value > spec.maximum
          : typeof value !== "string" ||
            value.length > (spec.maxLength || 100) ||
            (spec.enum && !spec.enum.includes(value))
      )
        throw Error("工具參數不符");
    }
    if (args.start !== undefined) {
      const stamp = Date.parse(args.start + "T00:00:00Z"),
        end = Date.parse(scope.end + "T00:00:00Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(args.start) ||
        !Number.isFinite(stamp) ||
        new Date(stamp).toISOString().slice(0, 10) !== args.start ||
        stamp > end ||
        end - stamp > 366 * 86400000
      )
        throw Error("查詢起日需為有效日期，且在截止日前一年內");
      if (scope.range_mode === "manual" && args.start !== scope.start)
        throw Error("使用者指定固定期間，不能自行更改起日");
      if (args.start !== scope.start) {
        if (!rangeTools.has(args.start))
          rangeTools.set(
            args.start,
            createStockTools(
              {
                ...context,
                snapshot: undefined,
                scope: { ...scope, start: args.start },
              },
              {
                fetcher,
                signal,
                complete,
                onCall: (event) =>
                  onCall({
                    ...event,
                    arguments: { ...event.arguments, start: args.start },
                  }),
              },
            ),
          );
        const { start, ...rest } = args;
        return rangeTools.get(start).call(name, rest);
      }
    }
    const receivedAt = new Date().toISOString(),
      offset = args.offset || 0,
      limit = args.limit || 20;
    let data,
      evidence = [],
      category,
      endpoint;
    try {
      if (name === "calculate_trade_profit") {
        category = "calculation";
        endpoint = "local:calculate_trade_profit";
        data = calculateTrade(
          args,
          await snapshot(),
          context.user_message || "",
        );
      } else if (name === "get_stock_data") {
        const { input, report } = await snapshot();
        category = args.section;
        endpoint = "/api/research/report-input";
        const filtered = (section) =>
          report.evidence.filter(
            (e) => e.category === section || e.id.startsWith(section + ":"),
          );
        if (category === "overview")
          data = {
            meta: { ...report.meta, mode: scope.mode },
            industry: report.meta.industry,
            datasets: input.facets.map(({ id, label, state, note }) => ({
              id,
              label,
              available: state !== "missing",
              note,
            })),
            quality: input.quality,
            bars_available: input.bars.length,
            expected_last_day: input.expected_last_day,
            continuity_verified: input.continuity_verified,
          };
        else if (category === "basic") {
          const company = await detail("equity");
          data = {
            profile: company.profile,
            catalogue: company.catalogue,
            targets: company.targets,
            coverage: company.coverage.filter((c) =>
              ["CompanyProfile", "AnalystTargetReport"].includes(c.dataset),
            ),
            note: company.note,
          };
          evidence = report.evidence.filter((e) => e.id === "company:profile");
        } else if (category === "technical") {
          evidence = filtered("technical");
          data = {
            metrics: report.metrics,
            bars: page(
              calculate(input.bars).filter(
                (b) => b.trade_date >= scope.start && b.trade_date <= scope.end,
              ),
              offset,
              limit,
              true,
            ),
            observations: report.observations,
            annotations: report.chart_annotations,
            quality: input.quality,
            price_basis: "raw",
            final_bars_only: true,
          };
        } else if (category === "scenarios") {
          evidence = report.evidence.filter((e) => e.category === "technical");
          data = {
            scenarios: report.scenarios,
            holding: report.holding,
            checks: report.plan_checks,
            note: "單一突破策略程式試算，並非股票整體評等。",
          };
        } else {
          evidence = filtered(category).map((e) => {
            if (!Array.isArray(e.rows)) return e;
            const ordered = [...e.rows].sort((a, b) =>
              String(a.date || a.trade_date || a.period || "").localeCompare(
                String(b.date || b.trade_date || b.period || ""),
              ),
            );
            const selected = page(ordered, offset, limit, true);
            return {
              ...e,
              rows: selected.rows,
              rows_total: selected.total,
              rows_offset: offset,
              rows_limit: limit,
              rows_has_more: selected.has_more,
            };
          });
          data = {
            coverage: input.facets.filter((f) => f.id === category),
            quality: input.quality,
          };
          if (category === "chips") {
            const chips = await detail("equity");
            data.workspace = bounded(chips.workspace, offset, limit);
            data.source_coverage = chips.coverage;
            data.unit = "股";
          }
        }
      } else if (name === "get_financial_history") {
        category = "financial";
        endpoint = `/api/fundamentals/${scope.market}/${scope.symbol}`;
        const finance = await detail("fundamentals");
        const metrics = finance.metrics || [];
        const catalogue = metrics.map((m) => ({
          key: m.key || m.id,
          label: m.label,
          date: m.date || m.period,
        }));
        if (!args.metric)
          data = { catalogue, coverage: finance.coverage, note: finance.note };
        else {
          const metric = metrics.find((m) => (m.key || m.id) === args.metric);
          if (!metric) throw Error("找不到指標；先查指標清單");
          data = {
            metric,
            sequential_changes: page(
              (finance.history?.[args.metric] || []).map(
                (row, index, history) => ({
                  period: row.period,
                  previous_period: history[index - 1]?.period || null,
                  difference:
                    index > 0 &&
                    row.value != null &&
                    history[index - 1].value != null
                      ? Number(
                          (row.value - history[index - 1].value).toFixed(10),
                        )
                      : null,
                }),
              ),
              offset,
              limit,
            ),
            history: bounded(
              finance.history?.[args.metric] || [],
              offset,
              limit,
            ),
            coverage: finance.coverage,
            note: finance.note,
          };
        }
      } else {
        category = "chips";
        endpoint = `/api/equity/${scope.market}/${scope.symbol}`;
        const equity = await detail("equity"),
          workspace = equity.workspace || {};
        const tabs = workspace.tabs || workspace;
        const entries = Array.isArray(tabs)
          ? tabs.map((t) => [t.id || t.key, t])
          : Object.entries(tabs);
        if (!args.dataset)
          data = {
            catalogue: entries.map(([id, t]) => ({
              id,
              label: t.label || t.title,
            })),
            coverage: equity.coverage,
            note: equity.note,
          };
        else {
          const selected = entries.find(([id]) => id === args.dataset);
          if (!selected) throw Error("找不到籌碼子頁；先查子頁清單");
          data = {
            dataset: bounded(selected[1], offset, limit),
            coverage: equity.coverage,
            note: equity.note,
            unit: "股",
          };
        }
      }
      const id =
        "tool:" +
        createHash("sha256")
          .update(JSON.stringify({ scope, name, args, data, evidence }))
          .digest("hex")
          .slice(0, 20);
      // Namespace source IDs per query so a follow-up cannot point to an older
      // report's identically named financial:eps / price:last evidence.
      const references = new Map(evidence.map((e) => [e.id, `${id}:${e.id}`]));
      function referenceData(value) {
        if (typeof value === "string") return references.get(value) || value;
        if (Array.isArray(value)) return value.map(referenceData);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, referenceData(v)]),
          );
        return value;
      }
      const result = {
        evidence_id: id,
        evidence: evidence.map((e) => ({
          ...referenceData(e),
          original_id: e.id,
        })),
        market: scope.market,
        symbol: scope.symbol,
        mode: scope.mode,
        as_of: scope.as_of,
        start: scope.start,
        end: scope.end,
        queried_at: receivedAt,
        endpoint,
        data: referenceData(data),
      };
      await onCall({ name, arguments: args, status: "completed", ...result });
      return modelData(result);
    } catch (error) {
      await onCall({
        name,
        arguments: args,
        status: "failed",
        as_of: scope.as_of,
        queried_at: receivedAt,
        error: error.message,
      });
      throw error;
    }
  }
  return { call, snapshot };
}
