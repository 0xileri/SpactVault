/**
 * LIVE 1Click error responses, recorded 2026-11-03 by the owner with curl against
 * https://1click.chaindefuser.com (no API key or JWT). Verbatim bodies.
 */

/**
 * POST /v0/quote with liveRequest(true, "vault2.0xileri.near") and liveRequest(false, "vault2.0xileri.near")
 * -> HTTP 400 both times. vault2.0xileri.near did not exist yet; the same requests refunding to the existing
 * vault.0xileri.near succeeded (./quote-dry.ts, ./quote.ts). The message does not say which field is wrong.
 */
export const refundAccountMissing = {
  status: 400,
  bodies: [
    {"message":"Internal server error","correlationId":"5a154194-4fa2-4c96-bc29-ed340206e1f6","timestamp":"2026-11-03T10:49:52.187Z","path":"/v0/quote"},
    {"message":"Internal server error","correlationId":"7ecd9b76-3692-4da5-90a2-eee7f128e6f4","timestamp":"2026-11-03T10:49:53.455Z","path":"/v0/quote"},
  ],
};

/** GET /v0/status?depositAddress=null (asked by mistake after the failed quote) -> HTTP 404. */
export const unknownDeposit = {
  status: 404,
  body: {"message":"Deposit address null not found","error":"Not Found","statusCode":404,"timestamp":"2026-11-03T10:49:54.227Z","path":"/v0/status?depositAddress=null"},
};
