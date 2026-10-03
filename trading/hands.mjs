#!/usr/bin/env node
// HANDS: execution layer. Default = PAPER with realistic fills (paper.mjs). LIVE is refused until a live
// executor is wired AND LIVE_TRADING=1 AND --confirm. Plug the "jev" API into executors.jev later.
import { journal } from './lib.mjs';
import { paperFill } from './paper.mjs';

const MAX_USD = Number(process.env.MAX_ORDER_USD ?? 25), CHAIN = process.env.CHAIN ?? 'sol';
const executors = {
  paper: o => paperFill(o, CHAIN),
  jev: async () => { throw new Error('jev executor not wired: need API base URL + auth scheme/docs'); },
};

export async function execute(order, { live = false } = {}) {
  if (order.side === 'buy' && order.usd > MAX_USD) throw new Error(`order $${order.usd} exceeds MAX_ORDER_USD=${MAX_USD}`);
  const mode = live && process.env.LIVE_TRADING === '1' ? (process.env.EXECUTOR ?? 'jev') : 'paper';
  const res = await executors[mode](order);
  journal({ event: 'fill', side: order.side, token: order.token, decisionPx: order.px, ...res, mode: res.mode ?? mode });
  return res;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [side, token, amt] = process.argv.slice(2);
  console.log(await execute(side === 'buy' ? { side, token, usd: +amt } : { side, token, units: +amt }, { live: process.argv.includes('--confirm') }));
}
