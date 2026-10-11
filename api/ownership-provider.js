import { fetchJSON, num, validDate } from "./lib.js";
const cache = new Map();
export function rocDate(value, monthEnd = false) {
  const text = String(value).replace(/[^0-9]/g, "");
  if (!/^\d{5}(\d{2})?$/.test(text)) throw Error("Invalid disclosure date");
  const year = Number(text.slice(0, 3)) + 1911,
    month = Number(text.slice(3, 5));
  const day =
    text.length === 7
      ? Number(text.slice(5))
      : monthEnd
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 1;
  return validDate(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}
export function parseOwnership(records, symbol, type, url) {
  return records
    .filter(
      (r) =>
        String(r["公司代號"] ?? r.CompanyCode ?? r.SecuritiesCompanyCode) ===
        symbol,
    )
    .map((r) => {
      const number = (key) =>
        num(
          String(r[key] ?? "")
            .replaceAll(",", "")
            .replace("%", ""),
        );
      if (type === "DirectorHoldingsReport") {
        const date = rocDate(r["資料年月"]),
          role = r["職稱"];
        return {
          date,
          period_month: date.slice(0, 7),
          published_at: rocDate(r["出表日期"]),
          stock_id: symbol,
          role,
          name: r["姓名"],
          holding_shares: number("目前持股"),
          holding_percent: null,
          pledge_shares: number("設質股數"),
          pledge_percent: number("設質股數佔持股比例"),
          related_holding_shares: number("內部人關係人目前持股合計"),
          aggregate_eligible: !String(role).includes("法人代表"),
          source_url: url,
        };
      }
      const own = number("預定轉讓總股數-自有持股"),
        trust = number("預定轉讓總股數-保留運用決定權信託股數");
      return {
        date: rocDate(r["出表日期"] ?? r.Date),
        date_kind: "公開資料出表日",
        stock_id: symbol,
        name: r["姓名"],
        role: r["申報人身分"] ?? r["申請人身分"],
        method: r["預定轉讓方式及股數-轉讓方式"],
        transfer_shares:
          own != null && trust != null
            ? own + trust
            : number("預定轉讓方式及股數-轉讓股數"),
        transfer_period: r["有效轉讓期間"],
        source_url: url,
      };
    });
}
export async function officialOwnership(market, symbol, type) {
  const table = type === "DirectorHoldingsReport" ? "11" : "12";
  const url =
    market === "TWSE"
      ? `https://openapi.twse.com.tw/v1/opendata/t187ap${table}_L`
      : `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap${table}_O`;
  let cached = cache.get(url);
  if (!cached || Date.now() - cached.time > 600000) {
    const records = await fetchJSON(url);
    if (!Array.isArray(records))
      throw Error("Disclosure response is not an array");
    cached = { records, time: Date.now() };
    cache.set(url, cached);
  }
  return parseOwnership(cached.records, symbol, type, url);
}
