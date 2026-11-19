import { state, stockKey } from "../models/stock-model.js";
import { $ } from "../views/dashboard-view.js";

let signature = "",
  version = 0,
  abort;
let loading = false,
  progress = null;
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
    start = $("mediaStart").value,
    end = $("mediaEnd").value,
    sig = `${key}:${start}:${end}`;
  if (
    !start ||
    !end ||
    start > end ||
    end > today() ||
    (Date.parse(end) - Date.parse(start)) / 86400000 >= 31
  ) {
    version++;
    abort?.abort();
    signature = "";
    $("mediaStatus").textContent =
      "請選擇有效起訖日期，起始日不晚於截止日，最多 31 個日曆日且不可超過今日。";
    return;
  }
  if (!force && signature === sig) return;
  signature = sig;
  const current = ++version;
  abort?.abort();
  abort = new AbortController();
  const fresh = force || progress?.sig !== sig;
  if (fresh)
    progress = {
      sig,
      news: [],
      discussions: [],
      failures: new Set(),
      sources: new Map(),
      cursor: start,
      processed: 0,
    };
  const batch = progress;
  const currentRequest = () => current === version && key === stockKey();
  loading = true;
  $("mediaCompanyTitle").textContent =
    `${state.stock.name || state.stock.symbol} · 公司新聞與討論`;
  $("mediaStatus").textContent = "正在取得公司新聞與公開文章…";
  if (fresh) {
    list("companyNews", [], "正在查詢公司新聞…");
    list("companyDiscussions", [], "正在查詢公開討論…");
  }
  $("mediaSources").replaceChildren();
  $("mediaSearchLinks").replaceChildren();
  $("mediaNotes").textContent = "";
  try {
    const { news, discussions, failures, sources } = batch;
    // Recent RSS articles are independent of the paced historical index.
    // Show them as soon as available instead of waiting for every index day.
    const recent = batch.recentDone
      ? Promise.resolve()
      : (async () => {
          try {
            const params = new URLSearchParams({
              start,
              end,
              source: "recent",
            });
            const response = await fetch(
              `/api/media/${state.stock.market}/${state.stock.symbol}?${params}`,
              {
                signal: AbortSignal.any([
                  abort.signal,
                  AbortSignal.timeout(30000),
                ]),
              },
            );
            const page = await response.json();
            if (!response.ok)
              throw Error(page.detail || "近期文章暫時無法取得");
            if (!currentRequest()) return;
            news.push(...page.news);
            discussions.push(...page.discussions);
            for (const source of page.sources) sources.set(source.id, source);
            batch.recentDone = true;
            list(
              "companyNews",
              merged(news),
              "近期來源尚無符合區間的公司新聞，歷史索引仍在查詢…",
            );
            list(
              "companyDiscussions",
              merged(discussions),
              "近期來源尚無符合區間的公開討論…",
            );
            $("mediaStatus").textContent =
              "近期文章已查詢，正在補齊所選區間的公司索引…";
          } catch (error) {
            if (currentRequest() && !abort.signal.aborted)
              batch.recentError = "近期文章來源未完成；目前清單可能不完整。";
          }
        })();
    let cursor = batch.cursor,
      data,
      processed = batch.processed;
    const total = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    do {
      const params = new URLSearchParams({
        start,
        end,
        cursor,
        source: "index",
      });
      const response = await fetch(
        `/api/media/${state.stock.market}/${state.stock.symbol}?${params}`,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]) },
      );
      data = await response.json();
      if (!response.ok) throw Error(data.detail || "新聞暫時無法取得");
      if (current !== version || key !== stockKey()) return;
      news.push(...data.news);
      discussions.push(...data.discussions);
      for (const date of data.failed_dates || []) failures.add(date);
      for (const source of data.sources) {
        const old = sources.get(source.id);
        sources.set(source.id, {
          ...source,
          count: source.count + (old?.count || 0),
          available: source.available && (old?.available ?? true),
          stale: source.stale || old?.stale,
        });
      }
      data.news = merged(news);
      data.discussions = merged(discussions);
      processed++;
      list(
        "companyNews",
        data.news,
        "所選區間尚未取得符合此公司的新聞，可調整區間或使用上方新聞搜尋。",
      );
      list(
        "companyDiscussions",
        data.discussions,
        "所選區間未取得符合此公司的公開討論；來源僅提供近期文章，可使用上方搜尋。",
      );
      $("mediaStatus").textContent =
        `正在載入 ${start}～${end} · ${processed}／${total} 日 · 新聞 ${data.news.length} 筆／公開討論 ${data.discussions.length} 筆`;
      cursor = data.next_cursor;
      batch.cursor = cursor;
      batch.processed = processed;
    } while (cursor);
    await recent;
    if (!currentRequest()) return;
    data.news = merged(news);
    data.discussions = merged(discussions);
    list("companyNews", data.news, "所選區間未取得符合此公司的新聞。");
    list(
      "companyDiscussions",
      data.discussions,
      "所選區間未取得符合此公司的公開討論。",
    );
    data.sources = [...sources.values()];
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
    $("mediaNotes").textContent = [
      ...(data.notes || []),
      ...(batch.recentError ? [batch.recentError] : []),
    ].join(" ");
    $("mediaStatus").textContent =
      data.warning ||
      `公司索引區間 ${start}～${end} · 新聞 ${data.news.length} 筆／公開討論 ${data.discussions.length} 筆${failures.size ? ` · 資料不完整：${[...failures].join("、")} 公司索引未取得，請重新套用` : " · 區間查詢完成"}${data.sources.some((s) => s.stale) ? " · 部分來源為先前快取" : ""}`;
  } catch (error) {
    if (current !== version || key !== stockKey() || abort.signal.aborted)
      return;
    signature = "";
    $("mediaStatus").textContent =
      `區間查詢未完成：${error.message}。目前清單僅為已載入部分，請重新套用。`;
  } finally {
    if (current === version) loading = false;
  }
}
let stock = "";
export function mediaChanged() {
  if (stock !== stockKey()) {
    stock = stockKey();
    signature = "";
    version++;
    abort?.abort();
    loading = false;
    progress = null;
  }
  if ($("dashboardGrid").dataset.view !== "news") {
    if (loading) {
      version++;
      abort?.abort();
      loading = false;
      signature = "";
    }
    return;
  }
  load();
}
export function initMediaController() {
  for (const id of ["mediaStart", "mediaEnd"]) $(id).max = today();
  setRange(7);
  document.querySelectorAll("[data-media-days]").forEach((button) => {
    button.onclick = () => {
      setRange(Number(button.dataset.mediaDays));
      load(true);
    };
  });
  $("mediaForm").onsubmit = (e) => {
    e.preventDefault();
    load(true);
  };
}
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function setRange(days) {
  const end = today();
  $("mediaEnd").value = end;
  $("mediaStart").value = new Date(Date.parse(end) - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
}
function merged(items) {
  const seen = new Set();
  return [...items]
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .filter((item) => {
      const url = new URL(item.url);
      for (const key of [...url.searchParams.keys()])
        if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
      if (seen.has(url.href)) return false;
      seen.add(url.href);
      return true;
    });
}
