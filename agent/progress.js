const labels = {
  overview: "研究範圍",
  basic: "基本資料",
  technical: "技術指標與K線",
  financial: "財務分析",
  chips: "籌碼分析",
  peers: "同業比較",
  news: "新聞與討論",
  market: "大盤資訊",
  scenarios: "技術價位參考",
};
export function dataActivity(call) {
  const label =
    labels[call.arguments?.section] ||
    (call.name === "get_financial_history" ? "財務歷史" : "籌碼明細");
  return {
    phase: "preparing",
    message: `${label}：${call.status === "completed" ? "查詢完成" : "查詢失敗"}`,
    tool: call.name,
  };
}
export function cliActivity(event) {
  if (event.type === "thread.started" || event.type === "turn.started")
    return { phase: "analyzing", message: "Codex已開始分析平台資料" };
  if (
    event.item?.type === "mcp_tool_call" &&
    event.item.server === "stock" &&
    ["item.started", "item.completed"].includes(event.type)
  ) {
    const args = event.item.arguments || {},
      label =
        labels[args.section] ||
        (event.item.tool === "calculate_trade_profit"
          ? "價差與毛損益試算"
          : event.item.tool === "get_financial_history"
            ? "財務歷史"
            : "籌碼明細");
    return {
      phase: "querying",
      message: `AI${event.type === "item.started" ? "正在補查" : "已完成補查"}：${label}${/^\d{4}-\d{2}-\d{2}$/.test(args.start || "") ? `（${args.start}起）` : ""}`,
      tool: event.item.tool,
    };
  }
  if (
    event.item?.type === "agent_message" &&
    ["item.started", "item.updated", "item.completed"].includes(event.type)
  )
    return {
      phase: "writing",
      message:
        event.type === "item.completed"
          ? "AI回覆已產生，正在檢核報告"
          : "AI正在撰寫報告",
    };
  if (event.type === "turn.completed")
    return { phase: "validating", message: "AI分析完成，正在驗證引用與價位" };
  return null;
}
