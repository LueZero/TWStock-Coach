// Process-local rolling request budget. Every attempt, including retries, counts.
export function createSourceBudget(limit = 300, clock = Date.now) {
  const starts = [];
  const windowMs = 3600000;
  const clean = () => {
    const now = clock();
    while (starts.length && starts[0] <= now - windowMs) starts.shift();
    return now;
  };
  const status = () => {
    const now = clean();
    return {
      limit,
      remaining: Math.max(0, limit - starts.length),
      retry_after_ms:
        starts.length >= limit ? Math.max(0, starts[0] + windowMs - now) : 0,
    };
  };
  return {
    status,
    consume() {
      const now = clean();
      if (starts.length >= limit) {
        const error = Object.assign(
          Error(
            "FinMind 本機每小時查詢額度已用完，請稍後重試；已取得資料仍可查看。",
          ),
          {
            statusCode: 429,
            code: "SOURCE_BUDGET",
            retryAfterMs: starts[0] + windowMs - now,
          },
        );
        throw error;
      }
      starts.push(now);
    },
  };
}
