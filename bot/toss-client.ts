// 토스증권 Open API 클라이언트 (필요한 엔드포인트만 구현)
// 문서: https://developers.tossinvest.com/llms.txt

const BASE_URL = "https://openapi.tossinvest.com";

export type HoldingItem = {
  symbol: string;
  name: string;
  marketCountry: "KR" | "US";
  currency: "KRW" | "USD";
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue: { purchaseAmount: string; amount: string };
};

export type MarketSession = { startTime: string; endTime: string } | null;

export type UsMarketDay = {
  date: string;
  regularMarket: MarketSession;
};

export type OrderRequest =
  | { clientOrderId?: string; symbol: string; side: "SELL"; orderType: "MARKET"; quantity: string }
  | { clientOrderId?: string; symbol: string; side: "BUY"; orderType: "MARKET"; orderAmount: string };

export class TossApiError extends Error {
  status: number;
  code: string;
  requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(`[${status} ${code}] ${message}`);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TossClient {
  private clientId: string;
  private clientSecret: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  // 토큰은 클라이언트당 1개만 유효하므로 캐싱해서 재사용한다
  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt) {
      return this.token.value;
    }
    const res = await fetch(`${BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 403 ? " (허용 IP 에 등록되지 않은 IP 일 수 있습니다)" : "";
      throw new TossApiError(res.status, body.error ?? "token-error", (body.error_description ?? "토큰 발급 실패") + hint);
    }
    // 만료 5분 전에 미리 갱신
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 300) * 1000,
    };
    return this.token.value;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { accountSeq?: number; query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    for (let attempt = 0; attempt < 4; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.getToken()}`,
      };
      if (opts.accountSeq != null) headers["X-Tossinvest-Account"] = String(opts.accountSeq);
      if (opts.body) headers["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (res.ok) return ((await res.json()) as { result: T }).result;

      const err = (await res.json().catch(() => ({}))).error ?? {};
      const code: string = err.code ?? "unknown";

      // 토큰 만료·대체 시 재발급 후 재시도
      if (res.status === 401 && ["expired-token", "token-revoked"].includes(code)) {
        await this.getToken(true);
        continue;
      }
      // 호출 한도 초과 시 Retry-After 만큼 대기 (지수 백오프 + jitter)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await sleep(retryAfter * 1000 + Math.random() * 300);
        continue;
      }
      throw new TossApiError(res.status, code, err.message ?? res.statusText, err.requestId);
    }
    throw new TossApiError(429, "retry-exhausted", `재시도 횟수 초과: ${method} ${path}`);
  }

  getAccounts() {
    return this.request<{ accountNo: string; accountSeq: number; accountType: string }[]>("GET", "/api/v1/accounts");
  }

  async getHoldings(accountSeq: number): Promise<HoldingItem[]> {
    const result = await this.request<{ items: HoldingItem[] }>("GET", "/api/v1/holdings", { accountSeq });
    return result.items ?? [];
  }

  async getUsMarketToday(): Promise<UsMarketDay> {
    const result = await this.request<{ today: UsMarketDay }>("GET", "/api/v1/market-calendar/US");
    return result.today;
  }

  createOrder(accountSeq: number, order: OrderRequest) {
    return this.request<{ orderId: string; clientOrderId?: string }>("POST", "/api/v1/orders", {
      accountSeq,
      body: order,
    });
  }
}
