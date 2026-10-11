import { state, stockKey } from "../models/stock-model.js";
import { $ } from "../views/dashboard-view.js";

let signature = "",
  version = 0,
  abort;
const node = (tag, value, cls) => {
  const e = document.createElement(tag);
  if (value != null) e.textContent = value;
  if (cls) e.className = cls;
  return e;
};
function list(id, items, empty, limit = 6) {
  const target = $(id);
  target.replaceChildren();
  if (!items.length) {
    target.append(node("p", empty, "media-empty"));
    return;
  }
  for (const item of items.slice(0, limit)) {
    const article = node("article", null, "media-item"),
      a = node("a", item.title, "media-headline");
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const date =
      item.timezone_known === false
        ? item.published_at.replace("T", " ") + "（來源未註明時區）"
        : new Date(item.published_at).toLocaleString("zh-TW", {
            timeZone: "Asia/Taipei",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
    const meta = node("div", null, "media-meta");
    meta.append(
      node("span", item.source, "media-source"),
      node("time", date),
      node("span", item.relation),
    );
    article.append(meta, a);
    target.append(article);
  }
  if (items.length > limit) {
    const more = node(
      "button",
      `顯示更多（還有 ${items.length - limit} 則）`,
      "quiet media-more",
    );
    more.onclick = () => list(id, items, empty, limit + 6);
    target.append(more);
  }
}
async function load(force = false) {
  if ($("dashboardGrid").dataset.view !== "news") return;
  const key = stockKey(),
    sig = key + ":" + $("mediaDate").value;
  if (!force && signature === sig) return;
  signature = sig;
  const current = ++version;
  abort?.abort();
  abort = new AbortController();
  $("mediaCompanyTitle").textContent =
    `${state.stock.name || state.stock.symbol} · 公司新聞與討論`;
  $("mediaStatus").textContent = "正在取得公司新聞與公開文章…";
  list("companyNews", [], "正在查詢公司新聞…");
  list("companyDiscussions", [], "正在查詢公開討論…");
  $("mediaSources").replaceChildren();
  $("mediaSearchLinks").replaceChildren();
  $("mediaNotes").textContent = "";
  try {
    const params = new URLSearchParams();
    if ($("mediaDate").value) params.set("date", $("mediaDate").value);
    const response = await fetch(
      `/api/media/${state.stock.market}/${state.stock.symbol}?${params}`,
      { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]) },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || "新聞暫時無法取得");
    if (current !== version || key !== stockKey()) return;
    if (!$("mediaDate").value) {
      $("mediaDate").value = data.date;
      signature = key + ":" + data.date;
    }
    list(
      "companyNews",
      data.news,
      "本次來源未提供符合此公司的新聞，可切換索引日期或使用上方新聞搜尋。",
    );
    list(
      "companyDiscussions",
      data.discussions,
      "最近公開文章未找到符合此公司的討論；這不代表沒有討論，可使用上方公開討論搜尋。",
    );
    for (const s of data.sources) {
      $("mediaSources").append(
        node(
          "p",
          `${s.label} · ${s.available ? `${s.count} 筆相關文章` : "暫時無法取得"}${s.stale ? " · 使用先前快取" : ""}${s.received_at ? " · 接收 " + new Date(s.received_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : ""}`,
          "subtle",
        ),
      );
    }
    for (const link of data.searches || []) {
      const a = node("a", link.label + " ↗");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      $("mediaSearchLinks").append(a);
    }
    $("mediaNotes").textContent = (data.notes || []).join(" ");
    $("mediaStatus").textContent =
      data.warning ||
      `公司索引日期 ${data.date} · 新聞 ${data.news.length} 筆／公開討論 ${data.discussions.length} 筆 · ${data.sources.filter((s) => s.available).length}／${data.sources.length} 來源可用${data.sources.some((s) => s.stale) ? " · 部分來源為先前快取" : ""}`;
  } catch (error) {
    if (current !== version || key !== stockKey() || abort.signal.aborted)
      return;
    signature = "";
    $("mediaStatus").textContent = error.message;
    list("companyNews", [], "未取得新聞資料，請稍後更新。");
    list("companyDiscussions", [], "未取得討論資料，請稍後更新。");
  }
}
let stock = "";
export function mediaChanged() {
  if (stock !== stockKey()) {
    stock = stockKey();
    signature = "";
    version++;
    abort?.abort();
    $("mediaDate").value = "";
  }
  load();
}
export function initMediaController() {
  $("mediaDate").max = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  $("mediaForm").onsubmit = (e) => {
    e.preventDefault();
    load(true);
  };
}
