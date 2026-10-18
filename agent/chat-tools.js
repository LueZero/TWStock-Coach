import { randomUUID, createHash } from "node:crypto";
import { createStockTools, toolDefinitions } from "./tools.js";
import { EVENT_VERSION } from "../api/technical-events.js";
import { validateExplanation } from "./report-schema.js";
import { validationReport } from "./report-validation.js";

export const chatToolDefinitions = [
  ...toolDefinitions,
  {
    name: "get_stock_quote",
    description:
      "查詢本次固定截止前平台已接收的個股公開行情與五檔快照，含行情／接收時間。不是逐筆即時或收盤訊號；休市／延遲與無資料依日期判斷。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "show_stock_chart",
    description:
      "顯示本次股票的完成日K、均線與技術事件，可用start選區間、focus_date聚焦真實交易日。以平台計算資料產生互動圖，不接受AI編造K棒或價位。",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", maxLength: 10 },
        focus_date: { type: "string", maxLength: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "save_research_report",
    description:
      "使用者需要或要求整理報告時呼叫，以本次實際查詢證據保存Markdown研究快照並即時展示。不是每次回答都要使用。引用僅限本次成功工具evidence_id，至少一項。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 120 },
        markdown: { type: "string", maxLength: 30000 },
        evidence_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 30,
        },
      },
      required: ["title", "markdown", "evidence_ids"],
      additionalProperties: false,
    },
  },
];

export function createChatTools(
  context,
  { fetcher = fetch, onCall = async () => {}, signal } = {},
) {
  let toolsPromise;
  const calls = [];
  const record = async (call) => {
    const event = { ...call, scope: { ...context.scope } };
    calls.push(event);
    await onCall(event);
  };
  async function tools() {
    return (toolsPromise ||= (async () => {
      if (context.scope.mode === "latest") {
        const response = await fetcher(
          new URL(
            `/api/research/refresh/${context.scope.market}/${context.scope.symbol}`,
            context.api_url,
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: AbortSignal.any([
              AbortSignal.timeout(40000),
              ...(signal ? [signal] : []),
            ]),
          },
        );
        if (!response.ok) throw Error("行情更新失敗，請稍後再試");
        const refresh = await response.json();
        context.scope.as_of = new Date().toISOString();
        context.scope.end = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(context.scope.as_of));
        context.latest_refresh = refresh;
      }
      return createStockTools(context, { fetcher, signal, onCall: record });
    })());
  }
  async function call(
    name,
    args = {},
    calculationMessage = context.user_message || "",
  ) {
    if (toolDefinitions.some((t) => t.name === name))
      return (await tools()).call(name, args, calculationMessage);
    const definition = chatToolDefinitions.find((t) => t.name === name);
    if (
      !definition ||
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) => !Object.hasOwn(definition.inputSchema.properties, k),
      )
    )
      throw Error("工具參數不符");
    if (name === "get_stock_quote") {
      const snapshot = await (await tools()).snapshot();
      const quote = snapshot.report.evidence.find(
        (e) => e.id === "quote:snapshot",
      );
      const id =
        "tool:" +
        createHash("sha256")
          .update(JSON.stringify({ scope: context.scope, quote }))
          .digest("hex")
          .slice(0, 20);
      const result = {
        evidence_id: id,
        evidence: quote
          ? [{ ...quote, original_id: quote.id, id: `${id}:${quote.id}` }]
          : [],
        ...context.scope,
        data: {
          meta: { asset: snapshot.report.meta?.asset },
          quote: quote?.rows?.[0] || null,
          source_time: quote?.source_time || null,
          received_at: quote?.received_at || null,
          note: "公開行情及瞬間五檔觀察快照，非完整逐筆，不能拿來確認完成日K訊號。",
        },
      };
      await record({ name, arguments: {}, status: "completed", ...result });
      return result;
    }
    if (name === "save_research_report") {
      if (
        typeof args.title !== "string" ||
        !args.title.trim() ||
        args.title.length > 120 ||
        typeof args.markdown !== "string" ||
        !args.markdown.trim() ||
        args.markdown.length > 30000 ||
        !Array.isArray(args.evidence_ids) ||
        !args.evidence_ids.length ||
        args.evidence_ids.length > 30
      )
        throw Error("報告需提供標題、Markdown與來源ID");
      const available = new Set(
        calls
          .filter((c) => c.status === "completed")
          .flatMap((c) => [
            c.evidence_id,
            ...(c.evidence || []).map((e) => e.id),
          ]),
      );
      if (
        !args.evidence_ids.every(
          (id) => typeof id === "string" && available.has(id),
        )
      )
        throw Error("報告只能引用本輪成功查詢的證據，請先查資料");
      validateExplanation(
        {
          answer: args.markdown,
          highlights: [],
          scenario_ids: [],
          cautions: [],
        },
        validationReport(calls, {}, context.user_message),
        { maxTextLength: 30000 },
      );
      const artifact = {
        id: randomUUID(),
        type: "report",
        title: args.title,
        markdown: args.markdown,
        evidence_ids: args.evidence_ids,
        scope: { ...context.scope },
        created_at: new Date().toISOString(),
      };
      await record({
        name,
        arguments: { title: args.title, evidence_ids: args.evidence_ids },
        status: "completed",
        artifact,
      });
      return {
        artifact_id: artifact.id,
        displayed: true,
        note: "研究報告已顯示並會隨本次對話保存；後續分析不覆寫此快照。",
      };
    }
    for (const value of Object.values(args))
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
      )
        throw Error("圖表日期格式需為有效YYYY-MM-DD");
    // Use the same technical query path as normal evidence, including range limits.
    let source = await (
      await tools()
    ).call("get_stock_data", {
      section: "technical",
      limit: 120,
      ...(args.start ? { start: args.start } : {}),
    });
    while (
      args.focus_date &&
      source.data.bars.rows.length &&
      args.focus_date < source.data.bars.rows[0].trade_date &&
      source.data.bars.has_more
    ) {
      source = await (
        await tools()
      ).call("get_stock_data", {
        section: "technical",
        limit: 120,
        offset: source.data.bars.offset + source.data.bars.limit,
        ...(args.start ? { start: args.start } : {}),
      });
    }
    const bars = source.data.bars.rows;
    if (!bars.length) throw Error("此區間沒有完成日K");
    if (args.focus_date && !bars.some((b) => b.trade_date === args.focus_date))
      throw Error("焦點日期不在此區間的完成日K內，請確認交易日及查詢起日");
    const artifact = {
      id: randomUUID(),
      type: "chart",
      title: "日K與技術事件",
      bars,
      focus_date: args.focus_date || null,
      evidence_ids: [source.evidence_id],
      technical_event_version: EVENT_VERSION,
      scope: { ...context.scope, start: source.start },
      created_at: new Date().toISOString(),
      note: `完成日K、原始價格；顯示${bars.length}／${source.data.bars.total}根，可用start調整研究區間。`,
    };
    await record({ name, arguments: args, status: "completed", artifact });
    return {
      artifact_id: artifact.id,
      displayed: true,
      evidence_id: source.evidence_id,
      first_day: bars[0].trade_date,
      last_day: bars.at(-1).trade_date,
      note: artifact.note,
    };
  }
  return { call };
}
