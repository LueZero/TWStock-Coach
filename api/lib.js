import { createHash } from "node:crypto";
// Try today's official daily source only after the post-close publication window.
export function dailySourceEnd(stamp = new Date()) {
  const local = new Date(new Date(stamp).getTime() + 8 * 3600000);
  return new Date(
    local.getTime() -
      (local.getUTCHours() * 60 + local.getUTCMinutes() >= 870 ? 0 : 86400000),
  )
    .toISOString()
    .slice(0, 10);
}
export const DAY = 86400000;
export const now = () => new Date().toISOString();
export const taipeiDay = (value = new Date()) =>
  new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export const addDays = (day, n) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
export const previousQuarter = (p) =>
  new Date(
    Date.UTC(
      Number(p.slice(0, 4)),
      Math.floor((Number(p.slice(5, 7)) - 1) / 3) * 3,
      0,
    ),
  )
    .toISOString()
    .slice(0, 10);
export const priorYear = (p, n = 1) =>
  String(Number(p.slice(0, 4)) - n) + p.slice(4);
export const num = (v) =>
  v == null || v === "" || typeof v === "boolean"
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;
export const pick = (v, ...keys) =>
  keys.map((k) => v?.[k]).find((x) => x != null) ?? null;
export const div = (a, b, scale = 1) =>
  a != null && b != null && b > 0 ? (a / b) * scale : null;
export const average = (a, b) => (a != null && b != null ? (a + b) / 2 : null);
export const latestKey = (v) => Object.keys(v).sort().at(-1) ?? null;
export const sum = (values) => values.reduce((a, b) => a + b, 0);
export const strictSum = (values) =>
  values.every((v) => v != null) ? sum(values) : null;
export const median = (values) => {
  const v = [...values].sort((a, b) => a - b),
    n = v.length;
  return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null;
};
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function fail(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-") ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("日期格式無效");
  return value;
}
export function validStamp(value) {
  const match =
    typeof value === "string"
      ? /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(
          value,
        )
      : null;
  if (
    !match ||
    Number(match[1]) > 23 ||
    Number(match[2]) > 59 ||
    Number(match[3] ?? 0) > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    fail("時間戳需具明確時區");
  validDate(value.slice(0, 10));
  return new Date(value).toISOString();
}
export function stock(market, symbol) {
  if (
    !["TWSE", "TPEX"].includes(market) ||
    typeof symbol !== "string" ||
    !/^[A-Za-z0-9]{2,16}$/.test(symbol)
  )
    fail("市場或股票代號格式不符");
  return { market, symbol };
}
export function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(label + "超出範圍或不是整數");
  return value;
}
export function finiteNumber(value, min, max, label) {
  const n = num(value);
  if (n == null || n < min || n > max) fail(label + "超出範圍");
  return n;
}
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(", ") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ": " + canonical(value[k]))
        .join(", ") +
      "}"
    );
  if (typeof value === "number" && !Number.isFinite(value))
    fail("資料不能含非有限數值");
  return JSON.stringify(value);
}
export const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export async function fetchJSON(url, settings = {}, extra = {}) {
  const { timeout = 45000, ...options } =
    typeof settings === "number" ? { timeout: settings, ...extra } : settings;
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("Source HTTP " + response.status);
  return response.json();
}
export function serialQueue() {
  let tail = Promise.resolve();
  return (fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
}
