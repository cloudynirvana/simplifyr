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
