import { randomUUID, createHash } from "node:crypto";
import { createChatTools, chatToolDefinitions } from "./chat-tools.js";
import { readResearchSkill, skillCatalogue } from "./research-skills.js";
import { validateExplanation } from "./report-schema.js";
import { validationReport } from "./report-validation.js";

const reportDefinition = chatToolDefinitions.find(
  (t) => t.name === "save_research_report",
);
const targetDefinitions = chatToolDefinitions
  .filter((t) => t !== reportDefinition)
  .map((t) => ({
    ...t,
    description:
      t.description +
      " 請明傳平台目錄核對的market、symbol；不使用平台選股或Session預設標的。",
    inputSchema: {
      ...t.inputSchema,
      properties: {
        ...t.inputSchema.properties,
        ...(t.name === "calculate_trade_profit"
          ? {
              position_text: {
                type: "string",
                maxLength: 1000,
                description:
                  "多股對話採用user_cost時，提供本Session使用者原文中包含本股名稱／代號、成本、股數的片段；不可混入其他股票。",
              },
            }
          : {}),
        market: { type: "string", enum: ["TWSE", "TPEX"] },
        symbol: { type: "string", maxLength: 16 },
      },
      required: [...(t.inputSchema.required || []), "market", "symbol"],
    },
  }));
export const assistantToolDefinitions = [
  {
    name: "search_stocks",
    description:
      "依使用者提供的公司／ETF名稱、簡稱或股票代號搜尋平台目錄。保留前導零；歧義時列候選讓使用者確認，不自行猜公司或同業。",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 40 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_research_skills",
    description: "列出股票助手可按需載入的研究技能及版本，不查行情。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_research_skill",
    description:
      "按名稱載入SKILL.md的實際研究方法。查股票資料前使用twstock-evidence；技術、跨股比較、持倉試算依問題另選相關技能，不需全部載入。",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", maxLength: 64 } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_market_data",
    description:
      "不選個股即可查最新加權指數、台指期日／夜盤與市場籌碼，逐項核對資料日期。此獨立入口目前不提供嚴格歷史截止快照。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  ...targetDefinitions,
  reportDefinition,
];
const evidenceId = (value) =>
  "tool:" +
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);

export function createAssistantTools(
  context,
  { fetcher = fetch, onCall = async () => {}, signal } = {},
) {
  const calls = [],
    targets = new Map(),
    catalogue = new Map();
  const baseScope = () => ({
    mode: context.scope.mode,
    as_of: context.scope.as_of,
    start: context.scope.start,
    end: context.scope.end,
    range_mode: "auto",
  });
  const record = async (event) => {
    calls.push(event);
    await onCall(event);
  };
  async function request(path) {
    const response = await fetcher(new URL(path, context.api_url), {
      signal: AbortSignal.any([
        AbortSignal.timeout(45000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    });
    if (!response.ok) throw Error(`平台查詢失敗（HTTP ${response.status}）`);
    return response.json();
  }
  async function search(query) {
    const rows = await request(`/api/search?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(rows)) throw Error("股票目錄回應格式不符");
    const candidates = rows.filter(
      (r) =>
        ["TWSE", "TPEX"].includes(r.market) &&
        typeof r.symbol === "string" &&
        /^[A-Za-z0-9._-]{1,16}$/.test(r.symbol),
    );
    for (const stock of candidates)
      catalogue.set(`${stock.market}:${stock.symbol}`, stock);
    return candidates;
  }
  async function target(market, symbol) {
    if (
      !["TWSE", "TPEX"].includes(market) ||
      typeof symbol !== "string" ||
      !/^[A-Za-z0-9._-]{1,16}$/.test(symbol)
    )
      throw Error("資料查詢需明傳market及字串symbol，請先搜尋股票目錄");
    const key = `${market}:${symbol}`;
    if (!catalogue.has(key)) await search(symbol);
    const stock = catalogue.get(key);
    if (!stock) throw Error("股票代號與市場不在平台目錄，請核對使用者描述");
    if (!targets.has(key)) {
      const childContext = {
        ...context,
        snapshot: undefined,
        scope: { ...baseScope(), market, symbol },
      };
      const tools = createChatTools(childContext, {
        fetcher,
        signal,
        onCall: async (call) => {
          const artifact = call.artifact
            ? {
                ...call.artifact,
                target: { ...stock },
                title: `${stock.name} ${symbol} · ${call.artifact.title}`,
              }
            : undefined;
          await record({
            ...call,
            market,
            symbol,
            target: { ...stock },
            ...(call.evidence
              ? {
                  evidence: call.evidence.map((e) => ({
                    ...e,
                    asset: call.data?.meta?.asset || e.asset,
                  })),
                }
              : {}),
            arguments: { ...call.arguments, market, symbol },
            ...(artifact ? { artifact } : {}),
          });
        },
      });
      targets.set(key, { stock, tools });
    }
    return targets.get(key);
  }
  async function call(name, args = {}) {
    const definition = assistantToolDefinitions.find((t) => t.name === name);
    if (
      !definition ||
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) => !Object.hasOwn(definition.inputSchema.properties, k),
      ) ||
      !(definition.inputSchema.required || []).every((k) =>
        Object.hasOwn(args, k),
      )
    )
      throw Error("工具參數不符，請依工具欄位提供標的及查詢條件");
    if (
      ![
        "list_research_skills",
        "read_research_skill",
        "search_stocks",
      ].includes(name) &&
      !calls.some(
        (c) =>
          c.name === "read_research_skill" &&
          c.data?.name === "twstock-evidence" &&
          c.status === "completed",
      )
    )
      throw Error(
        "查實際資料前請先用read_research_skill載入twstock-evidence，核對標的與資料時效；概念問答不需要資料工具。",
      );
    if (name === "list_research_skills")
      return { skills: await skillCatalogue() };
    if (name === "read_research_skill") {
      const skill = await readResearchSkill(args.name);
      await record({
        name,
        arguments: args,
        status: "completed",
        category: "skill",
        scope: baseScope(),
        data: skill,
      });
      return skill;
    }
    if (name === "search_stocks") {
      if (
        typeof args.query !== "string" ||
        !args.query.trim() ||
        args.query.length > 40
      )
        throw Error("搜尋文字需為1至40字");
      const candidates = await search(args.query.trim());
      const data = {
        query: args.query,
        candidates,
        note: "候選可能不唯一，請依使用者描述核對市場、代號及名稱；不能以平台選股取代。",
      };
      await record({
        name,
        arguments: args,
        status: "completed",
        category: "discovery",
        scope: baseScope(),
        data,
      });
      return data;
    }
    if (name === "get_market_data") {
      if (context.scope.mode === "historical")
        throw Error(
          "此入口僅提供最新市場快照，不可用於嚴格歷史截止推論；缺少可驗證的歷史大盤快照時請直接說明，不以最新資料替代或任意指定個股。",
        );
      const board = await request("/api/market/board");
      const chips = await request(
        `/api/market/chips?date=${encodeURIComponent(context.scope.end)}`,
      ).catch((error) => ({ available: false, note: error.message }));
      const as_of = new Date().toISOString();
      const data = {
        board,
        chips,
        as_of,
        note: "各市場商品、日夜盤與來源日期分開判讀；查詢成功不代表全部資料已更新。",
      };
      const result = {
        name,
        arguments: args,
        status: "completed",
        evidence_id: evidenceId(data),
        category: "market",
        scope: { ...baseScope(), as_of },
        as_of,
        data,
      };
      await record(result);
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
        throw Error("報告需提供標題、Markdown及本輪有效證據ID");
      const selected = calls.filter(
        (c) =>
          c.status === "completed" &&
          c.evidence_id &&
          (args.evidence_ids.includes(c.evidence_id) ||
            (c.evidence || []).some((e) => args.evidence_ids.includes(e.id))),
      );
      const ids = new Set(
        selected.flatMap((c) => [
          c.evidence_id,
          ...(c.evidence || []).map((e) => e.id),
        ]),
      );
      if (
        !args.evidence_ids.every((id) => typeof id === "string" && ids.has(id))
      )
        throw Error("報告不能引用舊回覆、技能或未取得的證據");
      validateExplanation(
        {
          answer: args.markdown,
          highlights: [],
          scenario_ids: [],
          cautions: [],
        },
        validationReport(selected, {}, context.user_message),
        { maxTextLength: 30000 },
      );
      const reportTargets = [
        ...new Map(
          selected
            .filter((c) => c.target)
            .map((c) => [`${c.market}:${c.symbol}`, c.target]),
        ).values(),
      ];
      const artifact = {
        id: randomUUID(),
        type: "report",
        title: args.title,
        markdown: args.markdown,
        evidence_ids: args.evidence_ids,
        targets: reportTargets,
        scope: {
          ...baseScope(),
          targets: selected
            .filter((c) => c.target)
            .map((c) => ({
              market: c.market,
              symbol: c.symbol,
              as_of: c.as_of || c.scope?.as_of,
            })),
        },
        created_at: new Date().toISOString(),
      };
      await record({
        name,
        arguments: { title: args.title, evidence_ids: args.evidence_ids },
        status: "completed",
        artifact,
        scope: artifact.scope,
      });
      return {
        artifact_id: artifact.id,
        displayed: true,
        note: "研究報告將隨本次對話保存，各標的截止分別保留。",
      };
    }
    const { market, symbol, position_text, ...query } = args;
    const selected = await target(market, symbol);
    let personalText = context.user_message || "";
    if (
      name === "calculate_trade_profit" &&
      query.buy_price_source === "user_cost"
    ) {
      const known = [
        ...new Map(
          [
            ...(context.known_targets || []),
            ...[...targets.values()].map((t) => t.stock),
          ].map((s) => [`${s.market}:${s.symbol}`, s]),
        ).values(),
      ];
      if (position_text !== undefined || known.length > 1) {
        if (
          typeof position_text !== "string" ||
          !position_text ||
          position_text.length > 1000 ||
          !personalText.includes(position_text) ||
          !(
            position_text.includes(symbol) ||
            position_text.includes(selected.stock.name)
          )
        )
          throw Error(
            "多股持倉試算需提供包含本股名稱／代號、成本與數量的使用者原文position_text，指代不明請先確認",
          );
        if (
          known.some(
            (s) =>
              (s.market !== market || s.symbol !== symbol) &&
              (position_text.includes(s.symbol) ||
                position_text.includes(s.name)),
          )
        )
          throw Error("持倉原文混入其他股票，請分別確認每檔成本與股數");
        personalText = position_text;
      }
    }
    return selected.tools.call(name, query, personalText);
  }
  return { call };
}
