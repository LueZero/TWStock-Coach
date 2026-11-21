import { resource } from "./source-cache.js";
import { fetchJSON, num, validDate, taipeiDay } from "./lib.js";

export function parseBookValue(rows, symbol, market) {
  const row = rows.find(
    (r) =>
      String(r["公司代號"] ?? r.CompanyCode ?? r.SecuritiesCompanyCode) ===
      symbol,
  );
  if (!row) return [];
  const year = Number(row["年度"] ?? row.Year),
    quarter = Number(row["季別"] ?? row.Season);
  const value = num(row["每股參考淨值"] ?? row.NetAssetValuePerShare);
  if (
    !Number.isInteger(year) ||
    ![1, 2, 3, 4].includes(quarter) ||
    value == null
  )
    return [];
  const date = `${year < 1911 ? year + 1911 : year}-${["03-31", "06-30", "09-30", "12-31"][quarter - 1]}`;
  validDate(date);
  return [
    {
      stock_id: symbol,
      date,
      type: "OfficialBookValuePerShare",
      value,
      market,
      origin_name: "官方每股參考淨值",
      published_date: row["出表日期"] ?? row.Date ?? null,
    },
  ];
}
export async function officialBookValue(market, symbol) {
  let failed = false;
  for (const sector of ["ci", "basi", "bd", "fh", "ins", "mim"]) {
    const url =
      market === "TWSE"
        ? `https://openapi.twse.com.tw/v1/opendata/t187ap07_L_${sector}`
        : `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_${sector}`;
    const e = resource(
      `official-book:${market}:${sector}:${taipeiDay()}`,
      async () => {
        const rows = await fetchJSON(url, 15000);
        if (!Array.isArray(rows)) throw Error("官方財報格式不符");
        return rows;
      },
      86400000,
    );
    await e.promise;
    if (e.error) {
      failed = true;
      continue;
    }
    const rows = parseBookValue(e.value, symbol, market);
    if (rows.length) return rows.map((r) => ({ ...r, source_url: url }));
  }
  if (failed)
    throw Error("部分官方財報來源暫時無法取得，尚不能判定此股沒有淨值資料");
  return [];
}
