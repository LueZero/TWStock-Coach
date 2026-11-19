// Convert vendor diagnostics into fixed, safe messages. Never echo response text.
export function finMindError(status, body = {}) {
  const message = typeof body.msg === "string" ? body.msg : "";
  let code,
    text,
    http = status;
  if (
    /TokenLevelTooLow|token[ _-]*level[ _-]*too[ _-]*low|permission|sponsor|backer/i.test(
      message,
    )
  ) {
    code = "SOURCE_PERMISSION";
    text =
      "目前 FinMind 帳戶沒有此資料集權限；加入 Token 不代表已取得付費權限。";
    http = 403;
  } else if (/TokenIllegal/i.test(message) || status === 401) {
    code = "SOURCE_AUTH";
    text = "FinMind Token 無效或已失效，請更新設定。";
    http = 401;
  } else if (status === 402 || status === 429) {
    code = "SOURCE_QUOTA";
    text = "FinMind 來源額度或速率已達上限，請稍後重試。";
    http = 429;
  } else if (/ip banned/i.test(message)) {
    code = "SOURCE_BLOCKED";
    text = "FinMind 暫時封鎖來源連線，請稍後重試。";
    http = 503;
  } else {
    code = "SOURCE_RESPONSE";
    text = `FinMind 來源回應異常（${status}），並非確認沒有資料。`;
    http = status >= 400 ? status : 502;
  }
  return Object.assign(Error(text), { code, statusCode: http });
}
