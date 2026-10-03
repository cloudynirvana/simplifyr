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

export function gmgn(args) {
  const out = execFileSync('gmgn-cli', args, { encoding: 'utf8', env: process.env, maxBuffer: 32 << 20 });
  return JSON.parse(out);
}

// Append-only journal: every signal, fill, close and reject follow-up. Source of truth for metrics.
import { appendFileSync as _a } from 'node:fs';
export const JOURNAL = new URL('./journal.jsonl', import.meta.url).pathname;
export const journal = r => _a(JOURNAL, JSON.stringify({ ts: Date.now(), ...r }) + '\n');
export const readJournal = () => existsSync(JOURNAL)
  ? readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
