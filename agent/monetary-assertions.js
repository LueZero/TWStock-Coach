// Interpret monetary wording without changing the report text. In particular,
// a loss list has negative economic values even when its printed amounts are
// unsigned: 「毛損失分別為2,380元與80元」.
export function monetaryAssertions(text) {
  const source = text.replace(
    /\b\d{4}-\d{2}-\d{2}\b|\b(?:0?[1-9]|1[0-2])[\/／](?:0?[1-9]|[12]\d|3[01])\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g,
    (date) => " ".repeat(date.length),
  );
  const pattern =
    /(?:價格|價位|停損|停利|目標價|支撐|壓力|買價|賣價|買入價|賣出價|買進價|收盤價|開盤價|進場價|出場價|觀察價|優先價|承接價|買入|買進|賣出)\s*[：:為在約]?\s*([-−﹣－＋+負]?[\d,]+(?:\.\d+)?)\s*(?:元)?(?![\d.日週月季年根期分張股倍%])|(?:NT\$|新台幣)\s*([-−﹣－＋+負]?[\d,]+(?:\.\d+)?)|([-−﹣－＋+負]?[\d,]+(?:\.\d+)?)\s*元/g;
  return [...source.matchAll(pattern)].map((m) => {
    const before = source
      .slice(0, m.index)
      .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
      .split(/[，,；;。！？!?\n]/)
      .at(-1);
    const after = source.slice(m.index + m[0].length);
    const contexts = [
      ...before.matchAll(
        /毛損失|毛虧損|虧損|損失|毛利|毛損益|淨利|淨損益|淨損失|淨虧損|獲利|盈利|(?<!均)價差|價格|價位|收盤|均線|配息|股息|股利|成本|買價|賣價/g,
      ),
    ];
    const context = contexts.at(-1)?.[0] || "";
    let kind = m[1] ? "price" : "amount";
    if (
      /^(?:買價|賣價|買入|賣出|買進|進場價|出場價|承接價)/.test(m[0]) ||
      /(?:買進|買入|賣出|委託|進場|出場)\s*$/.test(before) ||
      /^\s*(?:買入|買進|賣出|買|賣)(?:[，、；。\s]|$)/.test(after)
    )
      kind = "order";
    else if (!m[1]) {
      if (/淨利|淨損/.test(context)) kind = "net";
      else if (/損失|虧損|毛利|毛損益|獲利|盈利/.test(context)) kind = "gross";
      else if (context === "價差")
        kind = /(?:每股|一股)[^，、]{0,12}$/.test(before)
          ? "difference"
          : "trade_amount";
      if (kind === "gross" && /(?:每股|一股)[^，、]{0,12}$/.test(before))
        kind = "difference";
    }
    const raw = m[1] || m[2] || m[3];
    let number = Number(
      raw
        .replaceAll(",", "")
        .replace(/[−﹣－負]/g, "-")
        .replace("＋", "+"),
    );
    if (
      ["gross", "net", "difference"].includes(kind) &&
      /損失|虧損/.test(context)
    )
      number = -Math.abs(number);
    // User-stated goals are assumptions; do not mistake them for earned profit.
    if (kind === "gross" && /(?:目標|希望|期望|想要).{0,8}$/.test(before))
      kind = "amount";
    return { assertion: m[0], number, kind, offset: m.index };
  });
}

export function calculatedAmounts(report) {
  const result = {
    gross: new Set(),
    net: new Set(),
    difference: new Set(),
    trade_amount: new Set(),
  };
  for (const evidence of report.evidence || []) {
    const data = evidence.data;
    // Only successful calculator evidence enters this envelope. A random volume,
    // EPS, user target or other numerical cell cannot substantiate personal P/L.
    if (data?.formula !== "毛損益＝（賣價－買價）×股數") continue;
    for (const [kind, field] of [
      ["gross", "gross_profit"],
      ["net", "net_profit"],
      ["difference", "price_difference"],
    ]) {
      if (typeof data[field] === "number" && Number.isFinite(data[field])) {
        result[kind].add(String(data[field]));
        result[kind].add(String(Number(data[field].toFixed(2))));
        if (kind !== "net") {
          result.trade_amount.add(String(data[field]));
          result.trade_amount.add(String(Number(data[field].toFixed(2))));
        }
      }
    }
  }
  return result;
}
