/**
 * GMGN OpenAPI — READ-ONLY client (market/token data). Mirrors the official gmgn-cli "exist" auth:
 * header X-APIKEY + query timestamp & client_id. No signing key is used or accepted here, and no trade,
 * swap, order or wallet-write endpoint is implemented. Env: GMGN_API_KEY.
 * Rate limit (documented): leaky bucket rate 10 / capacity 10; 429s carry X-RateLimit-Reset (unix s).
 * Hammering during cooldown extends a ban, so this client spaces calls and waits out resets.
 */
export type Query = Record<string, string | number | string[]>;
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(k: string): string | null }; text(): Promise<string> }>;

export class GmgnClient {
  private last = 0;
  constructor(private apiKey: string, private opts: { minGapMs?: number; fetchImpl?: FetchLike; host?: string } = {}) {
    if (!apiKey) throw new Error("GMGN_API_KEY missing");
  }
  static fromEnv(): GmgnClient | null { const k = process.env.GMGN_API_KEY; return k ? new GmgnClient(k) : null; }

  private async req(method: "GET" | "POST", sub: string, q: Query, body?: unknown, attempt = 0): Promise<any> {
    const gap = this.opts.minGapMs ?? 250, wait = this.last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, timestamp: Math.floor(Date.now() / 1000), client_id: crypto.randomUUID() }))
      Array.isArray(v) ? v.forEach((x) => p.append(k, x)) : p.set(k, String(v));
    const f = this.opts.fetchImpl ?? (fetch as unknown as FetchLike);
    const res = await f(`${this.opts.host ?? "https://openapi.gmgn.ai"}${sub}?${p}`, { method, headers: { "X-APIKEY": this.apiKey, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const txt = await res.text();
    if (res.status === 429 && attempt < 2) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const ms = Number.isFinite(reset) && reset > 0 ? Math.min(30_000, reset * 1000 - Date.now() + 250) : 3000;
      await new Promise((r) => setTimeout(r, Math.max(1000, ms)));
      return this.req(method, sub, q, body, attempt + 1);
    }
    let j: any; try { j = JSON.parse(txt); } catch { throw new Error(`GMGN ${res.status}: non-JSON`); }
    if (res.status !== 200 || (j.code !== undefined && j.code !== 0)) throw new Error(`GMGN ${res.status} ${j.code ?? ""} ${j.msg ?? j.message ?? j.error ?? ""}`.trim());
    let d = j.data; while (d && typeof d === "object" && "data" in d && "code" in d) d = d.data; // responses are sometimes double-wrapped
    return d;
  }

  /** Trending ranking (up to 100). interval: 1m|5m|1h|6h|24h. extra: e.g. { orderby: "volume" } passes through unchanged. */
  async rank(chain: string, interval: string, extra: Query = {}): Promise<any[]> { const d = await this.req("GET", "/v1/market/rank", { chain, interval, limit: 100, ...extra }); return d?.rank ?? []; } // API default is only 10
  async trenches(chain: string, types: string[] = ["new_creation", "near_completion", "completed"], limit = 80): Promise<{ new_creation?: any[]; pump?: any[]; completed?: any[] }> {
    return (await this.req("POST", "/v1/trenches", { chain }, { type: types, limit })) ?? {};
  }
  async tokenSecurity(chain: string, address: string): Promise<any> { return this.req("GET", "/v1/token/security", { chain, address }); }
  async tokenInfo(chain: string, address: string): Promise<any> { return this.req("GET", "/v1/token/info", { chain, address }); }
  async createdTokens(chain: string, wallet: string): Promise<any> { return this.req("GET", "/v1/user/created_tokens", { chain, wallet_address: wallet }); }
}
