import { saved } from "./market-board.js";
import { fetchJSON, validDate } from "./lib.js";

const number = (v) =>
  v == null || String(v).trim() === "" || v === "--"
    ? null
    : Number(String(v).replaceAll(",", ""));
const isoDate = (v) =>
  /^\d{8}$/.test(v || "")
    ? validDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}`)
    : null;
export function parseInstitutional(body, date) {
  if (
    body.stat !== "OK" ||
    isoDate(body.date) !== date ||
    !Array.isArray(body.data)
  )
    throw Error("指定日期無法人統計");
  return body.data.map((r) => ({
    name: r[0],
    buy: number(r[1]),
    sell: number(r[2]),
    net: number(r[3]),
    unit: "元",
  }));
}
export function parseMargin(body, date) {
  if (body.stat !== "OK" || isoDate(body.date) !== date)
    throw Error("指定日期無融資融券統計");
  const table = body.tables?.find((t) => t.fields?.includes("今日餘額"));
  if (!table?.data?.length) throw Error("融資融券欄位未提供");
  return table.data.map((r) => {
    const money = r[0].includes("金額"),
      scale = money ? 1000 : 1;
    const value = (i) => (number(r[i]) == null ? null : number(r[i]) * scale);
    const previous = value(4),
      balance = value(5);
    return {
      name: r[0],
      buy: value(1),
      sell: value(2),
      repayment: value(3),
      previous,
      balance,
      change: previous == null || balance == null ? null : balance - previous,
      unit: money ? "元" : "交易單位",
    };
  });
}
export function parseFuturesInstitutional(data, date) {
  const result = data
    .filter((r) => r.ContractCode === "臺股期貨" && isoDate(r.Date) === date)
    .map((r) => ({
      name: r.Item,
      buy: number(r["TradingVolume(Long)"]),
      sell: number(r["TradingVolume(Short)"]),
      net: number(r["TradingVolume(Net)"]),
      open_interest_net: number(r["OpenInterest(Net)"]),
      unit: "口",
    }));
  if (!result.length)
    throw Error("此來源只提供最新一日台指期法人統計，指定日期未提供");
  return result;
}
export async function marketChips(date) {
  const key = date.replaceAll("-", ""),
    received = new Date().toISOString();
  const specs = [
    [
      "institutional",
      "證交所 · 上市法人買賣",
      `https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${key}&type=day`,
      parseInstitutional,
    ],
    [
      "margin",
      "證交所 · 上市融資融券",
      `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${key}&selectType=MS`,
      parseMargin,
    ],
    [
      "futures",
      "期交所 · 台指期法人日統計",
      "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate",
      parseFuturesInstitutional,
    ],
  ];
  const sources = await Promise.all(
    specs.map(async ([id, label, url, parser]) => {
      try {
        return {
          id,
          label,
          url,
          available: true,
          ...(await saved(`market-chips:${id}:${date}`, 300000, async () => ({
            date,
            received_at: received,
            data: parser(await fetchJSON(url, 12000), date),
          }))),
        };
      } catch {
        return {
          id,
          label,
          url,
          date,
          available: false,
          data: [],
          warning: "此日期未提供資料或來源暫時無法連線，請選擇有交易的日期。",
        };
      }
    }),
  );
  return {
    date,
    sources,
    notes: [
      "上市法人為金額統計；不將外資自營商再次加總。",
      "融資金額已從仟元換算為元；交易單位保留來源單位。",
      "台指期法人為全契約日統計，不能解讀為特定月份或夜盤的法人進出。",
      "此處統計於收盤後公布，不是盤中即時籌碼。",
    ],
  };
}
