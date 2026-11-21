// Process-local resources only. No disk, SQL or persistent queue.
const cache = new Map();
export function resource(key, load, ttl = 300000, { retryWhen } = {}) {
  let entry = cache.get(key);
  const retryable = entry?.error || (entry?.value && retryWhen?.(entry.value));
  if (
    entry?.pending ||
    (entry && Date.now() - entry.at < (retryable ? 60000 : ttl))
  )
    return entry;
  if (!entry && cache.size >= 96) {
    const oldest = [...cache].find(([, e]) => !e.pending);
    if (oldest) cache.delete(oldest[0]);
    else
      throw Object.assign(Error("來源查詢繁忙，請稍後重試"), {
        statusCode: 429,
      });
  }
  entry = {
    value: entry?.value,
    received_at: entry?.received_at,
    pending: true,
    at: Date.now(),
    error: null,
    error_code: null,
  };
  cache.set(key, entry);
  entry.promise = Promise.resolve()
    .then(() => load(entry.value))
    .then(
      (value) => {
        entry.value = value;
        entry.received_at = new Date().toISOString();
      },
      (error) => {
        entry.error_code = error.code || null;
        entry.error =
          error.statusCode === 422 ||
          [
            "SOURCE_PERMISSION",
            "SOURCE_AUTH",
            "SOURCE_QUOTA",
            "SOURCE_BLOCKED",
          ].includes(error.code)
            ? error.message
            : "來源暫時無法取得，未以DB或推估資料補值。";
      },
    )
    .finally(() => {
      entry.pending = false;
      entry.at = Date.now();
    });
  return entry;
}
export const cachedResources = () => [...cache.values()];
export const clearSourceCache = () => cache.clear();
