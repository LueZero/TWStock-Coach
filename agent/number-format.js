import Decimal from "decimal.js";

// Intl/decimal half-up display and legacy toFixed may differ at binary ties
// (28.435 -> 28.44 vs 28.43). Both describe the same sourced number. These are
// display variants only; executable orders still use the legal tick checker.
export function numberDisplayVariants(value, places = [2, 4]) {
  if (typeof value !== "number" || !Number.isFinite(value)) return [];
  const values = new Set([String(value)]);
  for (const digits of places) {
    values.add(String(Number(value.toFixed(digits))));
    // MA sums can carry binary noise such as 28.434999999999995. Normalize
    // insignificant noise before decimal display rounding, not before orders.
    values.add(
      new Decimal(value.toPrecision(15))
        .toDecimalPlaces(digits, Decimal.ROUND_HALF_UP)
        .toString(),
    );
  }
  return [...values];
}
