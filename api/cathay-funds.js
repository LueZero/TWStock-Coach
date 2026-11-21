import { resource } from "./source-cache.js";
import { fetchJSON, num, taipeiDay, validDate } from "./lib.js";
export const CATHAY_API = "https://cwapi.cathaysite.com.tw/api/";
async function get(path, params = {}, ttl = 3600000) {
  const url = CATHAY_API + path + "?" + new URLSearchParams(params);
  const e = resource(
    `cathay:${url}`,
    async () => {
      const j = await fetchJSON(url, 15000);
      if (j.returnCode === "4005" && j.success === false && j.result == null)
        return {
          ...j,
          source_empty: true,
          received_at: new Date().toISOString(),
        };
      if (j.returnCode !== "2000" || j.success !== true)
        throw Error("國泰公開資料未取得可驗證結果");
      return { ...j, received_at: new Date().toISOString() };
    },
    ttl,
  );
  await e.promise;
  if (e.error) throw Error("國泰公開來源暫時無法取得");
  return e.value;
}
export async function cathayFunds() {
  const j = await get(
    "ETF/GetETFList",
    { CurrentPage: "1", PerPageCount: "100" },
    86400000,
  );
  if (
    !Array.isArray(j.result) ||
    j.result.length !== j.totalCount ||
    j.totalCount > 100
  )
    throw Error("國泰基金目錄未取得完整分頁");
  const rows = j.result
    .filter(
      (r) =>
        /^[A-Za-z0-9]{1,12}$/.test(r.fundCode) &&
        /^[A-Za-z0-9]{2,16}$/.test(r.stockCode),
    )
    .map((r) => ({
      fundCode: r.fundCode,
      stockNo: r.stockCode,
      shortName: r.stockShortNameFix || r.stockShortName,
      issuer: "cathay",
    }));
  if (
    rows.length !== j.result.length ||
    new Set(rows.map((r) => r.stockNo)).size !== rows.length
  )
    throw Error("國泰基金代碼無法完整核對");
  return rows;
}
const dateOf = (s) => validDate(String(s || "").replaceAll("/", "-"));
const number = (s) => num(typeof s === "string" ? s.replaceAll(",", "") : s);
export function parseCathayStocks(j, fund, date) {
  if (j.returnCode !== "2000" || j.success !== true || !Array.isArray(j.result))
    throw Error("國泰股票明細格式不符");
  const rows = j.result.map((r) => {
    const shares = number(r.volumn),
      weight = number(r.weights);
    if (
      !/^[A-Za-z0-9.\-]{1,24}$/.test(r.stockCode) ||
      !Number.isSafeInteger(shares) ||
      shares < 0 ||
      weight == null ||
      weight < 0 ||
      weight > 100
    )
      throw Error("國泰股票明細數量或權重無法核對");
    return {
      symbol: r.stockCode,
      name: r.stockName,
      holding_shares: shares,
      weight_percent: weight,
      date,
      effective_date: null,
      fund_code: fund.stockNo,
      fund_name: fund.shortName,
      basis: "issuer_daily_portfolio",
      source: "cathay_public",
      source_url: `https://www.cathaysite.com.tw/fund-details/E${fund.fundCode}?tab=portfolio`,
    };
  });
  if (new Set(rows.map((r) => r.symbol)).size !== rows.length)
    throw Error("國泰股票明細重複代號");
  return rows;
}
export async function cathayPortfolio(fund) {
  const assets = await get("ETF/GetETFAssets", { FundCode: fund.fundCode });
  const date = dateOf(assets.result?.preDate);
  if (date > taipeiDay()) throw Error("國泰組合估值日不符");
  const j = await get("ETF/GetETFDetailStockList", {
    FundCode: fund.fundCode,
    SearchDate: date,
  });
  const rows = parseCathayStocks(j, fund, date);
  return {
    date,
    effective_date: null,
    fund_code: fund.stockNo,
    fund_name: fund.shortName,
    rows,
    received_at: j.received_at,
    basis: "issuer_daily_portfolio",
    stock_weight_percent: rows.reduce((s, r) => s + r.weight_percent, 0),
    other_assets_present: null,
    stock_table_only: true,
    note: "國泰投信公開日組合，依來源估值日查詢股票明細。此表只列股票，不是全部資產，也不是全市場基金持股；來源未提供PCF適用日則留空。",
  };
}
export function parseCathayQuarter(j, fund) {
  if (
    j.returnCode !== "2000" ||
    j.success !== true ||
    !/^\d{4}\/(03|06|09|12)$/.test(j.result?.date) ||
    !Array.isArray(j.result.categoryDetailList)
  )
    throw Error("國泰季度揭露格式不符");
  const [year, month] = j.result.date.split("/").map(Number);
  const date = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  if (date > taipeiDay()) throw Error("季度日期在未來");
  const rows = [];
  for (const category of j.result.categoryDetailList) {
    if (!Array.isArray(category.industryDetailList))
      throw Error("季度產業明細不完整");
    for (const industry of category.industryDetailList) {
      if (!Array.isArray(industry.targetDetailList))
        throw Error("季度投資標的明細不完整");
      for (const target of industry.targetDetailList) {
        const weight = number(target.proportion);
        if (!target.targetName || weight == null || weight < 0 || weight > 100)
          throw Error("季度標的權重無法核對");
        rows.push({
          name: String(target.targetName).trim(),
          category: String(category.categoryName).trim(),
          industry: String(industry.industryName).trim(),
          weight_percent: weight,
          date,
          holding_shares: null,
          symbol: null,
        });
      }
    }
  }
  return {
    date,
    rows,
    fund_code: fund.stockNo,
    fund_name: fund.shortName,
    basis: "issuer_quarterly_disclosure",
    source: "cathay_public_quarterly",
    source_url: `https://www.cathaysite.com.tw/fund-details/E${fund.fundCode}?tab=portfolio`,
    note: "投信公開季度投資揭露，僅有標的名稱及權重；來源未提供股票代號、股數及實際公告時間，不以名稱猜代號或推算股數，也不與每日組合相加。",
  };
}
export async function cathayQuarterly(symbol, end) {
  const fund = (await cathayFunds()).find((r) => r.stockNo === symbol);
  if (!fund)
    return {
      status: "not_connected",
      rows: [],
      note: "此發行人的季度揭露來源尚未接入；不是確認沒有季報。",
    };
  const j = await get("Fund/GetSeasonInvestmentDetail", {
    fundCode: fund.fundCode,
  });
  if (j.source_empty)
    return {
      status: "no_data",
      rows: [],
      received_at: j.received_at,
      note: "投信季度揭露來源本次回覆查無資料；不推論所有年度或其他來源皆沒有。",
    };
  const data = parseCathayQuarter(j, fund);
  if (data.date > end)
    return {
      status: "outside_range",
      rows: [],
      latest_source_date: data.date,
      note: "來源僅提供最新季度揭露，期間晚於截止，未回填歷史。",
    };
  return { status: "available", ...data, received_at: j.received_at };
}
