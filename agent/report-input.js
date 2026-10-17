import { createStockTools } from "./tools.js";

const labels = {
  overview: "研究範圍",
  basic: "基本分析",
  technical: "技術指標與K線",
  financial: "財務分析",
  chips: "籌碼分析",
  peers: "同業比較",
  news: "熱門新聞與討論",
  market: "大盤市場",
  scenarios: "技術價位參考",
};
export const INPUT_VERSION = "stock-context-v1";
function shareSources(packet) {
  const catalogue = {},
    ids = new Map();
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === "source" && Array.isArray(item) && item.length) {
          const signature = JSON.stringify(item);
          let id = ids.get(signature);
          if (!id) {
            id = `source:${ids.size + 1}`;
            ids.set(signature, id);
            catalogue[id] = item;
          }
          return ["source_ref", id];
        }
        return [key, visit(item)];
      }),
    );
  }
  return { ...visit(packet), source_catalogue: catalogue };
}
function compact(value) {
  if (typeof value === "number")
    return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    const rows = value.rows;
    if (
      Array.isArray(rows) &&
      rows.length >= 8 &&
      rows.every((r) => r && !Array.isArray(r) && typeof r === "object")
    ) {
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      return {
        ...compact(
          Object.fromEntries(
            Object.entries(value).filter(([k]) => k !== "rows"),
          ),
        ),
        encoding: "columnar",
        columns,
        rows: rows.map((r) => columns.map((k) => compact(r[k] ?? null))),
      };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) => !["revisions", "assessment", "original_id"].includes(k),
        )
        .map(([k, v]) => [k, compact(v)]),
    );
  }
  return value;
}
export async function prepareReportInput(
  context,
  { fetcher = fetch, onCall = async () => {}, signal } = {},
) {
  const calls = [],
    blocks = [],
    manifest = [];
  const tools = createStockTools(context, {
    fetcher,
    signal,
    complete: true,
    onCall: async (event) => {
      const entry = { ...event, origin: "prepared_input" };
      calls.push(entry);
      await onCall(entry);
    },
  });
  const snapshot = await tools.snapshot();
  // Sections are collected before the model runs; this is data preparation,
  // not a second model loop. The model may still request specific details.
  for (const [section, label] of Object.entries(labels)) {
    if (signal?.aborted) throw Error("工作已取消");
    try {
      const result = await tools.call("get_stock_data", {
        section,
        limit: 120,
      });
      const data = result.data;
      if (section === "technical") {
        const all = [...data.bars.rows];
        for (let offset = all.length; offset < data.bars.total; offset += 120) {
          const more = await tools.call("get_stock_data", {
            section,
            limit: 120,
            offset,
          });
          all.unshift(...more.data.bars.rows);
        }
        data.bars = {
          ...data.bars,
          rows: all,
          limit: all.length,
          has_more: false,
        };
        const keys = [
          "id",
          "revision",
          "trade_date",
          "timestamp",
          "open",
          "high",
          "low",
          "close",
          "volume",
          "ma5",
          "ma10",
          "ma20",
          "ma60",
          "ma120",
          "ma240",
          "rsi14",
          "macd",
          "macd_signal",
          "macd_histogram",
          "k",
          "d",
          "volume_ratio",
          "atr14",
          "bb_upper",
          "bb_lower",
          "source_time",
          "received_at",
        ];
        data.bars.rows = data.bars.rows.map((row) =>
          Object.fromEntries(keys.map((k) => [k, row[k] ?? null])),
        );
      }
      const missing =
        section === "overview"
          ? false
          : section === "basic"
            ? !data.profile && !data.catalogue
            : section === "technical"
              ? !data.bars.rows.length
              : section === "scenarios"
                ? !data.scenarios.length
                : section === "chips"
                  ? !result.evidence.some(
                      (e) => e.value != null || e.rows?.length,
                    )
                  : section === "financial"
                    ? !result.evidence.some((e) => e.value != null)
                    : section === "peers"
                      ? !result.evidence.some((e) => e.comparable_count > 0)
                      : !result.evidence.length;
      const hasMore = (value) =>
        value &&
        typeof value === "object" &&
        (value.has_more === true ||
          Object.values(value).some(
            (v) => typeof v === "object" && hasMore(v),
          ));
      const truncated =
        result.evidence.some((e) => e.rows_has_more || e.sample_truncated) ||
        (section === "financial" &&
          result.evidence.some(
            (e) =>
              e.id.endsWith("financial:coverage") &&
              e.rows?.some((r) => r.status !== "available"),
          )) ||
        (section === "technical" && data.metrics?.ma240 == null) ||
        hasMore(data.workspace) ||
        data.coverage?.some((c) => c.state === "missing") ||
        data.source_coverage?.some((c) => c.status !== "available");
      const item = {
        section,
        label,
        status: missing ? "missing" : truncated ? "partial" : "included",
        evidence_count: result.evidence.length,
        evidence_id: result.evidence_id,
        evidence_ids: calls
          .filter(
            (c) => c.arguments.section === section && c.status === "completed",
          )
          .map((c) => c.evidence_id),
        ...(section === "technical"
          ? { bar_count: data.bars.rows.length }
          : {}),
        ...(truncated
          ? {
              note: "部分來源缺漏或資料覆蓋不足；已取得的區間明細不因分頁省略。",
            }
          : {}),
      };
      manifest.push(item);
      blocks.push({
        ...item,
        data: compact(data),
        evidence: compact(result.evidence),
      });
    } catch (error) {
      const item = { section, label, status: "failed", note: error.message };
      manifest.push(item);
      blocks.push(item);
    }
  }
  if (
    !blocks.some(
      (b) => b.section === "technical" && b.data?.bars.rows.length,
    ) &&
    !blocks.some(
      (b) =>
        b.section === "financial" && b.evidence?.some((e) => e.value != null),
    )
  )
    throw Error("行情與財務皆無可分析資料，請先載入股票資訊。");
  return {
    snapshot,
    calls,
    packet: shareSources({
      version: INPUT_VERSION,
      scope: context.scope,
      manifest,
      sections: blocks,
      note: "區間走勢／籌碼／新聞依分析起日至截止篩選；最新財務與同季比較以截止前可得資料為準，較早期間僅作比較或暖機。encoding=columnar 的表格依columns欄名與rows每列同位置數值讀取，未刪除列；source_ref依source_catalogue查完整來源，重複來源只記一次。缺漏不補零；包含資料不代表來源完整覆蓋。",
    }),
  };
}
