import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Load .env.local from repo root (gitignored) without printing secrets.
const envPath = new URL('../.env.local', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const l of readFileSync(envPath, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// GMGN rate limits are per ACCOUNT (shared by every machine using the key) and hammering extends the ban.
// So: cache identical reads briefly, and after a 429 refuse all calls until the stated reset time has passed.
const cache = new Map();
let cooldownUntil = 0;
// Client-side leaky bucket matching GMGN's plan limits (rate/capacity in weight units): free 5/5, plus 20/20, pro 50/50.
// Weights from the GMGN skill docs. We wait BEFORE sending instead of getting 429s (which extend the ban).
const TIER = { free: 5, plus: 20, pro: 50 }[process.env.GMGN_TIER ?? 'free'] ?? 5;
const WEIGHT = { 'market kline': 2, 'market trending': 3, 'market trenches': 2, 'portfolio activity': 3, 'portfolio stats': 3,
  'portfolio holdings': 2, 'token holders': 5, 'token traders': 5 };
let level = 0, lastLeak = Date.now();
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function throttle(args) {
  const w = WEIGHT[args.slice(0, 2).join(' ')] ?? 1;
  for (;;) {
    const t = Date.now(); level = Math.max(0, level - ((t - lastLeak) / 1000) * TIER); lastLeak = t;
    if (level + w <= TIER) { level += w; return; }
    pause(Math.ceil(((level + w - TIER) / TIER) * 1000) + 20);
  }
}
export class RateLimited extends Error {}
export const rateLimitWaitMs = () => Math.max(0, cooldownUntil - Date.now());

export function gmgn(args, { ttlMs = 20000 } = {}) {
  if (Date.now() < cooldownUntil) throw new RateLimited(`GMGN cooldown ${Math.ceil(rateLimitWaitMs() / 1000)}s`);
  const k = args.join(' '), hit = cache.get(k);
  if (ttlMs && hit && Date.now() - hit.t < ttlMs) return hit.v;
  throttle(args);
  try {
    const v = JSON.parse(execFileSync('gmgn-cli', args, { encoding: 'utf8', env: process.env, maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
    cache.set(k, { t: Date.now(), v });
    if (cache.size > 2000) cache.clear();
    return v;
  } catch (e) {
    const msg = String(e.stderr ?? e.message);
    if (/429|RATE_LIMIT/.test(msg)) {
      const m = msg.match(/~(\d+)s remaining/);
      cooldownUntil = Date.now() + ((m ? Number(m[1]) : 60) + 10) * 1000;   // wait the stated time + margin
      throw new RateLimited(`GMGN rate limited, pausing ${Math.ceil(rateLimitWaitMs() / 1000)}s`);
    }
    throw e;
  }
}

// Append-only journal: every signal, fill, close and reject follow-up. Source of truth for metrics.
import { appendFileSync as _a } from 'node:fs';
export const JOURNAL = new URL('./journal.jsonl', import.meta.url).pathname;
export const journal = r => _a(JOURNAL, JSON.stringify({ ts: Date.now(), ...r }) + '\n');
export const readJournal = () => existsSync(JOURNAL)
  ? readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
