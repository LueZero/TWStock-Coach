export const signalCategories = [
  ["all", "全部訊號"],
  ["ma", "均線排列／交叉"],
  ["momentum", "MACD／KD交叉"],
  ["levels", "突破／跌破"],
];

export function renderTechnicalMarkers({
  svg,
  rows,
  x,
  y,
  left,
  right,
  top,
  bottom,
  eventsForRow = (r) => r.technical_events || [],
  filter = "all",
  onSelect,
  onInspect,
}) {
  const ns = "http://www.w3.org/2000/svg",
    occupied = { support: -Infinity, oppose: -Infinity };
  let count = 0;
  const node = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  rows.forEach((row, i) => {
    if (row.is_final === false) return;
    const events = eventsForRow(row).filter(
      (e) =>
        filter === "all" ||
        (e.category ||
          (/MACD|KD/.test(e.label)
            ? "momentum"
            : /均線|MA/.test(e.label)
              ? "ma"
              : "levels")) === filter,
    );
    count += events.length;
    for (const kind of ["support", "oppose"]) {
      const items = events.filter((e) => e.kind === kind);
      if (!items.length) continue;
      const support = kind === "support",
        color = support ? "#f27b8c" : "#53c9a2";
      const cx = x(i),
        cy = support
          ? Math.min(bottom - 7, y(row.low) + 10)
          : Math.max(top + 7, y(row.high) - 10);
      const label = items[0].short_label || items[0].label;
      const text = label + (items.length > 1 ? `+${items.length - 1}` : "");
      const group = node("g", {
        tabindex: 0,
        role: "button",
        "aria-label": `${row.trade_date} ${items.map((e) => e.label).join("、")}`,
        "data-technical-event": items.map((e) => e.label).join("、"),
        "data-signal": items.map((e) => e.label).join("、"),
        "data-event-kind": kind,
        "data-bar-timestamp": row.timestamp || row.trade_date,
        cursor: "pointer",
      });
      group.append(
        node(
          "title",
          {},
          `${row.timestamp || row.trade_date}\n${items.map((e) => `${e.label}：${e.note}`).join("\n")}`,
        ),
      );
      group.append(
        node("path", {
          d: support
            ? `M${cx},${cy - 5} l-5,9 h10 z`
            : `M${cx},${cy + 5} l-5,-9 h10 z`,
          fill: color,
          stroke: "#091827",
          "stroke-width": 1,
        }),
      );
      const width = Math.min(112, text.length * 10 + 10),
        textX = Math.max(left + width / 2, Math.min(right - width / 2, cx));
      if (textX - width / 2 > occupied[kind] + 5) {
        const ty = support
          ? Math.min(bottom - 2, cy + 18)
          : Math.max(top + 12, cy - 9);
        group.append(
          node(
            "text",
            {
              x: textX,
              y: ty,
              fill: color,
              stroke: "#091827",
              "stroke-width": 3,
              "paint-order": "stroke",
              "font-size": 12,
              "font-weight": 700,
              "text-anchor": "middle",
              "data-event-label": "true",
            },
            text,
          ),
        );
        occupied[kind] = textX + width / 2;
      }
      group.onmouseenter = group.onfocus = () => onInspect?.(row);
      group.onclick = (e) => {
        e.stopPropagation();
        onInspect?.(row);
        onSelect?.(row);
      };
      group.onkeydown = (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          onInspect?.(row);
          onSelect?.(row);
        }
      };
      svg.append(group);
    }
  });
  return count;
}
