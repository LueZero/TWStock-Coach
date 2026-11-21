import { taipeiDay, validDate, num, serialQueue } from "./lib.js";

export const TDCC_HISTORY_URL =
  "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock";
const queue = serialQueue(),
  cache = new Map(),
  pendingWeeks = new Map();
let nextAt = 0;
const clean = (s) =>
  String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
const day = (s) =>
  validDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
export function tdccForm(html) {
  const input = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = m[0].match(/\bname=["']([^"']+)["']/i)?.[1],
      value = m[0].match(/\bvalue=["']([^"']*)["']/i)?.[1];
    if (
      name &&
      ["SYNCHRONIZER_TOKEN", "SYNCHRONIZER_URI", "firDate"].includes(name)
    )
      input[name] = value || "";
  }
  const select = html.match(
    /<select\b[^>]*\bname=["']scaDate["'][^>]*>([\s\S]*?)<\/select>/i,
  )?.[1];
  const dates = [
    ...new Set(
      [
        ...String(select || "").matchAll(
          /<option\b[^>]*value=["'](\d{8})["']/gi,
        ),
      ].map((m) => day(m[1])),
    ),
  ]
    .filter((d) => d <= taipeiDay())
    .sort()
    .reverse();
  if (
    !input.SYNCHRONIZER_TOKEN ||
    input.SYNCHRONIZER_URI !== "/portal/zh/smWeb/qryStock" ||
    !dates.length
  )
    throw Error("集保官方查詢表單或歷史週別無法確認");
  return { input, dates };
}
export function parseTdccWeek(html, symbol, date) {
  const table = html.match(
    /<table\b[^>]*class=["'][^"']*\btable\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
  )?.[1];
  const prefix = table ? html.slice(0, html.indexOf(table)) : html;
  const text = clean(prefix);
  const code = text.match(/證券代號\s*[：:]\s*([A-Za-z0-9]+)/)?.[1];
  const stamp = text.match(
    /資料日期\s*[：:]\s*(\d{3,4})年\s*(\d{1,2})月\s*(\d{1,2})日/,
  );
  const actual = stamp
    ? `${Number(stamp[1]) < 1911 ? Number(stamp[1]) + 1911 : Number(stamp[1])}-${stamp[2].padStart(2, "0")}-${stamp[3].padStart(2, "0")}`
    : null;
  if (code !== symbol || actual !== date || !table)
    throw Error("集保回傳標的、日期或級距表格不符，未填入歷史資料");
  const rows = [];
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => clean(m[1]).replaceAll(",", ""),
    );
    if (cells.length !== 5) continue;
    const label = cells[1].replace(/[\s\u3000]/g, "");
    const level = /合計/.test(label)
      ? "total"
      : /差異/.test(label)
        ? "差異數"
        : /^1000001以上$/.test(label)
          ? "morethan1000000"
          : label;
    const people = num(cells[2]),
      shares = num(cells[3]),
      percent = num(cells[4]);
    if (
      !/^\d+-\d+$/.test(level) &&
      !["total", "差異數", "morethan1000000"].includes(level)
    )
      throw Error("集保出現未知級距");
    if (
      (level !== "差異數" && (!Number.isSafeInteger(people) || people < 0)) ||
      !Number.isSafeInteger(shares) ||
      percent == null ||
      (level !== "差異數" && (shares < 0 || percent < 0 || percent > 100))
    )
      throw Error("集保級距數值無法核對");
    rows.push({
      stock_id: symbol,
      date,
      HoldingSharesLevel: level,
      unit: shares,
      people,
      percent,
      source_url: TDCC_HISTORY_URL,
    });
  }
  const expected = [
    "1-999",
    "1000-5000",
    "5001-10000",
    "10001-15000",
    "15001-20000",
    "20001-30000",
    "30001-40000",
    "40001-50000",
    "50001-100000",
    "100001-200000",
    "200001-400000",
    "400001-600000",
    "600001-800000",
    "800001-1000000",
    "morethan1000000",
    "total",
  ];
  const set = new Set(rows.map((r) => r.HoldingSharesLevel));
  if (
    ![16, 17].includes(rows.length) ||
    set.size !== rows.length ||
    expected.some((k) => !set.has(k)) ||
    Math.abs(
      rows.find((r) => r.HoldingSharesLevel === "total")?.percent - 100,
    ) > 0.05
  )
    throw Error("集保完整級距未取得，不以部分占比計算");
  const total = rows.find((r) => r.HoldingSharesLevel === "total");
  if (
    rows
      .filter((r) => r.HoldingSharesLevel !== "total")
      .reduce((s, r) => s + r.unit, 0) !== total.unit
  )
    throw Error("集保級距股數與合計不符");
  return rows;
}
async function request(session, body) {
  return queue(async () => {
    const delay = Math.max(0, nextAt - Date.now());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    nextAt = Date.now() + 400;
    const response = await fetch(TDCC_HISTORY_URL, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: {
        ...(session.cookie ? { Cookie: session.cookie } : {}),
        ...(body
          ? {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: TDCC_HISTORY_URL,
            }
          : {}),
      },
      ...(body ? { body: new URLSearchParams(body) } : {}),
    });
    if (!response.ok) throw Error("集保歷史來源暫時無法取得");
    const jar = new Map(
      session.cookie
        ? session.cookie.split("; ").map((s) => {
            const i = s.indexOf("=");
            return [s.slice(0, i), s.slice(i + 1)];
          })
        : [],
    );
    for (const c of response.headers.getSetCookie?.() || []) {
      const first = c.split(";")[0],
        i = first.indexOf("=");
      jar.set(first.slice(0, i), first.slice(i + 1));
    }
    session.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const text = await response.text();
    if (text.length > 1500000) throw Error("集保回應超出預期範圍");
    return text;
  });
}
export async function tdccHistory(symbol, start, end, onProgress = () => {}) {
  const session = { cookie: "" };
  let form = tdccForm(await request(session));
  const dates = form.dates.filter((d) => start <= d && d <= end);
  const data = [],
    failed = [],
    skipped = [];
  let consecutiveFailures = 0;
  for (const date of dates) {
    const key = `${symbol}:${date}`;
    let stored = cache.get(key);
    if (
      stored &&
      Date.now() - stored.at < (date === form.dates[0] ? 300000 : 86400000)
    ) {
      data.push(...stored.rows);
      onProgress(data, {
        loaded_weeks: data.length ? new Set(data.map((r) => r.date)).size : 0,
        requested_weeks: dates.length,
      });
      continue;
    }
    let task = pendingWeeks.get(key);
    try {
      if (!task) {
        task = (async () => {
          const html = await request(session, {
            ...form.input,
            method: "submit",
            scaDate: date.replaceAll("-", ""),
            sqlMethod: "StockNo",
            stockNo: symbol,
            stockName: "",
          });
          const received_at = new Date().toISOString();
          const rows = parseTdccWeek(html, symbol, date).map((r) => ({
            ...r,
            received_at,
          }));
          form = tdccForm(html);
          cache.set(key, { at: Date.now(), rows });
          if (cache.size > 256) cache.delete(cache.keys().next().value);
          return rows;
        })();
        pendingWeeks.set(key, task);
      }
      const rows = await task;
      data.push(...rows);
      consecutiveFailures = 0;
    } catch {
      failed.push(date);
      consecutiveFailures++;
    } finally {
      if (pendingWeeks.get(key) === task) pendingWeeks.delete(key);
    }
    onProgress([...data], {
      loaded_weeks: new Set(data.map((r) => r.date)).size,
      requested_weeks: dates.length,
      failed_weeks: [...failed],
    });
    if (consecutiveFailures >= 3) {
      skipped.push(...dates.slice(dates.indexOf(date) + 1));
      break;
    }
  }
  if (dates.length && !data.length)
    throw Error("集保所選歷史週別皆未通過查證，不能當成無紀錄");
  return {
    data,
    coverage: {
      available_start: form.dates.at(-1),
      available_end: form.dates[0],
      available_weeks: form.dates.length,
      requested_weeks: dates.length,
      loaded_weeks: new Set(data.map((r) => r.date)).size,
      failed_weeks: failed,
      skipped_weeks: skipped,
      scope: "historical_weeks",
    },
  };
}
export function clearTdccHistoryCache() {
  cache.clear();
  nextAt = 0;
}
