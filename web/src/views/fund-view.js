import { $, fmt } from "./dashboard-view.js";
import { state, taipeiDay } from "../models/stock-model.js";
import { renderFinancialHistory } from "./financial-chart.js";

const requests = new Map();
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const money = (n) => (n == null ? "—" : fmt(n));
function table(container, labels, rows) {
  const wrap = node("div", null, "financial-table-wrap"),
    t = node("table"),
    head = node("tr");
  labels.forEach((l) => head.append(node("th", l)));
  t.append(head);
  rows.forEach((values) => {
    const tr = node("tr");
    values.forEach((v) => tr.append(node("td", v ?? "—")));
    t.append(tr);
  });
  if (!rows.length) {
    const td = node("td", "本次涵蓋範圍內沒有紀錄；不代表全市場沒有。"),
      tr = node("tr");
    td.colSpan = labels.length;
    tr.append(td);
    t.append(tr);
  }
  wrap.append(t);
  container.append(wrap);
}
function load(path, force = false) {
  let e = requests.get(path);
  if (force || !e || Date.now() - e.at > 60000) {
    e = {
      at: Date.now(),
      promise: fetch(path).then(async (r) => {
        if (!r.ok) throw Error("來源暫時無法取得，請稍後再試。");
        return r.json();
      }),
    };
    requests.set(path, e);
    e.promise.catch(() => {
      if (requests.get(path) === e) requests.delete(path);
    });
    if (requests.size > 24) requests.delete(requests.keys().next().value);
  }
  return e.promise;
}
export function renderFundPanel(
  container,
  section,
  { start = state.range.start, end = state.range.end } = {},
) {
  const market = state.stock.market,
    symbol = state.stock.symbol;
  const bands = ["per_band", "pbr_band"].includes(section);
  const panel = node("section", null, "financial-history fund-research");
  container.append(panel);
  panel.append(
    node(
      "h3",
      bands
        ? "來源估值倍數換算參考帶"
        : section === "nav"
          ? "ETF 淨值與折溢價"
          : section === "portfolio"
            ? "ETF 自身投資組合 · 投信公開資料"
            : section === "quarterly"
              ? "ETF 季度投資揭露 · 權重"
              : "公開 ETF 組合反查 · 群益／國泰",
    ),
  );
  const tools = node("div", null, "financial-history-tools"),
    from = node("input"),
    to = node("input"),
    button = node("button", "重新查詢", "quiet");
  from.type = to.type = "date";
  from.value = start;
  to.value = end;
  from.max = to.max = taipeiDay();
  const label = (s, input) => {
    const l = node("label", s);
    l.append(input);
    return l;
  };
  if (bands || section === "nav") tools.append(label("起始日期", from));
  tools.append(
    label(bands || section === "nav" ? "截止日期" : "查詢截止", to),
    button,
  );
  panel.append(tools);
  const output = node("div");
  panel.append(output);
  let version = 0;
  async function refresh(force = false) {
    const v = ++version;
    if (!bands && section !== "nav") from.value = to.value;
    output.replaceChildren(node("p", "正在查詢公開來源資料…", "utility-note"));
    if (
      !from.value ||
      !to.value ||
      from.value > to.value ||
      to.value > taipeiDay()
    ) {
      output.textContent = "請輸入有效起訖日期，截止日不可在未來。";
      return;
    }
    const q = new URLSearchParams({
      ...(bands
        ? { field: section === "per_band" ? "PER" : "PBR" }
        : { section }),
      start: from.value,
      end: to.value,
    });
    try {
      const data = await load(
        `/api/${bands ? "valuation-bands" : "fund-data"}/${market}/${symbol}?${q}`,
        force,
      );
      if (v !== version || !panel.isConnected) return;
      output.replaceChildren(node("p", data.note || "", "utility-note"));
      const statusLabels = {
        available: "本次來源可用，請核對涵蓋範圍",
        partial: "部分資料可用",
        source_error: "來源請求失敗，不能當成零筆",
        outside_range: "來源資料不在查詢範圍，未回填歷史",
        not_connected: "此來源範圍尚未接入",
        historical_unavailable: "不支援此歷史資料",
        no_data: "來源本次沒有紀錄",
        calculation_unavailable: "計算條件不足",
        permission_denied: "目前帳戶權限不足",
        invalid_token: "Token 無效或已失效",
        quota_exceeded: "來源額度不足或已達限速",
        source_blocked: "來源暫時封鎖請求",
      };
      output.append(
        node("p", statusLabels[data.status] || data.status, "utility-note"),
      );
      if (data.coverage && !Array.isArray(data.coverage))
        output.append(
          node(
            "p",
            `已取得 ${data.coverage.funds_loaded}/${data.coverage.funds_requested} 檔已接入投信國內成分 ETF；${data.coverage.funds_eligible ?? data.coverage.funds_loaded} 檔估值日不晚於截止，${data.coverage.outside_range_funds?.length || 0} 檔區間外、${data.coverage.failed_funds.length} 檔來源失敗。目錄失敗：${data.coverage.failed_issuers?.join("、") || "無"}；非全市場涵蓋。`,
            "utility-note",
          ),
        );
      if (
        ![
          "available",
          "partial",
          "no_data",
          "calculation_unavailable",
        ].includes(data.status)
      )
        return;
      if (section === "quarterly") {
        if (!data.date) return;
        output.append(
          node(
            "p",
            `揭露季度 ${data.date} · 來源接收 ${data.received_at || "未取得"}；季度日期不等於公告日期。`,
            "utility-note",
          ),
        );
        table(
          output,
          ["資產類別", "產業", "標的名稱", "占基金權重（%）"],
          data.rows.map((r) => [
            r.category,
            r.industry,
            r.name,
            money(r.weight_percent),
          ]),
        );
        if (data.source_url) {
          const a = node("a", "查看投信原始揭露");
          a.href = data.source_url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          output.append(a);
        }
      } else if (bands) {
        const metrics = [
          { key: "close", label: "原始收盤價", unit: "元／股" },
          ...[20, 40, 60, 80].map((p) => ({
            key: `q${p}`,
            label: `歷史倍數 ${p}% 分位參考帶`,
            unit: "元／股",
          })),
        ];
        const history = Object.fromEntries(
          metrics.map((m) => [
            m.key,
            data.rows
              .filter((r) => r[m.key] != null)
              .map((r) => ({ period: r.date, value: r[m.key] })),
          ]),
        );
        renderFinancialHistory({ history }, metrics, output);
        if (!data.rows.length)
          output.append(
            node(
              "p",
              `尚無足夠的同日價格及正值倍數；來源狀態 ${data.source_status}。至少需要60筆有效樣本。`,
              "utility-note",
            ),
          );
      } else if (section === "nav") {
        const snapshot = data.snapshot;
        if (snapshot) {
          const cards = node("div", null, "research-cards");
          [
            ["來源市價", snapshot.price, "元"],
            ["預估淨值", snapshot.indicative_nav, "元／單位"],
            ["預估折溢價", snapshot.premium_percent, "%"],
            ["前一營業日淨值", snapshot.previous_nav, "元／單位"],
          ].forEach(([label, value, unit]) => {
            const c = node("article", null, "research-card");
            c.append(
              node("span", label),
              node("strong", `${money(value)} ${unit}`),
            );
            cards.append(c);
          });
          output.append(
            cards,
            node(
              "p",
              `快照時間 ${snapshot.source_time} · 預估值不是正式結算淨值；折溢價不是報酬率。`,
              "utility-note",
            ),
          );
        }
        const metrics = [
          { key: "fund_nav", label: "盤後歷史淨值", unit: "元／單位" },
          { key: "fund_premium", label: "盤後折溢價", unit: "%" },
        ];
        const history = {
          fund_nav: data.history.map((r) => ({ period: r.date, value: r.nav })),
          fund_premium: data.history
            .filter((r) => r.premium_percent != null)
            .map((r) => ({ period: r.date, value: r.premium_percent })),
        };
        renderFinancialHistory({ history }, metrics, output);
        data.coverage.forEach((r) =>
          output.append(
            node(
              "p",
              `${r.label}：${{ available: "已取得", source_error: "來源請求失敗", outside_range: "最新快照不在所選區間", not_connected: "尚未接入", no_data: "來源本次無資料" }[r.status] || r.status}`,
              "utility-note",
            ),
          ),
        );
      } else {
        if (data.date)
          output.append(
            node(
              "p",
              `組合估值日 ${data.date}${data.effective_date ? " · 申購買回適用日 " + data.effective_date : " · 來源未提供PCF適用日"}${data.other_assets_present || data.stock_table_only ? " · 下表只列股票，不代表全部資產。" : ""}`,
              "utility-note",
            ),
          );
        const factor = $("volumeUnit").value === "lots" ? 1000 : 1,
          unit = factor === 1000 ? "張" : "股";
        table(
          output,
          [
            section === "portfolio" ? "成分股／代號" : "基金／代號",
            `股數（${unit}）`,
            "占基金權重（%）",
            "估值日",
            "PCF 適用日",
          ],
          (data.rows || []).map((r) => [
            section === "portfolio"
              ? `${r.name} ${r.symbol}`
              : `${r.fund_name} ${r.fund_code}`,
            money(r.holding_shares / factor),
            money(r.weight_percent),
            r.date,
            r.effective_date,
          ]),
        );
      }
    } catch (e) {
      if (v === version && panel.isConnected) output.textContent = e.message;
    }
  }
  button.onclick = () => refresh(true);
  void refresh();
}

export function renderFundPeers(data, visible) {
  $("peerStatus").textContent =
    `比較截止 ${data.reference_day} · 共同快照日 ${data.data_date || "未取得"}`;
  $("peerNotes").textContent = data.note;
  $("peerMetricButtons").replaceChildren();
  $("peerSummary").replaceChildren();
  $("peerChart").replaceChildren();
  const target = data.rows.find((r) => r.selected)?.snapshot;
  [
    ["本檔市價", target?.price, "元"],
    ["本檔預估淨值", target?.indicative_nav, "元／單位"],
    ["本檔預估折溢價", target?.premium_percent, "%"],
  ].forEach(([label, v, u]) => {
    const c = node("div");
    c.append(node("span", label), node("strong", `${money(v)} ${u}`));
    $("peerSummary").append(c);
  });
  $("peerHead").replaceChildren();
  const head = node("tr");
  ["基金／追蹤指數", "市價", "預估淨值", "預估折溢價（%）", "來源時間"].forEach(
    (l) => head.append(node("th", l)),
  );
  $("peerHead").append(head);
  $("peerRows").replaceChildren();
  visible.forEach((r) => {
    const tr = node("tr"),
      first = node("td");
    first.append(
      node("strong", `${r.name} ${r.symbol}${r.selected ? " · 本檔" : ""}`),
      node(
        "small",
        `${r.business_peer ? "相同追蹤指數 · " : "同類型候選 · "}${r.tracking_index || "未接入追蹤指數"}`,
      ),
    );
    tr.append(first);
    [
      money(r.snapshot?.price),
      money(r.snapshot?.indicative_nav),
      money(r.snapshot?.premium_percent),
      r.snapshot?.source_time || "未取得截止日前共同資料",
    ].forEach((v) => tr.append(node("td", v)));
    $("peerRows").append(tr);
  });
  $("peerSources").replaceChildren(
    node(
      "p",
      `來源：TWSE 基金基本資料與公開 ETF 快照 · 接收 ${data.received_at}`,
    ),
  );
}
