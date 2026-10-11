import { $ } from "../views/dashboard-view.js";
let result = null,
  category = "institutional",
  version = 0;
const make = (tag, value, cls) => {
  const e = document.createElement(tag);
  if (value != null) e.textContent = value;
  if (cls) e.className = cls;
  return e;
};
const fmt = (v, unit) =>
  v == null
    ? "—"
    : `${(v / (unit === "元" ? 1e8 : 1)).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}${unit === "元" ? " 億元" : " " + unit}`;
const tone = (v) => (v > 0 ? "tone-bull" : v < 0 ? "tone-bear" : "muted");
const label = (name) =>
  ({
    "自營商(自行買賣)": "自營商・自行買賣",
    "自營商(避險)": "自營商・避險",
    "外資及陸資(不含外資自營商)": "外資及陸資",
    "融資(交易單位)": "融資餘額",
    "融券(交易單位)": "融券餘額",
    "融資金額(仟元)": "融資金額",
  })[name] || name;
function draw() {
  const source = result?.sources.find((s) => s.id === category),
    data = source?.data || [];
  $("marketChipsMetrics").replaceChildren();
  $("marketChipsChart").replaceChildren();
  $("marketChipsHead").replaceChildren();
  $("marketChipsRows").replaceChildren();
  document
    .querySelectorAll("[data-market-chips]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.marketChips === category),
      ),
    );
  const margin = category === "margin";
  const heads = margin
    ? ["項目", "買進", "賣出", "償還", "前日餘額", "今日餘額", "增減"]
    : category === "futures"
      ? ["法人", "多方交易", "空方交易", "交易淨額", "未平倉淨額"]
      : ["法人", "買進金額", "賣出金額", "買賣超"];
  const h = make("tr");
  heads.forEach((v) => h.append(make("th", v)));
  $("marketChipsHead").append(h);
  for (const r of data) {
    const values = margin
      ? [
          label(r.name),
          fmt(r.buy, r.unit),
          fmt(r.sell, r.unit),
          fmt(r.repayment, r.unit),
          fmt(r.previous, r.unit),
          fmt(r.balance, r.unit),
          fmt(r.change, r.unit),
        ]
      : [
          label(r.name),
          fmt(r.buy, r.unit),
          fmt(r.sell, r.unit),
          fmt(r.net, r.unit),
          ...(category === "futures" ? [fmt(r.open_interest_net, r.unit)] : []),
        ];
    const row = make("tr");
    values.forEach((v, i) => {
      const cell = make(
        "td",
        null,
        i === values.length - 1
          ? tone(
              margin
                ? r.change
                : category === "futures"
                  ? r.open_interest_net
                  : r.net,
            )
          : "",
      );
      if (i === 0) {
        cell.textContent = v;
        cell.title = r.name;
        if (margin) cell.append(make("small", r.unit, "chip-cell-unit"));
      } else {
        const unit = r.unit === "元" ? "億元" : r.unit;
        cell.append(
          make("span", v === "—" ? v : v.slice(0, -unit.length).trim()),
        );
        cell.append(make("small", unit, "chip-cell-unit"));
      }
      row.append(cell);
    });
    $("marketChipsRows").append(row);
  }
  const focus = margin
      ? data
      : data.filter((r) => r.name !== "外資自營商" && r.name !== "合計"),
    max = Math.max(1, ...focus.map((r) => Math.abs(margin ? r.change : r.net)));
  for (const r of focus) {
    const value = margin ? r.change : r.net,
      card = make("div", null, "board-metric " + tone(value));
    card.append(
      make("span", label(r.name)),
      make("strong", fmt(value, r.unit)),
      make("small", margin ? "餘額較前日增減" : "交易淨額"),
    );
    $("marketChipsMetrics").append(card);
    const chart = make("div", null, "chip-bar-row"),
      track = make("div", null, "chip-bar-track"),
      bar = make("i", null, tone(value));
    bar.style.width = `${(Math.abs(value || 0) / max) * 48}%`;
    bar.style.left =
      value < 0 ? `${50 - (Math.abs(value) / max) * 48}%` : "50%";
    track.append(bar);
    chart.append(
      make("span", label(r.name)),
      track,
      make("strong", fmt(value, r.unit), tone(value)),
    );
    $("marketChipsChart").append(chart);
  }
  $("marketChipsChart").hidden = margin;
  $("marketChipsStatus").textContent = source
    ? `${source.label} · ${source.date} · ${source.available ? (source.stale ? "先前快取 · " + source.warning : "資料已載入") : source.warning}${source.received_at ? " · 接收 " + new Date(source.received_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : ""}`
    : "請選擇日期查詢。";
  $("marketChipsNotes").textContent = (result?.notes || []).join(" ");
}
export async function loadMarketChips() {
  const current = ++version;
  result = null;
  draw();
  $("marketChipsStatus").textContent = "正在取得收盤籌碼統計…";
  try {
    const response = await fetch(
        "/api/market/chips?" +
          new URLSearchParams({ date: $("marketChipsDate").value }),
        { signal: AbortSignal.timeout(25000) },
      ),
      data = await response.json();
    if (!response.ok) throw Error(data.detail || "籌碼資料暫時無法取得");
    if (current !== version) return;
    result = data;
    draw();
  } catch (e) {
    if (current === version) $("marketChipsStatus").textContent = e.message;
  }
}
export function initMarketChips() {
  $("marketChipsForm").onsubmit = (e) => {
    e.preventDefault();
    loadMarketChips();
  };
  document.querySelectorAll("[data-market-chips]").forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.marketChips;
        draw();
      }),
  );
}
