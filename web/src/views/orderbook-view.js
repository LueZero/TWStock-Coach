// Shared presentation for stock (shares/lots) and futures (contracts) books.
export function renderOrderbook({
  rows,
  balance,
  quote,
  volumeKey,
  quantity,
  price,
}) {
  rows.replaceChildren();
  balance.replaceChildren();
  const bids = quote?.bids || [],
    asks = quote?.asks || [];
  const max = Math.max(
    1,
    ...[...bids, ...asks].map((level) => level[volumeKey] ?? 0),
  );
  for (let index = 0; index < 5; index++) {
    const row = document.createElement("tr");
    function depth(level, sell) {
      const cell = document.createElement("td");
      cell.className = "depth" + (sell ? " sell" : "");
      const fill = document.createElement("i");
      fill.className = "depth-fill" + (sell ? " ask" : "");
      fill.style.width = ((level?.[volumeKey] ?? 0) / max) * 95 + "%";
      const value = document.createElement("span");
      value.textContent = quantity(level?.[volumeKey]);
      cell.append(fill, value);
      row.append(cell);
    }
    function cell(value, className = "") {
      const td = document.createElement("td");
      td.className = className;
      td.textContent = value;
      row.append(td);
    }
    depth(bids[index], false);
    cell(price(bids[index]?.price), "up");
    cell(index + 1);
    cell(price(asks[index]?.price), "down");
    depth(asks[index], true);
    rows.append(row);
  }
  if (!quote) return;
  const valid = (levels) =>
    levels.filter((level) => level.price != null && level[volumeKey] != null);
  const buyLevels = valid(bids),
    sellLevels = valid(asks);
  if (buyLevels.length !== 5 || sellLevels.length !== 5) {
    balance.textContent = "部分檔位未揭示，缺值以「—」顯示，不視為零委託。";
    return;
  }
  const buy = buyLevels.reduce((sum, level) => sum + level[volumeKey], 0);
  const sell = sellLevels.reduce((sum, level) => sum + level[volumeKey], 0);
  balance.textContent = `五檔合計　委買 ${quantity(buy)} ／ 委賣 ${quantity(sell)}`;
  if (buy + sell) {
    const bar = document.createElement("div"),
      fill = document.createElement("i");
    bar.className = "balance-bar";
    fill.style.width = (buy / (buy + sell)) * 100 + "%";
    bar.append(fill);
    balance.append(bar);
  }
}
