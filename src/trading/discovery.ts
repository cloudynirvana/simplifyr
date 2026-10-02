/** Tracks newly created tokens and says when each is due for an HTTP check (30m, 1h, 2h, 4h, 8h after creation). */
export const CHECKPOINTS_MIN = [30, 60, 120, 240, 480];

export interface Pending { mint: string; name: string; symbol: string; createdAt: number; next: number }

export class Discovery {
  private m = new Map<string, Pending>();
  constructor(private cap = 20000, readonly checkpoints = CHECKPOINTS_MIN) {}
  get size() { return this.m.size; }
  add(mint: string, name: string, symbol: string, now = Date.now()) {
    if (this.m.has(mint)) return;
    if (this.m.size >= this.cap) { const oldest = this.m.keys().next().value as string; this.m.delete(oldest); } // Map keeps insertion order
    this.m.set(mint, { mint, name, symbol, createdAt: now, next: 0 });
  }
  /** Tokens whose next checkpoint has passed, oldest first. */
  due(now = Date.now(), limit = 300): Pending[] {
    const out: Pending[] = [];
    for (const p of this.m.values()) if (now - p.createdAt >= this.checkpoints[p.next] * 60_000) out.push(p);
    return out.sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
  }
  /** Mark a token's current checkpoint done; drops it after the last one. */
  advance(mint: string) { const p = this.m.get(mint); if (!p) return; p.next++; if (p.next >= this.checkpoints.length) this.m.delete(mint); }
}
