// One transport contract for discovery, stock, market and health tools.
// Never include upstream bodies, query strings or credentials in errors.
export function createStockApiClient(apiUrl, { fetcher = fetch, signal } = {}) {
  const base = new URL(apiUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error("股票API網址設定不符");
  async function request(path, body, timeoutMs = 45000) {
    try {
      const response = await fetcher(new URL(path, base), {
        method: body ? "POST" : "GET",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(timeoutMs),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok)
        throw Object.assign(
          Error(
            `股票API回應HTTP ${response.status}（${path.split("?")[0]}），請核對工具參數及來源狀態`,
          ),
          { code: "STOCK_API_HTTP", http_status: response.status },
        );
      let data;
      try {
        data = await response.json();
      } catch {
        throw Object.assign(
          Error("股票API回應不是有效JSON，請檢查API位址與反向代理設定"),
          { code: "STOCK_API_FORMAT" },
        );
      }
      if (!data || typeof data !== "object")
        throw Object.assign(
          Error("股票API回應結構不符，請核對服務與反向代理設定"),
          { code: "STOCK_API_FORMAT" },
        );
      if (JSON.stringify(data).length > 4000000)
        throw Object.assign(Error("股票API回應過大，請縮小區間或分頁"), {
          code: "STOCK_API_SIZE",
        });
      return data;
    } catch (error) {
      if (error.code?.startsWith("STOCK_API_")) throw error;
      if (signal?.aborted)
        throw Object.assign(Error("股票資料查詢已取消"), {
          code: "STOCK_API_CANCELLED",
        });
      if (
        ["TimeoutError", "AbortError"].includes(error.name) ||
        [
          "ETIMEDOUT",
          "UND_ERR_CONNECT_TIMEOUT",
          "UND_ERR_HEADERS_TIMEOUT",
        ].includes(error.cause?.code)
      )
        throw Object.assign(
          Error("股票API查詢逾時；服務或上游來源尚未回應，不代表無資料"),
          { code: "STOCK_API_TIMEOUT" },
        );
      const causes = [
        error.cause?.code,
        ...(error.cause?.errors || []).map((item) => item.code),
      ];
      if (causes.includes("ECONNREFUSED"))
        throw Object.assign(
          Error(
            `股票API未啟動或連線被拒絕（${base.origin}）。請啟動 docker compose up -d api，並確認 ASSISTANT_STOCK_API_URL 與API位址一致；Codex登入成功不代表股票API已連線。`,
          ),
          { code: "STOCK_API_UNREACHABLE" },
        );
      if (causes.some((code) => ["ENOTFOUND", "EAI_AGAIN"].includes(code)))
        throw Object.assign(
          Error(
            "無法解析股票API主機；本機助手不能使用僅容器內可見的服務名稱，請核對ASSISTANT_STOCK_API_URL",
          ),
          { code: "STOCK_API_DNS" },
        );
      throw Object.assign(
        Error(
          "股票API連線中斷；請檢查服務、網路與代理設定，不代表來源沒有資料",
        ),
        { code: "STOCK_API_NETWORK" },
      );
    }
  }
  async function health() {
    try {
      const data = await request("/health", undefined, 3000);
      if (data.database_used !== false)
        return {
          ready: false,
          code: "STOCK_API_FORMAT",
          note: "此位址未確認為目前的無DB股票API，請核對服務版本與設定",
        };
      return {
        ready: true,
        database_used: false,
        note: "股票API已連線；各上游資料的權限與完整性仍須依個別查詢判斷",
      };
    } catch (error) {
      return { ready: false, code: error.code, note: error.message };
    }
  }
  return { request, health };
}
