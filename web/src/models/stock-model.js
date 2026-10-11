const stockKey = () => state.stock.market + ":" + state.stock.symbol;

const analysisBar = () => state.selected || completed().at(-1);

async function analysisJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : "請檢查數值、日期與持倉成本",
    );
  return data;
}

const taipeiDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const shiftDay = (day, n) =>
  new Date(new Date(day + "T12:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

const state = {
  stock: { market: "TWSE", symbol: "2330", name: "台積電", industry: "半導體" },
  mode: "live",
  chart: "daily",
  quote: null,
  rows: [],
  points: [],
  generation: 0,
  controller: new AbortController(),
  favorites: [],
  shownMAs: new Set([5, 10, 20, 60]),
  lastRefresh: 0,
  loading: false,
  market: null,
  resolution: "1d",
  range: null,
  rangePreset: null,
  presetRange: null,
  rangeRequest: 0,
  selected: null,
  viewport: { start: 0, count: null },
  quoteBusy: false,
  monitoringActive: false,
  marketChecked: 0,
  financialData: null,
  equityData: null,
  insight: null,
};

const maPeriods = [5, 10, 20, 60, 120, 240];

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: state.controller.signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : "資料暫時無法載入，請稍後再試",
    );
  return data;
}

function loadFavorites() {
  let stored = false;
  try {
    const list = JSON.parse(
      localStorage.getItem("stock-coach-favorites") || "null",
    );
    if (Array.isArray(list)) {
      stored = true;
      state.favorites = list
        .filter(
          (s) =>
            ["TWSE", "TPEX"].includes(s.market) &&
            /^[A-Za-z0-9]{2,16}$/.test(s.symbol),
        )
        .slice(0, 30);
    }
  } catch {}
  if (!stored)
    state.favorites = [
      { market: "TWSE", symbol: "2330", name: "台積電" },
      { market: "TWSE", symbol: "0050", name: "元大台灣50" },
      { market: "TPEX", symbol: "6488", name: "環球晶" },
    ];
}

function completed() {
  return state.rows.filter((r) => r.is_final);
}

function isMinute() {
  return state.resolution.endsWith("m") && state.resolution !== "1mo";
}

export function initStockModel() {}

export {
  stockKey,
  analysisBar,
  analysisJson,
  taipeiDay,
  shiftDay,
  state,
  maPeriods,
  json,
  loadFavorites,
  completed,
  isMinute,
};
