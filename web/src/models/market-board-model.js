export function aggregateBoardMinutes(data, step, closed = false) {
  const groups = new Map();
  for (const row of data) {
    // End-stamped source minutes are grouped within each session, never across products.
    const key = Math.floor(
      (row.session_minute - (row.session_start_minute || 0) - 1) / step,
    );
    if (!groups.has(key)) groups.set(key, { ...row });
    else {
      const bar = groups.get(key);
      bar.high = Math.max(bar.high, row.high);
      bar.low = Math.min(bar.low, row.low);
      bar.close = row.close;
      bar.label = row.label;
      bar.is_final &&= row.is_final;
      bar.volume =
        bar.volume == null || row.volume == null
          ? null
          : bar.volume + row.volume;
    }
  }
  const result = [...groups.values()];
  // The trailing bucket is still forming until its last source minute reaches the bucket end.
  if (result.length && data.length && !closed) {
    const last = data.at(-1),
      anchor = last.session_start_minute || 0;
    const bucketEnd =
      anchor +
      (Math.floor((last.session_minute - anchor - 1) / step) + 1) * step;
    if (!last.is_final || last.session_minute < bucketEnd)
      result.at(-1).is_final = false;
  }
  return result;
}
