/**
 * PumpPortal DATA feed (read-only websocket). No keys, no orders, no wallet.
 *   wss://pumpportal.fun/api/data  — subscribeNewToken / subscribeTokenTrade
 * Event field names below are from memory and UNVERIFIED (docs were not reachable from the build sandbox);
 * verify against https://pumpportal.fun/data-api/real-time before trusting them. The trading API
 * (real transactions from a funded wallet) is deliberately NOT implemented here.
 */

export interface PortalEvent {
  txType?: "create" | "buy" | "sell";
  signature?: string;
  mint?: string;
  traderPublicKey?: string;
  name?: string; symbol?: string;
  initialBuy?: number;        // dev's initial buy, whole tokens (create only)
  bondingCurve?: string; bondingCurveKey?: string;
  tokenAmount?: number; solAmount?: number;
  newTokenBalance?: number;   // trader's balance after the trade
  vSolInBondingCurve?: number; vTokensInBondingCurve?: number;
  marketCapSol?: number;
  pool?: string;              // "pump" while on the curve
}

export interface WebSocketLike {
  readyState?: number;
  send(data: string): void; close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export class PumpPortalFeed {
  private ws: WebSocketLike | null = null;
  private stopped = false;
  private retry = 0;
  private subscribed = new Set<string>();

  constructor(
    private onEvent: (e: PortalEvent) => void,
    private opts: { url?: string; WS?: WebSocketCtor; log?: (m: string) => void } = {}
  ) {}

  start() {
    this.stopped = false;
    const WS = this.opts.WS ?? ((globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket);
    const ws = new WS(this.opts.url ?? "wss://pumpportal.fun/api/data");
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      if (this.subscribed.size) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [...this.subscribed] }));
    };
    ws.onmessage = (m) => {
      try { this.onEvent(JSON.parse(String(m.data)) as PortalEvent); } catch { /* ignore non-JSON frames */ }
    };
    ws.onerror = () => this.opts.log?.("pumpportal ws error");
    ws.onclose = () => {
      if (this.stopped) return;
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.opts.log?.(`pumpportal ws closed; reconnecting in ${wait}ms`);
      setTimeout(() => this.start(), wait);
    };
  }

  trackTrades(mint: string) {
    if (this.subscribed.has(mint)) return;
    this.subscribed.add(mint);
    if (this.isOpen()) this.ws!.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] })); // else replayed in onopen
  }
  untrackTrades(mint: string) {
    if (!this.subscribed.delete(mint)) return;
    if (this.isOpen()) this.ws!.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
  }

  private isOpen() { return this.ws !== null && (this.ws.readyState === undefined || this.ws.readyState === 1); }

  stop() { this.stopped = true; this.ws?.close(); }
}
