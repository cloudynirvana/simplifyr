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
export class RateLimited extends Error {}
export const rateLimitWaitMs = () => Math.max(0, cooldownUntil - Date.now());

export function gmgn(args, { ttlMs = 20000 } = {}) {
  if (Date.now() < cooldownUntil) throw new RateLimited(`GMGN cooldown ${Math.ceil(rateLimitWaitMs() / 1000)}s`);
  const k = args.join(' '), hit = cache.get(k);
  if (ttlMs && hit && Date.now() - hit.t < ttlMs) return hit.v;
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
