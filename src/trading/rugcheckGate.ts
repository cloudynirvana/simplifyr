/** Rate-limited, cached RugCheck gate. Call only for tokens that already passed every other filter. */
import { getRugCheckReport, FetchLike } from "../lib/rugcheck";
import { evaluateRugCheck } from "./rugcheckFilter";

export interface GateResult { pass: boolean; failures: string[]; error?: string }

export function makeRugCheckGate(opts: { minGapMs?: number; ttlMs?: number; fetchImpl?: FetchLike; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const gap = opts.minGapMs ?? 3000, ttl = opts.ttlMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now, sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cache = new Map<string, { at: number; res: GateResult }>();
  let last = 0;
  return async (mint: string): Promise<GateResult> => {
    const hit = cache.get(mint);
    if (hit && now() - hit.at < ttl) return hit.res;
    const wait = last + gap - now();
    if (wait > 0) await sleep(wait);
    last = now();
    let res: GateResult;
    try {
      const v = evaluateRugCheck(await getRugCheckReport(mint, opts.fetchImpl));
      res = { pass: v.pass, failures: v.failures };
    } catch (e) {
      res = { pass: false, failures: ["rugcheck unavailable (failing closed)"], error: (e as Error).message }; // fail closed
    }
    if (!res.error) cache.set(mint, { at: now(), res }); // don't cache errors
    return res;
  };
}
