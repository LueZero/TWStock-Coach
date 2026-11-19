// One source request at a time; visible analysis precedes background enrichment.
export function sourceQueue() {
  const waiting = [];
  let running = false;
  function next() {
    if (running || !waiting.length) return;
    waiting.sort((a, b) => b.priority - a.priority);
    const item = waiting.shift();
    running = true;
    Promise.resolve()
      .then(item.work)
      .then(item.resolve, item.reject)
      .finally(() => {
        running = false;
        next();
      });
  }
  const enqueue = (work, priority = 1, key = null) =>
    new Promise((resolve, reject) => {
      waiting.push({ work, priority, key, resolve, reject });
      next();
    });
  enqueue.promote = (key, priority) => {
    for (const item of waiting)
      if (item.key === key) item.priority = Math.max(item.priority, priority);
  };
  return enqueue;
}
