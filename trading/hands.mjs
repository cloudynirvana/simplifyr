#!/usr/bin/env node
// HANDS: execution layer. Default = PAPER (no funds move). LIVE is refused until a live
// executor is configured AND LIVE_TRADING=1 AND --confirm is passed. Plug the "jev" API into
// executors.jev below once its endpoint/auth details are confirmed.
import { appendFileSync } from 'node:fs';

const MAX_USD = Number(process.env.MAX_ORDER_USD ?? 25);

const executors = {
  paper: async o => ({ ok: true, mode: 'paper', ...o, ts: Date.now() }),
  jev: async () => { throw new Error('jev executor not wired: need API base URL + auth scheme/docs'); },
};

export async function execute(order, { live = false } = {}) {
  if (order.usd > MAX_USD) throw new Error(`order $${order.usd} exceeds MAX_ORDER_USD=${MAX_USD}`);
  const mode = live && process.env.LIVE_TRADING === '1' ? (process.env.EXECUTOR ?? 'jev') : 'paper';
  const res = await executors[mode](order);
  appendFileSync(new URL('./trades.log.jsonl', import.meta.url), JSON.stringify(res) + '\n');
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [side, token, usd] = process.argv.slice(2);
  console.log(await execute({ side, token, usd: Number(usd) }, { live: process.argv.includes('--confirm') }));
}
