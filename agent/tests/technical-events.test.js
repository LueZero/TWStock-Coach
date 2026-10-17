import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateTechnicalRows,
  EVENT_VERSION,
} from "../../api/technical-events.js";
import { aggregate } from "../../api/charting.js";
import { buildRuleReport } from "../../api/report-conditions.js";
import { chartAnnotations } from "../../api/report-observations.js";
import { prepareReportInput } from "../report-input.js";

function row(i, values = {}) {
  const day = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
  return {
    timestamp: day + "T05:30:00.000Z",
    trade_date: day,
    is_final: true,
    close: 9,
    ma5: 9,
    ma20: 10,
    ma60: 11,
    macd: -1,
    macd_signal: 0,
    k: 20,
    d: 30,
    prior_high20: 12,
    prior_low20: 7,
    volume_ratio: 2,
    ...values,
  };
}

test("K棒交叉、轉多空與突破跌破依當期實值判定，持續狀態不重複發訊號", () => {
  const up = {
    close: 14,
    ma5: 12,
    ma20: 11,
    ma60: 10,
    macd: 1,
    k: 40,
    prior_high20: 13,
  };
  const data = annotateTechnicalRows([
    row(0),
    row(1, up),
    row(2, up),
    row(3, { close: 6, ma5: 8, ma20: 9, ma60: 10 }),
  ]);
  assert.deepEqual(
    new Set(data[1].technical_events.map((e) => e.code)),
    new Set([
      "ma5_ma20_up",
      "macd_up",
      "kd_up",
      "alignment_bullish",
      "close_above_ma20",
      "break_high20",
    ]),
  );
  assert.equal(data[1].technical_state.label, "均線多頭排列");
  assert.equal(data[2].technical_state.code, "bullish");
  assert.equal(data[2].technical_events.length, 0);
  assert.ok(data[3].technical_events.some((e) => e.code === "break_low20"));
  assert.ok(
    data[3].technical_events.some((e) => e.code === "close_below_ma20"),
  );
  assert.ok(data[3].technical_events.some((e) => e.code === "ma5_ma20_down"));
  assert.ok(data[3].technical_events.every((e) => e.kind === "oppose"));
  assert.ok(
    data[1].technical_events.every(
      (e) => e.rule_version === EVENT_VERSION && e.note && e.values,
    ),
  );
});

test("未完成、空指標不生正式訊號，新增未來K不改寫既有事件，同棒多空可並存", () => {
  const a = row(0),
    b = row(1, { ma5: 12, ma20: 11, ma60: 10, macd: -2 });
  const flat = [a, b];
  const base = annotateTechnicalRows(flat);
  assert.deepEqual(
    annotateTechnicalRows([...flat, row(2, { close: 9999 })]).slice(0, 2),
    base,
  );
  const forming = row(1, { is_final: false, close: 9999, ma5: 9999 });
  assert.equal(
    annotateTechnicalRows([a, forming])[1].technical_events.length,
    0,
  );
  assert.equal(
    annotateTechnicalRows([
      row(0, { ma5: null, ma20: null, ma60: null, macd: null, k: null }),
      row(1, { ma5: null, ma20: null, ma60: null, macd: null, k: null }),
    ])[1].technical_events.length,
    0,
  );
  const mixed = annotateTechnicalRows([row(0, { macd: 1 }), b])[1]
    .technical_events;
  assert.ok(mixed.some((e) => e.kind === "support"));
  assert.ok(mixed.some((e) => e.kind === "oppose"));
  const minutes = [
    row(0, { timestamp: "2026-01-01T01:05Z" }),
    row(0, { timestamp: "2026-01-01T01:10Z", ma5: 12, ma20: 11, ma60: 10 }),
  ];
  assert.ok(
    annotateTechnicalRows(minutes)[1].technical_events.every(
      (e) => e.timestamp === minutes[1].timestamp,
    ),
  );
});

test("個股日K、報告K線與AI註記共用規則，完整區間事件不截成最後16筆", async () => {
  const bars = Array.from({ length: 180 }, (_, i) => {
    const close = 30 + Math.sin(i / 2) * 5 + i * 0.01;
    return row(i, {
      id: i + 1,
      revision: 1,
      open: close - 0.2,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + (i % 7) * 300,
      price_basis: "raw",
      session: "daily_aggregate",
    });
  });
  const start = bars[60].trade_date,
    end = bars.at(-1).trade_date;
  const report = buildRuleReport({
    bars,
    evidence: [],
    quality: [],
    facets: [],
    context: {},
    market: "TWSE",
    symbol: "2883",
    name: "測試",
    asset: "stock",
    start,
    end,
    as_of: "2026-10-18T00:00Z",
    expected_last_day: end,
    continuity_verified: true,
  });
  const chart = aggregate(bars, "1d", new Date("2026-10-18T00:00Z"));
  assert.deepEqual(
    report.chart_annotations,
    chart
      .filter((r) => r.trade_date >= start)
      .flatMap((r) => r.technical_events),
  );
  assert.ok(report.chart_annotations.length > 16);
  assert.deepEqual(
    report.chart_bars.at(-1).technical_events,
    chart.at(-1).technical_events,
  );
  assert.equal(report.technical_event_version, EVENT_VERSION);
  assert.equal(
    chartAnnotations(
      bars.map((r) => ({ ...r, ma5: r.id % 2 ? 9 : 11, ma20: 10 })),
      start,
      end,
    ).length > 16,
    true,
  );
  const input = await prepareReportInput(
    {
      api_url: "http://localhost:8000",
      scope: {
        market: "TWSE",
        symbol: "2883",
        mode: "historical",
        start,
        end,
        as_of: "2026-10-18T00:00Z",
      },
      snapshot: { input: { bars, facets: [], quality: [] }, report },
    },
    {
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          profile: null,
          catalogue: {},
          coverage: [],
          workspace: {},
        }),
      }),
    },
  );
  const technical = input.packet.sections.find(
    (s) => s.section === "technical",
  );
  assert.equal(technical.data.technical_event_version, EVENT_VERSION);
  assert.equal(
    technical.data.annotations.length,
    report.chart_annotations.length,
  );
  assert.ok(technical.data.bars.columns.includes("signals"));
  assert.ok(technical.data.bars.columns.includes("technical_state"));
});
